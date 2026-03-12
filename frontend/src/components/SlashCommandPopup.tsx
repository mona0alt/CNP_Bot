import { useEffect, useRef } from 'react';
import { HelpCircle, Terminal, Activity, Sparkles } from 'lucide-react';
import type { SlashCommand } from '@/lib/types';

interface SlashCommandPopupProps {
  commands: SlashCommand[];
  onSelect: (command: string) => void;
  onClose: () => void;
  position: { top: number; left: number };
  filter?: string;
  selectedIndex?: number;
  onHover?: (index: number) => void;
}

const defaultIcons: Record<
  string,
  React.ComponentType<{ size?: number; className?: string }>
> = {
  '/help': HelpCircle,
  '/clear': Terminal,
  '/status': Activity,
};

function getIcon(command: string, source: 'sdk' | 'custom') {
  if (source === 'custom') return Sparkles;
  return defaultIcons[command] || Terminal;
}

export function SlashCommandPopup({
  commands,
  onSelect,
  onClose,
  position,
  filter = '',
  selectedIndex = 0,
  onHover,
}: SlashCommandPopupProps) {
  const ref = useRef<HTMLDivElement>(null);

  const filteredCommands = commands.filter((cmd) => {
    const searchTerm = filter.toLowerCase();
    return (
      cmd.command.toLowerCase().includes(searchTerm) ||
      cmd.description.toLowerCase().includes(searchTerm)
    );
  });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  useEffect(() => {
    if (ref.current) {
      const selected = ref.current.querySelector(
        `[data-index="${selectedIndex}"]`,
      );
      selected?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (filteredCommands.length === 0) {
    return (
      <div
        ref={ref}
        className="absolute z-50 w-72 bg-popover text-popover-foreground rounded-md border shadow-md overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        style={{
          bottom: `calc(100% + 10px)`,
          left: position.left,
        }}
      >
        <div className="p-3 text-sm text-muted-foreground text-center">
          No commands found
        </div>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="absolute z-50 w-72 bg-popover text-popover-foreground rounded-md border shadow-md overflow-hidden animate-in fade-in zoom-in-95 duration-200"
      style={{
        bottom: `calc(100% + 10px)`,
        left: position.left,
        maxHeight: '300px',
        overflowY: 'auto',
      }}
    >
      <div className="p-2">
        <div className="text-xs font-medium text-muted-foreground px-2 py-1.5 mb-1">
          Available Commands {filter && `(${filteredCommands.length})`}
        </div>
        {filteredCommands.map((cmd, index) => {
          const Icon = getIcon(cmd.command, cmd.source);
          return (
            <button
              key={cmd.command}
              data-index={index}
              className={`w-full flex items-center gap-2 px-2 py-2 text-sm rounded-sm transition-colors text-left group ${
                index === selectedIndex
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-accent hover:text-accent-foreground'
              }`}
              onClick={() => onSelect(cmd.command)}
              onMouseEnter={() => onHover?.(index)}
            >
              <Icon
                size={14}
                className={`shrink-0 ${
                  cmd.source === 'custom'
                    ? 'text-primary'
                    : 'opacity-70 group-hover:opacity-100'
                }`}
              />
              <span className="font-mono font-medium flex-1 shrink-0">
                {cmd.command}
              </span>
              <span className="text-muted-foreground ml-auto text-xs opacity-70 group-hover:opacity-100 truncate">
                {cmd.description}
              </span>
              {cmd.source === 'custom' && (
                <span className="text-xs bg-primary/20 text-primary px-1 rounded ml-1 shrink-0">
                  custom
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="px-2 py-1.5 border-t text-xs text-muted-foreground flex gap-2">
        <span>
          <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">↑↓</kbd>{' '}
          navigate
        </span>
        <span>
          <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">↵</kbd>{' '}
          select
        </span>
        <span>
          <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">esc</kbd>{' '}
          close
        </span>
      </div>
    </div>
  );
}
