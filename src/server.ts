import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { RawData } from 'ws';
import { z } from 'zod';
import {
  getAllRegisteredGroups,
  getRecentMessages,
  getAllTasks,
  getAllChats,
  getMessagesSinceAll,
  storeChatMetadata,
  storeMessageDirect,
  deleteChat,
} from './db.js';
import { logger } from './logger.js';
import { ASSISTANT_NAME } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ServerOpts {
  port?: number;
  sendMessage?: (jid: string, text: string) => Promise<void>;
  onWebUserMessage?: (jid: string, text: string) => Promise<{
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
  getGroupStats?: (jid: string) => { usage?: { input_tokens: number, output_tokens: number } } | undefined;
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
    storeChatMetadata('web:default', new Date().toISOString(), 'Web Chat', 'web', false);
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

  app.get('/api/groups', (req, res) => {
    try {
      const groups = getAllRegisteredGroups();
      res.json(groups);
    } catch (err) {
      logger.error({ err }, 'Failed to fetch groups');
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  app.get('/api/chats', (req, res) => {
    try {
      const chats = getAllChats();
      res.json(chats);
    } catch (err) {
      logger.error({ err }, 'Failed to fetch chats');
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  app.post('/api/chats', (req, res) => {
    try {
      const jid = 'web:' + randomUUID();
      const timestamp = new Date().toISOString();
      storeChatMetadata(jid, timestamp, 'New Chat', 'web', false);
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

  app.delete('/api/chats/:jid', (req, res) => {
    try {
      const { jid } = req.params;
      deleteChat(jid);
      res.status(200).json({ success: true });
    } catch (err) {
      logger.error({ err }, 'Failed to delete chat');
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  app.get('/api/groups/:jid/status', (req, res) => {
    try {
      const { jid } = req.params;
      const groups = getAllRegisteredGroups();
      const group = groups[jid];
      
      if (!group) {
        return res.status(404).json({ error: 'Group not found' });
      }

      const stats = opts.getGroupStats ? opts.getGroupStats(jid) : undefined;
      const model = process.env.MODEL || 'claude-3-5-sonnet-20241022'; // Default fallback

      res.json({
        workingDirectory: group.folder,
        model,
        usage: stats?.usage || { input_tokens: 0, output_tokens: 0 }
      });
    } catch (err) {
      logger.error({ err }, 'Failed to fetch group status');
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  app.get('/api/groups/:jid/messages', (req, res) => {
    try {
      const { jid } = req.params;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const since = typeof req.query.since === 'string' ? req.query.since : null;
      const messages = since
        ? getMessagesSinceAll(jid, since, limit)
        : getRecentMessages(jid, limit);
      res.json(messages);
    } catch (err) {
      logger.error({ err }, 'Failed to fetch messages');
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  app.post('/api/groups/:jid/messages', async (req, res) => {
    const schema = z.object({
      content: z.string().trim().min(1).max(5000),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    const { jid } = req.params;
    const isWebChat = jid.startsWith('web:');
    const timestamp = new Date().toISOString();

    if (isWebChat) {
      try {
        if (!opts.onWebUserMessage) {
          return res.status(500).json({ error: 'Web chat not enabled' });
        }
        const stored = await opts.onWebUserMessage(jid, parsed.data.content);
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
      storeChatMetadata(jid, timestamp, undefined, 'whatsapp', jid.endsWith('@g.us'));
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

  app.get('/api/groups/:jid/stream', (req, res) => {
    const { jid } = req.params;
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
        res.write(`event: error\ndata: ${JSON.stringify({ error: 'stream_error' })}\n\n`);
      }
    };
    const interval = setInterval(tick, 1000);
    res.write(`event: ready\ndata: ${JSON.stringify({ jid })}\n\n`);
    req.on('close', () => {
      clearInterval(interval);
    });
  });

  app.get('/api/tasks', (req, res) => {
    try {
      const tasks = getAllTasks();
      res.json(tasks);
    } catch (err) {
      logger.error({ err }, 'Failed to fetch tasks');
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
    let clientEntry: { ws: WebSocket; jid: string } | null = null;
    try {
      const u = new URL(req.url || '', 'http://localhost');
      const jid = u.searchParams.get('jid') || 'web:default';
      
      clientEntry = { ws: socket, jid };
      connectedSockets.add(clientEntry);

      const since = u.searchParams.get('since') || '';
      let cursor = since;
      let lastHeartbeat = Date.now();
      const sendJson = (obj: unknown) => {
        try {
          socket.send(JSON.stringify(obj));
        } catch {}
      };
      const tick = () => {
        try {
          const batch = getMessagesSinceAll(jid, cursor, 200);
          if (batch.length > 0) {
            for (const m of batch) {
              sendJson({ type: 'message', data: m });
            }
            cursor = batch[batch.length - 1]!.timestamp;
          }
          const now = Date.now();
          if (now - lastHeartbeat >= 15000) {
            sendJson({ type: 'heartbeat', ts: now });
            lastHeartbeat = now;
          }
        } catch (err) {
          logger.error({ err, jid }, 'WS stream error');
          sendJson({ type: 'error', error: 'stream_error' });
        }
      };
      const interval = setInterval(tick, 1000);
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
          if (parsed && parsed.type === 'send' && typeof parsed.content === 'string' && parsed.content.trim()) {
            const content = String(parsed.content).trim();
            const isWebChat = jid.startsWith('web:');
            if (isWebChat) {
              if (!opts.onWebUserMessage) return;
              const created = await opts.onWebUserMessage(jid, content);
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
                storeChatMetadata(jid, timestamp, undefined, 'whatsapp', jid.endsWith('@g.us'));
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
      socket.on('close', () => {
        clearInterval(interval);
        if (clientEntry) connectedSockets.delete(clientEntry);
      });
    } catch (err) {
      logger.error({ err }, 'WS connection error');
      if (clientEntry) connectedSockets.delete(clientEntry);
    }
  });

  return { broadcastToJid };
}
