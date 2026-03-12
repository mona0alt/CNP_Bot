import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare, Trash2 } from 'lucide-react';
import type { Chat, Message, SlashCommand } from '@/lib/types';
import { StatusSidebar } from '@/components/StatusSidebar';
import { ChatSidebar, MessageList, MessageInput } from '@/components/Chat';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useChatWebSocket } from '@/hooks/useChatWebSocket';
import { useStreamingMessages } from '@/contexts/StreamingMessagesContext';
import { useAuth } from '@/contexts/AuthContext';

export function Chat() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedJid, setSelectedJid] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedToBottomRef = useRef(true);

  const {
    saveStreamingMessages,
    getStreamingMessages,
    clearStreamingMessages,
  } = useStreamingMessages();
  const { token, logout } = useAuth();

  const apiBase = import.meta.env.DEV
    ? `${location.protocol}//${location.hostname}:3000`
    : '';

  const authHeaders = useMemo<HeadersInit | undefined>(() => {
    if (!token) return undefined;
    return { Authorization: `Bearer ${token}` };
  }, [token]);

  const handleUnauthorized = useCallback(async () => {
    await logout();
    window.location.href = '/login';
  }, [logout]);

  // Chat list operations
  const fetchChats = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${apiBase}/api/chats`, {
        headers: authHeaders,
      });
      if (res.status === 401 || res.status === 403) {
        await handleUnauthorized();
        return;
      }
      if (!res.ok) {
        throw new Error('Failed to fetch chats');
      }
      const data = await res.json();
      setChats(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error(error);
    }
  }, [apiBase, authHeaders, token, handleUnauthorized]);

  const updateChatPreviewFromUserMessage = (
    jid: string,
    content: string,
    timestamp: string,
  ) => {
    const sessionTitle = content.trim();
    if (!sessionTitle) return;

    setChats((prev) => {
      const next = [...prev];
      const index = next.findIndex((chat) => chat.jid === jid);

      if (index >= 0) {
        const existing = next[index];
        next[index] = {
          ...existing,
          last_message_time: timestamp,
          last_message: content,
          last_user_message: sessionTitle,
        };
      } else {
        next.push({
          jid,
          name: 'New Chat',
          last_message_time: timestamp,
          last_message: content,
          last_user_message: sessionTitle,
          is_group: 0,
        });
      }

      next.sort(
        (a, b) =>
          new Date(b.last_message_time || 0).getTime() -
          new Date(a.last_message_time || 0).getTime(),
      );
      return next;
    });
  };

  const handleCreateChat = async () => {
    try {
      if (!token) return;
      const res = await fetch(`${apiBase}/api/chats`, {
        method: 'POST',
        headers: authHeaders,
      });
      if (res.status === 401 || res.status === 403) {
        await handleUnauthorized();
        return;
      }
      if (!res.ok) throw new Error('Failed to create chat');
      const newChat = await res.json();
      fetchChats();
      setSelectedJid(newChat.jid);
    } catch (error) {
      console.error('Failed to create chat', error);
    }
  };

  const handleDeleteChat = async (jid: string) => {
    try {
      if (!token) return;
      const res = await fetch(
        `${apiBase}/api/chats/${encodeURIComponent(jid)}`,
        {
          method: 'DELETE',
          headers: authHeaders,
        },
      );
      if (res.status === 401 || res.status === 403) {
        await handleUnauthorized();
        return;
      }
      if (!res.ok) throw new Error('Failed to delete chat');
      setChats((prev) => prev.filter((c) => c.jid !== jid));
      if (selectedJid === jid) {
        setSelectedJid(null);
      }
    } catch (error) {
      console.error('Failed to delete chat', error);
    }
  };

  // WebSocket hook
  const { sendMessage, stopGenerating, fetchMessages } = useChatWebSocket({
    jid: selectedJid,
    apiBase,
    token,
    setMessages,
    setIsGenerating,
    onUnauthorized: handleUnauthorized,
  });

  const fetchSlashCommands = useCallback(() => {
    if (!token) return;
    fetch(`${apiBase}/api/slash-commands`, {
      headers: authHeaders,
    })
      .then((res) => {
        if (res.status === 401 || res.status === 403) {
          handleUnauthorized();
          return [];
        }
        return res.json();
      })
      .then((data) => {
        if (Array.isArray(data)) {
          setSlashCommands(data);
        }
      })
      .catch((err) => {
        console.error('Failed to fetch slash commands:', err);
      });
  }, [apiBase, authHeaders, handleUnauthorized, token]);

  // Initial load
  useEffect(() => {
    fetchChats();
    fetchSlashCommands();
  }, [fetchChats, fetchSlashCommands]);

  // Load messages when chat is selected
  useEffect(() => {
    if (!selectedJid) {
      setMessages([]);
      return;
    }

    setLoading(true);
    setIsGenerating(false);
    fetchMessages(selectedJid).then((data) => {
      // 尝试从 Context 恢复流式消息
      const savedStreaming = getStreamingMessages(selectedJid);
      if (savedStreaming && savedStreaming.length > 0) {
        // 合并：数据库消息 + 流式消息（去除重复）
        const streamingIds = new Set(savedStreaming.map((m: Message) => m.id));
        const filteredData = data.filter(
          (m: Message) => !streamingIds.has(m.id),
        );
        // 流式消息放在最后
        setMessages([...filteredData, ...savedStreaming]);
      } else {
        setMessages(data);
      }
      setLoading(false);
    });
  }, [selectedJid, fetchMessages, getStreamingMessages]);

  // 保存流式消息到 Context
  useEffect(() => {
    if (!selectedJid || messages.length === 0) return;
    if (messages.some((m) => m.chat_jid !== selectedJid)) return;

    const streamingBotMessages = messages.filter(
      (m) => m.is_bot_message && m.id.startsWith('stream-'),
    );

    if (streamingBotMessages.length > 0) {
      saveStreamingMessages(selectedJid, streamingBotMessages);
    } else {
      clearStreamingMessages(selectedJid);
    }
  }, [selectedJid, messages, saveStreamingMessages, clearStreamingMessages]);

  useEffect(() => {
    if (!selectedJid || isGenerating) return;
    const hasStreamingMessage = messages.some(
      (m) => m.chat_jid === selectedJid && m.id.startsWith('stream-'),
    );
    if (!hasStreamingMessage) {
      const timer = setTimeout(() => {
        clearStreamingMessages(selectedJid);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [selectedJid, isGenerating, messages, clearStreamingMessages]);

  // Auto-scroll
  useEffect(() => {
    if (!pinnedToBottomRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Handle send message
  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedJid || isGenerating) return;

    const content = newMessage.trim();
    const timestamp = new Date().toISOString();
    setNewMessage('');
    setIsGenerating(true);

    // Try WebSocket first (sendMessage is always defined, but checks WebSocket state internally)
    sendMessage(content);
    const optimisticMsg: Message = {
      id: 'temp-' + Date.now(),
      chat_jid: selectedJid,
      sender_name: 'You',
      content,
      timestamp,
      is_from_me: true,
      is_bot_message: false,
    };
    setMessages((prev) => [...prev, optimisticMsg]);
    updateChatPreviewFromUserMessage(selectedJid, content, timestamp);
    return;

    // Fallback to HTTP
    try {
      const res = await fetch(`${apiBase}/api/groups/${selectedJid}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const created = (await res.json()) as Message;
      setMessages((prev) => [...prev, created]);
    } catch (error) {
      console.error('Failed to send message', error);
      setIsGenerating(false);
    }
  };

  const handleStop = () => {
    stopGenerating();
    setIsGenerating(false);
  };

  // Render items with date separators
  const renderItems = useMemo(() => {
    const items: Array<
      | ({ type: 'date' } & { key: string; label: string })
      | ({ type: 'msg' } & { key: string; msg: Message })
    > = [];
    let lastDay: string | null = null;

    for (const msg of messages) {
      const d = new Date(msg.timestamp);
      const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (dayKey !== lastDay) {
        lastDay = dayKey;
        items.push({
          type: 'date',
          key: `date:${dayKey}`,
          label: d.toLocaleDateString(),
        });
      }
      items.push({ type: 'msg', key: msg.id, msg });
    }
    return items;
  }, [messages]);

  const chatName = selectedJid
    ? chats.find((c) => c.jid === selectedJid)?.name || selectedJid
    : null;

  return (
    <div className="flex h-full">
      <ChatSidebar
        chats={chats}
        selectedJid={selectedJid}
        onSelectChat={setSelectedJid}
        onCreateChat={handleCreateChat}
        onDeleteChat={handleDeleteChat}
      />

      <div className="flex-1 flex flex-col bg-background">
        {selectedJid ? (
          <>
            <div className="p-4 border-b flex items-center justify-between bg-card/50">
              <h3 className="font-semibold">{chatName}</h3>
              <button
                onClick={() => setShowDeleteDialog(true)}
                className="p-2 text-muted-foreground hover:text-destructive rounded-md hover:bg-muted transition-colors"
                title="Delete Chat"
              >
                <Trash2 size={18} />
              </button>
            </div>

            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-4 scrollbar-thin"
              onScroll={() => {
                const el = scrollRef.current;
                if (!el) return;
                const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
                pinnedToBottomRef.current = dist < 120;
              }}
            >
              {loading ? (
                <div className="text-center text-muted-foreground">
                  Loading...
                </div>
              ) : (
                renderItems.map((it) => {
                  if (it.type === 'date') {
                    return (
                      <div key={it.key} className="flex justify-center my-4">
                        <div className="px-3 py-1 rounded-full bg-muted text-muted-foreground text-xs">
                          {it.label}
                        </div>
                      </div>
                    );
                  }
                  return <MessageList key={it.key} messages={[it.msg]} />;
                })
              )}
            </div>

            <MessageInput
              value={newMessage}
              onChange={setNewMessage}
              onSend={handleSendMessage}
              onStop={handleStop}
              isGenerating={isGenerating}
              slashCommands={slashCommands}
              onSlash={fetchSlashCommands}
            />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>Select a chat to view history</p>
            </div>
          </div>
        )}
      </div>

      <StatusSidebar jid={selectedJid} apiBase={apiBase} token={token} />

      <ConfirmDialog
        open={showDeleteDialog}
        title="Delete Chat"
        message="Are you sure you want to delete this chat? This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={() => {
          if (selectedJid) {
            handleDeleteChat(selectedJid);
            setShowDeleteDialog(false);
          }
        }}
        onCancel={() => setShowDeleteDialog(false)}
        destructive
      />
    </div>
  );
}
