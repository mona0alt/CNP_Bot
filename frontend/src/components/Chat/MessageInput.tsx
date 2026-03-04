import { useRef } from "react";
import { Send, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { SlashCommandPopup } from "@/components/SlashCommandPopup";

interface MessageInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  isGenerating: boolean;
}

export function MessageInput({
  value,
  onChange,
  onSend,
  onStop,
  isGenerating,
}: MessageInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const showSlashCommands = value === "/";

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (showSlashCommands) {
        onChange("");
      }
      onSend();
    }
    if (e.key === "Escape") {
      onChange("");
    }
  };

  return (
    <div className="p-4 border-t bg-card/50 relative">
      {showSlashCommands && (
        <SlashCommandPopup
          onSelect={(cmd) => {
            onChange("");
            if (cmd === "/clear") {
              if (confirm("Clear chat history view?")) {
                // Parent will handle clearing
              }
            }
          }}
          onClose={() => onChange("")}
          position={{ top: 0, left: 0 }}
        />
      )}
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isGenerating}
          placeholder={isGenerating ? "Agent is thinking..." : "Type a message... (try /)"}
          className="flex-1 bg-background border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        />
        <button
          onClick={isGenerating ? onStop : onSend}
          disabled={!isGenerating && !value.trim()}
          className={cn(
            "px-4 py-2 rounded-md disabled:opacity-50 flex items-center justify-center transition-colors",
            isGenerating
              ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
              : "bg-primary text-primary-foreground hover:bg-primary/90"
          )}
          title={isGenerating ? "Stop generating" : "Send message"}
        >
          {isGenerating ? <Square size={18} fill="currentColor" /> : <Send size={18} />}
        </button>
      </div>
    </div>
  );
}