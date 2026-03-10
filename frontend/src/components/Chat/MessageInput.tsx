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
}

export function MessageInput({
  value,
  onChange,
  onSend,
  onStop,
  isGenerating,
  slashCommands = [],
}: MessageInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [showPopup, setShowPopup] = useState(false);
  const [popupPosition, setPopupPosition] = useState({ top: 0, left: 0 });
  const [filter, setFilter] = useState('');

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
    if (value === '/') {
      setShowPopup(true);
      setFilter('');
    } else if (value.startsWith('/')) {
      const cmdPart = value.slice(1);
      const spaceIdx = cmdPart.indexOf(' ');
      const searchTerm = spaceIdx === -1 ? cmdPart : cmdPart.slice(0, spaceIdx);
      setFilter(searchTerm);
      setShowPopup(true);
    } else {
      setShowPopup(false);
      setFilter('');
    }
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (showPopup) {
        // Let the popup handle it
        return;
      }
      onSend();
    }
    if (e.key === 'Escape') {
      setShowPopup(false);
      onChange('');
    }
  };

  const handleSelectCommand = (command: string) => {
    onChange(command + ' ');
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
