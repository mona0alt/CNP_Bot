import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Chat } from "@/lib/types";

interface ChatSidebarProps {
  chats: Chat[];
  selectedJid: string | null;
  onSelectChat: (jid: string) => void;
  onCreateChat: () => void;
  onDeleteChat: (jid: string) => void;
}

export function ChatSidebar({
  chats,
  selectedJid,
  onSelectChat,
  onCreateChat,
  onDeleteChat,
}: ChatSidebarProps) {
  const handleDelete = (e: React.MouseEvent, jid: string) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this chat?")) return;
    onDeleteChat(jid);
  };

  return (
    <div className="w-80 border-r bg-card flex flex-col">
      <div className="p-4 border-b flex items-center justify-between">
        <h2 className="text-lg font-semibold">Chats</h2>
        <button
          onClick={onCreateChat}
          className="p-1.5 hover:bg-muted rounded-md transition-colors text-muted-foreground hover:text-foreground"
          title="New Chat"
        >
          <Plus size={20} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {chats.map((chat) => (
          <div
            key={chat.jid}
            onClick={() => onSelectChat(chat.jid)}
            className={cn(
              "group p-4 border-b cursor-pointer hover:bg-muted/50 transition-colors relative",
              selectedJid === chat.jid && "bg-muted"
            )}
          >
            <div className="font-medium truncate pr-6">{chat.name || chat.jid}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {new Date(chat.last_message_time).toLocaleString()}
            </div>
            <button
              onClick={(e) => handleDelete(e, chat.jid)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
              title="Delete Chat"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}