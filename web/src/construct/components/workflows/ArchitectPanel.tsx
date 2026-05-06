/**
 * Architect — editor-scoped chat panel.
 *
 * Slides in from the right of the workflow editor. Reuses
 * `useAgentChatSession` (the same WebSocket-streaming hook the dashboard
 * AssistantPanel uses) so the chat surface, tool-call cards, slash menu,
 * and history persistence all behave identically. The only differences:
 *
 *   1. The panel's pageContext is namespaced as `v2:workflow_editor:architect`
 *      so the Operator can detect it server-side and compose the architect
 *      tools (`revise_workflow`, `get_workflow_metadata`, …) when answering.
 *   2. A scoped slash-command set: `/architect <description>` shows up in
 *      the autocomplete (because the menu is rendered with
 *      `scope='workflow_editor'`), other commands are filtered out unless
 *      flagged for that scope.
 *   3. The first message of every fresh session is a synthetic system
 *      preface with the current workflow's kref + name, so the Operator
 *      knows which workflow to revise without requiring the user to
 *      paste the kref.
 *
 * Stage B.1 deliberately does NOT call `/api/architect/revise` from the
 * client — the Operator does it via the registered MCP tool, and the
 * editor's existing `useWorkflowEvents` SSE subscription auto-applies the
 * resulting revision. That keeps this panel a pure chat surface.
 *
 * When `workflowKref` is null (the user has opened the editor on a fresh
 * canvas and not yet saved), the panel still mounts and the toolbar
 * button is still clickable — but the body renders a quiet "Save your
 * workflow first" inline state instead of the chat surface, and the
 * chat-surface hooks (which depend on the kref) are not called. The
 * chat surface is a sub-component so all its hooks remain unconditional.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Check, Copy, Loader2, Send, Wand2, X } from 'lucide-react';
import { useAgentChatSession } from '@/construct/hooks/useAgentChatSession';
import {
  matchCommands,
  parseInput,
  resolveCommand,
  type SlashCommandContext,
  type SlashThemeName,
} from '@/construct/components/assistant/slashCommands';
import SlashCommandMenu from '@/construct/components/assistant/SlashCommandMenu';
import ActivityCard from '@/construct/components/assistant/ActivityCard';
import { useTheme } from '@/construct/hooks/useTheme';
import { useT, type Locale } from '@/construct/hooks/useT';
import { copyToClipboard } from '@/construct/lib/clipboard';

interface ArchitectPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** kref of the workflow currently open in the editor, or null when
   *  the user hasn't saved the workflow yet. */
  workflowKref: string | null;
  /** Display name — surfaced in the header badge and the context preface.
   *  Null when the workflow has no name yet. */
  workflowName: string | null;
}

/** Stable session id per workflow kref. Persisted in sessionStorage so
 *  reopening the panel within the same tab continues the same chat
 *  thread; opening a different workflow gets its own. */
