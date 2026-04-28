import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Code2,
  Copy,
  MessageSquare,
  Plus,
  Settings,
  Terminal,
  X,
} from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { generateUUID } from '@/lib/uuid';
import { useAgentChatSession } from '@/construct/hooks/useAgentChatSession';
import { useV2Assistant } from './AssistantContext';
import { v2RouteMeta } from '../layout/construct-navigation';
import {
  COLOR_SCHEMES,
  SCHEME_KEYS,
  useAssistantConfig,
  type AssistantConfig,
  type SchemeColors,
} from './assistantConfig';
import XTerminal from './XTerminal';
import CodeTab, { basename, type CodeSession, toolLabel } from './CodeTab';
import { copyToClipboard } from '@/construct/lib/clipboard';

/* ── types ─────────────────────────────────────────── */

type TabType = 'chat' | 'terminal' | 'code';

interface AssistantTab {
  id: string;
  type: TabType;
  title: string;
  sessionId: string;
  /** For code tabs: null until the user starts a session. */
  codeSession?: CodeSession | null;
  /** Override the pageContext used by chat tabs (e.g. 'v2:code:operator'). */
  pageContextOverride?: string;
}

/* ── helpers ───────────────────────────────────────── */

function routeContext(pathname: string) {
  return pathname.replace(/^\//, '');
}

/* ── ConfigPanel ──────────────────────────────────── */

function ConfigPanel({
  config,
  updateConfig,
}: {
  config: AssistantConfig;
  updateConfig: (partial: Partial<AssistantConfig>) => void;
}) {
  return (
    <div
      className="border-b px-4 py-3"
      style={{ borderColor: 'var(--construct-border-soft)', background: 'color-mix(in srgb, var(--construct-bg-surface) 95%, transparent)' }}
    >
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs">
        {/* Color Scheme */}
        <div>
          <label className="mb-1 block font-semibold uppercase tracking-[0.1em]" style={{ color: 'var(--construct-text-faint)', fontSize: '10px' }}>
            Color Scheme
          </label>
          <div className="flex gap-1.5">
            {SCHEME_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => updateConfig({ colorScheme: key })}
                className="rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors"
                style={{
                  background: config.colorScheme === key ? COLOR_SCHEMES[key].colors.primary : 'transparent',
                  color: config.colorScheme === key ? '#0c0c0c' : 'var(--construct-text-secondary)',
                  border: `1px solid ${config.colorScheme === key ? COLOR_SCHEMES[key].colors.primary : 'var(--construct-border-soft)'}`,
                }}
              >
                {COLOR_SCHEMES[key].label}
              </button>
            ))}
          </div>
        </div>

        {/* Font Size */}
        <div>
          <label className="mb-1 block font-semibold uppercase tracking-[0.1em]" style={{ color: 'var(--construct-text-faint)', fontSize: '10px' }}>
            Font Size — {config.fontSize}px
          </label>
          <input
            type="range"
            min={10}
            max={20}
            step={1}
            value={config.fontSize}
            onChange={(e) => updateConfig({ fontSize: Number(e.target.value) })}
            className="w-full accent-current"
            style={{ color: 'var(--construct-signal-live)' }}
          />
        </div>

        {/* Cursor Blink */}
        <div className="flex items-center gap-2">
          <label className="font-semibold uppercase tracking-[0.1em]" style={{ color: 'var(--construct-text-faint)', fontSize: '10px' }}>
            Cursor Blink
          </label>
          <button
            type="button"
            onClick={() => updateConfig({ cursorBlink: !config.cursorBlink })}
            className="relative h-5 w-9 rounded-full transition-colors"
            style={{
              background: config.cursorBlink ? 'var(--construct-signal-live)' : 'var(--construct-border-strong)',
            }}
          >
            <span
              className="absolute top-0.5 block h-4 w-4 rounded-full bg-white shadow transition-transform"
              style={{ transform: config.cursorBlink ? 'translateX(18px)' : 'translateX(2px)' }}
            />
          </button>
        </div>

        {/* Panel Height */}
        <div>
          <label className="mb-1 block font-semibold uppercase tracking-[0.1em]" style={{ color: 'var(--construct-text-faint)', fontSize: '10px' }}>
            Panel Height — {config.panelHeightPercent}%
          </label>
          <input
            type="range"
            min={25}
            max={90}
            step={5}
            value={config.panelHeightPercent}
            onChange={(e) => updateConfig({ panelHeightPercent: Number(e.target.value) })}
            className="w-full accent-current"
            style={{ color: 'var(--construct-signal-live)' }}
          />
        </div>
      </div>
    </div>
  );
}

