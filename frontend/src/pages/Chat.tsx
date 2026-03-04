import { useEffect, useMemo, useRef, useState } from "react";
import { MessageSquare } from "lucide-react";
import type { Chat, Message } from "@/lib/types";
import { StatusSidebar } from "@/components/StatusSidebar";
import { ChatSidebar, MessageList, MessageInput } from "@/components/Chat";
import { useChatWebSocket } from "@/hooks/useChatWebSocket";

export function Chat() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedJid, setSelectedJid] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedToBottomRef = useRef(true);

  const apiBase = import.meta.env.DEV
    ? `${location.protocol}//${location.hostname}:3000`
    : "";

  // Chat list operations
  const fetchChats = () => {
    fetch(`${apiBase}/api/chats`)
      .then((res) => res.json())
      .then(setChats)
      .catch(console.error);
  };

  const handleCreateChat = async () => {
    try {
      const res = await fetch(`${apiBase}/api/chats`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to create chat");
      const newChat = await res.json();
      fetchChats();
      setSelectedJid(newChat.jid);
    } catch (error) {
      console.error("Failed to create chat", error);
    }
  };

  const handleDeleteChat = async (jid: string) => {
    try {
      const res = await fetch(`${apiBase}/api/chats/${encodeURIComponent(jid)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete chat");
      setChats((prev) => prev.filter((c) => c.jid !== jid));
      if (selectedJid === jid) {
        setSelectedJid(null);
      }
    } catch (error) {
      console.error("Failed to delete chat", error);
    }
  };

  // WebSocket hook
  const { sendMessage, stopGenerating, fetchMessages } = useChatWebSocket({
    jid: selectedJid,
    apiBase,
    setMessages,
    setIsGenerating,
  });

  // Initial load
  useEffect(() => {
    fetchChats();
  }, []);

  // Load messages when chat is selected
  useEffect(() => {
    if (!selectedJid) {
      setMessages([]);
      return;
    }

    setLoading(true);
    setIsGenerating(false);
    fetchMessages(selectedJid).then((data) => {
      setMessages(data);
      setLoading(false);
    });
  }, [selectedJid, fetchMessages]);

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

    const content = newMessage;
    setNewMessage("");

    // Try WebSocket first (sendMessage is always defined, but checks WebSocket state internally)
    sendMessage(content);
    const optimisticMsg: Message = {
      id: 'temp-' + Date.now(),
      chat_jid: selectedJid,
      sender_name: 'You',
      content,
      timestamp: new Date().toISOString(),
      is_from_me: true,
      is_bot_message: false
    };
    setMessages((prev) => [...prev, optimisticMsg]);
    return;

    // Fallback to HTTP
    try {
      const res = await fetch(`${apiBase}/api/groups/${selectedJid}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const created = (await res.json()) as Message;
      setMessages((prev) => [...prev, created]);
    } catch (error) {
      console.error("Failed to send message", error);
      setIsGenerating(false);
    }
  };

  const handleStop = () => {
    stopGenerating();
    setIsGenerating(false);
  };

  // Render items with date separators
  const renderItems = useMemo(() => {
    const items: Array<{ type: "date" } & { key: string; label: string } | { type: "msg" } & { key: string; msg: Message }> = [];
    let lastDay: string | null = null;

    for (const msg of messages) {
      const d = new Date(msg.timestamp);
      const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (dayKey !== lastDay) {
        lastDay = dayKey;
        items.push({ type: "date", key: `date:${dayKey}`, label: d.toLocaleDateString() });
      }
      items.push({ type: "msg", key: msg.id, msg });
    }
    return items;
  }, [messages]);

  const chatName = selectedJid ? chats.find(c => c.jid === selectedJid)?.name || selectedJid : null;

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
            </div>

            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-4"
              onScroll={() => {
                const el = scrollRef.current;
                if (!el) return;
                const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
                pinnedToBottomRef.current = dist < 120;
              }}
            >
              {loading ? (
                <div className="text-center text-muted-foreground">Loading...</div>
              ) : (
                renderItems.map((it) => {
                  if (it.type === "date") {
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

      <StatusSidebar jid={selectedJid} apiBase={apiBase} />
    </div>
  );
}