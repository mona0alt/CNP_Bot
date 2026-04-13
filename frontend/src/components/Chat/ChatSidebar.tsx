import { useState } from "react";
import { ChevronLeft, ChevronRight, MessageSquareText, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { Chat } from "@/lib/types";

interface ChatSidebarProps {
  chats: Chat[];
  selectedJid: string | null;
  onSelectChat: (jid: string) => void;
  onCreateChat: (input?: {
    agentType?: 'claude' | 'deepagent';
    skills?: string[];
  }) => void;
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
        collapsed ? "w-14" : "w-56",
      )}
    >
      {/* Header */}
      <div
        className={cn(
          "h-12 border-b flex items-center shrink-0",
          collapsed ? "px-1.5 flex-col justify-center gap-2" : "px-3.5 justify-between",
        )}
      >
        {collapsed ? (
          <>
            <button
              onClick={onToggleCollapsed}
              className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-border/70 bg-background text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors cursor-pointer"
              title="展开会话列表"
              aria-label="展开会话列表"
            >
              <ChevronRight size={15} />
            </button>
            <button
              onClick={() => onCreateChat()}
              className="h-8 w-8 inline-flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer"
              title="新建会话"
              aria-label="新建会话"
            >
              <Plus size={14} />
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2.5 min-w-0">
              <button
                onClick={onToggleCollapsed}
                className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-border/70 bg-background text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors cursor-pointer"
                title="收起会话列表"
                aria-label="收起会话列表"
              >
                <ChevronLeft size={15} />
              </button>
              <div className="min-w-0">
                <h2 className="text-[14px] font-medium tracking-tight">会话</h2>
                <p className="text-[10px] text-muted-foreground mt-0.5">{chats.length} 个会话</p>
              </div>
            </div>
            <button
              onClick={() => onCreateChat()}
              className="h-8 inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 px-3 text-[12px] font-medium transition-colors cursor-pointer"
              title="新建会话"
            >
              <Plus size={14} />
              新建
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
                ? "px-1.5 py-2.5 flex justify-center"
                : "px-3 py-2.5 hover:bg-muted/40",
              selectedJid === chat.jid && (collapsed ? "bg-primary/10" : "bg-muted/60")
            )}
            title={chat.last_user_message || chat.name || chat.jid}
            aria-label={chat.last_user_message || chat.name || chat.jid}
          >
            {collapsed ? (
              <div
                className={cn(
                  "h-9 w-9 rounded-xl border flex items-center justify-center text-[12px] font-medium transition-all",
                  selectedJid === chat.jid
                    ? "border-primary/35 bg-primary/12 text-primary shadow-sm"
                    : "border-border/70 bg-background text-foreground/80 group-hover:bg-muted/60",
                )}
              >
                {((chat.last_user_message || chat.name || chat.jid).trim().charAt(0) || '#').toUpperCase()}
              </div>
            ) : (
              <>
                <div className="font-medium truncate pr-8 text-[13px] text-foreground leading-tight">
                  {chat.last_user_message || chat.name || chat.jid}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
                  {new Date(chat.last_message_time).toLocaleString()}
                </div>
                {chat.last_message && (
                  <div className="text-[11px] text-muted-foreground/75 truncate pr-6 mt-1 leading-relaxed">
                    {chat.last_message.length > 40
                      ? chat.last_message.substring(0, 40) + '...'
                      : chat.last_message}
                  </div>
                )}
                <button
                  onClick={(e) => handleDeleteClick(e, chat.jid)}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-background/80 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                  title="删除会话"
                >
                  <Trash2 size={13} />
                </button>
              </>
            )}
          </div>
        ))}
        {chats.length === 0 && (
          <div className={cn("text-muted-foreground", collapsed ? "px-1 py-3 flex justify-center" : "p-4")}>
            {collapsed ? (
              <MessageSquareText size={16} />
            ) : (
              <div className="text-[13px]">还没有会话，点击"新建"开始。</div>
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
