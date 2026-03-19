import { useState } from "react";
import { ChevronLeft, ChevronRight, MessageSquareText, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { Chat } from "@/lib/types";

interface ChatSidebarProps {
  chats: Chat[];
  selectedJid: string | null;
  onSelectChat: (jid: string) => void;
  onCreateChat: () => void;
  onDeleteChat: (jid: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export function ChatSidebar({
  chats,
  selectedJid,
  onSelectChat,
  onCreateChat,
  onDeleteChat,
  collapsed,
  onToggleCollapsed,
}: ChatSidebarProps) {
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const handleDeleteClick = (e: React.MouseEvent, jid: string) => {
    e.stopPropagation();
    setDeleteTarget(jid);
  };

  const handleConfirmDelete = () => {
    if (deleteTarget) {
      onDeleteChat(deleteTarget);
      setDeleteTarget(null);
    }
  };

  return (
    <div
      className={cn(
        "border-r bg-card/95 backdrop-blur-sm flex flex-col transition-all duration-300 ease-out shrink-0",
        collapsed ? "w-[76px]" : "w-80",
      )}
    >
      <div
        className={cn(
          "h-[60px] border-b flex items-center shrink-0",
          collapsed ? "px-2 flex-col justify-center gap-2" : "px-4 justify-between",
        )}
      >
        {collapsed ? (
          <>
            <button
              onClick={onToggleCollapsed}
              className="h-9 w-9 inline-flex items-center justify-center rounded-xl border border-border/70 bg-background text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors"
              title="展开会话列表"
              aria-label="展开会话列表"
            >
              <ChevronRight size={18} />
            </button>
            <button
              onClick={onCreateChat}
              className="h-9 w-9 inline-flex items-center justify-center rounded-xl bg-primary/12 text-primary hover:bg-primary/18 transition-colors"
              title="新建会话"
              aria-label="新建会话"
            >
              <Plus size={18} />
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 min-w-0">
              <button
                onClick={onToggleCollapsed}
                className="h-9 w-9 inline-flex items-center justify-center rounded-xl border border-border/70 bg-background text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors"
                title="收起会话列表"
                aria-label="收起会话列表"
              >
                <ChevronLeft size={18} />
              </button>
              <div className="min-w-0">
                <h2 className="text-[15px] font-semibold leading-none">Sessions</h2>
                <p className="text-xs text-muted-foreground mt-1">{chats.length} 个会话</p>
              </div>
            </div>
            <button
              onClick={onCreateChat}
              className="h-9 px-3 inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/92 shadow-sm transition-colors"
              title="新建会话"
            >
              <Plus size={16} />
              <span className="text-sm font-medium">新建</span>
            </button>
          </>
        )}
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {chats.map((chat) => (
          <div
            key={chat.jid}
            onClick={() => onSelectChat(chat.jid)}
            className={cn(
              "group border-b cursor-pointer transition-colors relative",
              collapsed
                ? "px-2 py-3 flex justify-center"
                : "p-4 hover:bg-muted/45",
              selectedJid === chat.jid && (collapsed ? "bg-primary/10" : "bg-muted/70")
            )}
            title={chat.last_user_message || chat.name || chat.jid}
            aria-label={chat.last_user_message || chat.name || chat.jid}
          >
            {collapsed ? (
              <div
                className={cn(
                  "h-11 w-11 rounded-2xl border flex items-center justify-center text-sm font-semibold transition-all",
                  selectedJid === chat.jid
                    ? "border-primary/35 bg-primary/12 text-primary shadow-sm"
                    : "border-border/70 bg-background text-foreground/80 group-hover:bg-muted/60",
                )}
              >
                {((chat.last_user_message || chat.name || chat.jid).trim().charAt(0) || '#').toUpperCase()}
              </div>
            ) : (
              <>
                <div className="font-medium truncate pr-10 text-sm text-foreground">
                  {chat.last_user_message || chat.name || chat.jid}
                </div>
                <div className="text-[11px] text-muted-foreground mt-1.5">
                  {new Date(chat.last_message_time).toLocaleString()}
                </div>
                {chat.last_message && (
                  <div className="text-sm text-muted-foreground/90 truncate pr-10 mt-1">
                    {chat.last_message.length > 50
                      ? chat.last_message.substring(0, 50) + '...'
                      : chat.last_message}
                  </div>
                )}
                <button
                  onClick={(e) => handleDeleteClick(e, chat.jid)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-background/80 opacity-0 group-hover:opacity-100 transition-all"
                  title="删除会话"
                >
                  <Trash2 size={16} />
                </button>
              </>
            )}
          </div>
        ))}
        {chats.length === 0 && (
          <div className={cn("text-muted-foreground", collapsed ? "px-2 py-4 flex justify-center" : "p-5")}>
            {collapsed ? (
              <MessageSquareText size={18} />
            ) : (
              <div className="text-sm">还没有会话，点击右上角“新建”开始。</div>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除会话"
        message="确定要删除这个会话吗？该操作无法撤销。"
        confirmLabel="删除"
        cancelLabel="取消"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
        destructive
      />
    </div>
  );
}
