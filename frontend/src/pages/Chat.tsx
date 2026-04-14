import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, BookOpen, ChevronRight, MessageSquare, PanelLeftOpen, Sparkles, Trash2 } from 'lucide-react';
import type { Chat, ChatSkillSelectionResponse, Message, SlashCommand } from '@/lib/types';
import { AskUserCard } from '@/components/AskUserCard';
import { ConfirmBashCard } from '@/components/ConfirmBashCard';
import { StatusSidebar } from '@/components/StatusSidebar';
import type { GroupStatus } from '@/components/StatusSidebar';
import { ChatSidebar, MessageInput } from '@/components/Chat';
import { MessageItem } from '@/components/Chat/MessageItem';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ChatSkillsDialog } from '@/components/skills/ChatSkillsDialog';
import { KBExtractDialog } from '@/components/kb/KBExtractDialog';
import { useChatWebSocket } from '@/hooks/useChatWebSocket';
import { useStreamingMessages } from '@/contexts/StreamingMessagesContext';
import { useAuth } from '@/contexts/AuthContext';
import type {
  AskUserRequest,
  ConfirmBashRequest,
} from '@/lib/interactive-events';
import {
  appendPendingAsk,
  appendPendingConfirm,
} from '@/lib/interactive-events';
import { parseMessageContent } from '@/lib/message-parser';
import { finalizePendingToolCalls } from '@/lib/message-utils';
import { mergePersistedAndStreamingMessages } from '@/hooks/streaming-session-recovery';

