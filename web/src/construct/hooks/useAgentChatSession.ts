import { useState, useEffect, useRef, useCallback, useContext } from 'react';
import type { WsMessage, AgentChannelEvent } from '@/types/api';
import { WebSocketClient } from '@/lib/ws';
import { generateUUID } from '@/lib/uuid';
import { DraftContext } from '@/construct/hooks/useDraft';
import { t } from '@/lib/i18n';
import { getSessionMessages } from '@/lib/api';
import {
  loadChatHistory,
  mapServerMessagesToPersisted,
  persistedToUiMessages,
  saveChatHistory,
  uiMessagesToPersisted,
} from '@/lib/chatHistoryStorage';
import type { ActivityEvent, ChatMessage } from '@/components/chat/types';
import { operatorPhaseIcon, isTransientPhase, friendlyToolLabel } from '@/components/chat/chat-utils';
import { copyToClipboard } from '@/construct/lib/clipboard';

interface UseAgentChatSessionOptions {
  sessionId: string;
  draftKey: string;
  pageContext?: string;
  onUserMessage?: (content: string) => void;
}

export function useAgentChatSession({
  sessionId,
  draftKey,
  pageContext,
  onUserMessage,
}: UseAgentChatSessionOptions) {
  const { getDraft, setDraft, clearDraft: clearDraftStore } = useContext(DraftContext);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [input, setInput] = useState(() => getDraft(draftKey));
  const [typing, setTyping] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingThinking, setStreamingThinking] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [agentEvents, setAgentEvents] = useState<AgentChannelEvent[]>([]);

  const wsRef = useRef<WebSocketClient | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pendingContentRef = useRef('');
  const pendingThinkingRef = useRef('');
  const capturedThinkingRef = useRef('');
  const activitiesRef = useRef<ActivityEvent[]>([]);
  const onUserMessageRef = useRef(onUserMessage);
  onUserMessageRef.current = onUserMessage;
  const draftKeyRef = useRef(draftKey);
  draftKeyRef.current = draftKey;

  // Reset input when session changes (one-way: store → state)
  useEffect(() => {
    setInput(getDraft(draftKey));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Persist input to draft store (one-way: state → store, no re-render)
  useEffect(() => {
    setDraft(draftKeyRef.current, input);
  }, [input, setDraft]);

  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    setActivities([]);
    setAgentEvents([]);
    activitiesRef.current = [];
    setStreamingContent('');
    setStreamingThinking('');
    setTyping(false);
    setError(null);
    setHistoryReady(false);

    (async () => {
      try {
        const res = await getSessionMessages(sessionId);
        if (cancelled) return;
        if (res.session_persistence && res.messages.length > 0) {
          setMessages(persistedToUiMessages(mapServerMessagesToPersisted(res.messages)));
        } else if (!res.session_persistence) {
          const ls = loadChatHistory(sessionId);
          setMessages(ls.length ? persistedToUiMessages(ls) : []);
        }
      } catch {
        if (!cancelled) {
          const ls = loadChatHistory(sessionId);
          setMessages(ls.length ? persistedToUiMessages(ls) : []);
        }
      } finally {
        if (!cancelled) setHistoryReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!historyReady) return;
    saveChatHistory(sessionId, uiMessagesToPersisted(
      messages.filter((m): m is ChatMessage & { role: 'user' | 'agent' } => m.role !== 'operator'),
    ));
  }, [historyReady, messages, sessionId]);

  useEffect(() => {
    let cancelled = false;
    let ws: WebSocketClient | null = null;

    const connectTimer = setTimeout(() => {
      if (cancelled) return;
      ws = new WebSocketClient({ sessionId });

      ws.onOpen = () => {
        if (cancelled) return;
        setConnected(true);
        setError(null);
      };

      ws.onClose = (ev: CloseEvent) => {
        if (cancelled) return;
        setConnected(false);
        if (ev.code !== 1000 && ev.code !== 1001) {
          setError(`Connection closed unexpectedly (code: ${ev.code}). Please check your configuration.`);
        }
      };

      ws.onError = () => {
        if (cancelled) return;
        setError(t('agent.connection_error'));
      };

      ws.onMessage = (msg: WsMessage) => {
        if (cancelled) return;
        switch (msg.type) {
          case 'session_start':
          case 'connected':
            break;

          case 'thinking': {
            setTyping(true);
            pendingThinkingRef.current += msg.content ?? '';
            setStreamingThinking(pendingThinkingRef.current);
            const previous = activitiesRef.current;
            const last = previous[previous.length - 1];
            const nextActivities = last?.kind === 'thinking'
              ? [
                  ...previous.slice(0, -1),
                  { ...last, label: 'Reasoning...', detail: (last.detail ?? '') + (msg.content ?? '') },
                ]
              : [
                  ...previous,
                  { id: generateUUID(), kind: 'thinking' as const, label: 'Reasoning...', timestamp: new Date() },
                ];
            activitiesRef.current = nextActivities;
            setActivities(nextActivities);
            break;
          }

          case 'chunk':
            setTyping(true);
            pendingContentRef.current += msg.content ?? '';
            setStreamingContent(pendingContentRef.current);
            break;

          case 'chunk_reset':
            capturedThinkingRef.current = pendingThinkingRef.current;
            pendingContentRef.current = '';
            pendingThinkingRef.current = '';
            setStreamingContent('');
            setStreamingThinking('');
            break;

          case 'message':
          case 'done': {
            const content = msg.full_response ?? msg.content ?? pendingContentRef.current;
            const thinking = capturedThinkingRef.current || pendingThinkingRef.current || undefined;
            const persistedActivities = activitiesRef.current.filter((activity) =>
              activity.kind !== 'thinking' || !!activity.detail,
            );

            activitiesRef.current = [];
            setActivities([]);

            if (content) {
              setMessages((prev) => [
                ...prev,
                {
                  id: generateUUID(),
                  role: 'agent',
                  content,
                  thinking,
                  markdown: true,
                  timestamp: new Date(),
                  activityLog: persistedActivities.length > 0 ? persistedActivities : undefined,
                },
              ]);
            } else if (persistedActivities.length > 0) {
              setMessages((prev) => [
                ...prev,
                {
                  id: generateUUID(),
                  role: 'operator',
                  content: persistedActivities.map((activity) => activity.label).join('\n'),
                  operatorPhase: 'completed',
                  timestamp: new Date(),
                  activityLog: persistedActivities,
                },
              ]);
            }

            pendingContentRef.current = '';
            pendingThinkingRef.current = '';
            capturedThinkingRef.current = '';
            setStreamingContent('');
            setStreamingThinking('');
            setTyping(false);
            break;
          }

          case 'tool_call': {
            setTyping(true);
            const nextActivities = [
              ...activitiesRef.current,
              {
                id: generateUUID(),
                kind: 'tool_call' as const,
                label: friendlyToolLabel(msg.name ?? 'tool'),
                detail: msg.args ? (typeof msg.args === 'string' ? msg.args : JSON.stringify(msg.args, null, 2)) : undefined,
                timestamp: new Date(),
              },
            ];
            activitiesRef.current = nextActivities;
            setActivities(nextActivities);
            break;
          }

          case 'tool_result': {
            const nextActivities = [
              ...activitiesRef.current,
              {
                id: generateUUID(),
                kind: 'tool_result' as const,
                label: `${friendlyToolLabel(msg.name ?? 'tool')} - done`,
                detail: msg.output && msg.output.length > 500 ? `${msg.output.slice(0, 500)}...` : msg.output,
                timestamp: new Date(),
              },
            ];
            activitiesRef.current = nextActivities;
            setActivities(nextActivities);
            break;
          }

          case 'operator_status': {
            setTyping(true);
            const phase = msg.phase ?? 'working';
            const detail = msg.detail ?? '';
            const nextActivities = [
              ...activitiesRef.current,
              {
                id: generateUUID(),
                kind: 'operator' as const,
                label: `${operatorPhaseIcon(phase)} ${detail}`,
                detail: detail || undefined,
                timestamp: new Date(),
              },
            ];
            activitiesRef.current = nextActivities;
            setActivities(nextActivities);

            if (!isTransientPhase(phase)) {
              setMessages((prev) => [
                ...prev,
                {
                  id: generateUUID(),
                  role: 'operator',
                  content: `${operatorPhaseIcon(phase)} ${detail}`,
                  operatorPhase: phase,
                  timestamp: new Date(),
                },
              ]);
            }
            break;
          }

          case 'agent_event': {
            const ev = msg.event as AgentChannelEvent | undefined;
            console.log('[construct] agent_event received:', ev?.type, ev?.agentTitle, ev);
            if (ev) {
              setAgentEvents((prev) => [...prev, ev]);
            }
            break;
          }

          case 'error':
            setMessages((prev) => [
              ...prev,
              {
                id: generateUUID(),
                role: 'agent',
                content: `${t('agent.error_prefix')} ${msg.message ?? t('agent.unknown_error')}`,
                timestamp: new Date(),
              },
            ]);
            if (msg.code === 'AGENT_INIT_FAILED' || msg.code === 'AUTH_ERROR' || msg.code === 'PROVIDER_ERROR') {
              setError(`Configuration error: ${msg.message}. Please check your provider settings (API key, model, etc.).`);
            } else if (msg.code === 'INVALID_JSON' || msg.code === 'UNKNOWN_MESSAGE_TYPE' || msg.code === 'EMPTY_CONTENT') {
              setError(`Message error: ${msg.message}`);
            }
            setTyping(false);
            pendingContentRef.current = '';
            pendingThinkingRef.current = '';
            capturedThinkingRef.current = '';
            setStreamingContent('');
            setStreamingThinking('');
            activitiesRef.current = [];
            setActivities([]);
            break;
        }
      };

      ws.connect();
      wsRef.current = ws;
    }, 50);

    return () => {
      cancelled = true;
      clearTimeout(connectTimer);
      if (ws) ws.disconnect();
      wsRef.current = null;
    };
  }, [pageContext, sessionId]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || !wsRef.current?.connected) return false;

    setMessages((prev) => [
      ...prev,
      {
        id: generateUUID(),
        role: 'user',
        content: trimmed,
        timestamp: new Date(),
      },
    ]);

    try {
      wsRef.current.sendMessage(trimmed, pageContext);
      onUserMessageRef.current?.(trimmed);
      setTyping(true);
      pendingContentRef.current = '';
      pendingThinkingRef.current = '';
      capturedThinkingRef.current = '';
      activitiesRef.current = [];
      setActivities([]);
    } catch {
      setError(t('agent.send_error'));
      return false;
    }

    setInput('');
    clearDraftStore(draftKeyRef.current);
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.focus();
    }
    return true;
  }, [clearDraftStore, input, pageContext]);

  const handleTextareaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
  }, []);

  const copyMessage = useCallback(async (messageId: string, content: string) => {
    if (!(await copyToClipboard(content))) return;
    setCopiedId(messageId);
    setTimeout(() => setCopiedId((prev) => (prev === messageId ? null : prev)), 2000);
  }, []);

  return {
    activities,
    agentEvents,
    connected,
    copiedId,
    copyMessage,
    error,
    handleSend,
    handleTextareaChange,
    input,
    inputRef,
    messages,
    setInput,
    streamingContent,
    streamingThinking,
    typing,
  };
}
