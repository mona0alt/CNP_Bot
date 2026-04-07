import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import cors from 'cors';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { RawData } from 'ws';
import { z } from 'zod';
import jwt, { type SignOptions } from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import multer from 'multer';
import {
  deleteGlobalSkillAndRebind,
  importGlobalSkillZip,
  renameGlobalSkillAndRebind,
} from './skills-admin-service.js';
import {
  getAllRegisteredGroups,
  getRecentMessages,
  getAllTasks,
  getChatsByRole,
  canAccessChat,
  getMessagesSinceAll,
  storeChatMetadata,
  storeMessageDirect,
  deleteChatByRole,
  getUserByUsername,
  getUserById,
  getAllUsers,
  createUser,
  updateUser,
  updateUserPassword,
  updateUserLastLogin,
  deleteUser,
  getSessionSkillBindings,
  getSessionSkillSyncState,
  replaceSessionSkillBindings,
  setSessionSkillSyncState,
  type UserWithoutPassword,
} from './db.js';
import { logger } from './logger.js';
import { ASSISTANT_NAME, JWT_SECRET, JWT_EXPIRES_IN, AgentType, DEFAULT_AGENT_TYPE } from './config.js';
import { getSlashCommands } from './slash-commands.js';
import {
  createGlobalSkillEntry,
  deleteGlobalSkillEntry,
  getGlobalSkillTree,
  listGlobalSkills,
  moveGlobalSkillEntry,
  readGlobalSkillFile,
  writeGlobalSkillFile,
} from './skills-store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Login rate limiter (in-memory, per IP) ---
// Max 10 failed attempts per 15 minutes per IP
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function checkLoginRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now >= entry.resetAt) {
    loginAttempts.set(ip, { count: 0, resetAt: now + LOGIN_WINDOW_MS });
    return true;
  }
  return entry.count < LOGIN_MAX_ATTEMPTS;
}

function recordLoginFailure(ip: string): void {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now >= entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

function clearLoginAttempts(ip: string): void {
  loginAttempts.delete(ip);
}

// --- Auth types ---

interface AuthUser {
  userId: string;
  username: string;
  role: 'admin' | 'user';
}

interface AuthRequest extends Request {
  user?: AuthUser;
}

// --- Auth middleware ---

function authenticateToken(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;
    req.user = decoded;
    next();
  } catch {
    res.status(403).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}

function verifyToken(token: string): AuthUser | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AuthUser;
  } catch {
    return null;
  }
}

export interface ServerOpts {
  port?: number;
  host?: string;
  skillsRootDir?: string;
  sendMessage?: (jid: string, text: string) => Promise<void>;
  onWebUserMessage?: (
    jid: string,
    text: string,
    userId: string,
  ) => Promise<{
    id: string;
    chat_jid: string;
    sender: string;
    sender_name: string;
    content: string;
    timestamp: string;
    is_from_me: boolean;
    is_bot_message: boolean;
  }>;
  onStopGeneration?: (jid: string) => void;
  onDeleteChat?: (jid: string) => void;
  getGroupStats?: (
    jid: string,
  ) => { usage?: { input_tokens: number; output_tokens: number } } | undefined;
  onCreateChat?: (
    jid: string,
    userId: string,
    agentType: AgentType,
  ) => void;
  onChatSkillsUpdated?: (
    jid: string,
  ) => Promise<{
    status: 'pending' | 'synced' | 'failed';
    errorMessage?: string;
  }>;
  isGroupActive?: (jid: string) => boolean;
  /** Returns the group folder for a given JID, used to write ask/confirm responses */
  getGroupFolder?: (jid: string) => string | undefined;
  /** Called when user submits answer to an ask_user request */
  onAskUserResponse?: (
    groupFolder: string,
    requestId: string,
    answer: string,
  ) => boolean;
  /** Called when user approves/denies a confirm_bash request */
  onConfirmBashResponse?: (
    groupFolder: string,
    requestId: string,
    approved: boolean,
  ) => boolean;
  /** Returns current pending interactive requests for websocket replay/reconnect recovery */
  getPendingInteractive?: (
    jid: string,
  ) => {
    asks: Array<{ requestId: string; question: string }>;
    confirms: Array<{ requestId: string; command: string; reason?: string; targetHost?: string }>;
  };
}