export function Chat() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [chatsLoaded, setChatsLoaded] = useState(false);
  const [selectedJid, setSelectedJid] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [generatingJids, setGeneratingJids] = useState<Set<string>>(new Set());
  const [groupStatusMap, setGroupStatusMap] = useState<Record<string, GroupStatus>>({});
  const [newMessage, setNewMessage] = useState('');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [newChatAgentType] = useState<'claude' | 'deepagent'>('claude');
  const [createChatDialogOpen, setCreateChatDialogOpen] = useState(false);
  const [createChatAgentType, setCreateChatAgentType] = useState<'claude' | 'deepagent'>('deepagent');
  const [editChatSkillsDialogOpen, setEditChatSkillsDialogOpen] = useState(false);
  const [chatSkillsMap, setChatSkillsMap] = useState<Record<string, ChatSkillSelectionResponse>>({});
  const [showKbExtract, setShowKbExtract] = useState(false);
  const [kbAvailable, setKbAvailable] = useState(false);

  // Derived: is the currently selected session generating?
  const isGenerating = selectedJid ? generatingJids.has(selectedJid) : false;

  // Per-jid setter passed to the WebSocket hook — captured by the hook's closure
  // so it always targets the jid that was active when the WS connection was made.
  const setIsGenerating = useCallback((v: boolean) => {
    if (!selectedJid) return;
    const jid = selectedJid;
    setGeneratingJids((prev) => {
      const next = new Set(prev);
      if (v) next.add(jid);
      else next.delete(jid);
      return next;
    });
  }, [selectedJid]);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>([]);
  const [askRequests, setAskRequests] = useState<AskUserRequest[]>([]);
  const [confirmRequests, setConfirmRequests] = useState<ConfirmBashRequest[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedToBottomRef = useRef(true);
  const creatingInitialChatRef = useRef(false);

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

  const handleIncomingAskUser = useCallback((request: AskUserRequest) => {
    setAskRequests((prev) => appendPendingAsk(prev, request));
  }, []);

  const handleIncomingConfirmBash = useCallback(
    (request: ConfirmBashRequest) => {
      setConfirmRequests((prev) => appendPendingConfirm(prev, request));
    },
    [],
  );

  const handleAskUserAck = useCallback((
    requestId: string,
    ok: boolean,
    answer?: string,
  ) => {
    setAskRequests((prev) =>
      prev.map((request) =>
        request.requestId === requestId
          ? {
              ...request,
              submitting: false,
              answer: answer ?? request.answer,
              answered: ok ? true : request.answered,
            }
          : request,
      ),
    );
  }, []);

  const handleConfirmBashAck = useCallback((requestId: string, ok: boolean) => {
    setConfirmRequests((prev) => {
      if (ok) {
        return prev.filter((request) => request.requestId !== requestId);
      }

      return prev.map((request) =>
        request.requestId === requestId
          ? { ...request, submitting: false }
          : request,
      );
    });
  }, []);

  // Chat list operations
  const fetchChats = useCallback(async () => {
    if (!token) {
      setChatsLoaded(false);
      return;
    }
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
    } finally {
      setChatsLoaded(true);
    }
  }, [apiBase, authHeaders, token, handleUnauthorized]);

  useEffect(() => {
    if (!token) return;

    const checkKbHealth = async () => {
      try {
        const response = await fetch(`${apiBase}/api/kb/health`, {
          headers: authHeaders,
        });
        if (response.status === 401 || response.status === 403) {
          await handleUnauthorized();
          return;
        }
        if (!response.ok) return;
        const data = await response.json();
        setKbAvailable(Boolean(data.connected) || Boolean(data.url));
      } catch {
        setKbAvailable(false);
      }
    };

    void checkKbHealth();
  }, [apiBase, authHeaders, handleUnauthorized, token]);

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

  const createChatSession = useCallback(async (
    agentType?: 'claude' | 'deepagent',
    skills?: string[],
  ): Promise<Chat | null> => {
    try {
      if (!token) return null;
      const payload: { agentType: 'claude' | 'deepagent'; skills?: string[] } = {
        agentType: agentType ?? newChatAgentType,
      };
      if (Array.isArray(skills)) {
        payload.skills = skills;
      }
      const res = await fetch(`${apiBase}/api/chats`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status === 401 || res.status === 403) {
        await handleUnauthorized();
        return null;
      }
      if (!res.ok) throw new Error('Failed to create chat');
      const newChat = await res.json() as Chat;
      setChats((prev) => [newChat, ...prev.filter((chat) => chat.jid !== newChat.jid)]);
      creatingInitialChatRef.current = false;
      return newChat;
    } catch (error) {
      creatingInitialChatRef.current = false;
      console.error('Failed to create chat', error);
      return null;
    }
  }, [apiBase, authHeaders, token, handleUnauthorized, newChatAgentType]);

  const loadChatSkills = useCallback(async (jid: string) => {
    if (!token) return;
    try {
      const res = await fetch(`${apiBase}/api/chats/${encodeURIComponent(jid)}/skills`, {
        headers: authHeaders,
      });
      if (res.status === 401 || res.status === 403) {
        await handleUnauthorized();
        return;
      }
      if (!res.ok) return;
      const data = await res.json();
      setChatSkillsMap((prev) => ({
        ...prev,
        [jid]: {
          selectedSkills: Array.isArray(data.selectedSkills) ? data.selectedSkills : [],
          syncStatus: data.syncStatus ?? 'pending',
          lastSyncedAt: data.lastSyncedAt ?? null,
          errorMessage: data.errorMessage ?? null,
        },
      }));
    } catch (error) {
      console.error('Failed to fetch chat skills', error);
    }
  }, [apiBase, authHeaders, token, handleUnauthorized]);

  const handleCreateChat = useCallback((input?: {
    agentType?: 'claude' | 'deepagent';
    skills?: string[];
  }) => {
    const targetAgentType = input?.agentType ?? newChatAgentType;
    if (Array.isArray(input?.skills)) {
      void createChatSession(targetAgentType, input.skills).then((newChat) => {
        if (newChat) {
          setSelectedJid(newChat.jid);
          void loadChatSkills(newChat.jid);
        }
      });
      return;
    }
    setCreateChatAgentType(targetAgentType);
    setCreateChatDialogOpen(true);
  }, [createChatSession, loadChatSkills, newChatAgentType]);

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
      setGeneratingJids((prev) => {
        if (!prev.has(jid)) return prev;
        const next = new Set(prev);
        next.delete(jid);
        return next;
      });
      setGroupStatusMap((prev) => {
        if (!(jid in prev)) return prev;
        const next = { ...prev };
        delete next[jid];
        return next;
      });
      setChatSkillsMap((prev) => {
        if (!(jid in prev)) return prev;
        const next = { ...prev };
        delete next[jid];
        return next;
      });
      if (selectedJid === jid) {
        setSelectedJid(null);
      }
    } catch (error) {
      console.error('Failed to delete chat', error);
    }
  };

  // WebSocket hook
  const {
    sendMessage,
    stopGenerating,
    sendAskUserResponse,
    sendConfirmBashResponse,
    fetchMessages,
    setRestoredActiveStreamId,
  } = useChatWebSocket({
    jid: selectedJid,
    apiBase,
    token,
    setMessages,
    setIsGenerating,
    onUnauthorized: handleUnauthorized,
    onAskUser: handleIncomingAskUser,
    onConfirmBash: handleIncomingConfirmBash,
    onAskUserAck: handleAskUserAck,
    onConfirmBashAck: handleConfirmBashAck,
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

  const syncGeneratingState = useCallback(async (jid: string) => {
    if (!token) return;

    try {
      const res = await fetch(
        `${apiBase}/api/groups/${encodeURIComponent(jid)}/status`,
        { headers: authHeaders },
      );
      if (res.status === 401 || res.status === 403) {
        await handleUnauthorized();
        return;
      }
      if (!res.ok) return;

      const data = await res.json();
      setGeneratingJids((prev) => {
        const next = new Set(prev);
        if (data?.isActive) next.add(jid);
        else next.delete(jid);
        return next;
      });
      if (data) {
        setGroupStatusMap((prev) => ({ ...prev, [jid]: data }));
      }
    } catch (error) {
      console.error('Failed to sync generating state', error);
    }
  }, [apiBase, authHeaders, token, handleUnauthorized]);

  // Initial load
  useEffect(() => {
    setChatsLoaded(false);
    fetchChats();
    fetchSlashCommands();
  }, [fetchChats, fetchSlashCommands]);

  useEffect(() => {
    if (!chatsLoaded) return;
    if (selectedJid && chats.some((chat) => chat.jid === selectedJid)) return;
    if (chats.length > 0) {
      setSelectedJid(chats[0]!.jid);
      return;
    }

    if (!token) return;
    if (creatingInitialChatRef.current) return;
    creatingInitialChatRef.current = true;
    void createChatSession().then((newChat) => {
      if (newChat) {
        setSelectedJid(newChat.jid);
      }
    });
  }, [chats, chatsLoaded, selectedJid, token, createChatSession]);

  // Load messages when chat is selected
  useEffect(() => {
    setAskRequests([]);
    setConfirmRequests([]);
    setStatusOpen(false);
  }, [selectedJid]);

  useEffect(() => {
    if (!selectedJid) return;
    void loadChatSkills(selectedJid);
  }, [loadChatSkills, selectedJid]);

  useEffect(() => {
    if (!selectedJid) {
      setMessages([]);
      return;
    }

    setLoading(true);
    syncGeneratingState(selectedJid);
    fetchMessages(selectedJid).then((data) => {
      const savedStreaming = getStreamingMessages(selectedJid);
      const merged = mergePersistedAndStreamingMessages(data, savedStreaming);

      if (savedStreaming && savedStreaming.length > 0 && !merged.activeStreamId) {
        clearStreamingMessages(selectedJid);
      }

      setRestoredActiveStreamId(merged.activeStreamId);
      setMessages(merged.messages);
      setLoading(false);
    });
  }, [
    selectedJid,
    fetchMessages,
    getStreamingMessages,
    syncGeneratingState,
    clearStreamingMessages,
    setRestoredActiveStreamId,
  ]);

  useEffect(() => {
    if (!selectedJid) return;

    syncGeneratingState(selectedJid);
    const timer = setInterval(() => {
      syncGeneratingState(selectedJid);
    }, 3000);

    return () => clearInterval(timer);
  }, [selectedJid, syncGeneratingState]);

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
    const sent = sendMessage(content);
    if (!sent) {
      setNewMessage(content);
      return;
    }
    setIsGenerating(true);
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
  };

  const handleStop = () => {
    stopGenerating();
    if (selectedJid) {
      setMessages((prev) => {
        for (let index = prev.length - 1; index >= 0; index -= 1) {
          const message = prev[index];
          if (message.chat_jid !== selectedJid || !message.is_bot_message) continue;

          const blocks = parseMessageContent(message.content);
          const nextBlocks = finalizePendingToolCalls(blocks, 'cancelled', '已终止');
          if (nextBlocks !== blocks) {
            const next = [...prev];
            next[index] = {
              ...message,
              content: JSON.stringify(nextBlocks),
            };
            return next;
          }
        }

        return prev;
      });

      const jid = selectedJid;
      setGeneratingJids((prev) => {
        const next = new Set(prev);
        next.delete(jid);
        return next;
      });
    }
  };

  const handleAskUserSubmit = useCallback(
    (requestId: string, answer: string) => {
      const sent = sendAskUserResponse(requestId, answer);
      if (!sent) {
        console.warn('ask_user 响应发送失败：WebSocket 未连接');
        return;
      }
      setAskRequests((prev) =>
        prev.map((request) =>
          request.requestId === requestId
            ? { ...request, submitting: true, answer }
            : request,
        ),
      );
    },
    [sendAskUserResponse],
  );

  const handleConfirmBashRespond = useCallback(
    (requestId: string, approved: boolean) => {
      const sent = sendConfirmBashResponse(requestId, approved);
      if (!sent) {
        console.warn('confirm_bash 响应发送失败：WebSocket 未连接');
        return;
      }
      setConfirmRequests((prev) =>
        prev.map((request) =>
          request.requestId === requestId
            ? { ...request, submitting: true, approved }
            : request,
        ),
      );
    },
    [sendConfirmBashResponse],
  );

  const handleCreateChatWithSkills = useCallback(async (skills: string[]) => {
    const newChat = await createChatSession(createChatAgentType, skills);
    if (newChat) {
      setSelectedJid(newChat.jid);
      await loadChatSkills(newChat.jid);
    }
  }, [createChatAgentType, createChatSession, loadChatSkills]);

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
  const currentChatSkillsState = selectedJid ? chatSkillsMap[selectedJid] ?? null : null;
  const currentStatus = selectedJid ? groupStatusMap[selectedJid] ?? null : null;
  const statusDotColor = !currentStatus
    ? 'bg-gray-400'
    : currentStatus.isActive
      ? 'bg-blue-500'
      : currentStatus.processReady
        ? 'bg-green-500'
        : 'bg-yellow-500';
  const skillsStatusLabel = currentChatSkillsState
    ? currentChatSkillsState.syncStatus === 'synced'
      ? '已同步'
      : currentChatSkillsState.syncStatus === 'failed'
        ? '同步失败'
        : '待同步'
    : '待同步';

  return (
    <div className="flex h-full min-h-0 bg-background px-4 py-4 lg:px-5 lg:py-5">
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-2xl border border-border/70 bg-card/20 shadow-sm">
        <ChatSidebar
          chats={chats}
          selectedJid={selectedJid}
          onSelectChat={setSelectedJid}
          onCreateChat={handleCreateChat}
          onDeleteChat={handleDeleteChat}
          collapsed={isSidebarCollapsed}
          onToggleCollapsed={() => setIsSidebarCollapsed((prev) => !prev)}
        />

        <div className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-background">
          {selectedJid ? (
            <>
              <div className="flex h-12 shrink-0 items-center justify-between border-b bg-card/60 px-3.5 backdrop-blur-sm">
              {/* Left section */}
              <div className="flex items-center gap-2.5 min-w-0">
                {isSidebarCollapsed && (
                  <button
                    onClick={() => setIsSidebarCollapsed(false)}
                    className="h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-lg border border-border/70 bg-background text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors cursor-pointer"
                    title="展开会话列表"
                    aria-label="展开会话列表"
                  >
                    <PanelLeftOpen size={15} />
                  </button>
                )}
                <div className="min-w-0">
                  <h3 className="font-medium text-[14px] tracking-tight truncate">{chatName}</h3>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[10px] text-muted-foreground">
                      {currentChatSkillsState?.selectedSkills.length ?? 0} Skills
                    </span>
                    <span className="text-[10px] text-muted-foreground/50">·</span>
                    <span className="text-[10px] text-muted-foreground">{skillsStatusLabel}</span>
                  </div>
                </div>
              </div>

              {/* Right section */}
              <div className="flex items-center gap-1.5">
                {!isSidebarCollapsed && (
                  <button
                    onClick={() => setIsSidebarCollapsed(true)}
                    className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-border/70 bg-background text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors cursor-pointer"
                    title="收起会话列表"
                    aria-label="收起会话列表"
                  >
                    <ChevronRight size={15} />
                  </button>
                )}
                <button
                  onClick={() => setEditChatSkillsDialogOpen(true)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 bg-background px-2.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground cursor-pointer"
                  title="会话技能"
                >
                  <Sparkles size={12} />
                  <span>技能</span>
                </button>
                {kbAvailable ? (
                  <button
                    onClick={() => setShowKbExtract(true)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 bg-background px-2.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground cursor-pointer"
                    title="提取到知识库"
                  >
                    <BookOpen size={12} />
                    <span>提取</span>
                  </button>
                ) : null}
                <button
                  onClick={() => setStatusOpen(true)}
                  className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-border/70 bg-background text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors relative cursor-pointer"
                  title="查看状态"
                  aria-label="查看状态"
                >
                  <Activity size={14} />
                  <span className={`absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full ${statusDotColor}`} />
                </button>
                <button
                  onClick={() => setShowDeleteDialog(true)}
                  className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-border/70 bg-background text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                  title="删除会话"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

              <div
                ref={scrollRef}
                className="scrollbar-thin flex-1 space-y-3 overflow-y-auto px-3 py-4"
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
                        <div key={it.key} className="my-4 flex justify-center">
                          <div className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                            {it.label}
                          </div>
                        </div>
                      );
                    }
                    return <MessageItem key={it.key} message={it.msg} />;
                  })
                )}

                {askRequests.map((request) => (
                  <AskUserCard
                    key={request.requestId}
                    request={request}
                    onSubmit={handleAskUserSubmit}
                  />
                ))}

                {confirmRequests.map((request) => (
                  <ConfirmBashCard
                    key={request.requestId}
                    request={request}
                    onRespond={handleConfirmBashRespond}
                  />
                ))}
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
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              <div className="text-center">
                <MessageSquare className="mx-auto mb-4 h-12 w-12 opacity-50" />
                <p>选择一个会话查看历史消息</p>
              </div>
            </div>
          )}

          <StatusSidebar
            status={selectedJid ? groupStatusMap[selectedJid] ?? null : null}
            open={statusOpen}
            onClose={() => setStatusOpen(false)}
          />
        </div>
      </div>

      <ChatSkillsDialog
        open={createChatDialogOpen}
        mode="create"
        apiBase={apiBase}
        authHeaders={authHeaders}
        agentType={createChatAgentType}
        onClose={() => setCreateChatDialogOpen(false)}
        onUnauthorized={handleUnauthorized}
        onCreate={handleCreateChatWithSkills}
        onUpdated={() => {}}
      />

      <ChatSkillsDialog
        open={editChatSkillsDialogOpen && !!selectedJid}
        mode="edit"
        apiBase={apiBase}
        authHeaders={authHeaders}
        chatJid={selectedJid}
        onClose={() => setEditChatSkillsDialogOpen(false)}
        onUnauthorized={handleUnauthorized}
        onCreate={async () => {}}
        onUpdated={(state) => {
          if (!selectedJid) return;
          setChatSkillsMap((prev) => ({
            ...prev,
            [selectedJid]: state,
          }));
        }}
      />

      <ConfirmDialog
        open={showDeleteDialog}
        title="删除会话"
        message="确定要删除当前会话吗？该操作无法撤销。"
        confirmLabel="删除"
        cancelLabel="取消"
        onConfirm={() => {
          if (selectedJid) {
            handleDeleteChat(selectedJid);
            setShowDeleteDialog(false);
          }
        }}
        onCancel={() => setShowDeleteDialog(false)}
        destructive
      />

      <KBExtractDialog
        open={showKbExtract}
        onClose={() => setShowKbExtract(false)}
        chatJid={selectedJid}
      />
    </div>
  );
}
