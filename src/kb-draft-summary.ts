import {
  KB_SUMMARY_LLM_API_KEY,
  KB_SUMMARY_LLM_API_URL,
  KB_SUMMARY_LLM_MODEL,
  KB_SUMMARY_LLM_TIMEOUT,
} from './config.js';
import type { ExtractMessage } from './kb-proxy.js';

export interface KnowledgeDraftSummary {
  summary: string;
  conclusions: string[];
  followUps: string[];
  warnings?: string[];
}

const NO_TOOLS_PREAMBLE = `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.

- Do NOT use any tool.
- You already have all the conversation content you need.
- Tool calls will be rejected.
- Your response must contain an <analysis> block and a <summary> block.
`;

const BASE_KB_DRAFT_PROMPT = `Your task is to summarize the conversation into a knowledge-base draft aid.

Before your final answer, use <analysis> to reason privately about:
- the user's real problem
- the key decisions
- the final conclusions
- the unresolved follow-up items

In <summary>, output exactly these sections:
## 摘要
## 关键结论
## 后续建议

Rules:
- \`## 摘要\` 用 1 段中文总结本次会话的核心问题、处理动作和最终结果
- \`## 关键结论\` 使用 3-6 条 bullet，必须是可以直接写入知识库的结论
- \`## 后续建议\` 使用 1-5 条 bullet，只保留真正需要后续处理或复核的事项
- 不要编造未在会话中出现的事实
- 不要输出工具调用
- 不要输出额外章节
`;

const NO_TOOLS_TRAILER = 'REMINDER: Do NOT call any tools. Respond with plain text only.';

export function isKnowledgeDraftLlmConfigured(): boolean {
  return Boolean(
    KB_SUMMARY_LLM_API_URL.trim() &&
    KB_SUMMARY_LLM_API_KEY.trim() &&
    KB_SUMMARY_LLM_MODEL.trim(),
  );
}

export function getKnowledgeDraftPrompt(transcript: string): string {
  return [
    NO_TOOLS_PREAMBLE.trim(),
    '',
    BASE_KB_DRAFT_PROMPT.trim(),
    '',
    'Conversation transcript:',
    transcript.trim(),
    '',
    NO_TOOLS_TRAILER,
  ].join('\n');
}

export function parseKnowledgeDraftSummary(raw: string): KnowledgeDraftSummary {
  const match = raw.match(/<summary>([\s\S]*?)<\/summary>/i);
  if (!match) {
    throw new Error('Missing <summary> block in LLM response');
  }

  const summaryBlock = match[1]?.trim() ?? '';
  const summary = readSection(summaryBlock, '摘要');
  const conclusions = readBulletSection(summaryBlock, '关键结论');
  const followUps = readBulletSection(summaryBlock, '后续建议');

  if (!summary) {
    throw new Error('Summary section is empty');
  }

  return {
    summary,
    conclusions,
    followUps,
  };
}

export async function summarizeKnowledgeDraft(
  messages: ExtractMessage[],
  options: { title?: string; chatJid?: string; chatName?: string } = {},
): Promise<KnowledgeDraftSummary> {
  const transcript = buildTranscript(messages, options);
  const prompt = getKnowledgeDraftPrompt(transcript);
  const response = await fetch(buildChatCompletionsUrl(), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${KB_SUMMARY_LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: KB_SUMMARY_LLM_MODEL,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: 'You are a careful assistant that writes structured knowledge-base summaries.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
    signal: AbortSignal.timeout(KB_SUMMARY_LLM_TIMEOUT),
  });

  if (!response.ok) {
    throw new Error(`Knowledge draft summary request failed with status ${response.status}`);
  }

  const payload = JSON.parse(await response.text()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const rawContent = payload.choices?.[0]?.message?.content?.trim() ?? '';
  if (!rawContent) {
    throw new Error('Knowledge draft summary response is empty');
  }

  return parseKnowledgeDraftSummary(rawContent);
}

function readSection(content: string, heading: string): string {
  const section = readSectionContent(content, heading);
  return squashWhitespace(section.replace(/^- /gm, ' ').trim());
}

function readBulletSection(content: string, heading: string): string[] {
  const section = readSectionContent(content, heading);
  return section
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean);
}

function readSectionContent(content: string, heading: string): string {
  const escapedHeading = escapeRegex(heading);
  const pattern = new RegExp(`##\\s+${escapedHeading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, 'i');
  const match = content.match(pattern);
  if (!match) {
    throw new Error(`Missing section: ${heading}`);
  }
  return match[1]?.trim() ?? '';
}

function squashWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildTranscript(
  messages: ExtractMessage[],
  options: { title?: string; chatJid?: string; chatName?: string },
): string {
  const metaLines = [
    options.title?.trim() ? `[title] ${options.title.trim()}` : undefined,
    options.chatName?.trim() ? `[chat_name] ${options.chatName.trim()}` : undefined,
    options.chatJid?.trim() ? `[chat_jid] ${options.chatJid.trim()}` : undefined,
  ].filter(Boolean);
  const messageLines = messages
    .slice(-40)
    .map((message) => `[${(message.role ?? 'user').trim() || 'user'}] ${message.content.trim()}`)
    .join('\n');
  const transcript = [...metaLines, messageLines].filter(Boolean).join('\n');
  if (transcript.length <= 12000) {
    return transcript;
  }
  return transcript.slice(transcript.length - 12000);
}

function buildChatCompletionsUrl(): string {
  return `${KB_SUMMARY_LLM_API_URL.replace(/\/+$/, '')}/chat/completions`;
}
