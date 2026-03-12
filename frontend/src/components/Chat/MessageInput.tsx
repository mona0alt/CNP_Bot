import { useRef, useState, useEffect, useCallback } from 'react';
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
  const [showPopup, setShowPopup] = useState(false);
  const [popupPosition, setPopupPosition] = useState({ top: 0, left: 0 });
  const [filter, setFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const prevShowPopupRef = useRef(false);

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

  // 当 filter 改变时，重置选中的索引
  useEffect(() => {
    setSelectedIndex(0);
  }, [filter]);

  useEffect(() => {
    // 如果是命令后跟空格+参数的情况，不显示弹窗
    if (value.startsWith('/') && value.includes(' ')) {
      setShowPopup(false);
      setFilter('');
      prevShowPopupRef.current = false;
      return;
    }

    if (value === '/') {
      if (!prevShowPopupRef.current) {
        onSlash?.();
      }
      setShowPopup(true);
      setFilter('');
    } else if (value.startsWith('/')) {
      const cmdPart = value.slice(1);
      const spaceIdx = cmdPart.indexOf(' ');
      const searchTerm = spaceIdx === -1 ? cmdPart : cmdPart.slice(0, spaceIdx);
      setFilter(searchTerm);
      if (!prevShowPopupRef.current) {
        onSlash?.();
      }
      setShowPopup(true);
    } else {
      setShowPopup(false);
      setFilter('');
    }
    prevShowPopupRef.current = showPopup;
  }, [value, onSlash]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showPopup && filteredCommands.length > 0) {
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
        setShowPopup(false);
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
    setShowPopup(false);
    inputRef.current?.focus();
  };

  const handleClosePopup = () => {
    setShowPopup(false);
  };

  return (
    <div className="p-4 border-t bg-card/50 relative">
      {showPopup && slashCommands.length > 0 && (
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
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isGenerating}
          placeholder={
            isGenerating ? 'Agent is thinking...' : 'Type a message... (try /)'
          }
          className="flex-1 bg-background border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        />
        <button
          onClick={isGenerating ? onStop : onSend}
          disabled={!isGenerating && !value.trim()}
          className={cn(
            'px-4 py-2 rounded-md disabled:opacity-50 flex items-center justify-center transition-colors',
            isGenerating
              ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
              : 'bg-primary text-primary-foreground hover:bg-primary/90',
          )}
          title={isGenerating ? 'Stop generating' : 'Send message'}
        >
          {isGenerating ? (
            <Square size={18} fill="currentColor" />
          ) : (
            <Send size={18} />
          )}
        </button>
      </div>
    </div>
  );
}