export interface BroadcastCapability {
  broadcastToJid: (jid: string, payload: unknown) => void;
}

export interface AppContext extends BroadcastCapability {
  app: express.Express;
  jidSockets: Map<string, Set<WebSocket>>;
}

export function createApp(opts: ServerOpts = {}): AppContext {
  const skillsRootDir = opts.skillsRootDir;
  const app = express();
  app.use(cors());
  app.use(express.json());
  const upload = multer({ dest: os.tmpdir() });

  const buildSkillListResponse = () =>
    listGlobalSkills(skillsRootDir).map((skill) => ({
      name: skill.name,
      has_skill_md: skill.hasSkillMd,
      updated_at: skill.updatedAt,
    }));

  const buildChatSkillsResponse = (jid: string) => {
    const syncState = getSessionSkillSyncState(jid);
    return {
      selectedSkills: getSessionSkillBindings(jid),
      syncStatus: syncState?.status ?? 'pending',
      lastSyncedAt: syncState?.last_synced_at ?? null,
      errorMessage: syncState?.error_message ?? null,
    };
  };

  const validateSkillSelection = (skills: string[]) => {
    const availableSkills = new Set(
      listGlobalSkills(skillsRootDir).map((skill) => skill.name),
    );
    for (const skill of skills) {
      if (!availableSkills.has(skill)) {
        throw new Error(`Unknown skill: ${skill}`);
      }
    }
  };

  const applyChatSkillsUpdate = async (jid: string, skills: string[]) => {
    validateSkillSelection(skills);
    replaceSessionSkillBindings(jid, skills);

    const outcome = opts.onChatSkillsUpdated
      ? await opts.onChatSkillsUpdated(jid)
      : { status: 'pending' as const, errorMessage: undefined };

    setSessionSkillSyncState(jid, {
      status: outcome.status,
      errorMessage: outcome.errorMessage ?? null,
      lastSyncedAt:
        outcome.status === 'synced' ? new Date().toISOString() : null,
    });
    return buildChatSkillsResponse(jid);
  };

  const isTopLevelSkillPath = (targetPath: string) => {
    const normalized = targetPath
      .replace(/\\/g, '/')
      .replace(/^\/+|\/+$/g, '');
    return normalized.length > 0 && !normalized.includes('/');
  };

  // Store connected sockets indexed by jid for O(1) broadcast lookup
  const jidSockets = new Map<string, Set<WebSocket>>();

  const broadcastToJid = (jid: string, payload: unknown) => {
    const sockets = jidSockets.get(jid);
    if (!sockets) return;
    const data = JSON.stringify(payload);
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(data);
        } catch {
          // Ignore send errors
        }
      }
    }
  };

  // API Endpoints
  app.get('/api/status', (req, res) => {
    res.json({
      status: 'running',
      assistantName: ASSISTANT_NAME,
      uptime: process.uptime(),
    });
  });

  app.get('/api/slash-commands', authenticateToken, async (req, res) => {
    try {
      const commands = await getSlashCommands();
      res.json(commands);
    } catch (err) {
      logger.error({ err }, 'Failed to get slash commands');
      res.status(500).json({ error: 'Failed to get slash commands' });
    }
  });

  app.get('/api/groups', authenticateToken, (req, res) => {
    try {
      const groups = getAllRegisteredGroups();
      res.json(groups);
    } catch (err) {
      logger.error({ err }, 'Failed to fetch groups');
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  app.get('/api/chats', authenticateToken, (req, res) => {
    try {
      const authReq = req as AuthRequest;
      const chats = getChatsByRole(authReq.user!.userId, authReq.user!.role);
      res.json(chats);
    } catch (err) {
      logger.error({ err }, 'Failed to fetch chats');
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  app.post('/api/chats', authenticateToken, (req, res) => {
    const schema = z.object({
      agentType: z.enum(['claude', 'deepagent']).optional(),
      skills: z.array(z.string().trim().min(1)).optional(),
    });

    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    try {
      const authReq = req as AuthRequest;
      const jid = 'web:' + randomUUID();
      const timestamp = new Date().toISOString();
      const agentType: AgentType =
        parsed.data.agentType || DEFAULT_AGENT_TYPE;
      const skills = parsed.data.skills ?? [];
      storeChatMetadata(
        jid,
        timestamp,
        'New Chat',
        'web',
        false,
        authReq.user!.userId,
        agentType,
      );
      validateSkillSelection(skills);
      replaceSessionSkillBindings(jid, skills);
      setSessionSkillSyncState(jid, { status: 'pending' });
      if (opts.onCreateChat) {
        opts.onCreateChat(jid, authReq.user!.userId, agentType);
      }
      res.status(201).json({
        jid,
        name: 'New Chat',
        last_message_time: timestamp,
        channel: 'web',
        is_group: 0,
        agent_type: agentType,
      });
    } catch (err) {
      logger.error({ err }, 'Failed to create chat');
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // --- Skills endpoints ---

  app.get('/api/skills', authenticateToken, requireAdmin, (_req, res) => {
    try {
      res.json(buildSkillListResponse());
    } catch (err) {
      logger.error({ err }, 'Failed to list skills');
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  app.get('/api/skills/tree', authenticateToken, requireAdmin, (req, res) => {
    try {
      const skill =
        typeof req.query.skill === 'string' ? req.query.skill : undefined;
      res.json(getGlobalSkillTree({ rootDir: skillsRootDir, skill }));
    } catch (err) {
      logger.error({ err }, 'Failed to load skill tree');
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid request' });
    }
  });

  app.get('/api/skills/file', authenticateToken, requireAdmin, (req, res) => {
    try {
      const targetPath =
        typeof req.query.path === 'string' ? req.query.path : '';
      if (!targetPath) {
        return res.status(400).json({ error: 'path is required' });
      }
      res.json(readGlobalSkillFile(targetPath, skillsRootDir));
    } catch (err) {
      logger.error({ err }, 'Failed to read skill file');
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid request' });
    }
  });

  app.put('/api/skills/file', authenticateToken, requireAdmin, (req, res) => {
    const schema = z.object({
      path: z.string().trim().min(1),
      content: z.string(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    try {
      writeGlobalSkillFile(parsed.data.path, parsed.data.content, skillsRootDir);
      res.json({ success: true });
    } catch (err) {
      logger.error({ err }, 'Failed to write skill file');
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid request' });
    }
  });

  app.post('/api/skills/fs', authenticateToken, requireAdmin, (req, res) => {
    const schema = z.object({
      parentPath: z.string(),
      name: z.string().trim().min(1),
      type: z.enum(['file', 'directory']),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    try {
      const createdPath = createGlobalSkillEntry(parsed.data, skillsRootDir);
      res.status(201).json({ path: createdPath });
    } catch (err) {
      logger.error({ err }, 'Failed to create skills entry');
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid request' });
    }
  });

  app.patch('/api/skills/fs', authenticateToken, requireAdmin, async (req, res) => {
    const schema = z.object({
      fromPath: z.string().trim().min(1),
      toPath: z.string().trim().min(1),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    try {
      if (
        isTopLevelSkillPath(parsed.data.fromPath) &&
        isTopLevelSkillPath(parsed.data.toPath)
      ) {
        await renameGlobalSkillAndRebind({
          fromPath: parsed.data.fromPath,
          toPath: parsed.data.toPath,
          globalRootDir: skillsRootDir,
          isChatActive: opts.isGroupActive,
          syncChatSkills: opts.onChatSkillsUpdated
            ? async (jid) => {
                await opts.onChatSkillsUpdated?.(jid);
              }
            : undefined,
        });
      } else {
        moveGlobalSkillEntry(
          parsed.data.fromPath,
          parsed.data.toPath,
          skillsRootDir,
        );
      }
      res.json({ success: true });
    } catch (err) {
      logger.error({ err }, 'Failed to move skills entry');
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid request' });
    }
  });

  app.delete('/api/skills/fs', authenticateToken, requireAdmin, async (req, res) => {
    const targetPath =
      typeof req.query.path === 'string' ? req.query.path : '';
    if (!targetPath) {
      return res.status(400).json({ error: 'path is required' });
    }

    try {
      if (isTopLevelSkillPath(targetPath)) {
        await deleteGlobalSkillAndRebind({
          relativePath: targetPath,
          globalRootDir: skillsRootDir,
          isChatActive: opts.isGroupActive,
          syncChatSkills: opts.onChatSkillsUpdated
            ? async (jid) => {
                await opts.onChatSkillsUpdated?.(jid);
              }
            : undefined,
        });
      } else {
        deleteGlobalSkillEntry(targetPath, skillsRootDir);
      }
      res.json({ success: true });
    } catch (err) {
      logger.error({ err }, 'Failed to delete skills entry');
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid request' });
    }
  });

  app.post(
    '/api/skills/upload-zip',
    authenticateToken,
    requireAdmin,
    upload.single('file'),
    async (req, res) => {
      if (!req.file) {
        return res.status(400).json({ error: 'Zip file is required' });
      }

      try {
        const result = await importGlobalSkillZip({
          zipPath: req.file.path,
          globalRootDir: skillsRootDir,
          originalName: req.file.originalname,
        });
        res.status(201).json(result);
      } catch (err) {
        logger.error({ err }, 'Failed to import skill zip');
        const message = err instanceof Error ? err.message : 'Invalid request';
        const statusCode = /already exists/i.test(message) ? 409 : 400;
        res.status(statusCode).json({ error: message });
      } finally {
        try {
          fs.rmSync(req.file.path, { force: true });
        } catch {}
      }
    },
  );

  app.get('/api/skills/catalog', authenticateToken, (_req, res) => {
    try {
      res.json(buildSkillListResponse());
    } catch (err) {
      logger.error({ err }, 'Failed to list skills catalog');
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  app.get('/api/skills/catalog/tree', authenticateToken, (req, res) => {
    try {
      const skill =
        typeof req.query.skill === 'string' ? req.query.skill : undefined;
      res.json(getGlobalSkillTree({ rootDir: skillsRootDir, skill }));
    } catch (err) {
      logger.error({ err }, 'Failed to load skills catalog tree');
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid request' });
    }
  });

  app.get('/api/skills/catalog/file', authenticateToken, (req, res) => {
    try {
      const targetPath =
        typeof req.query.path === 'string' ? req.query.path : '';
      if (!targetPath) {
        return res.status(400).json({ error: 'path is required' });
      }

      const file = readGlobalSkillFile(targetPath, skillsRootDir);
      const authReq = req as AuthRequest;
      if (authReq.user?.role !== 'admin') {
        return res.json({
          ...file,
          editable: false,
        });
      }
      return res.json(file);
    } catch (err) {
      logger.error({ err }, 'Failed to read skills catalog file');
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid request' });
    }
  });

  app.get('/api/chats/:jid/skills', authenticateToken, (req, res) => {
    try {
      const authReq = req as AuthRequest;
      const { jid } = req.params as { jid: string };
      if (!canAccessChat(jid, authReq.user!.userId, authReq.user!.role)) {
        return res.status(404).json({ error: 'Chat not found' });
      }
      res.json(buildChatSkillsResponse(jid));
    } catch (err) {
      logger.error({ err }, 'Failed to fetch chat skills');
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  app.put('/api/chats/:jid/skills', authenticateToken, async (req, res) => {
    const schema = z.object({
      skills: z.array(z.string().trim().min(1)),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    try {
      const authReq = req as AuthRequest;
      const { jid } = req.params as { jid: string };
      if (!canAccessChat(jid, authReq.user!.userId, authReq.user!.role)) {
        return res.status(404).json({ error: 'Chat not found' });
      }
      const response = await applyChatSkillsUpdate(jid, parsed.data.skills);
      res.json(response);
    } catch (err) {
      logger.error({ err }, 'Failed to update chat skills');
      const message = err instanceof Error ? err.message : 'Invalid request';
      const statusCode = /Unknown skill/i.test(message) ? 400 : 500;
      res.status(statusCode).json({ error: message });
    }
  });

  app.post('/api/chats/:jid/skills/sync', authenticateToken, async (req, res) => {
    try {
      const authReq = req as AuthRequest;
      const { jid } = req.params as { jid: string };
      if (!canAccessChat(jid, authReq.user!.userId, authReq.user!.role)) {
        return res.status(404).json({ error: 'Chat not found' });
      }
      const outcome = opts.onChatSkillsUpdated
        ? await opts.onChatSkillsUpdated(jid)
        : { status: 'pending' as const, errorMessage: undefined };
      setSessionSkillSyncState(jid, {
        status: outcome.status,
        errorMessage: outcome.errorMessage ?? null,
        lastSyncedAt:
          outcome.status === 'synced' ? new Date().toISOString() : null,
      });
      res.json(buildChatSkillsResponse(jid));
    } catch (err) {
      logger.error({ err }, 'Failed to sync chat skills');
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  app.delete('/api/chats/:jid', authenticateToken, (req, res) => {
    try {
      const authReq = req as AuthRequest;
      const { jid } = req.params as { jid: string };
      const deleted = deleteChatByRole(
        jid,
        authReq.user!.userId,
        authReq.user!.role,
      );
      if (!deleted) {
        return res.status(404).json({ error: 'Chat not found' });
      }
      // Call onDeleteChat to stop the container process if running
      if (opts.onDeleteChat) {
        opts.onDeleteChat(jid);
      }
      res.status(200).json({ success: true });
    } catch (err) {
      logger.error({ err }, 'Failed to delete chat');
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  app.get('/api/groups/:jid/status', authenticateToken, (req, res) => {
    try {
      const authReq = req as AuthRequest;
      const { jid } = req.params as { jid: string };
      const allowed = canAccessChat(
        jid,
        authReq.user!.userId,
        authReq.user!.role,
      );
      if (!allowed) {
        return res.status(404).json({ error: 'Chat not found' });
      }
      const groups = getAllRegisteredGroups();
      const group = groups[jid];
      const model = process.env.MODEL || process.env.ANTHROPIC_MODEL || '';

      if (!group) {
        return res.json({
          workingDirectory: null,
          model,
          usage: { input_tokens: 0, output_tokens: 0 },
          processReady: false,
          isActive: false,
        });
      }

      const stats = opts.getGroupStats ? opts.getGroupStats(jid) : undefined;

      res.json({
        workingDirectory: group.folder,
        model,
        usage: stats?.usage || { input_tokens: 0, output_tokens: 0 },
        processReady: true,
        isActive: opts.isGroupActive ? opts.isGroupActive(jid) : false,
      });
    } catch (err) {
      logger.error({ err }, 'Failed to fetch group status');
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  app.get('/api/groups/:jid/messages', authenticateToken, (req, res) => {
    try {
      const authReq = req as AuthRequest;
      const { jid } = req.params as { jid: string };
      const allowed = canAccessChat(
        jid,
        authReq.user!.userId,
        authReq.user!.role,
      );
      if (!allowed) {
        return res.status(404).json({ error: 'Chat not found' });
      }
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const since =
        typeof req.query.since === 'string' ? req.query.since : null;
      const messages = since
        ? getMessagesSinceAll(jid, since, limit)
        : getRecentMessages(jid, limit);
      res.json(messages);
    } catch (err) {
      logger.error({ err }, 'Failed to fetch messages');
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  app.post('/api/groups/:jid/messages', authenticateToken, async (req, res) => {
    const schema = z.object({
      content: z.string().trim().min(1).max(5000),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    const authReq = req as AuthRequest;
    const { jid } = req.params as { jid: string };
    const allowed = canAccessChat(
      jid,
      authReq.user!.userId,
      authReq.user!.role,
    );
    if (!allowed) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    const isWebChat = jid.startsWith('web:');
    const timestamp = new Date().toISOString();

    if (isWebChat) {
      try {
        if (!opts.onWebUserMessage) {
          return res.status(500).json({ error: 'Web chat not enabled' });
        }
        const stored = await opts.onWebUserMessage(
          jid,
          parsed.data.content,
          authReq.user!.userId,
        );
        return res.status(201).json(stored);
      } catch (err) {
        logger.error({ err, jid }, 'Failed to handle web chat message');
        return res.status(500).json({ error: 'Internal Server Error' });
      }
    }

    const msg = {
      id: randomUUID(),
      chat_jid: jid,
      sender: 'web-ui',
      sender_name: ASSISTANT_NAME,
      content: parsed.data.content,
      timestamp,
      is_from_me: true,
      is_bot_message: true,
    };

    try {
      storeChatMetadata(
        jid,
        timestamp,
        undefined,
        'web',
        false,
      );
      storeMessageDirect(msg);
      if (opts.sendMessage) {
        await opts.sendMessage(jid, parsed.data.content);
      }
      res.status(201).json(msg);
    } catch (err) {
      logger.error({ err, jid }, 'Failed to send message');
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  app.get('/api/tasks', authenticateToken, (req, res) => {
    try {
      const tasks = getAllTasks();
      res.json(tasks);
    } catch (err) {
      logger.error({ err }, 'Failed to fetch tasks');
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // --- Auth endpoints ---

  app.post('/api/auth/login', async (req, res) => {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      'unknown';

    if (!checkLoginRateLimit(ip)) {
      logger.warn({ ip }, 'Login rate limit exceeded');
      return res
        .status(429)
        .json({ error: 'Too many login attempts, please try again later' });
    }

    const schema = z.object({
      username: z.string().min(1),
      password: z.string().min(1),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    const { username, password } = parsed.data;
    const user = getUserByUsername(username);

    if (!user) {
      recordLoginFailure(ip);
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      recordLoginFailure(ip);
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    clearLoginAttempts(ip);

    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN } as SignOptions,
    );

    updateUserLastLogin(user.id);

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        display_name: user.display_name,
      },
    });
  });

  app.post('/api/auth/logout', authenticateToken, (_req, res) => {
    res.json({ success: true });
  });

  // Silently re-sign a new token for an authenticated user (session extension)
  app.post('/api/auth/refresh', authenticateToken, (req, res) => {
    const authReq = req as AuthRequest;
    const user = getUserById(authReq.user!.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN } as SignOptions,
    );
    res.json({ token });
  });

  app.get('/api/auth/me', authenticateToken, (req, res) => {
    const authReq = req as AuthRequest;
    const user = getUserById(authReq.user!.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      id: user.id,
      username: user.username,
      role: user.role,
      display_name: user.display_name,
      last_login: user.last_login,
    });
  });

  app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
    const schema = z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(6),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    const { currentPassword, newPassword } = parsed.data;
    const authReq = req as AuthRequest;
    const user = getUserById(authReq.user!.userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const validPassword = await bcrypt.compare(
      currentPassword,
      user.password_hash,
    );
    if (!validPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    updateUserPassword(user.id, newHash);

    res.json({ success: true });
  });

  // --- User management endpoints (admin only) ---

  app.get('/api/users', authenticateToken, requireAdmin, (_req, res) => {
    try {
      const users = getAllUsers();
      res.json(users);
    } catch (err) {
      logger.error({ err }, 'Failed to fetch users');
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  app.post('/api/users', authenticateToken, requireAdmin, async (req, res) => {
    const schema = z.object({
      username: z.string().min(1).max(50),
      password: z.string().min(6),
      role: z.enum(['admin', 'user']).optional(),
      display_name: z.string().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    const { username, password, role, display_name } = parsed.data;

    // Check if username already exists
    if (getUserByUsername(username)) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    try {
      const passwordHash = await bcrypt.hash(password, 10);
      const id = randomUUID();
      createUser({
        id,
        username,
        password_hash: passwordHash,
        role: role || 'user',
        display_name,
      });

      const newUser = getUserById(id);
      res.status(201).json(newUser);
    } catch (err) {
      logger.error({ err }, 'Failed to create user');
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  app.put('/api/users/:id', authenticateToken, requireAdmin, (req, res) => {
    const { id } = req.params as { id: string };
    const schema = z.object({
      username: z.string().min(1).max(50).optional(),
      role: z.enum(['admin', 'user']).optional(),
      display_name: z.string().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    const user = getUserById(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check username uniqueness if changing
    if (parsed.data.username && parsed.data.username !== user.username) {
      if (getUserByUsername(parsed.data.username)) {
        return res.status(400).json({ error: 'Username already exists' });
      }
    }

    try {
      updateUser(id, parsed.data);
      const updated = getUserById(id);
      res.json(updated);
    } catch (err) {
      logger.error({ err }, 'Failed to update user');
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  app.delete('/api/users/:id', authenticateToken, requireAdmin, (req, res) => {
    const { id } = req.params as { id: string };
    const authReq = req as AuthRequest;

    // Prevent self-deletion
    if (id === authReq.user!.userId) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const user = getUserById(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    try {
      deleteUser(id);
      res.json({ success: true });
    } catch (err) {
      logger.error({ err }, 'Failed to delete user');
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // Serve Frontend
  // Assuming frontend/dist is relative to project root, and this file is in src/
  // project/src/server.ts -> project/frontend/dist
  const frontendPath = path.join(__dirname, '../frontend/dist');
  app.use(express.static(frontendPath));

  // Fallback for SPA routing
  app.get(/.*/, (req, res) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ error: 'Not Found' });
    }
    res.sendFile(path.join(frontendPath, 'index.html'));
  });

  return { app, broadcastToJid, jidSockets };
}

export function startServer(opts: ServerOpts = {}): BroadcastCapability {
  const port = opts.port ?? 3000;
  const host = opts.host ?? '0.0.0.0';
  const { app, broadcastToJid, jidSockets } = createApp(opts);

  const server = app.listen(port, host, () => {
    logger.info({ port, host }, 'Web server started');
  });

  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (socket: WebSocket, req: IncomingMessage) => {
    // Parse non-sensitive URL params (jid, since) — token is NOT read from URL
    const u = new URL(req.url || '', 'http://localhost');
    const jid = u.searchParams.get('jid') || '';
    const since = u.searchParams.get('since') || '';

    let interval: ReturnType<typeof setInterval> | null = null;
    let authenticated = false;

    const sendJson = (obj: unknown) => {
      try {
        socket.send(JSON.stringify(obj));
      } catch {}
    };

    // Auth timeout: close unauthenticated connections after 10 seconds
    const authTimeout = setTimeout(() => {
      if (!authenticated) {
        socket.close(1008, 'Authentication timeout');
      }
    }, 10000);

    const startSession = (authUser: AuthUser) => {
      authenticated = true;
      clearTimeout(authTimeout);

      let jidSet = jidSockets.get(jid);
      if (!jidSet) {
        jidSet = new Set();
        jidSockets.set(jid, jidSet);
      }
      jidSet.add(socket);

      interval = setInterval(() => {
        try {
          sendJson({ type: 'heartbeat', ts: Date.now() });
        } catch (err) {
          logger.error({ err, jid }, 'WS heartbeat error');
        }
      }, 15000);
      sendJson({ type: 'ready', jid });

      const pendingInteractive = opts.getPendingInteractive?.(jid);
      if (pendingInteractive) {
        for (const ask of pendingInteractive.asks) {
          sendJson({
            type: 'ask_user',
            chat_jid: jid,
            requestId: ask.requestId,
            question: ask.question,
          });
        }
        for (const confirm of pendingInteractive.confirms) {
          sendJson({
            type: 'confirm_bash',
            chat_jid: jid,
            requestId: confirm.requestId,
            command: confirm.command,
            reason: confirm.reason,
            targetHost: confirm.targetHost,
          });
        }
      }

      sendJson({
        type: 'typing',
        chat_jid: jid,
        isTyping: opts.isGroupActive?.(jid) ?? false,
      });

      socket.on('message', async (data: RawData) => {
        try {
          const parsed = JSON.parse(String(data) || '{}') as any;
          if (parsed?.type === 'stop') {
            if (opts.onStopGeneration) {
              opts.onStopGeneration(jid);
            }
            return;
          }
          if (
            parsed?.type === 'ask_user_response' &&
            typeof parsed.requestId === 'string' &&
            typeof parsed.answer === 'string'
          ) {
            const groupFolder = opts.getGroupFolder?.(jid);
            const ok =
              groupFolder && opts.onAskUserResponse
                ? opts.onAskUserResponse(
                    groupFolder,
                    parsed.requestId,
                    parsed.answer,
                  )
                : false;
            broadcastToJid(jid, {
              type: 'ask_user_ack',
              requestId: parsed.requestId,
              answer: parsed.answer,
              ok,
            });
            return;
          }
          if (
            parsed?.type === 'confirm_bash_response' &&
            typeof parsed.requestId === 'string' &&
            typeof parsed.approved === 'boolean'
          ) {
            const groupFolder = opts.getGroupFolder?.(jid);
            const ok =
              groupFolder && opts.onConfirmBashResponse
                ? opts.onConfirmBashResponse(
                    groupFolder,
                    parsed.requestId,
                    parsed.approved,
                  )
                : false;
            broadcastToJid(jid, {
              type: 'confirm_bash_ack',
              requestId: parsed.requestId,
              approved: parsed.approved,
              ok,
            });
            return;
          }
          if (
            parsed &&
            parsed.type === 'send' &&
            typeof parsed.content === 'string' &&
            parsed.content.trim()
          ) {
            const content = String(parsed.content).trim();
            const isWebChat = jid.startsWith('web:');
            if (isWebChat) {
              if (!opts.onWebUserMessage) return;
              const created = await opts.onWebUserMessage(
                jid,
                content,
                authUser.userId,
              );
              sendJson({ type: 'message', data: created });
            } else {
              const timestamp = new Date().toISOString();
              const msg = {
                id: randomUUID(),
                chat_jid: jid,
                sender: 'web-ui',
                sender_name: ASSISTANT_NAME,
                content,
                timestamp,
                is_from_me: true,
                is_bot_message: true,
              };
              try {
                storeChatMetadata(
                  jid,
                  timestamp,
                  undefined,
                  'web',
                  false,
                );
                storeMessageDirect(msg);
                if (opts.sendMessage) {
                  await opts.sendMessage(jid, content);
                }
                sendJson({ type: 'message', data: msg });
              } catch (err) {
                logger.error({ err, jid }, 'WS send error');
                sendJson({ type: 'error', error: 'send_failed' });
              }
            }
          }
        } catch {}
      });
    };

    // First message must be {type:'auth', token:'...'}
    const handleFirstMessage = (data: RawData) => {
      try {
        const parsed = JSON.parse(String(data) || '{}') as any;
        if (parsed?.type !== 'auth' || typeof parsed.token !== 'string') {
          socket.close(1008, 'Authentication required');
          return;
        }
        const authUser = verifyToken(parsed.token);
        if (!authUser) {
          socket.close(1008, 'Invalid token');
          return;
        }
        if (!canAccessChat(jid, authUser.userId, authUser.role)) {
          socket.close(1008, 'Chat not found');
          return;
        }
        // Replace first-message handler with normal session handler
        socket.off('message', handleFirstMessage);
        startSession(authUser);
      } catch {
        socket.close(1008, 'Authentication error');
      }
    };

    socket.on('message', handleFirstMessage);

    const removeSocket = () => {
      const jidSet = jidSockets.get(jid);
      if (jidSet) {
        jidSet.delete(socket);
        if (jidSet.size === 0) jidSockets.delete(jid);
      }
    };

    socket.on('close', () => {
      clearTimeout(authTimeout);
      if (interval) clearInterval(interval);
      removeSocket();
    });

    socket.on('error', (err) => {
      logger.error({ err }, 'WS connection error');
      clearTimeout(authTimeout);
      if (interval) clearInterval(interval);
      removeSocket();
    });
  });

  return { broadcastToJid };
}
