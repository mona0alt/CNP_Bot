import { Fragment } from "react";
import { User, Bot, Brain } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Message } from "@/lib/types";
import { parseMessageContent } from "@/lib/message-parser";
import { parseThoughts } from "@/lib/thought-parser";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { JumpServerSessionCard } from "@/components/JumpServerSessionCard";
import { ToolCallCard } from "@/components/ToolCallCard";
import { PrometheusChartCard } from '@/components/PrometheusChartCard';
import type { ContentBlock, JumpServerBlock, PrometheusChartBlock } from '@/lib/types';
import { ThoughtProcess } from "@/components/ThoughtProcess";
import { useTheme } from "@/contexts/ThemeContext";
import { shouldHideToolUseBlock } from "@/lib/tool-visibility";

interface MessageItemProps {
  message: Message;
}

type RenderableEntry =
  | { kind: 'block'; block: ContentBlock | { type: 'text'; text: string; key: string }; key: string };

export function MessageItem({ message: msg }: MessageItemProps) {
  const { theme } = useTheme();

  const outgoing = !!msg.is_from_me;
  const bubble = outgoing
    ? "bg-primary text-primary-foreground"
    : "bg-card border border-border text-foreground";

  const blocks = parseMessageContent(msg.content);
  const hasThinkingTag = /<(commentary|thinking|think|internal)>/.test(msg.content);
  const displayName = hasThinkingTag ? "Thinking" : (msg.is_bot_message ? "CNP-Bot" : msg.sender_name);
  const avatarColor = hasThinkingTag
    ? "bg-amber-500"
    : (msg.is_bot_message
        ? (theme === "light" ? "bg-muted" : "bg-blue-600")
        : "bg-muted");

  const visibleBlocks = blocks.filter((block) => !shouldHideToolUseBlock(block));

  const renderEntries: RenderableEntry[] = [];
  const aggregatedThought = {
    content: [] as string[],
    isComplete: true,
  };

  const appendThought = (content: string, isComplete: boolean) => {
    const trimmed = content.trim();
    if (!trimmed && isComplete) return;

    if (trimmed) {
      aggregatedThought.content.push(trimmed);
    }
    aggregatedThought.isComplete = aggregatedThought.isComplete && isComplete;
  };

  visibleBlocks.forEach((block, blockIndex) => {
    if (block.type === 'thinking' || block.type === 'redacted_thinking') {
      const thoughtText =
        block.text ||
        (block.type === 'redacted_thinking' ? "Thinking process is redacted." : "");
      appendThought(
        thoughtText,
        block.isComplete !== false,
      );
      return;
    }

    if (block.type === 'text') {
      const segments = parseThoughts(block.text || "");
      let textSegmentIndex = 0;
      segments.forEach((seg) => {
        if (seg.type === 'thought') {
          appendThought(seg.content, !!seg.isComplete);
          return;
        }

        if (seg.content.trim()) {
          renderEntries.push({
            kind: 'block',
            key: `text-${blockIndex}-${textSegmentIndex}`,
            block: {
              type: 'text',
              text: seg.content,
              key: `text-${blockIndex}-${textSegmentIndex}`,
            },
          });
        }
        textSegmentIndex += 1;
      });
      return;
    }

    renderEntries.push({
      kind: 'block',
      key: `block-${block.id || blockIndex}`,
      block,
    });
  });

  const thoughtContent = aggregatedThought.content.join('\n\n').trim();
  const hasThoughtCard = !!thoughtContent || !aggregatedThought.isComplete;

  const hasVisibleContent = hasThoughtCard || renderEntries.length > 0;

  if (!hasVisibleContent) return null;

  return (
    <div
      className={cn(
        "flex gap-3",
        outgoing
          ? "ml-auto flex-row-reverse max-w-[70%]"
          : "w-full"
      )}
    >
      <div
        className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
          avatarColor
        )}
      >
        {hasThinkingTag ? <Brain size={16} /> : (msg.is_bot_message ? <Bot size={16} /> : <User size={16} />)}
      </div>
      <div className={cn("p-3 rounded-2xl text-sm min-w-[100px] mt-2 first:mt-0 break-words overflow-wrap-anywhere", bubble, !outgoing && "flex-1 min-w-0")}>
        {!outgoing ? (
          <div className="font-semibold text-xs mb-1 opacity-70">
            {displayName}
          </div>
        ) : null}

        {hasThoughtCard ? (
          <ThoughtProcess
            key="aggregated-thought"
            content={thoughtContent}
            isComplete={aggregatedThought.isComplete}
          />
        ) : null}

        {renderEntries.map((entry, bIdx) => {
          const block = entry.block;
          if (block.type === 'tool_use') {
            let inputObj = block.input || {};
            const isEmptyObject = typeof inputObj === 'object' && inputObj !== null && Object.keys(inputObj).length === 0;
            if (isEmptyObject && block.partial_json) {
              try {
                inputObj = JSON.parse(block.partial_json);
              } catch {
                inputObj = block.partial_json;
              }
            }

            return (
              <ToolCallCard
                key={`tool-${block.id || bIdx}`}
                toolName={block.name || 'Unknown Tool'}
                input={inputObj}
                status={block.status || 'calling'}
                result={block.result}
                defaultExpanded={false}
                className={outgoing ? "dark:border-emerald-400/50 border-emerald-500/30" : ""}
              />
            );
          }

          if (block.type === 'prometheus_chart') {
            return (
              <PrometheusChartCard
                key={entry.key}
                block={block as PrometheusChartBlock}
              />
            );
          }

          if (block.type === 'jumpserver_session') {
            return (
              <JumpServerSessionCard
                key={entry.key}
                block={block as JumpServerBlock}
              />
            );
          }

          return (
            <Fragment key={'key' in block ? String(block.key) : entry.key}>
              <MarkdownRenderer
                key={`text-${bIdx}`}
                content={typeof block.text === 'string' ? block.text : ''}
                className={cn(
                  "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
                  outgoing ? "prose-invert" : ""
                )}
              />
            </Fragment>
          );
        })}

        <div className="text-[10px] opacity-60 mt-1 text-right">
          {new Date(msg.timestamp).toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}
