import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { RawData } from 'ws';
import { z } from 'zod';
import jwt, { type SignOptions } from 'jsonwebtoken';
import bcrypt from 'bcrypt';
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
  type UserWithoutPassword,
} from './db.js';
import { logger } from './logger.js';
import { ASSISTANT_NAME, JWT_SECRET, JWT_EXPIRES_IN } from './config.js';
import { getSlashCommands } from './slash-commands.js';

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
  onCreateChat?: (jid: string, userId: string) => void;
  isGroupActive?: (jid: string) => boolean;
}

export interface BroadcastCapability {
  broadcastToJid: (jid: string, payload: unknown) => void;
}

export function startServer(opts: ServerOpts = {}): BroadcastCapability {
  const port = opts.port ?? 3000;
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Store connected sockets
  const connectedSockets = new Set<{ ws: WebSocket; jid: string }>();

  const broadcastToJid = (jid: string, payload: unknown) => {
    const data = JSON.stringify(payload);
    for (const client of connectedSockets) {
      if (client.jid === jid && client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(data);
        } catch {
          // Ignore send errors
        }
      }
    }
  };

  try {
    storeChatMetadata(
      'web:default',
      new Date().toISOString(),
      'Web Chat',
      'web',
      false,
    );
  } catch (err) {
    logger.warn({ err }, 'Failed to ensure web chat exists');
  }

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
    try {
      const authReq = req as AuthRequest;
      const jid = 'web:' + randomUUID();
      const timestamp = new Date().toISOString();
      storeChatMetadata(
        jid,
        timestamp,
        'New Chat',
        'web',
        false,
        authReq.user!.userId,
      );
      if (opts.onCreateChat) {
        opts.onCreateChat(jid, authReq.user!.userId);
      }
      res.status(201).json({
        jid,
        name: 'New Chat',
        last_message_time: timestamp,
        channel: 'web',
        is_group: 0,
      });
    } catch (err) {
      logger.error({ err }, 'Failed to create chat');
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
        jid.endsWith('@g.us'),
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

  app.get('/api/groups/:jid/stream', authenticateToken, (req, res) => {
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
    const since = typeof req.query.since === 'string' ? req.query.since : '';
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 200;
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    let cursor = since;
    let lastHeartbeat = Date.now();
    const tick = () => {
      try {
        const batch = getMessagesSinceAll(jid, cursor, limit);
        if (batch.length > 0) {
          for (const m of batch) {
            res.write(`event: message\ndata: ${JSON.stringify(m)}\n\n`);
          }
          cursor = batch[batch.length - 1]!.timestamp;
        }
        const now = Date.now();
        if (now - lastHeartbeat >= 15000) {
          res.write(`event: heartbeat\ndata: ${now}\n\n`);
          lastHeartbeat = now;
        }
      } catch (err) {
        logger.error({ err, jid }, 'SSE stream error');
        res.write(
          `event: error\ndata: ${JSON.stringify({ error: 'stream_error' })}\n\n`,
        );
      }
    };
    const interval = setInterval(tick, 1000);
    res.write(`event: ready\ndata: ${JSON.stringify({ jid })}\n\n`);
    req.on('close', () => {
      clearInterval(interval);
    });
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

  const server = app.listen(port, '0.0.0.0', () => {
    logger.info({ port }, 'Web server started');
  });

  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (socket: WebSocket, req: IncomingMessage) => {
    // Parse non-sensitive URL params (jid, since) — token is NOT read from URL
    const u = new URL(req.url || '', 'http://localhost');
    const jid = u.searchParams.get('jid') || 'web:default';
    const since = u.searchParams.get('since') || '';

    let clientEntry: { ws: WebSocket; jid: string } | null = null;
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

      clientEntry = { ws: socket, jid };
      connectedSockets.add(clientEntry);

      interval = setInterval(() => {
        try {
          sendJson({ type: 'heartbeat', ts: Date.now() });
        } catch (err) {
          logger.error({ err, jid }, 'WS heartbeat error');
        }
      }, 15000);
      sendJson({ type: 'ready', jid });

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
                  jid.endsWith('@g.us'),
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

    socket.on('close', () => {
      clearTimeout(authTimeout);
      if (interval) clearInterval(interval);
      if (clientEntry) connectedSockets.delete(clientEntry);
    });

    socket.on('error', (err) => {
      logger.error({ err }, 'WS connection error');
      clearTimeout(authTimeout);
      if (interval) clearInterval(interval);
      if (clientEntry) connectedSockets.delete(clientEntry);
    });
  });

  return { broadcastToJid };
}
