import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';

import multer from 'multer';
import { z } from 'zod';

import { authenticateToken, requireAdmin } from './auth-middleware.js';
import { getMessagesSinceAll } from './db.js';
import {
  buildKnowledgeDraft,
  extractConversation,
  fsDelete,
  fsMkdir,
  fsMove,
  fsTree,
  healthCheck,
  readContent,
  reindex,
  saveKnowledgeDraft,
  search,
  writeContent,
} from './kb-proxy.js';
import { KB_API_KEY, KB_API_URL, KB_ROOT_URI, KB_SEARCH_TIMEOUT } from './config.js';
import { logger } from './logger.js';

const router = express.Router();
const upload = multer({ dest: os.tmpdir() });

router.get('/health', authenticateToken, async (_req, res) => {
  try {
    res.json(await healthCheck());
  } catch (err) {
    logger.error({ err }, 'Failed to check KB health');
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.post('/search', authenticateToken, async (req, res) => {
  const schema = z.object({
    query: z.string().trim().min(1),
    limit: z.number().int().positive().max(20).optional(),
    targetUri: z.string().trim().min(1).optional(),
  });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  try {
    const results = await search(parsed.data.query, {
      limit: parsed.data.limit,
      targetUri: parsed.data.targetUri,
    });
    res.json(results);
  } catch (err) {
    logger.error({ err }, 'Failed to search KB');
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal Server Error' });
  }
});

router.get('/tree', authenticateToken, async (req, res) => {
  try {
    const uri = typeof req.query.uri === 'string' ? req.query.uri : KB_ROOT_URI;
    res.json(await fsTree(uri));
  } catch (err) {
    logger.error({ err }, 'Failed to load KB tree');
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal Server Error' });
  }
});

router.get('/read', authenticateToken, async (req, res) => {
  const uri = typeof req.query.uri === 'string' ? req.query.uri : '';
  if (!uri) {
    return res.status(400).json({ error: 'uri is required' });
  }

  try {
    res.json({ uri, content: await readContent(uri) });
  } catch (err) {
    logger.error({ err }, 'Failed to read KB content');
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal Server Error' });
  }
});

router.post('/write', authenticateToken, requireAdmin, async (req, res) => {
  const schema = z.object({
    uri: z.string().trim().min(1),
    content: z.string(),
    mode: z.enum(['replace', 'append']).optional(),
  });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  try {
    await writeContent(parsed.data.uri, parsed.data.content, parsed.data.mode);
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, 'Failed to write KB content');
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal Server Error' });
  }
});

router.post('/mkdir', authenticateToken, requireAdmin, async (req, res) => {
  const schema = z.object({
    uri: z.string().trim().min(1),
  });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  try {
    await fsMkdir(parsed.data.uri);
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, 'Failed to create KB directory');
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal Server Error' });
  }
});

router.delete('/', authenticateToken, requireAdmin, async (req, res) => {
  const uri = typeof req.query.uri === 'string' ? req.query.uri : '';
  if (!uri) {
    return res.status(400).json({ error: 'uri is required' });
  }

  try {
    await fsDelete(uri);
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, 'Failed to delete KB entry');
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal Server Error' });
  }
});

router.patch('/mv', authenticateToken, requireAdmin, async (req, res) => {
  const schema = z.object({
    from: z.string().trim().min(1),
    to: z.string().trim().min(1),
  });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  try {
    await fsMove(parsed.data.from, parsed.data.to);
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, 'Failed to move KB entry');
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal Server Error' });
  }
});

router.post(
  '/upload',
  authenticateToken,
  requireAdmin,
  upload.single('file'),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'file is required' });
    }

    const targetUri = typeof req.body?.targetUri === 'string' && req.body.targetUri.trim()
      ? req.body.targetUri.trim()
      : KB_ROOT_URI;

    try {
      const result = await uploadToKnowledgeBase(req.file.path, req.file.originalname, targetUri);
      res.status(201).json(result);
    } catch (err) {
      logger.error({ err }, 'Failed to upload KB resource');
      res.status(500).json({ error: err instanceof Error ? err.message : 'Internal Server Error' });
    } finally {
      try {
        fs.rmSync(req.file.path, { force: true });
      } catch {
        // ignore cleanup failures
      }
    }
  },
);

