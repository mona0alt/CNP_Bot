import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { MessageSquare, User, Bot, Send, Plus, Trash2, Square } from "lucide-react";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { ToolCallCard } from "@/components/ToolCallCard";
import { ThoughtProcess } from "@/components/ThoughtProcess";
import { parseThoughts } from "@/lib/thought-parser";

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

interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: any;
  partial_json?: string; // For streaming tool input
  status?: "calling" | "executed" | "error";
  result?: any;
}

function parseMessageContent(content: string): ContentBlock[] {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return [{ type: "text", text: content }];
  } catch {
    return [{ type: "text", text: content }];
  }
}

export function Chat() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedJid, setSelectedJid] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const messageIdsRef = useRef<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pinnedToBottomRef = useRef(true);

  const fetchMessages = async (jid: string) => {
    setLoading(true);
    setIsGenerating(false);
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

  const handleStop = () => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "stop" }));
    }
    setIsGenerating(false);
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedJid || isGenerating) return;

    setIsGenerating(true);
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
        setIsGenerating(false);
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
      setIsGenerating(false);
    }
  };

  const fetchChats = () => {
    fetch("/api/chats")
      .then((res) => res.json())
      .then(setChats)
      .catch(console.error);
  };

  const handleCreateChat = async () => {
    try {
      const res = await fetch("/api/chats", { method: "POST" });
      if (!res.ok) throw new Error("Failed to create chat");
      const newChat = await res.json();
      fetchChats();
      setSelectedJid(newChat.jid);
    } catch (error) {
      console.error("Failed to create chat", error);
    }
  };

  const handleDeleteChat = async (e: React.MouseEvent, jid: string) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this chat?")) return;

    try {
      const res = await fetch(`/api/chats/${encodeURIComponent(jid)}`, {
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

  useEffect(() => {
    fetchChats();
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
              event?: any;
              chat_jid?: string;
              content?: string;
              sender?: string;
              is_bot_message?: boolean;
              timestamp?: string;
            };

            if (payload.type === "stream_event" && payload.event && payload.chat_jid === selectedJid) {
                const event = payload.event;
                setMessages(prev => {
                    // Special handling for tool_result: find the message containing the tool_use_id
                    if (event.type === 'tool_result') {
                        // Search backwards for the message containing the tool_use_id
                        // We check if the content string contains the ID (fast check)
                        const msgIndex = [...prev].reverse().findIndex(m => 
                            m.is_bot_message && m.content.includes(event.tool_use_id)
                        );
                        
                        if (msgIndex !== -1) {
                            const actualIndex = prev.length - 1 - msgIndex;
                            const msg = prev[actualIndex];
                            const blocks = parseMessageContent(msg.content);
                            const updatedBlocks = applyEventToBlocks(blocks, event);
                            const newPrev = [...prev];
                            newPrev[actualIndex] = { ...msg, content: JSON.stringify(updatedBlocks) };
                            return newPrev;
                        }
                    }

                    const last = prev[prev.length - 1];
                    // We only apply events to the last message if it's from bot
                    if (!last || !last.is_bot_message) {
                        // Create new message if none exists or last was user
                        const initialBlocks: ContentBlock[] = [];
                        // Handle initial event types if needed, or just start empty
                        const newMsg: Message = {
                            id: 'stream-' + Date.now(),
                            chat_jid: payload.chat_jid!,
                            sender_name: 'CNP-Bot',
                            content: JSON.stringify(initialBlocks),
                            timestamp: new Date().toISOString(),
                            is_from_me: false,
                            is_bot_message: true
                        };
                        // Apply event to new message
                        const updatedBlocks = applyEventToBlocks(initialBlocks, event);
                        newMsg.content = JSON.stringify(updatedBlocks);
                        return [...prev, newMsg];
                    }

                    // Parse existing content
                    const blocks = parseMessageContent(last.content);
                    const updatedBlocks = applyEventToBlocks(blocks, event);
                    
                    return [
                        ...prev.slice(0, -1),
                        { ...last, content: JSON.stringify(updatedBlocks) }
                    ];
                });
            } else if (payload.type === "stream" && payload.chunk && payload.chat_jid === selectedJid) {
                // Legacy text stream support
                setMessages(prev => {
                    const last = prev[prev.length - 1];
                    if (last && last.is_bot_message) {
                        // Check if content is JSON blocks
                        const blocks = parseMessageContent(last.content);
                        // If it's a single text block, append
                        if (blocks.length === 1 && blocks[0].type === 'text') {
                             blocks[0].text = (blocks[0].text || "") + payload.chunk;
                             return [...prev.slice(0, -1), { ...last, content: JSON.stringify(blocks) }];
                        } else if (blocks.length > 0 && blocks[blocks.length - 1].type === 'text') {
                             // Append to last text block
                             blocks[blocks.length - 1].text = (blocks[blocks.length - 1].text || "") + payload.chunk;
                             return [...prev.slice(0, -1), { ...last, content: JSON.stringify(blocks) }];
                        } else {
                             // Create new text block? Or if it was plain string before, just append?
                             // If parseMessageContent returned [{type: 'text', text: content}], we are fine.
                             // But if content was "[]" (empty blocks), we add text block.
                             if (blocks.length === 0 || blocks[blocks.length - 1].type !== 'text') {
                                 blocks.push({ type: 'text', text: payload.chunk });
                             } else {
                                 // Should be covered above
                                 const lastBlock = blocks[blocks.length - 1];
                                 if (lastBlock) {
                                     lastBlock.text = (lastBlock.text || "") + (payload.chunk || "");
                                 }
                             }
                             return [...prev.slice(0, -1), { ...last, content: JSON.stringify(blocks) }];
                        }
                    } else {
                        // New message
                        return [...prev, {
                            id: 'stream-' + Date.now(),
                            chat_jid: payload.chat_jid!,
                            sender_name: 'CNP-Bot',
                            content: payload.chunk!, // Raw text for now, or JSON string?
                            // Better to start with JSON structure if we want consistency
                            // content: JSON.stringify([{ type: 'text', text: payload.chunk }]),
                            // But legacy code expects raw text? Let's use raw text if it's just text stream
                            // parseMessageContent handles raw text fine.
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
                  sender_name: 'CNP-Bot',
                  content: payload.content!,
                  timestamp: payload.timestamp!,
                  is_from_me: false,
                  is_bot_message: !!payload.is_bot_message
              } as Message;
              
              if (!msg.is_from_me) {
                  setIsGenerating(false);
              }
              
              setMessages(prev => {
                  if (messageIdsRef.current.has(msg.id)) return prev;

                  // If it's my message, check if we have a pending optimistic message with same content
                  if (msg.is_from_me) {
                      const matchIndex = [...prev].reverse().findIndex(m => 
                          m.id.startsWith('temp-') && m.is_from_me && m.content === msg.content
                      );
                      if (matchIndex !== -1) {
                          const actualIndex = prev.length - 1 - matchIndex;
                          const newPrev = [...prev];
                          newPrev[actualIndex] = msg;
                          messageIdsRef.current.add(msg.id);
                          return newPrev;
                      }
                  }

                  const last = prev[prev.length - 1];
                  if (last && last.id.startsWith('stream-')) {
                      // Merge content if stream has tool calls and final message is text-only
                      const streamBlocks = parseMessageContent(last.content);
                      const hasTools = streamBlocks.some(b => b.type === 'tool_use');
                      if (hasTools) {
                          const finalBlocks = parseMessageContent(msg.content);
                          // If final content is text (or just text blocks), we append it to the tools
                          // But usually final content IS the text response.
                          // So we want: [Tools..., FinalText]
                          
                          // We also want tool_result blocks if they exist in stream?
                          // Yes, stream might contain tool_result blocks too.
                          // Basically we want to keep everything EXCEPT the last text block from stream?
                          // Or rather, we want to replace the stream's text with the final text.
                          
                          // Let's filter out text blocks from stream that are "in progress"
                          // Actually, the stream might have partial text.
                          // The final message has the complete text.
                          
                          const nonTextBlocks = streamBlocks.filter(b => b.type !== 'text');
                          const textBlocks = finalBlocks.filter(b => b.type === 'text');
                          
                          // If final message has structured content (unlikely from current backend), use it.
                          // If it's just text, use it.
                          
                          if (nonTextBlocks.length > 0) {
                              // We only merge if the final message DOES NOT already have non-text blocks
                              // If backend is updated to send full structure, we shouldn't duplicate
                              const finalHasNonText = finalBlocks.some(b => b.type !== 'text');
                              if (!finalHasNonText) {
                                  const mergedBlocks = [...nonTextBlocks, ...textBlocks];
                                  msg.content = JSON.stringify(mergedBlocks);
                              }
                          }
                      }
                      
                      messageIdsRef.current.add(msg.id);
                      return [...prev.slice(0, -1), msg];
                  }
                  
                  // Deduplicate bot messages too
                   if (msg.is_bot_message && last && last.is_bot_message) {
                       // Check for identical content
                       if (last.content === msg.content && Math.abs(new Date(last.timestamp).getTime() - new Date(msg.timestamp).getTime()) < 1000) {
                           return prev;
                       }
                       // Check for rich content vs plain text duplicate
                       // If last message has tool calls (is rich) and new message is just the text part of it
                       try {
                           const lastBlocks = parseMessageContent(last.content);
                           if (lastBlocks.some(b => b.type === 'tool_use')) {
                               const msgBlocks = parseMessageContent(msg.content);
                               const lastText = lastBlocks.filter(b => b.type === 'text').map(b => b.text || '').join('');
                                const msgText = msgBlocks.filter(b => b.type === 'text').map(b => b.text || '').join('');
                               if (lastText === msgText && Math.abs(new Date(last.timestamp).getTime() - new Date(msg.timestamp).getTime()) < 2000) {
                                   return prev;
                               }
                           }
                       } catch {}
                   }
                  
                  messageIdsRef.current.add(msg.id);
                  return [...prev, msg];
              });
            } else if (payload.type === "error") {
                setIsGenerating(false);
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
        <div className="p-4 border-b flex items-center justify-between">
            <h2 className="text-lg font-semibold">Chats</h2>
            <button 
              onClick={handleCreateChat}
              className="p-1.5 hover:bg-muted rounded-md transition-colors text-muted-foreground hover:text-foreground"
              title="New Chat"
            >
              <Plus size={20} />
            </button>
        </div>
        <div className="flex-1 overflow-y-auto">
            {chats.map(chat => (
                <div
                    key={chat.jid}
                    onClick={() => setSelectedJid(chat.jid)}
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
                        onClick={(e) => handleDeleteChat(e, chat.jid)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Delete Chat"
                    >
                        <Trash2 size={16} />
                    </button>
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

                          const blocks = parseMessageContent(msg.content);
                          
                          // Force display name for bot messages
                          const displayName = msg.is_bot_message ? "CNP-Bot" : msg.sender_name;

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
                              <div className={cn("p-3 rounded-2xl text-sm min-w-[100px]", bubble)}>
                                {!outgoing ? (
                                  <div className="font-semibold text-xs mb-1 opacity-70">
                                    {displayName}
                                  </div>
                                ) : null}
                                
                                {blocks.map((block, idx) => {
                                    if (block.type === 'tool_use') {
                                        let inputObj = block.input || {};
                                        // Try to parse partial_json if input is empty
                                        if (!block.input && block.partial_json) {
                                            try {
                                                inputObj = JSON.parse(block.partial_json);
                                            } catch {
                                                inputObj = block.partial_json;
                                            }
                                        }

                                        return (
                                            <ToolCallCard
                                                key={idx}
                                                toolName={block.name || 'Unknown Tool'}
                                                input={inputObj}
                                                status={block.status || 'calling'}
                                                result={block.result}
                                                defaultExpanded={false}
                                                className={outgoing ? "border-emerald-400/50" : ""}
                                            />
                                        );
                                    }
                                    const segments = parseThoughts(block.text || "");
                                    return segments.map((seg, i) => {
                                        if (seg.type === 'thought') {
                                            return (
                                                <ThoughtProcess
                                                    key={`${idx}-${i}`}
                                                    content={seg.content}
                                                    isComplete={!!seg.isComplete}
                                                    autoCollapse={true}
                                                />
                                            );
                                        }
                                        return (
                                            <MarkdownRenderer
                                                key={`${idx}-${i}`}
                                                content={seg.content}
                                                className={cn(
                                                    "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
                                                    outgoing ? "prose-invert" : ""
                                                )}
                                            />
                                        );
                                    });
                                })}

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
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                                e.preventDefault();
                                handleSendMessage();
                              }
                            }}
                            disabled={isGenerating}
                            placeholder={isGenerating ? "Agent is thinking..." : "Type a message..."}
                            className="flex-1 bg-background border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                        />
                        <button
                            onClick={isGenerating ? handleStop : handleSendMessage}
                            disabled={!isGenerating && !newMessage.trim()}
                            className={cn(
                                "px-4 py-2 rounded-md disabled:opacity-50 flex items-center justify-center transition-colors",
                                isGenerating 
                                    ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" 
                                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                            )}
                            title={isGenerating ? "Stop generating" : "Send message"}
                        >
                            {isGenerating ? <Square size={18} fill="currentColor" /> : <Send size={18} />}
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

function applyEventToBlocks(blocks: ContentBlock[], event: any): ContentBlock[] {
    const newBlocks = [...blocks];
    
    if (event.type === 'content_block_start') {
        newBlocks.push({
            type: event.content_block.type,
            text: event.content_block.text || '',
            id: event.content_block.id,
            name: event.content_block.name,
            input: event.content_block.input,
            status: event.content_block.type === 'tool_use' ? 'calling' : undefined
        });
    } else if (event.type === 'content_block_delta') {
        const index = event.index;
        if (newBlocks[index]) {
            const block = { ...newBlocks[index] };
            if (event.delta.type === 'text_delta') {
                block.text = (block.text || '') + event.delta.text;
            } else if (event.delta.type === 'input_json_delta') {
                block.partial_json = (block.partial_json || '') + event.delta.partial_json;
            }
            newBlocks[index] = block;
        }
    } else if (event.type === 'content_block_stop') {
         const index = event.index;
         if (newBlocks[index]) {
             const block = { ...newBlocks[index] };
             if (block.type === 'tool_use') {
                  // Try to finalize input from partial_json
                  if (block.partial_json && !block.input) {
                      try {
                          block.input = JSON.parse(block.partial_json);
                      } catch {
                          // Keep partial if parsing fails
                      }
                  }
             }
             newBlocks[index] = block;
         }
     } else if (event.type === 'tool_result') {
         // Find the tool use block by ID
         const index = newBlocks.findIndex(b => b.type === 'tool_use' && b.id === event.tool_use_id);
         if (index !== -1) {
             const block = { ...newBlocks[index] };
             block.status = event.is_error ? 'error' : 'executed';
             // Tool result content can be string or array of blocks (e.g. image)
             // For now, simplify to string or JSON string
             if (Array.isArray(event.content)) {
                 // Try to extract text or image description
                 block.result = event.content.map((c: any) => c.text || JSON.stringify(c)).join('\n');
             } else {
                 block.result = event.content;
             }
             newBlocks[index] = block;
         }
     }
     
     return newBlocks;
 }
