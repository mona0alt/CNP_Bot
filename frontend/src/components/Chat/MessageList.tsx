import { User, Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Message } from "@/lib/types";
import { parseMessageContent } from "@/lib/message-parser";
import { parseThoughts } from "@/lib/thought-parser";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { ToolCallCard } from "@/components/ToolCallCard";
import { ThoughtProcess } from "@/components/ThoughtProcess";

interface MessageListProps {
  messages: Message[];
}

export function MessageList({ messages }: MessageListProps) {
  const renderItems = messages.map((msg, idx) => {
    const outgoing = !!msg.is_from_me;
    const bubble = outgoing ? "bg-emerald-600 text-white" : "bg-muted text-foreground";
    const avatar = msg.is_bot_message ? "bg-blue-600" : "bg-muted";

    const blocks = parseMessageContent(msg.content);

    // Sort blocks: tool_use first, then everything else
    const sortedBlocks = [...blocks].sort((a, b) => {
      if (a.type === 'tool_use' && b.type !== 'tool_use') return -1;
      if (a.type !== 'tool_use' && b.type === 'tool_use') return 1;
      return 0;
    });

    const displayName = msg.is_bot_message ? "CNP-Bot" : msg.sender_name;

    return (
      <div
        key={msg.id || idx}
        className={cn(
          "flex gap-3 max-w-[80%]",
          outgoing ? "ml-auto flex-row-reverse" : ""
        )}
      >
        <div
          className={cn(
            "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
            avatar
          )}
        >
          {msg.is_bot_message ? <Bot size={16} /> : <User size={16} />}
        </div>
        <div className={cn("p-3 rounded-2xl text-sm min-w-[100px]", bubble)}>
          {!outgoing ? (
            <div className="font-semibold text-xs mb-1 opacity-70">
              {displayName}
            </div>
          ) : null}

          {sortedBlocks.map((block, bIdx) => {
            if (block.type === 'tool_use') {
              let inputObj = block.input || {};
              if (!block.input && block.partial_json) {
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
                  className={outgoing ? "border-emerald-400/50" : ""}
                />
              );
            }

            const segments = parseThoughts(block.text || "");
            return segments.map((seg, sIdx) => {
              if (seg.type === 'thought') {
                return (
                  <ThoughtProcess
                    key={`${bIdx}-${sIdx}`}
                    content={seg.content}
                    isComplete={!!seg.isComplete}
                    autoCollapse={true}
                  />
                );
              }
              return (
                <MarkdownRenderer
                  key={`${bIdx}-${sIdx}`}
                  content={seg.content}
                  className={cn(
                    "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
                    outgoing ? "prose-invert" : ""
                  )}
                />
              );
            });
          })}

          <div className="text-[10px] opacity-60 mt-1 text-right">
            {new Date(msg.timestamp).toLocaleTimeString()}
          </div>
        </div>
      </div>
    );
  });

  return <div className="space-y-4">{renderItems}</div>;
}