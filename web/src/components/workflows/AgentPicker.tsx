import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Loader2, X, Bot, Plus } from 'lucide-react';
import type { AgentDefinition } from '@/types/api';
import { useAgentRoster } from './useAgentRoster';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Current task.assign value */
  value?: string;
  /** Called with the selected `item_name`, or `null` to clear assignment. */
  onSelect: (name: string | null) => void;
  /**
   * When set, the popover is anchored ~8px below the rect, right-aligned
   * to it. When omitted, the popover is centered in the viewport.
   */
  anchorRect?: DOMRect | null;
}

const POPOVER_WIDTH = 320;
const POPOVER_MAX_HEIGHT = 360;
const ANCHOR_GAP = 8;

function getPosition(anchor: DOMRect | null | undefined): React.CSSProperties {
  if (!anchor) {
    return {
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
    };
  }
  const margin = 8;
  // Right-align to anchor by default.
  let left = anchor.right - POPOVER_WIDTH;
  if (left < margin) left = margin;
  if (left + POPOVER_WIDTH > window.innerWidth - margin) {
    left = window.innerWidth - POPOVER_WIDTH - margin;
  }
  let top = anchor.bottom + ANCHOR_GAP;
  // Flip above if not enough room below.
  if (top + POPOVER_MAX_HEIGHT > window.innerHeight - margin) {
    const above = anchor.top - POPOVER_MAX_HEIGHT - ANCHOR_GAP;
    if (above >= margin) top = above;
  }
  return { top, left };
}

const AGENT_TYPE_TONES: Record<string, { color: string; bg: string }> = {
  claude: {
    color: 'var(--construct-signal-network)',
    bg: 'var(--construct-signal-network-soft)',
  },
  codex: {
    color: 'var(--construct-status-warning)',
    bg: 'color-mix(in srgb, var(--construct-status-warning) 14%, transparent)',
  },
};

function AgentTypeChip({ type }: { type: string }) {
  const tone = AGENT_TYPE_TONES[type] ?? {
    color: 'var(--pc-text-muted)',
    bg: 'var(--pc-hover)',
  };
  return (
    <span
      className="px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider"
      style={{ background: tone.bg, color: tone.color }}
    >
      {type || 'agent'}
    </span>
  );
}

export default function AgentPicker({
  open,
  onOpenChange,
  value,
  onSelect,
  anchorRect,
}: Props) {
  const { agents, loading } = useAgentRoster();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Reset query + focus input when opened
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    // Focus on next tick so the popover is mounted.
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popoverRef.current && !popoverRef.current.contains(target)) {
        onOpenChange(false);
      }
    };
    // Defer to avoid catching the same click that opened it.
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open, onOpenChange]);

  const filtered = useMemo(() => {
    if (!query) return agents;
    const q = query.toLowerCase();
    return agents.filter(
      (a) =>
        a.item_name.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        (a.role && a.role.toLowerCase().includes(q)) ||
        (a.identity && a.identity.toLowerCase().includes(q)),
    );
  }, [query, agents]);

  // Keep activeIndex within bounds when filter changes
  useEffect(() => {
    if (activeIndex >= filtered.length) setActiveIndex(0);
  }, [filtered.length, activeIndex]);

  const select = (a: AgentDefinition) => {
    onSelect(a.item_name);
    onOpenChange(false);
  };

  const clear = () => {
    onSelect(null);
    onOpenChange(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onOpenChange(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(0, filtered.length - 1)));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const pick = filtered[activeIndex];
      if (pick) select(pick);
    }
  };

  if (!open) return null;

  const position = getPosition(anchorRect);
  const useBackdrop = !anchorRect;

  return (
    <>
      {useBackdrop && (
        <div
          className="fixed inset-0 z-40"
          style={{ background: 'rgba(0,0,0,0.4)' }}
          onClick={() => onOpenChange(false)}
        />
      )}
      <div
        ref={popoverRef}
        className="fixed z-50 rounded-xl shadow-xl flex flex-col"
        style={{
          ...position,
          width: POPOVER_WIDTH,
          maxHeight: POPOVER_MAX_HEIGHT,
          background: 'var(--pc-bg-elevated)',
          border: '1px solid var(--pc-border-strong)',
          boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
        }}
        role="dialog"
        aria-label="Pool agent picker"
      >
        {/* Search */}
        <div
          className="flex items-center gap-2 px-3 py-2 border-b"
          style={{ borderColor: 'var(--pc-border)' }}
        >
          <Search className="h-3.5 w-3.5" style={{ color: 'var(--pc-text-faint)' }} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search pool agents…"
            className="flex-1 bg-transparent border-none outline-none text-sm"
            style={{ color: 'var(--pc-text-primary)' }}
          />
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="p-0.5 rounded hover:opacity-80"
            style={{ color: 'var(--pc-text-faint)' }}
            title="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto py-1">
          {loading ? (
            <div
              className="px-3 py-6 text-center text-xs flex items-center justify-center gap-2"
              style={{ color: 'var(--pc-text-faint)' }}
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading agents…
            </div>
          ) : filtered.length === 0 ? (
            <div
              className="px-3 py-6 text-center text-xs"
              style={{ color: 'var(--pc-text-faint)' }}
            >
              {agents.length === 0 ? 'No pool agents yet.' : 'No matches.'}
            </div>
          ) : (
            filtered.map((agent, idx) => {
              const isActive = idx === activeIndex;
              const isCurrent = value && agent.item_name === value;
              return (
                <button
                  key={agent.kref}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => select(agent)}
                  className="w-full text-left px-3 py-2 flex items-center gap-2 transition-colors"
                  style={{
                    background: isActive ? 'var(--pc-hover-strong)' : 'transparent',
                    color: 'var(--pc-text-primary)',
                  }}
                >
                  <Bot
                    className="h-4 w-4 flex-shrink-0"
                    style={{ color: 'var(--construct-signal-network)' }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-mono font-medium truncate">
                        {agent.item_name}
                      </span>
                      {isCurrent && (
                        <span
                          className="text-[9px] px-1 py-0.5 rounded font-semibold uppercase tracking-wider"
                          style={{
                            background: 'var(--pc-accent-glow)',
                            color: 'var(--pc-accent-light)',
                          }}
                        >
                          current
                        </span>
                      )}
                    </div>
                    {(agent.role || agent.identity) && (
                      <div
                        className="text-[10px] truncate mt-0.5"
                        style={{ color: 'var(--pc-text-faint)' }}
                      >
                        {agent.role}
                        {agent.role && agent.identity ? ' · ' : ''}
                        {agent.identity}
                      </div>
                    )}
                  </div>
                  <AgentTypeChip type={agent.agent_type} />
                </button>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div
          className="border-t px-2 py-1.5 flex items-center justify-between gap-2"
          style={{ borderColor: 'var(--pc-border)' }}
        >
          {value ? (
            <button
              type="button"
              onClick={clear}
              className="text-[10px] font-medium px-2 py-1 rounded inline-flex items-center gap-1"
              style={{ color: 'var(--construct-status-warning)' }}
              title="Clear assignment"
            >
              <X className="h-3 w-3" />
              Clear assignment
            </button>
          ) : (
            <span />
          )}
          <a
            href="/agents"
            className="text-[10px] font-medium px-2 py-1 rounded inline-flex items-center gap-1"
            style={{ color: 'var(--pc-accent-light)' }}
            onClick={() => onOpenChange(false)}
          >
            <Plus className="h-3 w-3" />
            Create pool agent →
          </a>
        </div>
      </div>
    </>
  );
}
