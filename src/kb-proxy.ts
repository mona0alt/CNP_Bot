import { createHash } from 'crypto';

import {
  KB_API_KEY,
  KB_API_URL,
  KB_EXTRACT_TIMEOUT,
  KB_ROOT_URI,
  KB_SEARCH_TIMEOUT,
} from './config.js';
import { logger } from './logger.js';

const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_SEARCH_LIMIT = 5;
const MIN_SEARCH_CANDIDATES = 20;
const MAX_CAPTURE_CHARS = 24000;
const LEAF_BOOST = 0.12;
const MAX_OVERLAP_BOOST = 0.2;
const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'how',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'was',
  'were',
  'with',
  '关于',
  '一个',
  '一些',
  '以及',
  '什么',
  '什么样',
  '如何',
  '我们',
  '你们',
  '他们',
  '是否',
  '需要',
  '进行',
  '相关',
  '这个',
  '那个',
]);

const knowledgeCache = new Map<string, { expiresAt: number; value: string }>();

export interface QueryProfile {
  raw: string;
  tokens: string[];
}

export interface FindResultItem {
  uri: string;
  score?: number;
  abstract?: string;
  category?: string;
  level?: number;
  title?: string;
}

export interface ExtractMessage {
  role?: string;
  content: string;
}

export interface ExtractResult {
  ok: boolean;
  count: number;
  items: unknown[];
  partial?: boolean;
  errors?: string[];
}

export interface OvTreeNode {
  uri?: string;
  name?: string;
  type?: string;
  children?: OvTreeNode[];
  [key: string]: unknown;
}

type SearchOptions = {
  limit?: number;
  targetUri?: string;
};

type RelevantContextOptions = SearchOptions;

type WriteMode = 'replace' | 'append';

export function buildQueryProfile(query: string): QueryProfile {
  const rawTokens = (query.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? [])
    .map((token) => token.trim())
    .filter((token) => token && !STOPWORDS.has(token));
  const tokens = Array.from(new Set(rawTokens));
  return { raw: query, tokens };
}

export function rankForInjection(item: FindResultItem, profile: QueryProfile): number {
  const baseScore = clampScore(item.score);
  const leafBoost = item.level === 2 ? LEAF_BOOST : 0;
  const overlapBoost = lexicalOverlapBoost(
    profile.tokens,
    `${item.uri} ${item.abstract ?? ''} ${item.title ?? ''}`,
  );
  return baseScore + leafBoost + overlapBoost;
}

export function filterMessages<T extends ExtractMessage>(messages: T[]): T[] {
  return messages.flatMap((message) => {
    const content = (message.content ?? '').trim();
    if (!content) return [];
    if (isSlashCommand(content)) return [];
    if (isPunctuationOnly(content)) return [];
    if (isTooShort(content)) return [];

    return [{
      ...message,
      content: content.length > MAX_CAPTURE_CHARS
        ? content.slice(0, MAX_CAPTURE_CHARS)
        : content,
    }];
  });
}

export function isKbConfigured(): boolean {
  return KB_API_URL.trim().length > 0;
}

export async function healthCheck(): Promise<{ connected: boolean; url: string; version?: string }> {
  if (!isKbConfigured()) {
    return { connected: false, url: KB_API_URL };
  }

  try {
    const data = await ovFetch<Record<string, unknown>>('/health', {
      timeoutMs: KB_SEARCH_TIMEOUT,
    });
    return {
      connected: true,
      url: KB_API_URL,
      version: readString(data.version) ?? readString((data.data as Record<string, unknown> | undefined)?.version),
    };
  } catch (err) {
    logger.warn({ err }, 'KB health check failed');
    return { connected: false, url: KB_API_URL };
  }
}

export async function search(query: string, options: SearchOptions = {}): Promise<FindResultItem[]> {
  if (!isKbConfigured() || !query.trim()) return [];

  const limit = Math.max(1, options.limit ?? DEFAULT_SEARCH_LIMIT);
  const candidateLimit = Math.max(limit * 4, MIN_SEARCH_CANDIDATES);
  const targetUris = options.targetUri
    ? [options.targetUri]
    : [KB_ROOT_URI, 'viking://user/memories/', 'viking://agent/memories/'];

  const settled = await Promise.allSettled(
    targetUris.map((targetUri) =>
      ovFetch<unknown>('/api/v1/search/find', {
        method: 'POST',
        timeoutMs: KB_SEARCH_TIMEOUT,
        body: {
          query,
          limit: candidateLimit,
          target_uri: targetUri,
        },
      }),
    ),
  );

  const deduped = new Map<string, FindResultItem>();
  for (const result of settled) {
    if (result.status !== 'fulfilled') {
      logger.warn({ err: result.reason }, 'KB search scope failed');
      continue;
    }

    for (const item of normalizeSearchResults(result.value)) {
      const existing = deduped.get(item.uri);
      if (!existing || rankForInjection(item, buildQueryProfile(query)) > rankForInjection(existing, buildQueryProfile(query))) {
        deduped.set(item.uri, item);
      }
    }
  }

  const profile = buildQueryProfile(query);
  return Array.from(deduped.values())
    .sort((left, right) => rankForInjection(right, profile) - rankForInjection(left, profile))
    .slice(0, limit);
}

