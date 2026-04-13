import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { Send, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SlashCommandPopup } from '@/components/SlashCommandPopup';
import type { SlashCommand } from '@/lib/types';

interface MessageInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  isGenerating: boolean;
  slashCommands?: SlashCommand[];
  onSlash?: () => void;
}

export function MessageInput({
  value,
  onChange,
  onSend,
  onStop,
  isGenerating,
  slashCommands = [],
  onSlash,
}: MessageInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [popupPosition, setPopupPosition] = useState({ top: 0, left: 0 });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isPopupDismissed, setIsPopupDismissed] = useState(false);
  const prevShowPopupRef = useRef(false);

  const { shouldShowPopup, filter } = useMemo(() => {
    if (value.startsWith('/') && value.includes(' ')) {
      return { shouldShowPopup: false, filter: '' };
    }

    if (value === '/') {
      return { shouldShowPopup: true, filter: '' };
    }

    if (value.startsWith('/')) {
      const cmdPart = value.slice(1);
      const spaceIdx = cmdPart.indexOf(' ');
      const searchTerm = spaceIdx === -1 ? cmdPart : cmdPart.slice(0, spaceIdx);
      return { shouldShowPopup: true, filter: searchTerm };
    }

    return { shouldShowPopup: false, filter: '' };
  }, [value]);

  const isPopupVisible = shouldShowPopup && !isPopupDismissed;

  // 计算过滤后的命令列表
  const filteredCommands = slashCommands.filter((cmd) => {
    const searchTerm = filter.toLowerCase();
    return (
      cmd.command.toLowerCase().includes(searchTerm) ||
      cmd.description.toLowerCase().includes(searchTerm)
    );
  });

  const updatePopupPosition = useCallback(() => {
    if (inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      setPopupPosition({
        top: rect.top,
        left: rect.left,
      });
    }
  }, []);

  useEffect(() => {
    updatePopupPosition();
    window.addEventListener('resize', updatePopupPosition);
    window.addEventListener('scroll', updatePopupPosition, true);
    return () => {
      window.removeEventListener('resize', updatePopupPosition);
      window.removeEventListener('scroll', updatePopupPosition, true);
    };
  }, [updatePopupPosition]);

  useEffect(() => {
    if (isPopupVisible && !prevShowPopupRef.current) {
      onSlash?.();
    }

    if (!shouldShowPopup) {
      prevShowPopupRef.current = false;
      return;
    }

    prevShowPopupRef.current = isPopupVisible;
  }, [isPopupVisible, onSlash, shouldShowPopup]);

  const handleInputChange = (nextValue: string) => {
    const currentSlashTerm = value.startsWith('/') ? value.slice(1) : '';
    const nextSlashTerm = nextValue.startsWith('/') ? nextValue.slice(1) : '';

    if (currentSlashTerm !== nextSlashTerm) {
      setSelectedIndex(0);
    }

    if (isPopupDismissed) {
      setIsPopupDismissed(false);
    }

    onChange(nextValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isPopupVisible && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < filteredCommands.length - 1 ? prev + 1 : 0
        );
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev > 0 ? prev - 1 : filteredCommands.length - 1
        );
        return;
      }
      if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
        e.preventDefault();
        if (filteredCommands[selectedIndex]) {
          handleSelectCommand(filteredCommands[selectedIndex].command);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsPopupDismissed(true);
        onChange('');
        return;
      }
    }
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSend();
    }
  };

  const handleSelectCommand = (command: string) => {
    const safeCommand = command.startsWith('/') ? command : `/${command}`;
    onChange(safeCommand + ' ');
    setIsPopupDismissed(false);
    setSelectedIndex(0);
    inputRef.current?.focus();
  };

  const handleClosePopup = () => {
    setIsPopupDismissed(true);
  };

  return (
    <div className="px-3 py-2 border-t bg-card/60 backdrop-blur-sm relative">
      {isPopupVisible && slashCommands.length > 0 && (
        <SlashCommandPopup
          commands={slashCommands}
          onSelect={handleSelectCommand}
          onClose={handleClosePopup}
          position={popupPosition}
          filter={filter}
          selectedIndex={selectedIndex}
          onHover={setSelectedIndex}
        />
      )}
      <div className="flex gap-2 items-center">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isGenerating}
          placeholder={
            isGenerating ? 'Agent is thinking...' : 'Type a message... (try /)'
          }
          className="flex-1 h-9 bg-background/90 border border-border/80 rounded-lg px-3.5 text-[13px] shadow-sm focus:outline-none focus:ring-2 focus:ring-ring/60 focus:border-ring disabled:opacity-50 disabled:cursor-not-allowed transition-[border-color,box-shadow]"
        />
        <button
          onClick={isGenerating ? onStop : onSend}
          disabled={!isGenerating && !value.trim()}
          className={cn(
            'h-9 px-3 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 transition-all shadow-sm border',
            isGenerating
              ? 'bg-amber-500/10 text-amber-600 dark:text-amber-300 border-amber-500/25 hover:bg-amber-500/16 hover:border-amber-500/35'
              : 'bg-primary text-primary-foreground border-primary hover:bg-primary/92',
          )}
          title={isGenerating ? '停止生成' : '发送消息'}
        >
          {isGenerating ? (
            <>
              <Square size={12} fill="currentColor" />
              <span className="text-[11px] font-medium">停止</span>
            </>
          ) : (
            <>
              <Send size={14} />
              <span className="text-[11px] font-medium">发送</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
