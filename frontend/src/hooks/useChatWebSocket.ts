import { useEffect, useRef, useCallback } from "react";
import type { Message, ContentBlock } from "@/lib/types";
import { parseMessageContent } from "@/lib/message-parser";
import { applyEventToBlocks } from "@/lib/message-utils";

interface StreamEvent {
  type: string;
  content_block?: {
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: unknown;
  };
  delta?: {
    type: string;
    text?: string;
    partial_json?: string;
  };
  index?: number;
  tool_use_id?: string;
  is_error?: boolean;
  content?: unknown;
}

interface UseChatWebSocketOptions {
  jid: string | null;
  apiBase: string;
  token: string | null;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setIsGenerating: (v: boolean) => void;
  onUnauthorized?: () => void | Promise<void>;
}

export function useChatWebSocket({
  jid,
  apiBase,
  token,
  setMessages,
  setIsGenerating,
  onUnauthorized,
}: UseChatWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const messageIdsRef = useRef<Set<string>>(new Set());

  const findActiveStreamIndex = useCallback((messages: Message[]) => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (
        message.chat_jid === jid &&
        message.is_bot_message &&
        message.id.startsWith('stream-')
      ) {
        return index;
      }
    }

    return -1;
  }, [jid]);

  const findLastMatchingBotMessageIndex = useCallback((
    messages: Message[],
    predicate: (message: Message) => boolean,
  ) => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.chat_jid === jid && message.is_bot_message && predicate(message)) {
        return index;
      }
    }

    return -1;
  }, [jid]);

  const isStandaloneChartMessage = useCallback((message: Message) => {
    const blocks = parseMessageContent(message.content);
    return (
      blocks.length > 0 &&
      blocks.every((block) => block.type === 'prometheus_chart')
    );
  }, []);

  const fetchMessages = useCallback(async (chatJid: string): Promise<Message[]> => {
    if (!token) {
      return [];
    }
    try {
      const res = await fetch(`${apiBase}/api/groups/${chatJid}/messages?limit=200`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.status === 401 || res.status === 403) {
        await onUnauthorized?.();
        return [];
      }
      if (!res.ok) {
        return [];
      }
      const data = (await res.json()) as Message[];
      messageIdsRef.current = new Set(data.map((m) => m.id));
      return data;
    } catch (error) {
      console.error("Failed to fetch messages", error);
      return [];
    }
  }, [apiBase, token, onUnauthorized]);

  useEffect(() => {
    wsRef.current?.close();
    wsRef.current = null;
    messageIdsRef.current = new Set();

    if (!jid || !token) return;

    let cancelled = false;

    fetchMessages(jid).then((initial) => {
      if (cancelled) return;

      const lastTs = initial.length > 0 ? initial[initial.length - 1]!.timestamp : "";
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const wsHost = import.meta.env.DEV
        ? `${location.hostname}:3000`
        : location.host;
      // Token is NOT included in URL — sent as first frame after connection
      const url = `${proto}://${wsHost}/ws?jid=${encodeURIComponent(jid)}&since=${encodeURIComponent(lastTs)}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.addEventListener("open", () => {
        ws.send(JSON.stringify({ type: "auth", token }));
      });

      ws.addEventListener("message", (evt) => {
        try {
          const payload = JSON.parse(String((evt as MessageEvent).data) || "{}") as {
            type: string;
            data?: Message;
            chunk?: string;
            event?: StreamEvent;
            chat_jid?: string;
            content?: string;
            sender?: string;
            is_bot_message?: boolean;
            timestamp?: string;
          };

          if (payload.type === "stream_event" && payload.event && payload.chat_jid === jid) {
            const event = payload.event;
            setMessages((prev) => {
              if (event.type === 'tool_result') {
                const streamIndex = findActiveStreamIndex(prev);
                const toolResultTargetIndex = streamIndex !== -1
                  ? streamIndex
                  : findLastMatchingBotMessageIndex(prev, (message) =>
                      message.content.includes(event.tool_use_id || ''),
                    );

                const msgIndex = toolResultTargetIndex;
                if (msgIndex !== -1) {
                  const msg = prev[msgIndex];
                  const blocks = parseMessageContent(msg.content);
                  const updatedBlocks = applyEventToBlocks(blocks, event);
                  const newPrev = [...prev];
                  newPrev[msgIndex] = { ...msg, content: JSON.stringify(updatedBlocks) };
                  return newPrev;
                }
              }

              const activeStreamIndex = findActiveStreamIndex(prev);
              if (activeStreamIndex === -1) {
                const initialBlocks: ContentBlock[] = [];
                const newMsg: Message = {
                  id: 'stream-' + Date.now(),
                  chat_jid: payload.chat_jid!,
                  sender_name: 'CNP-Bot',
                  content: JSON.stringify(initialBlocks),
                  timestamp: new Date().toISOString(),
                  is_from_me: false,
                  is_bot_message: true
                };
                const updatedBlocks = applyEventToBlocks(initialBlocks, event);
                newMsg.content = JSON.stringify(updatedBlocks);
                return [...prev, newMsg];
              }

              const streamMessage = prev[activeStreamIndex];
              const blocks = parseMessageContent(streamMessage.content);
              const updatedBlocks = applyEventToBlocks(blocks, event);
              const nextMessages = [...prev];
              nextMessages[activeStreamIndex] = {
                ...streamMessage,
                content: JSON.stringify(updatedBlocks),
              };
              return nextMessages;
            });
          } else if (payload.type === "stream" && payload.chunk && payload.chat_jid === jid) {
            setMessages((prev) => {
              const activeStreamIndex = findActiveStreamIndex(prev);
              if (activeStreamIndex !== -1) {
                const streamMessage = prev[activeStreamIndex];
                const blocks = parseMessageContent(streamMessage.content);
                const nextMessages = [...prev];

                if (blocks.length === 1 && blocks[0].type === 'text') {
                  blocks[0].text = (blocks[0].text || "") + payload.chunk;
                  nextMessages[activeStreamIndex] = {
                    ...streamMessage,
                    content: JSON.stringify(blocks),
                  };
                  return nextMessages;
                } else if (blocks.length > 0 && blocks[blocks.length - 1].type === 'text') {
                  blocks[blocks.length - 1].text = (blocks[blocks.length - 1].text || "") + (payload.chunk || "");
                  nextMessages[activeStreamIndex] = {
                    ...streamMessage,
                    content: JSON.stringify(blocks),
                  };
                  return nextMessages;
                } else {
                  if (blocks.length === 0 || blocks[blocks.length - 1].type !== 'text') {
                    blocks.push({ type: 'text', text: payload.chunk });
                  } else {
                    const lastBlock = blocks[blocks.length - 1];
                    if (lastBlock) {
                      lastBlock.text = (lastBlock.text || "") + (payload.chunk || "");
                    }
                  }
                  nextMessages[activeStreamIndex] = {
                    ...streamMessage,
                    content: JSON.stringify(blocks),
                  };
                  return nextMessages;
                }
              } else {
                return [...prev, {
                  id: 'stream-' + Date.now(),
                  chat_jid: payload.chat_jid!,
                  sender_name: 'CNP-Bot',
                  content: payload.chunk!,
                  timestamp: new Date().toISOString(),
                  is_from_me: false,
                  is_bot_message: true
                }];
              }
            });
          } else if ((payload.type === "message" || !payload.type) && (payload.data || payload.content)) {
            const msg = payload.data || {
              id: 'msg-' + Date.now(),
              chat_jid: payload.chat_jid!,
              sender_name: 'CNP-Bot',
              content: payload.content!,
              timestamp: payload.timestamp!,
              is_from_me: false,
              is_bot_message: !!payload.is_bot_message
            } as Message;
            const standaloneChartMessage = !msg.is_from_me && isStandaloneChartMessage(msg);

            setMessages((prev) => {
              if (messageIdsRef.current.has(msg.id)) return prev;

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

              const activeStreamIndex = findActiveStreamIndex(prev);
              if (activeStreamIndex !== -1) {
                if (standaloneChartMessage) {
                  messageIdsRef.current.add(msg.id);
                  return [...prev, msg];
                }

                const streamMessage = prev[activeStreamIndex];
                const streamBlocks = parseMessageContent(streamMessage.content);
                const hasTools = streamBlocks.some(b => b.type === 'tool_use');
                if (hasTools) {
                  const finalBlocks = parseMessageContent(msg.content);
                  const nonTextBlocks = streamBlocks.filter(b => b.type !== 'text');
                  const textBlocks = finalBlocks.filter(b => b.type === 'text');
                  if (nonTextBlocks.length > 0) {
                    const finalHasNonText = finalBlocks.some(b => b.type !== 'text');
                    if (!finalHasNonText) {
                      const mergedBlocks = [...nonTextBlocks, ...textBlocks];
                      msg.content = JSON.stringify(mergedBlocks);
                    }
                  }
                }
                messageIdsRef.current.add(msg.id);
                if (!msg.is_from_me) {
                  setIsGenerating(false);
                }
                const nextMessages = [...prev];
                nextMessages[activeStreamIndex] = msg;
                return nextMessages;
              }

              messageIdsRef.current.add(msg.id);
              if (!msg.is_from_me && !standaloneChartMessage) {
                setIsGenerating(false);
              }
              return [...prev, msg];
            });
          } else if (payload.type === "error") {
            setIsGenerating(false);
          }
        } catch {
          // ignore
        }
      });
    });

    return () => {
      cancelled = true;
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [jid, token, apiBase, fetchMessages, findActiveStreamIndex, findLastMatchingBotMessageIndex, isStandaloneChartMessage, setMessages, setIsGenerating]);

  const sendMessage = useCallback((content: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "send", content }));
    }
  }, []);

  const stopGenerating = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "stop" }));
    }
  }, []);

  return { sendMessage, stopGenerating, fetchMessages };
}