router.post('/reindex', authenticateToken, requireAdmin, async (req, res) => {
  const schema = z.object({
    uri: z.string().trim().min(1),
  });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  try {
    await reindex(parsed.data.uri);
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, 'Failed to reindex KB content');
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal Server Error' });
  }
});

router.post('/extract', authenticateToken, requireAdmin, async (req, res) => {
  const schema = z.object({
    chatJid: z.string().trim().min(1),
    title: z.string().trim().min(1).optional(),
  });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  try {
    const messages = readChatMessages(parsed.data.chatJid);
    const result = await extractConversation(messages, { title: parsed.data.title });
    res.json(result);
  } catch (err) {
    logger.error({ err }, 'Failed to extract chat into KB');
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal Server Error' });
  }
});

router.post('/extract-draft', authenticateToken, requireAdmin, async (req, res) => {
  const schema = z.object({
    chatJid: z.string().trim().min(1),
    title: z.string().trim().min(1).optional(),
    chatName: z.string().trim().min(1).optional(),
  });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  try {
    const messages = readChatMessages(parsed.data.chatJid);
    const draft = buildKnowledgeDraft(messages, {
      title: parsed.data.title,
      chatJid: parsed.data.chatJid,
      chatName: parsed.data.chatName,
    });
    res.json(draft);
  } catch (err) {
    logger.error({ err }, 'Failed to build KB draft');
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal Server Error' });
  }
});

router.post('/save-draft', authenticateToken, requireAdmin, async (req, res) => {
  const schema = z.object({
    uri: z.string().trim().min(1),
    content: z.string(),
    overwrite: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  try {
    const result = await saveKnowledgeDraft(parsed.data);
    res.status(201).json(result);
  } catch (err) {
    logger.error({ err }, 'Failed to save KB draft');
    const errorCode = err instanceof Error && 'code' in err ? String(err.code) : '';
    if (errorCode === 'KB_FILE_EXISTS') {
      return res.status(409).json({
        error: err instanceof Error ? err.message : '目标文件已存在',
        code: errorCode,
      });
    }
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal Server Error' });
  }
});

export default router;

function readChatMessages(chatJid: string): Array<{ role: string; content: string }> {
  return getMessagesSinceAll(chatJid, '', 200).map((message) => ({
    role: message.is_from_me ? 'assistant' : 'user',
    content: message.content,
  }));
}

async function uploadToKnowledgeBase(
  filePath: string,
  originalName: string,
  targetUri: string,
): Promise<{ success: true; resourceUri?: string; tempUri?: string }> {
  if (!KB_API_URL) {
    throw new Error('Knowledge base is not configured');
  }

  const fileBuffer = fs.readFileSync(filePath);
  const formData = new FormData();
  formData.append(
    'file',
    new Blob([fileBuffer], { type: 'application/octet-stream' }),
    originalName,
  );

  const tempUpload = await kbFetch('/api/v1/resources/temp_upload', {
    method: 'POST',
    body: formData,
  });

  const tempUri = readString(tempUpload.temp_uri) ?? readString(tempUpload.uri);
  const created = await kbFetch('/api/v1/resources', {
    method: 'POST',
    body: JSON.stringify({
      temp_uri: tempUri,
      target_uri: targetUri,
      name: originalName,
    }),
    headers: {
      'content-type': 'application/json',
    },
  });

  return {
    success: true,
    resourceUri: readString(created.uri) ?? readString(created.resource_uri),
    tempUri: tempUri ?? undefined,
  };
}

async function kbFetch(
  endpoint: string,
  options: {
    method?: string;
    body?: string | FormData;
    headers?: Record<string, string>;
  } = {},
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), KB_SEARCH_TIMEOUT);

  try {
    const url = new URL(endpoint, KB_API_URL.endsWith('/') ? KB_API_URL : `${KB_API_URL}/`).toString();
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      body: options.body,
      headers: {
        ...(KB_API_KEY ? { authorization: `Bearer ${KB_API_KEY}` } : {}),
        ...options.headers,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`OpenViking request failed: ${response.status} ${response.statusText}`);
    }

    const text = await response.text();
    return text ? JSON.parse(text) as Record<string, unknown> : {};
  } finally {
    clearTimeout(timeout);
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
