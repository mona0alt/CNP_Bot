import { User, Bot, Brain } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Message } from "@/lib/types";
import { parseMessageContent } from "@/lib/message-parser";
import { parseThoughts } from "@/lib/thought-parser";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { ToolCallCard } from "@/components/ToolCallCard";
import { ThoughtProcess } from "@/components/ThoughtProcess";
import { useTheme } from "@/contexts/ThemeContext";

interface MessageListProps {
  messages: Message[];
}

export function MessageList({ messages }: MessageListProps) {
  const { theme } = useTheme();

  const renderItems = messages.map((msg, idx) => {
    const outgoing = !!msg.is_from_me;
    // Light theme: sent messages use primary color, received use white bg with border
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

    // Sort blocks: tool_use first, then thought, then everything else
    const sortedBlocks = [...blocks].sort((a, b) => {
      // thinking blocks always come first
      const aIsThoughtBlock = a.type === 'thinking' || a.type === 'redacted_thinking';
      const bIsThoughtBlock = b.type === 'thinking' || b.type === 'redacted_thinking';
      if (aIsThoughtBlock && !bIsThoughtBlock) return -1;
      if (!aIsThoughtBlock && bIsThoughtBlock) return 1;

      // thought (parsed from text blocks) comes before tool_use
      const aHasThought = a.type === 'text' && /<(commentary|thinking|think|internal)>/.test(a.text || '');
      const bHasThought = b.type === 'text' && /<(commentary|thinking|think|internal)>/.test(b.text || '');
      if (aHasThought && !bHasThought) return -1;
      if (!aHasThought && bHasThought) return 1;

      // tool_use comes after thoughts
      if (a.type === 'tool_use' && b.type !== 'tool_use') return -1;
      if (a.type !== 'tool_use' && b.type === 'tool_use') return 1;
      
      return 0;
    });

    const hasVisibleContent = sortedBlocks.some((block) => {
      if (block.type === 'tool_use') return true;
      if (block.type === 'thinking' || block.type === 'redacted_thinking') return true;
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
        <div className={cn("p-3 rounded-2xl text-sm min-w-[100px] mt-2 first:mt-0", bubble)}>
          {!outgoing ? (
            <div className="font-semibold text-xs mb-1 opacity-70">
              {displayName}
            </div>
          ) : null}

          {sortedBlocks.map((block, bIdx) => {
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

            if (block.type === 'thinking' || block.type === 'redacted_thinking') {
                return (
                  <ThoughtProcess
                    key={`thought-block-${bIdx}`}
                    content={block.text || (block.type === 'redacted_thinking' ? "Thinking process is redacted." : "")}
                    isComplete={true} 
                    autoCollapse={true}
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

  return <div className="space-y-6">{renderItems}</div>;
}
