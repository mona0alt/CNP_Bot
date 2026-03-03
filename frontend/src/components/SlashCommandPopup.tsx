import { useEffect, useRef } from "react";
import { HelpCircle, Terminal, Activity } from "lucide-react";

interface SlashCommandPopupProps {
  onSelect: (command: string) => void;
  onClose: () => void;
  position: { top: number; left: number };
}

const COMMANDS = [
  { command: "/help", description: "Show available commands", icon: HelpCircle },
  { command: "/clear", description: "Clear chat history", icon: Terminal },
  { command: "/status", description: "Show current status", icon: Activity },
];

export function SlashCommandPopup({ onSelect, onClose, position }: SlashCommandPopupProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute z-50 w-64 bg-popover text-popover-foreground rounded-md border shadow-md overflow-hidden animate-in fade-in zoom-in-95 duration-200"
      style={{
        bottom: `calc(100% + 10px)`, // Position above the input
        left: position.left,
      }}
    >
      <div className="p-2">
        <div className="text-xs font-medium text-muted-foreground px-2 py-1.5 mb-1">
          Available Commands
        </div>
        {COMMANDS.map((cmd) => (
          <button
            key={cmd.command}
            className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-sm hover:bg-accent hover:text-accent-foreground transition-colors text-left group"
            onClick={() => onSelect(cmd.command)}
          >
            <cmd.icon size={14} className="opacity-70 group-hover:opacity-100" />
            <span className="font-mono font-medium flex-1">{cmd.command}</span>
            <span className="text-muted-foreground ml-auto text-xs opacity-70 group-hover:opacity-100">
              {cmd.description}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
