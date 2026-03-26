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

  // Sort blocks: thinking first, then thought-tagged text, then tool_use, then rest
  const sortedBlocks = [...blocks].sort((a, b) => {
    const aIsThoughtBlock = a.type === 'thinking' || a.type === 'redacted_thinking';
    const bIsThoughtBlock = b.type === 'thinking' || b.type === 'redacted_thinking';
    if (aIsThoughtBlock && !bIsThoughtBlock) return -1;
    if (!aIsThoughtBlock && bIsThoughtBlock) return 1;

    const aHasThought = a.type === 'text' && /<(commentary|thinking|think|internal)>/.test(a.text || '');
    const bHasThought = b.type === 'text' && /<(commentary|thinking|think|internal)>/.test(b.text || '');
    if (aHasThought && !bHasThought) return -1;
    if (!aHasThought && bHasThought) return 1;

    if (a.type === 'tool_use' && b.type !== 'tool_use') return -1;
    if (a.type !== 'tool_use' && b.type === 'tool_use') return 1;

    return 0;
  });

  const visibleBlocks = sortedBlocks.filter((block) => !shouldHideToolUseBlock(block));

  const thoughtContents: string[] = [];
  let hasIncompleteThought = false;
  const displayBlocks: Array<
    | ContentBlock
    | { type: 'text'; text: string; key: string }
  > = [];

  visibleBlocks.forEach((block, blockIndex) => {
    if (block.type === 'thinking' || block.type === 'redacted_thinking') {
      const thoughtText =
        block.text ||
        (block.type === 'redacted_thinking' ? "Thinking process is redacted." : "");
      if (thoughtText) {
        thoughtContents.push(thoughtText);
      }
      return;
    }

    if (block.type === 'text') {
      const segments = parseThoughts(block.text || "");
      let textSegmentIndex = 0;
      segments.forEach((seg) => {
        if (seg.type === 'thought') {
          if (seg.content.trim()) {
            thoughtContents.push(seg.content);
          }
          if (!seg.isComplete) {
            hasIncompleteThought = true;
          }
          return;
        }

        if (seg.content.trim()) {
          displayBlocks.push({
            type: 'text',
            text: seg.content,
            key: `text-${blockIndex}-${textSegmentIndex++}`,
          });
        }
      });
      return;
    }

    displayBlocks.push(block);
  });

  const mergedThoughtContent = thoughtContents.join('\n\n').trim();

  const hasVisibleContent =
    mergedThoughtContent.length > 0 ||
    hasIncompleteThought ||
    displayBlocks.length > 0;

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
      <div className={cn("p-3 rounded-2xl text-sm min-w-[100px] mt-2 first:mt-0", bubble, !outgoing && "flex-1 min-w-0")}>
        {!outgoing ? (
          <div className="font-semibold text-xs mb-1 opacity-70">
            {displayName}
          </div>
        ) : null}

        {(mergedThoughtContent || hasIncompleteThought) ? (
          <ThoughtProcess
            key="thought-merged"
            content={mergedThoughtContent}
            isComplete={!hasIncompleteThought}
            autoCollapse={true}
          />
        ) : null}

        {displayBlocks.map((block, bIdx) => {
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
                key={`chart-${bIdx}`}
                block={block as PrometheusChartBlock}
              />
            );
          }

          if (block.type === 'jumpserver_session') {
            return (
              <JumpServerSessionCard
                key={`jumpserver-${block.id || bIdx}`}
                block={block as JumpServerBlock}
              />
            );
          }

          return (
            <Fragment key={'key' in block ? String(block.key) : `text-block-${bIdx}`}>
              <MarkdownRenderer
                key={`text-${bIdx}`}
                content={block.text || ''}
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