export async function readContent(uri: string): Promise<string> {
  if (!isKbConfigured() || !uri) return '';

  const url = new URL('/api/v1/content/read', normalizeBaseUrl(KB_API_URL));
  url.searchParams.set('uri', uri);
  const data = await ovFetch<unknown>(url.toString(), {
    timeoutMs: KB_SEARCH_TIMEOUT,
    absoluteUrl: true,
  });
  return normalizeContentResponse(data);
}

export async function getRelevantContext(
  prompt: string,
  options: RelevantContextOptions = {},
): Promise<string> {
  if (!isKbConfigured() || !prompt.trim()) return '';

  const cacheKey = createHash('md5').update(prompt.slice(0, 500)).digest('hex');
  const cached = knowledgeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  try {
    const items = await search(prompt, options);
    if (items.length === 0) return '';

    const lines = await Promise.all(items.map(async (item, index) => {
      let content = item.abstract?.trim() ?? '';
      if (!content) {
        try {
          content = (await readContent(item.uri)).trim();
        } catch {
          content = '';
        }
      }
      const label = item.category ?? deriveCategory(item.uri);
      const title = item.title ?? deriveTitle(item.uri);
      const summary = squashWhitespace(content).slice(0, 240);
      return `${index + 1}. [${label}] ${title}${summary ? ` - ${summary}` : ''}`;
    }));

    const value = [
      '<knowledge-base>',
      '以下是从运维知识库中检索到的相关内容，可作为参考：',
      ...lines,
      '</knowledge-base>',
    ].join('\n');

    knowledgeCache.set(cacheKey, {
      expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
      value,
    });
    return value;
  } catch (err) {
    logger.warn({ err }, 'Failed to build KB context');
    return '';
  }
}

export async function extractConversation(
  messages: ExtractMessage[],
  options: { title?: string } = {},
): Promise<ExtractResult> {
  if (!isKbConfigured()) {
    return { ok: false, count: 0, items: [], errors: ['知识库未配置'] };
  }

  const filtered = filterMessages(messages);
  if (filtered.length === 0) {
    return { ok: true, count: 0, items: [] };
  }

  let sessionId = '';
  const errors: string[] = [];

  try {
    const session = await ovFetch<Record<string, unknown>>('/api/v1/sessions', {
      method: 'POST',
      timeoutMs: KB_EXTRACT_TIMEOUT,
      body: {
        title: options.title,
      },
    });
    sessionId = readString(session.id) ?? readString(session.sessionId) ?? '';
    if (!sessionId) {
      throw new Error('OpenViking 未返回 sessionId');
    }

    const batches = chunkMessages(filtered, 10);
    for (const batch of batches) {
      try {
        await ovFetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}/messages`, {
          method: 'POST',
          timeoutMs: KB_EXTRACT_TIMEOUT,
          body: {
            role: 'user',
            content: batch.map((item) => `[${item.role ?? 'user'}] ${item.content}`).join('\n\n'),
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(message);
        logger.warn({ err, sessionId }, 'Failed to write KB session batch');
      }
    }

    const extracted = await ovFetch<unknown>(`/api/v1/sessions/${encodeURIComponent(sessionId)}/extract`, {
      method: 'POST',
      timeoutMs: KB_EXTRACT_TIMEOUT,
      body: {},
    });
    const items = normalizeExtractItems(extracted);

    return {
      ok: true,
      count: items.length,
      items,
      partial: errors.length > 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (err) {
    return {
      ok: false,
      count: 0,
      items: [],
      errors: [err instanceof Error ? err.message : String(err)],
    };
  } finally {
    if (sessionId) {
      try {
        await ovFetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}`, {
          method: 'DELETE',
          timeoutMs: KB_EXTRACT_TIMEOUT,
        });
      } catch (err) {
        logger.warn({ err, sessionId }, 'Failed to delete temporary KB session');
      }
    }
  }
}

export async function fsTree(uri = KB_ROOT_URI): Promise<OvTreeNode[]> {
  if (!isKbConfigured()) return [];

  const url = new URL('/api/v1/fs/tree', normalizeBaseUrl(KB_API_URL));
  url.searchParams.set('uri', uri);
  const data = await ovFetch<unknown>(url.toString(), {
    timeoutMs: KB_SEARCH_TIMEOUT,
    absoluteUrl: true,
  });
  return normalizeTree(data);
}

export async function fsMkdir(uri: string): Promise<boolean> {
  if (!isKbConfigured()) return false;
  await ovFetch('/api/v1/fs/mkdir', {
    method: 'POST',
    timeoutMs: KB_SEARCH_TIMEOUT,
    body: { uri },
  });
  return true;
}