/* ── ChatPane ─────────────────────────────────────── */

function ChatPane({
  sessionId,
  pageContext,
  placeholder,
  config,
  colors,
}: {
  sessionId: string;
  pageContext: string;
  placeholder: string;
  config: AssistantConfig;
  colors: SchemeColors;
}) {
  const { open } = useV2Assistant();
  const {
    activities,
    connected,
    error,
    handleSend,
    handleTextareaChange,
    input,
    inputRef,
    messages,
    streamingContent,
    streamingThinking,
    typing,
  } = useAgentChatSession({ sessionId, draftKey: `construct-assistant:${pageContext}`, pageContext });

  const scrollRef = useRef<HTMLDivElement>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyMessage = useCallback(async (id: string, text: string) => {
    if (!(await copyToClipboard(text))) return;
    setCopiedId(id);
    setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 1200);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [activities, messages, streamingContent, typing]);

  // Focus the message input each time the panel opens. The 320ms delay
  // matches the panel's 300ms slide-down transition (line 532) so the
  // textarea is on screen and clickable when the cursor lands. inputRef
  // is a stable ref so depending on `open` is what actually drives the
  // re-focus on every dropdown.
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => inputRef.current?.focus(), 320);
    return () => clearTimeout(id);
  }, [open, inputRef]);

  const roleColor = useCallback(
    (role: string) => {
      if (role === 'user') return colors.user;
      if (role === 'operator') return colors.secondary;
      return colors.primary;
    },
    [colors],
  );

  const roleGlow = useCallback(
    (role: string) => {
      if (role === 'agent') return colors.glow;
      if (role === 'operator') return colors.glowSecondary;
      return 'none';
    },
    [colors],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {typing && (
        <div className="h-[2px] overflow-hidden" style={{ background: 'var(--construct-bg-surface)' }}>
          <div
            className="h-full"
            style={{
              background: colors.primary,
              width: '40%',
              animation: 'construct-assistant-sweep 1.4s ease-in-out infinite alternate',
            }}
          />
        </div>
      )}

      {error && (
        <div
          className="border-b px-4 py-2 text-xs"
          style={{ borderColor: 'rgba(255,107,122,0.2)', background: 'rgba(255,107,122,0.06)', color: 'var(--construct-status-danger)' }}
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="h-3 w-3 shrink-0" />
            <span>{error}</span>
          </div>
        </div>
      )}

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto p-4 font-mono leading-6"
        style={{ fontSize: `${config.fontSize}px` }}
      >
        {messages.length === 0 && !typing ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <pre className="text-xs" style={{ color: 'var(--construct-text-faint)' }}>
{`┌──────────────────────────────┐
│  session ready · ask away    │
└──────────────────────────────┘`}
            </pre>
            <p className="mt-3 max-w-xs text-xs leading-5" style={{ color: 'var(--construct-text-muted)' }}>
              {placeholder}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {messages.map((msg) => {
              const prefix = msg.role === 'user' ? 'you' : msg.role === 'operator' ? 'sys' : 'op';
              const color = roleColor(msg.role);
              const glow = roleGlow(msg.role);
              const copied = copiedId === msg.id;
              return (
                <div key={msg.id} className="group relative whitespace-pre-wrap break-words pr-7">
                  <span style={{ color, textShadow: glow, fontWeight: 600 }}>{prefix} {'>'} </span>
                  <span style={{ color: msg.role === 'user' ? 'var(--construct-text-secondary)' : color, textShadow: glow }}>
                    {msg.content}
                  </span>
                  <button
                    type="button"
                    onClick={() => copyMessage(msg.id, msg.content)}
                    aria-label={copied ? 'Copied' : 'Copy message'}
                    title={copied ? 'Copied' : 'Copy'}
                    className="absolute right-0 top-0 inline-flex h-5 w-5 items-center justify-center rounded opacity-0 transition-opacity hover:opacity-100 focus:opacity-100 focus:outline-none group-hover:opacity-60"
                    style={{ color: 'var(--construct-text-muted)' }}
                  >
                    {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  </button>
                </div>
              );
            })}

            {typing && activities.length > 0 && (
              <div style={{ color: 'var(--construct-text-faint)' }}>
                {activities.slice(-3).map((evt) => (
                  <div key={evt.id} className="truncate">sys {'>'} {evt.label}</div>
                ))}
              </div>
            )}

            {typing && (streamingContent || streamingThinking) && (
              <div className="whitespace-pre-wrap break-words">
                <span style={{ color: colors.primary, textShadow: colors.glow, fontWeight: 600 }}>
                  op {'>'}{' '}
                </span>
                <span style={{ color: colors.primary, textShadow: colors.glow }}>
                  {streamingContent || '…'}
                </span>
              </div>
            )}

            {typing && !streamingContent && !streamingThinking && activities.length === 0 && (
              <div className="animate-pulse" style={{ color: colors.primary, textShadow: colors.glow }}>
                op {'>'} ▊
              </div>
            )}
          </div>
        )}
      </div>

      <div className="border-t px-4 py-3" style={{ borderColor: 'var(--construct-border-soft)' }}>
        <div className="flex items-end gap-2">
          <span
            className="shrink-0 pb-[7px] font-mono text-sm font-semibold"
            style={{ color: colors.primary, textShadow: colors.glow }}
          >
            {'>'}<span className={config.cursorBlink ? 'construct-cursor-blink' : ''}>_</span>
          </span>
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={handleTextareaChange}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
            }}
            placeholder={connected ? 'message…' : 'connecting…'}
            disabled={!connected}
            className="min-h-[2rem] flex-1 resize-none bg-transparent font-mono outline-none focus:outline-none focus-visible:outline-none disabled:opacity-50"
            style={{
              color: 'var(--construct-text-primary)',
              caretColor: colors.cursorColor,
              maxHeight: '6rem',
              fontSize: `${config.fontSize}px`,
            }}
          />
        </div>
        <div className="mt-2 flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--construct-text-faint)' }}>
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: connected ? 'var(--construct-status-success)' : 'var(--construct-status-danger)' }}
            />
            {connected ? 'live' : 'offline'}
          </span>
          <span className="text-[10px]" style={{ color: 'var(--construct-text-faint)' }}>{pageContext}</span>
        </div>
      </div>
    </div>
  );
}

