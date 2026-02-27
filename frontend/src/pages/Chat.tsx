import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { MessageSquare, User, Bot, Send } from "lucide-react";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";

interface Chat {
  jid: string;
  name: string;
  last_message_time: string;
  is_group: number;
}

interface Message {
  id: string;
  chat_jid: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me: boolean;
  is_bot_message: boolean;
}

export function Chat() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedJid, setSelectedJid] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const messageIdsRef = useRef<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pinnedToBottomRef = useRef(true);

  const fetchMessages = async (jid: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/groups/${jid}/messages?limit=200`);
      const data = (await res.json()) as Message[];
      messageIdsRef.current = new Set(data.map((m) => m.id));
      setMessages(data);
      return data;
    } finally {
      setLoading(false);
    }
  };

  // Helper to process message content (beautify commentary)
  const processContent = (content: string) => {
    // Replace <commentary>...</commentary> with styled block
    return content.replace(
      /<commentary>([\s\S]*?)<\/commentary>/g,
      (_, inner) => `\n> **Thinking Process:**\n${inner.split('\n').map((l: string) => `> ${l}`).join('\n')}\n`
    );
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedJid) return;

    const ws = wsRef.current;
    const content = newMessage;
    setNewMessage("");
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "send", content }));
        // Optimistically add user message
        const optimisticMsg: Message = {
            id: 'temp-' + Date.now(),
            chat_jid: selectedJid,
            sender_name: 'You',
            content,
            timestamp: new Date().toISOString(),
            is_from_me: true,
            is_bot_message: false
        };
        setMessages(prev => [...prev, optimisticMsg]);
      } catch {
        // ignore
      }
      return;
    }
    try {
      const res = await fetch(`/api/groups/${selectedJid}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const created = (await res.json()) as Message;
      if (!messageIdsRef.current.has(created.id)) {
        messageIdsRef.current.add(created.id);
        setMessages((prev) => [...prev, created]);
      }
    } catch (error) {
      console.error("Failed to send message", error);
    }
  };

  useEffect(() => {
    fetch("/api/chats")
      .then((res) => res.json())
      .then(setChats)
      .catch(console.error);
  }, []);

  useEffect(() => {
    wsRef.current?.close();
    wsRef.current = null;
    messageIdsRef.current = new Set();
    setMessages([]);

    if (!selectedJid) return;

    let cancelled = false;

    fetchMessages(selectedJid)
      .then((initial) => {
        if (cancelled) return;
        const lastTs = initial.length > 0 ? initial[initial.length - 1]!.timestamp : "";
        const proto = location.protocol === "https:" ? "wss" : "ws";
        const url = `${proto}://${location.host}/ws?jid=${encodeURIComponent(selectedJid)}&since=${encodeURIComponent(lastTs)}`;
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.addEventListener("message", (evt) => {
          try {
            const payload = JSON.parse(String((evt as MessageEvent).data) || "{}") as {
              type: string;
              data?: Message;
              chunk?: string;
              chat_jid?: string;
              content?: string;
              sender?: string;
              is_bot_message?: boolean;
              timestamp?: string;
            };

            if (payload.type === "stream" && payload.chunk && payload.chat_jid === selectedJid) {
                setMessages(prev => {
                    const last = prev[prev.length - 1];
                    // If last message is from bot and looks like it's streaming (or we just want to append)
                    // We assume the last message is the one being streamed to if it's a bot message
                    if (last && last.is_bot_message) {
                        return [
                            ...prev.slice(0, -1),
                            { ...last, content: last.content + payload.chunk }
                        ];
                    } else {
                        // Create new partial message
                        return [...prev, {
                            id: 'stream-' + Date.now(), // Temporary ID
                            chat_jid: payload.chat_jid!,
                            sender_name: 'NanoClaw', // Default name
                            content: payload.chunk!,
                            timestamp: new Date().toISOString(),
                            is_from_me: false,
                            is_bot_message: true
                        }];
                    }
                });
            } else if ((payload.type === "message" || !payload.type) && (payload.data || payload.content)) {
              // Handle full message update (replaces stream or adds new)
              const msg = payload.data || {
                  id: 'msg-' + Date.now(),
                  chat_jid: payload.chat_jid!,
                  sender_name: 'NanoClaw',
                  content: payload.content!,
                  timestamp: payload.timestamp!,
                  is_from_me: false,
                  is_bot_message: !!payload.is_bot_message
              } as Message;
              
              if (messageIdsRef.current.has(msg.id)) return;
              
              // If we have a streaming message at the end, replace it with the final one
              setMessages(prev => {
                  const last = prev[prev.length - 1];
                  if (last && last.id.startsWith('stream-')) {
                      messageIdsRef.current.add(msg.id);
                      return [...prev.slice(0, -1), msg];
                  }
                  messageIdsRef.current.add(msg.id);
                  return [...prev, msg];
              });
            }
          } catch {
            // ignore
          }
        });
      })
      .catch(console.error);

    return () => {
      cancelled = true;
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [selectedJid]);

  useEffect(() => {
    if (!pinnedToBottomRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const renderItems = useMemo(() => {
    const items: Array<
      | { type: "date"; key: string; label: string }
      | { type: "msg"; key: string; msg: Message }
    > = [];

    let lastDay: string | null = null;
    for (const msg of messages) {
      const d = new Date(msg.timestamp);
      const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (dayKey !== lastDay) {
        lastDay = dayKey;
        items.push({
          type: "date",
          key: `date:${dayKey}`,
          label: d.toLocaleDateString(),
        });
      }
      items.push({ type: "msg", key: msg.id, msg });
    }
    return items;
  }, [messages]);

  return (
    <div className="flex h-full">
      <div className="w-80 border-r bg-card flex flex-col">
        <div className="p-4 border-b">
            <h2 className="text-lg font-semibold">Chats</h2>
        </div>
        <div className="flex-1 overflow-y-auto">
            {chats.map(chat => (
                <div
                    key={chat.jid}
                    onClick={() => setSelectedJid(chat.jid)}
                    className={cn(
                        "p-4 border-b cursor-pointer hover:bg-muted/50 transition-colors",
                        selectedJid === chat.jid && "bg-muted"
                    )}
                >
                    <div className="font-medium truncate">{chat.name || chat.jid}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                        {new Date(chat.last_message_time).toLocaleString()}
                    </div>
                </div>
            ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col bg-background">
          {selectedJid ? (
              <>
                <div className="p-4 border-b flex items-center justify-between bg-card/50">
                    <h3 className="font-semibold">
                        {chats.find(c => c.jid === selectedJid)?.name || selectedJid}
                    </h3>
                </div>
                <div
                  ref={scrollRef}
                  className="flex-1 overflow-y-auto p-4 space-y-4"
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
                              <div key={it.key} className="flex justify-center">
                                <div className="px-3 py-1 rounded-full bg-muted text-muted-foreground text-xs">
                                  {it.label}
                                </div>
                              </div>
                            );
                          }

                          const msg = it.msg;
                          const outgoing = !!msg.is_from_me;
                          const bubble = outgoing ? "bg-emerald-600 text-white" : "bg-muted text-foreground";
                          const avatar = msg.is_bot_message ? "bg-blue-600" : "bg-muted";

                          return (
                            <div
                              key={it.key}
                              className={cn(
                                "flex gap-3 max-w-[80%]",
                                outgoing ? "ml-auto flex-row-reverse" : ""
                              )}
                            >
                              <div
                                className={cn(
                                  "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                                  avatar
                                )}
                              >
                                {msg.is_bot_message ? <Bot size={16} /> : <User size={16} />}
                              </div>
                              <div className={cn("p-3 rounded-2xl text-sm", bubble)}>
                                {!outgoing ? (
                                  <div className="font-semibold text-xs mb-1 opacity-70">
                                    {msg.sender_name}
                                  </div>
                                ) : null}
                                <MarkdownRenderer
                                  content={processContent(msg.content)}
                                  className={cn(
                                    "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
                                    outgoing ? "prose-invert" : ""
                                  )}
                                />
                                <div className="text-[10px] opacity-60 mt-1 text-right">
                                  {new Date(msg.timestamp).toLocaleTimeString()}
                                </div>
                              </div>
                            </div>
                          );
                        })
                    )}
                </div>
                <div className="p-4 border-t bg-card/50">
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={newMessage}
                            onChange={(e) => setNewMessage(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                            placeholder="Type a message..."
                            className="flex-1 bg-background border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                        <button
                            onClick={handleSendMessage}
                            disabled={!newMessage.trim()}
                            className="bg-primary text-primary-foreground px-4 py-2 rounded-md disabled:opacity-50 hover:bg-primary/90 flex items-center justify-center"
                        >
                            <Send size={18} />
                        </button>
                    </div>
                </div>
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
    </div>
  );
}