export async function fsDelete(uri: string): Promise<boolean> {
  if (!isKbConfigured()) return false;

  const url = new URL('/api/v1/fs', normalizeBaseUrl(KB_API_URL));
  url.searchParams.set('uri', uri);
  await ovFetch(url.toString(), {
    method: 'DELETE',
    timeoutMs: KB_SEARCH_TIMEOUT,
    absoluteUrl: true,
  });
  return true;
}

export async function fsMove(from: string, to: string): Promise<boolean> {
  if (!isKbConfigured()) return false;
  await ovFetch('/api/v1/fs/mv', {
    method: 'POST',
    timeoutMs: KB_SEARCH_TIMEOUT,
    body: { from, to },
  });
  return true;
}

export async function writeContent(
  uri: string,
  content: string,
  mode: WriteMode = 'replace',
): Promise<boolean> {
  if (!isKbConfigured()) return false;
  await ovFetch('/api/v1/content/write', {
    method: 'POST',
    timeoutMs: KB_SEARCH_TIMEOUT,
    body: { uri, content, mode },
  });
  return true;
}

export async function reindex(uri: string): Promise<boolean> {
  if (!isKbConfigured()) return false;
  await ovFetch('/api/v1/content/reindex', {
    method: 'POST',
    timeoutMs: KB_SEARCH_TIMEOUT,
    body: { uri },
  });
  return true;
}

function clampScore(score?: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(1, score ?? 0));
}

function lexicalOverlapBoost(tokens: string[], haystack: string): number {
  if (tokens.length === 0) return 0;
  const normalized = haystack.toLowerCase();
  const overlapCount = tokens.filter((token) => normalized.includes(token)).length;
  return (overlapCount / tokens.length) * MAX_OVERLAP_BOOST;
}

function isTooShort(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.length >= 10) return false;
  const cjkOnly = trimmed.replace(/\s+/g, '');
  return cjkOnly.length < 4 || trimmed.length < 10;
}

function isSlashCommand(content: string): boolean {
  return content.trimStart().startsWith('/');
}

function isPunctuationOnly(content: string): boolean {
  return /^[\p{P}\p{S}\s]+$/u.test(content);
}

function chunkMessages<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function normalizeBaseUrl(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

async function ovFetch<T>(
  endpoint: string,
  options: {
    method?: 'GET' | 'POST' | 'DELETE' | 'PATCH' | 'PUT';
    body?: unknown;
    timeoutMs?: number;
    absoluteUrl?: boolean;
  } = {},
): Promise<T> {
  if (!isKbConfigured()) {
    throw new Error('Knowledge base is not configured');
  }

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? KB_SEARCH_TIMEOUT;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = options.absoluteUrl ? endpoint : new URL(endpoint, normalizeBaseUrl(KB_API_URL)).toString();
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(KB_API_KEY ? { authorization: `Bearer ${KB_API_KEY}` } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`OpenViking request failed: ${response.status} ${response.statusText}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeSearchResults(payload: unknown): FindResultItem[] {
  const source = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { results?: unknown[] } | null)?.results)
      ? (payload as { results: unknown[] }).results
      : Array.isArray((payload as { items?: unknown[] } | null)?.items)
        ? (payload as { items: unknown[] }).items
        : Array.isArray((payload as { data?: unknown[] } | null)?.data)
          ? (payload as { data: unknown[] }).data
          : [];

  return source
    .map((item) => normalizeSearchItem(item))
    .filter((item): item is FindResultItem => Boolean(item));
}

function normalizeSearchItem(payload: unknown): FindResultItem | null {
  if (!payload || typeof payload !== 'object') return null;
  const item = payload as Record<string, unknown>;
  const uri = readString(item.uri) ?? readString(item.path);
  if (!uri) return null;

  return {
    uri,
    score: readNumber(item.score),
    abstract: readString(item.abstract) ?? readString(item.summary) ?? readString(item.content),
    category: readString(item.category),
    level: readNumber(item.level),
    title: readString(item.title) ?? readString(item.name),
  };
}

function normalizeExtractItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.items)) return record.items;
  if (Array.isArray(record.results)) return record.results;
  if (Array.isArray(record.memories)) return record.memories;
  return [];
}

function normalizeContentResponse(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (!payload || typeof payload !== 'object') return '';
  const record = payload as Record<string, unknown>;
  return readString(record.content) ?? readString(record.text) ?? '';
}

function normalizeTree(payload: unknown): OvTreeNode[] {
  if (Array.isArray(payload)) return payload as OvTreeNode[];
  if (!payload || typeof payload !== 'object') return [];
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.tree)) return record.tree as OvTreeNode[];
  if (Array.isArray(record.children)) return record.children as OvTreeNode[];
  return [];
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function deriveCategory(uri: string): string {
  if (uri.includes('/incidents/')) return 'incident';
  if (uri.includes('/sop/')) return 'SOP';
  if (uri.includes('/deploy')) return 'deploy';
  if (uri.includes('/memories/')) return 'memory';
  return 'knowledge';
}

function deriveTitle(uri: string): string {
  const normalized = uri.replace(/\/+$/, '');
  const segments = normalized.split('/');
  return segments[segments.length - 1] || uri;
}

function squashWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