/* ── NewTabMenu ───────────────────────────────────── */

function NewTabMenu({
  onSelect,
  onClose,
}: {
  onSelect: (type: TabType) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="absolute left-0 top-full z-50 mt-1 rounded-[8px] border py-1 shadow-lg"
      style={{
        background: 'var(--construct-bg-panel-strong)',
        borderColor: 'var(--construct-border-strong)',
        minWidth: '10rem',
      }}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-white/5"
        style={{ color: 'var(--construct-text-secondary)' }}
        onClick={() => { onSelect('chat'); onClose(); }}
      >
        <MessageSquare className="h-3.5 w-3.5" />
        New Chat
      </button>
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-white/5"
        style={{ color: 'var(--construct-text-secondary)' }}
        onClick={() => { onSelect('terminal'); onClose(); }}
      >
        <Terminal className="h-3.5 w-3.5" />
        New Terminal
      </button>
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-white/5"
        style={{ color: 'var(--construct-text-secondary)' }}
        onClick={() => { onSelect('code'); onClose(); }}
      >
        <Code2 className="h-3.5 w-3.5" />
        New Code
      </button>
    </div>
  );
}

/* ── AssistantPanel ─────────────────────────────── */

export default function AssistantPanel() {
  const location = useLocation();
  const { open, closeAssistant, pageContextOverride, placeholderOverride } = useV2Assistant();
  const { config, colors, updateConfig } = useAssistantConfig();
  const routeMeta = v2RouteMeta[location.pathname];
  const pageContext = pageContextOverride ?? `v2:${routeContext(location.pathname) || 'dashboard'}`;
  const placeholder = placeholderOverride ?? `Ask about ${routeMeta?.title?.toLowerCase() ?? 'this workspace'}.`;

  const [tabs, setTabs] = useState<AssistantTab[]>(() => [
    { id: 'chat-main', type: 'chat', title: 'Chat', sessionId: generateUUID() },
    { id: 'terminal-main', type: 'terminal', title: 'Terminal', sessionId: generateUUID() },
  ]);
  const [activeTabId, setActiveTabId] = useState('chat-main');
  const [showNewTabMenu, setShowNewTabMenu] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const activeTab = useMemo(() => tabs.find((t) => t.id === activeTabId) ?? tabs[0], [tabs, activeTabId]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeAssistant(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, closeAssistant]);

  const addTab = useCallback((type: TabType) => {
    const id = generateUUID();
    setTabs((prev) => {
      const count = prev.filter((t) => t.type === type).length;
      let title: string;
      if (type === 'chat') title = `Chat ${count + 1}`;
      else if (type === 'terminal') title = `Terminal ${count + 1}`;
      else title = 'Code';
      const newTab: AssistantTab = {
        id,
        type,
        title,
        sessionId: generateUUID(),
        codeSession: type === 'code' ? null : undefined,
      };
      return [...prev, newTab];
    });
    setActiveTabId(id);
  }, []);

  const updateTab = useCallback((tabId: string, patch: Partial<AssistantTab>) => {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, ...patch } : t)));
  }, []);

  const handleCodeSessionStart = useCallback(
    (tabId: string) => (session: CodeSession, _label: string, resolvedCwd: string) => {
      updateTab(tabId, {
        codeSession: session,
        title: `${toolLabel(session.toolKey)} · ${basename(resolvedCwd)}`,
      });
    },
    [updateTab],
  );

  const handleCodeSessionEnd = useCallback(
    (tabId: string) => () => {
      updateTab(tabId, { codeSession: null, title: 'Code' });
    },
    [updateTab],
  );

  const handleCodeDelegateToChat = useCallback(
    (tabId: string) => (pageCtx: string, title: string) => {
      // Convert the code tab in place into a chat tab with the Operator context.
      updateTab(tabId, {
        type: 'chat',
        title,
        sessionId: generateUUID(),
        codeSession: undefined,
        pageContextOverride: pageCtx,
      });
    },
    [updateTab],
  );

  const closeTab = useCallback((tabId: string) => {
    setTabs((prev) => {
      const remaining = prev.filter((t) => t.id !== tabId);
      if (remaining.length === 0) {
        // Always keep at least one tab
        const fallback: AssistantTab = { id: generateUUID(), type: 'chat', title: 'Chat', sessionId: generateUUID() };
        return [fallback];
      }
      return remaining;
    });
    setActiveTabId((prev) => {
      if (prev !== tabId) return prev;
      const idx = tabs.findIndex((t) => t.id === tabId);
      const remaining = tabs.filter((t) => t.id !== tabId);
      if (remaining.length === 0) return prev; // will be replaced by new tab
      return remaining[Math.min(idx, remaining.length - 1)]!.id;
    });
  }, [tabs]);

  const panelHeight = `${config.panelHeightPercent}vh`;

  return (
    <>
      {open && (
        <div
          className="absolute inset-0 z-[50]"
          style={{ background: 'rgba(0,0,0,0.25)' }}
          onClick={closeAssistant}
        />
      )}

      <div
        className="absolute inset-x-0 top-0 z-[60] flex flex-col overflow-hidden border-b border-l border-r"
        style={{
          height: open ? panelHeight : '0px',
          maxHeight: open ? '90vh' : '0px',
          opacity: open ? 1 : 0,
          transform: open ? 'translateY(0)' : 'translateY(-0.75rem)',
          transition: 'height 300ms ease-out, max-height 300ms ease-out, opacity 200ms ease-out, transform 300ms ease-out',
          borderColor: open ? 'var(--construct-border-strong)' : 'transparent',
          background: 'var(--construct-bg-base)',
          boxShadow: open ? 'var(--construct-shadow-overlay)' : 'none',
          pointerEvents: open ? 'auto' : 'none',
          borderRadius: '0 0 14px 14px',
        }}
      >
        {/* scanlines */}
        <div
          className="pointer-events-none absolute inset-0 z-[5]"
          style={{
            background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(125,255,155,0.012) 2px, rgba(125,255,155,0.012) 4px)',
            mixBlendMode: 'overlay',
          }}
        />

        {/* tab bar */}
        <div
          className="relative z-20 flex items-center gap-0.5 border-b px-2 py-1"
          style={{ borderColor: 'var(--construct-border-soft)', background: 'var(--construct-bg-surface)' }}
        >
          {tabs.map((tab) => {
            const isActive = activeTabId === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                className="group flex items-center gap-1.5 px-2.5 py-1.5 font-mono text-[11px] transition-colors"
                onClick={() => setActiveTabId(tab.id)}
                style={{
                  background: isActive ? colors.primary + '18' : 'transparent',
                  color: isActive ? colors.primary : 'var(--construct-text-muted)',
                  textShadow: isActive ? colors.glow : 'none',
                  borderBottom: isActive ? `2px solid ${colors.primary}` : '2px solid transparent',
                }}
              >
                {tab.type === 'terminal' ? (
                  <Terminal className="h-3 w-3" />
                ) : tab.type === 'code' ? (
                  <Code2 className="h-3 w-3" />
                ) : (
                  <MessageSquare className="h-3 w-3" />
                )}
                {tab.title}
                {tabs.length > 1 && (
                  <span
                    className="ml-0.5 p-0.5 opacity-0 transition-opacity hover:bg-white/10 group-hover:opacity-100"
                    onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                    role="button"
                    tabIndex={-1}
                  >
                    <X className="h-2.5 w-2.5" />
                  </span>
                )}
              </button>
            );
          })}

          <div className="relative">
            <button
              type="button"
              className="flex items-center gap-0.5 p-1.5 transition-colors hover:bg-white/5"
              onClick={() => setShowNewTabMenu((prev) => !prev)}
              style={{ color: 'var(--construct-text-faint)' }}
              title="New tab"
            >
              <Plus className="h-3 w-3" />
              <ChevronDown className="h-2.5 w-2.5" />
            </button>
            {showNewTabMenu && (
              <NewTabMenu
                onSelect={addTab}
                onClose={() => setShowNewTabMenu(false)}
              />
            )}
          </div>

          <div className="flex-1" />

          <button
            type="button"
            className="p-1.5 transition-colors hover:bg-white/5"
            onClick={() => setShowConfig((prev) => !prev)}
            style={{ color: showConfig ? colors.primary : 'var(--construct-text-faint)' }}
            title="Settings"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            className="p-1.5 transition-colors hover:bg-white/5"
            onClick={closeAssistant}
            style={{ color: 'var(--construct-text-faint)' }}
            title="Dismiss (Esc)"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* config panel (inline) */}
        {showConfig && <ConfigPanel config={config} updateConfig={updateConfig} />}

        {/* pane content */}
        {open && (
          <div className="relative z-10 flex min-h-0 flex-1 flex-col">
            {/* Terminal tabs — all rendered, visibility toggled */}
            {tabs.filter((t) => t.type === 'terminal').map((tab) => (
              <XTerminal
                key={tab.id}
                sessionId={tab.sessionId}
                config={config}
                colors={colors}
                visible={activeTabId === tab.id}
              />
            ))}

            {/* Code tabs — all rendered, visibility toggled so xterm state persists. */}
            {tabs.filter((t) => t.type === 'code').map((tab) => (
              <CodeTab
                key={tab.id}
                tabId={tab.id}
                config={config}
                colors={colors}
                visible={activeTabId === tab.id}
                session={tab.codeSession ?? null}
                onSessionStart={handleCodeSessionStart(tab.id)}
                onSessionEnd={handleCodeSessionEnd(tab.id)}
                onDelegateToChat={handleCodeDelegateToChat(tab.id)}
              />
            ))}

            {/* Active chat tab */}
            {activeTab?.type === 'chat' && (
              <ChatPane
                key={activeTab.id}
                sessionId={activeTab.sessionId}
                pageContext={activeTab.pageContextOverride ?? pageContext}
                placeholder={placeholder}
                config={config}
                colors={colors}
              />
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes construct-assistant-sweep {
          from { transform: translateX(-10%); }
          to   { transform: translateX(160%); }
        }
        @keyframes construct-cursor-blink-anim {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
        .construct-cursor-blink {
          animation: construct-cursor-blink-anim 1s step-end infinite;
        }
      `}</style>
    </>
  );
}