function architectSessionIdFor(workflowKref: string): string {
  const key = `construct.architect.session_id:${workflowKref}`;
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const fresh =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `arch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(key, fresh);
    return fresh;
  } catch {
    return `arch-${workflowKref}`;
  }
}

/** Build the system-style preface that primes every new architect chat
 *  with the workflow context. Rendered as a single `operator`-role
 *  message at the top of the scrollback so the user can see what the
 *  Operator was told. */
function buildContextPreface(workflowName: string, workflowKref: string): string {
  return [
    `You are operating in Architect mode for workflow "${workflowName}" (kref: ${workflowKref}).`,
    'You have access to MCP tools: revise_workflow, get_workflow_metadata, validate_workflow, list_workflows, get_workflow_status.',
    'When the user describes a workflow change, propose operations and call revise_workflow.',
    'On success, a new Kumiho revision is created and the editor picks it up live.',
    'On SkippedItem[] errors (step_not_found, reference_broken, etc.), repair via additional ops.',
  ].join('\n');
}

/** Inline state shown when the user opens the panel before saving the
 *  workflow. The chat surface depends on `workflowKref` for session id,
 *  pageContext, and the context preface — none of those exist yet. */
function SaveFirstState() {
  return (
    <div
      style={{
        padding: '32px 24px',
        textAlign: 'center',
        color: 'var(--pc-text-secondary)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        alignItems: 'center',
      }}
    >
      <Wand2 size={28} style={{ color: 'var(--pc-accent)' }} />
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--pc-text-primary)' }}>
        Save your workflow first
      </div>
      <div style={{ fontSize: 12, lineHeight: 1.5, maxWidth: 320 }}>
        Architect proposes revisions to a saved workflow. Give your workflow a
        name and click Save in the toolbar — then come back and I'll help you
        build it out.
      </div>
    </div>
  );
}

/** The live chat surface — all hooks that depend on `workflowKref` live
 *  here so the parent can mount this conditionally without violating
 *  the rules of hooks. */
function ArchitectChatSurface({
  open,
  onOpenChange,
  workflowKref,
  workflowName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflowKref: string;
  workflowName: string;
}) {
  const sessionId = useMemo(() => architectSessionIdFor(workflowKref), [workflowKref]);
  const pageContext = `v2:workflow_editor:architect:${workflowKref}`;
  const { setTheme } = useTheme();
  const { setLocale } = useT();

  const {
    activities,
    appendSystemMessage,
    clearMessages,
    connected,
    error,
    handleSend,
    handleTextareaChange,
    input,
    inputRef,
    messages,
    setInput,
    streamingContent,
    streamingThinking,
    submitMessage,
    typing,
  } = useAgentChatSession({
    sessionId,
    draftKey: `construct-architect:${workflowKref}`,
    pageContext,
  });

  // Inject the context preface as a synthetic operator-role message the
  // first time we observe an empty scrollback for this session. We can't
  // do this in the hook's setup because it would race the history fetch;
  // instead we wait for `messages.length === 0` to settle and then prepend
  // once. The check is intentionally idempotent — restoring a session
  // with prior history skips the inject and the existing preface (if any)
  // is preserved.
  const prefacedRef = useRef<string | null>(null);
  useEffect(() => {
    if (prefacedRef.current === sessionId) return;
    if (!open) return;
    if (messages.length > 0) {
      // Either history loaded or the user already started a turn — don't
      // prepend a stale preface on top.
      prefacedRef.current = sessionId;
      return;
    }
    appendSystemMessage(buildContextPreface(workflowName, workflowKref));
    prefacedRef.current = sessionId;
  }, [open, sessionId, messages.length, appendSystemMessage, workflowName, workflowKref]);

  // ── Slash menu plumbing — same pattern as AssistantPanel/ChatPane,
  //    but scoped to `workflow_editor` so only `/architect` (and any
  //    future scoped commands) show up in the autocomplete.
  const composerRef = useRef<HTMLDivElement>(null);
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const slashMatches = useMemo(() => {
    if (slashDismissed) return [];
    const trimmed = input.trimStart();
    if (!trimmed.startsWith('/')) return [];
    if (trimmed.includes(' ') || trimmed.includes('\n')) return [];
    return matchCommands(trimmed, 'workflow_editor');
  }, [input, slashDismissed]);

  useEffect(() => {
    if (slashSelectedIndex >= slashMatches.length) {
      setSlashSelectedIndex(slashMatches.length === 0 ? 0 : slashMatches.length - 1);
    }
  }, [slashMatches.length, slashSelectedIndex]);

  useEffect(() => {
    if (slashDismissed && !input.startsWith('/')) setSlashDismissed(false);
  }, [input, slashDismissed]);

  const slashCtx = useMemo<SlashCommandContext>(
    () => ({
      clearMessages,
      appendSystemMessage,
      // The architect surface has no file picker / tab actions; provide
      // no-op handlers so commands that *would* call them in the global
      // scope (and slip in via a future scope-multiplexed command)
      // degrade gracefully instead of crashing.
      openFilePicker: () => {},
      addTab: () => {},
      openNewTabMenu: () => {},
      closeActiveTab: () => onOpenChange(false),
      setLang: (code: string) => {
        setLocale(code as Locale);
      },
      setTheme: (theme: SlashThemeName) => {
        setTheme(theme);
      },
      submitMessage,
      workflowKref,
      workflowName,
    }),
    [
      clearMessages,
      appendSystemMessage,
      onOpenChange,
      setLocale,
      setTheme,
      submitMessage,
      workflowKref,
      workflowName,
    ],
  );

  const runSlashFromInput = useCallback((): boolean => {
    const parsed = parseInput(input);
    if (!parsed) return false;
    const cmd = resolveCommand(parsed.name);
    if (!cmd) return false;
    setInput('');
    setSlashSelectedIndex(0);
    setSlashDismissed(false);
    if (inputRef.current) inputRef.current.style.height = 'auto';
    try {
      void cmd.handler(slashCtx, parsed.args);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appendSystemMessage(`Command "/${cmd.name}" failed: ${msg}`);
    }
    return true;
  }, [input, slashCtx, setInput, inputRef, appendSystemMessage]);

  const pickSlashCommand = useCallback(
    (index: number) => {
      const cmd = slashMatches[index];
      if (!cmd) return;
      if (cmd.args) {
        setInput(`/${cmd.name} `);
        setSlashSelectedIndex(0);
        inputRef.current?.focus();
      } else {
        setInput('');
        setSlashSelectedIndex(0);
        if (inputRef.current) inputRef.current.style.height = 'auto';
        try {
          void cmd.handler(slashCtx, '');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          appendSystemMessage(`Command "/${cmd.name}" failed: ${msg}`);
        }
      }
    },
    [slashMatches, slashCtx, setInput, inputRef, appendSystemMessage],
  );

  // Auto-scroll to the bottom on new content, mirroring ChatPane.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [activities, messages, streamingContent, typing]);

  // Focus the textarea when the panel opens.
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => inputRef.current?.focus(), 220);
    return () => clearTimeout(id);
  }, [open, inputRef]);

  const copyMessage = useCallback(async (id: string, text: string) => {
    if (!(await copyToClipboard(text))) return;
    setCopiedId(id);
    setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 1200);
  }, []);

  return (
    <>
      {/* Connection status pill — sits as a slim row at the top of the
          chat surface (the wrapper's header is layout-fixed and doesn't
          have access to `connected`). Visually merges into the header
          via shared border + surface background. */}
      <div
        className="flex items-center justify-end border-b px-3 py-1"
        style={{
          borderColor: 'var(--construct-border-soft)',
          background: 'var(--construct-bg-surface)',
        }}
      >
        <span
          className="flex shrink-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em]"
          style={{ color: 'var(--construct-text-faint)' }}
        >
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{
              background: connected
                ? 'var(--construct-status-success)'
                : 'var(--construct-status-danger)',
            }}
          />
          {connected ? 'live' : 'offline'}
        </span>
      </div>

      {/* Typing sweep */}
      {typing && (
        <div className="h-[2px] overflow-hidden" style={{ background: 'var(--construct-bg-surface)' }}>
          <div
            className="h-full"
            style={{
              background: 'var(--construct-signal-network)',
              width: '40%',
              animation: 'construct-architect-sweep 1.4s ease-in-out infinite alternate',
            }}
          />
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div
          className="border-b px-3 py-2 text-xs"
          style={{
            borderColor: 'color-mix(in srgb, var(--construct-status-danger) 32%, transparent)',
            background: 'color-mix(in srgb, var(--construct-status-danger) 10%, transparent)',
            color: 'var(--construct-status-danger)',
          }}
        >
          {error}
        </div>
      )}

      {/* Scrollback */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-3 font-mono leading-6"
        style={{ fontSize: 13 }}
      >
        {messages.length === 0 && !typing ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <pre className="text-xs" style={{ color: 'var(--construct-text-faint)' }}>
{`┌──────────────────────────────┐
│  architect ready · describe  │
│  a change to "${workflowName.length > 14 ? workflowName.slice(0, 12) + '…' : workflowName.padEnd(14)}" │
└──────────────────────────────┘`}
            </pre>
            <p
              className="mt-3 max-w-xs text-xs leading-5"
              style={{ color: 'var(--construct-text-muted)' }}
            >
              Try /architect add a python step that prints hello
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg) => {
              const prefix = msg.role === 'user' ? 'you' : msg.role === 'operator' ? 'sys' : 'op';
              const color =
                msg.role === 'user'
                  ? 'var(--construct-text-secondary)'
                  : msg.role === 'operator'
                    ? 'var(--construct-signal-network)'
                    : 'var(--construct-signal-live)';
              const copied = copiedId === msg.id;
              return (
                <div key={msg.id} className="group">
                  {msg.activityLog && msg.activityLog.length > 0 && (
                    <div className="mb-1 space-y-0.5">
                      {msg.activityLog.map((evt) => (
                        <ActivityCard
                          key={evt.id}
                          event={evt}
                          accent={
                            evt.kind === 'tool_result'
                              ? 'var(--construct-status-success)'
                              : 'var(--construct-signal-network)'
                          }
                          fontSize={13}
                        />
                      ))}
                    </div>
                  )}
                  <div className="whitespace-pre-wrap break-words">
                    <span style={{ color, fontWeight: 600 }}>{prefix} {'>'} </span>
                    <span style={{ color }}>{msg.content}</span>
                  </div>
                  <div
                    className="mt-0.5 flex items-center justify-end gap-2 text-[10px]"
                    style={{ color: 'var(--construct-text-faint)' }}
                  >
                    <button
                      type="button"
                      onClick={() => copyMessage(msg.id, msg.content)}
                      aria-label={copied ? 'Copied' : 'Copy message'}
                      title={copied ? 'Copied' : 'Copy'}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 opacity-50 transition-all hover:bg-white/5 hover:opacity-100 group-hover:opacity-80"
                      style={{ color: 'var(--construct-text-muted)' }}
                    >
                      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      <span>{copied ? 'copied' : 'copy'}</span>
                    </button>
                  </div>
                </div>
              );
            })}

            {typing && activities.length > 0 && (
              <div className="space-y-0.5">
                {activities.map((evt) => (
                  <ActivityCard
                    key={evt.id}
                    event={evt}
                    accent={
                      evt.kind === 'tool_result'
                        ? 'var(--construct-status-success)'
                        : evt.kind === 'thinking'
                          ? 'var(--construct-text-faint)'
                          : 'var(--construct-signal-network)'
                    }
                    fontSize={13}
                  />
                ))}
              </div>
            )}

            {typing && (streamingContent || streamingThinking) && (
              <div className="whitespace-pre-wrap break-words">
                <span
                  style={{ color: 'var(--construct-signal-live)', fontWeight: 600 }}
                >
                  op {'>'}{' '}
                </span>
                <span style={{ color: 'var(--construct-signal-live)' }}>
                  {streamingContent || '…'}
                </span>
              </div>
            )}

            {typing && !streamingContent && !streamingThinking && activities.length === 0 && (
              <div
                className="animate-pulse"
                style={{ color: 'var(--construct-signal-live)' }}
              >
                op {'>'} <Loader2 className="inline h-3 w-3 animate-spin" />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Composer */}
      <div
        ref={composerRef}
        className="relative border-t px-3 py-2"
        style={{ borderColor: 'var(--construct-border-soft)' }}
      >
        <div
          className="flex items-end gap-2 rounded-md border px-2 py-1.5"
          style={{
            borderColor: 'var(--construct-border-soft)',
            color: 'var(--construct-signal-network)',
          }}
        >
          <span
            className="shrink-0 pb-[3px] font-mono text-sm font-semibold"
            style={{ color: 'var(--construct-signal-network)' }}
          >
            {'>'}<span className="construct-cursor-blink">_</span>
          </span>
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={handleTextareaChange}
            onKeyDown={(e) => {
              const menuOpen = slashMatches.length > 0;
              if (menuOpen) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setSlashSelectedIndex((i) => (i + 1) % slashMatches.length);
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setSlashSelectedIndex(
                    (i) => (i - 1 + slashMatches.length) % slashMatches.length,
                  );
                  return;
                }
                if (e.key === 'Tab') {
                  e.preventDefault();
                  pickSlashCommand(slashSelectedIndex);
                  return;
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setSlashDismissed(true);
                  return;
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  pickSlashCommand(slashSelectedIndex);
                  return;
                }
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (runSlashFromInput()) return;
                handleSend();
              }
            }}
            placeholder={
              connected
                ? 'Describe a change… (try /architect)'
                : 'connecting…'
            }
            disabled={!connected}
            className="min-h-[1.75rem] min-w-0 flex-1 resize-none bg-transparent font-mono outline-none focus:outline-none focus-visible:outline-none disabled:opacity-50"
            style={{
              color: 'var(--construct-text-primary)',
              caretColor: 'var(--construct-signal-network)',
              maxHeight: '6rem',
              fontSize: 16,
            }}
          />
          <button
            type="button"
            onClick={() => handleSend()}
            disabled={!connected || !input.trim()}
            aria-label="Send message"
            title={connected ? 'Send (Enter)' : 'Disconnected'}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded transition-all hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-30"
            style={{
              color: input.trim() && connected
                ? 'var(--construct-signal-network)'
                : 'var(--construct-text-faint)',
            }}
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>

        <SlashCommandMenu
          anchorRef={composerRef}
          matches={slashMatches}
          selectedIndex={slashSelectedIndex}
          onPick={pickSlashCommand}
        />
      </div>
    </>
  );
}

export default function ArchitectPanel({
  open,
  onOpenChange,
  workflowKref,
  workflowName,
}: ArchitectPanelProps) {
  // Esc closes the panel — same affordance the dashboard AssistantPanel
  // uses. Listener is only registered while open so it doesn't intercept
  // Esc on other surfaces. Lives in the wrapper so it works regardless
  // of whether the chat surface is mounted (e.g. in the Save-first
  // state, the user can still hit Esc to dismiss).
  useEffect(() => {
    if (!open) return undefined;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onOpenChange]);

  const displayName = workflowName ?? 'workflow';

  return (
    <>
      {/* Scrim — taps outside the panel dismiss it. Stays below the panel
          but above editor content so a stray click doesn't drop a noodle
          on the React Flow canvas behind us. */}
      {open && (
        <div
          className="fixed inset-0 z-[80]"
          style={{ background: 'rgba(0,0,0,0.18)' }}
          onClick={() => onOpenChange(false)}
        />
      )}

      <aside
        className="fixed right-0 top-0 z-[90] flex h-full flex-col border-l"
        style={{
          width: 480,
          maxWidth: '100vw',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 280ms ease-out',
          background: 'var(--construct-bg-base)',
          borderColor: 'var(--construct-border-strong)',
          boxShadow: open ? 'var(--construct-shadow-overlay)' : 'none',
          pointerEvents: open ? 'auto' : 'none',
        }}
        aria-hidden={!open}
      >
        {/* Header */}
        <div
          className="flex items-center gap-2 border-b px-3 py-2"
          style={{
            borderColor: 'var(--construct-border-soft)',
            background: 'var(--construct-bg-surface)',
          }}
        >
          <Wand2
            size={14}
            style={{ color: 'var(--construct-signal-network)' }}
            aria-hidden
          />
          <span
            className="text-[12px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: 'var(--construct-text-primary)' }}
          >
            Architect
          </span>
          <span
            className="ml-1 truncate rounded px-2 py-0.5 text-[11px]"
            style={{
              background: 'var(--pc-bg-input)',
              color: 'var(--construct-text-muted)',
              maxWidth: 220,
            }}
            title={workflowKref ? `${displayName} · ${workflowKref}` : displayName}
          >
            {displayName}
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close Architect"
            title="Close (Esc)"
            className="ml-1 rounded p-1 transition-colors hover:bg-white/5"
            style={{ color: 'var(--construct-text-faint)' }}
          >
            <X size={14} />
          </button>
        </div>

        {workflowKref ? (
          <ArchitectChatSurface
            open={open}
            onOpenChange={onOpenChange}
            workflowKref={workflowKref}
            workflowName={displayName}
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <SaveFirstState />
          </div>
        )}

        {/* Footer attribution */}
        <div
          className="border-t px-3 py-1.5 text-center text-[10px] uppercase tracking-[0.16em]"
          style={{
            borderColor: 'var(--construct-border-soft)',
            color: 'var(--pc-text-faint, var(--construct-text-faint))',
            background: 'var(--construct-bg-surface)',
          }}
        >
          Powered by Operator
        </div>
      </aside>

      <style>{`
        @keyframes construct-architect-sweep {
          from { transform: translateX(-10%); }
          to   { transform: translateX(160%); }
        }
      `}</style>
    </>
  );
}
