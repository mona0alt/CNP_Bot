import { User, Bot, Brain } from "lucide-react";
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
    const bubble = outgoing ? "bg-emerald-600 text-white" : "bg-card border border-border text-foreground";

    const blocks = parseMessageContent(msg.content);
    const hasThinkingTag = /<(commentary|thinking|think|internal)>/.test(msg.content);
    const displayName = hasThinkingTag ? "Thinking" : (msg.is_bot_message ? "CNP-Bot" : msg.sender_name);
    const avatarColor = hasThinkingTag ? "bg-amber-500" : (msg.is_bot_message ? "bg-blue-600" : "bg-muted");

    // Sort blocks: tool_use first, then thought, then everything else
    const sortedBlocks = [...blocks].sort((a, b) => {
      // tool_use always comes first
      if (a.type === 'tool_use' && b.type !== 'tool_use') return -1;
      if (a.type !== 'tool_use' && b.type === 'tool_use') return 1;
      // thought (parsed from text blocks) comes after tool_use but before regular text
      const aHasThought = a.type === 'text' && /<(commentary|thinking|think|internal)>/.test(a.text || '');
      const bHasThought = b.type === 'text' && /<(commentary|thinking|think|internal)>/.test(b.text || '');
      if (aHasThought && !bHasThought) return 1;
      if (!aHasThought && bHasThought) return -1;
      return 0;
    });

    const hasVisibleContent = sortedBlocks.some((block) => {
      if (block.type === 'tool_use') return true;
      const segments = parseThoughts(block.text || "");
      if (segments.length === 0) return false;
      return segments.some((seg) => {
        if (seg.type === 'text') return seg.content.trim().length > 0;
        return !seg.isComplete || seg.content.trim().length > 0;
      });
    });

    if (!hasVisibleContent) {
      return null;
    }

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
            avatarColor
          )}
        >
          {hasThinkingTag ? <Brain size={16} /> : (msg.is_bot_message ? <Bot size={16} /> : <User size={16} />)}
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

            // Parse thoughts from text blocks
            const segments = parseThoughts(block.text || "");

            // Separate thought segments from text segments
            const thoughtSegments = segments.filter(seg => seg.type === 'thought');
            const textSegments = segments.filter(seg => seg.type === 'text');

            // Render thought segments at the top (like toolcard)
            return (
              <>
                {thoughtSegments.map((seg, sIdx) => (
                  <ThoughtProcess
                    key={`thought-${bIdx}-${sIdx}`}
                    content={seg.content}
                    isComplete={!!seg.isComplete}
                    autoCollapse={true}
                  />
                ))}
                {textSegments.map((seg, sIdx) => (
                  <MarkdownRenderer
                    key={`text-${bIdx}-${sIdx}`}
                    content={seg.content}
                    className={cn(
                      "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
                      outgoing ? "prose-invert" : ""
                    )}
                  />
                ))}
              </>
            );
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
