/**
 * AgentPicker — cmdk-powered popover for choosing a pool agent.
 *
 * Used in two surfaces:
 *   1. Anchored — opened from the canvas TaskNode badge or the side-panel
 *      field button. `anchorRect` positions the popover ~8px below the
 *      anchor's bottom, right-aligned to the anchor's right edge, clamped
 *      to viewport.
 *   2. Centered — when `anchorRect` is null/undefined, renders as a small
 *      centered modal (used as the auto-open fallback after creating a
 *      new agent step).
 *
 * Shares the editor-session agent roster via useAgentRoster() so the second
 * open never re-hits the API.
 */

import { Command } from 'cmdk';
import { Bot, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAgentRoster } from './useAgentRoster';
import NewPoolAgentModal from './NewPoolAgentModal';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Current task.assign — passed in to highlight + show "Clear" button. */
  value?: string;
  /** Callback with the selected pool-agent item_name, or null to clear. */
  onSelect: (name: string | null) => void;
  /**
   * Bounding rect of the trigger element. When provided, popover is
   * positioned anchored to it. When null/undefined, renders centered.
   */
  anchorRect?: DOMRect | null;
}

const POPOVER_WIDTH = 340;
const POPOVER_MAX_HEIGHT = 360;
const ANCHOR_GAP = 8;
const PICKER_BACKDROP_Z = 9000;
const PICKER_PANEL_Z = 9001;

function computeAnchoredStyle(rect: DOMRect): React.CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const top = Math.min(rect.bottom + ANCHOR_GAP, vh - POPOVER_MAX_HEIGHT - 8);
  const right = Math.max(8, vw - rect.right);
  return {
    position: 'fixed',
    top: Math.max(8, top),
    right,
    width: POPOVER_WIDTH,
    maxHeight: POPOVER_MAX_HEIGHT,
  };
}

function centeredStyle(): React.CSSProperties {
  return {
    position: 'fixed',
    top: '20vh',
    left: '50%',
    transform: 'translateX(-50%)',
    width: POPOVER_WIDTH,
    maxHeight: POPOVER_MAX_HEIGHT,
  };
}

export default function AgentPicker({
  open,
  onOpenChange,
  value,
  onSelect,
  anchorRect,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { agents, loading, refresh } = useAgentRoster();
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  // Autofocus the search input on open. Reset search each open.
  useEffect(() => {
    if (open) {
      setSearch('');
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onOpenChange(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onOpenChange]);

  const popoverStyle = useMemo<React.CSSProperties>(() => {
    if (anchorRect) return computeAnchoredStyle(anchorRect);
    return centeredStyle();
  }, [anchorRect]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const handlePick = (name: string | null) => {
    onSelect(name);
    onOpenChange(false);
  };

  const content = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Choose pool agent"
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: PICKER_BACKDROP_Z,
        background: 'transparent',
      }}
    >
      <div
        className="construct-panel"
        data-variant="primary"
        style={{
          ...popoverStyle,
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 12,
          borderColor: 'var(--construct-border-strong)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.36)',
          overflow: 'hidden',
          zIndex: PICKER_PANEL_Z,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <Command label="Choose pool agent" loop shouldFilter>
          {/* Search input */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 12px',
              borderBottom: '1px solid var(--construct-border-soft)',
            }}
          >
            <Search size={14} style={{ color: 'var(--construct-text-faint)' }} />
            <Command.Input
              ref={inputRef}
              value={search}
              onValueChange={setSearch}
              placeholder="Search pool agents…"
              style={{
                flex: 1,
                background: 'transparent',
                border: 0,
                outline: 'none',
                color: 'var(--construct-text-primary)',
                fontSize: 13,
              }}
            />
            <kbd
              className="construct-kbd"
              style={{
                fontSize: 10,
                padding: '2px 6px',
                borderRadius: 6,
                color: 'var(--construct-text-faint)',
                background: 'var(--pc-bg-input)',
                border: '1px solid var(--construct-border-soft)',
              }}
            >
              ESC
            </kbd>
          </div>

          {/* List body */}
          <Command.List
            style={{
              flex: 1,
              maxHeight: 240,
              overflowY: 'auto',
              padding: '6px',
            }}
          >
            <Command.Empty
              style={{
                padding: '20px 16px',
                textAlign: 'center',
                fontSize: 12,
                color: 'var(--construct-text-faint)',
              }}
            >
              {loading ? 'Loading agents…' : 'No agents match'}
            </Command.Empty>

            {agents.map((agent) => {
              const isSelected = value === agent.item_name;
              return (
                <Command.Item
                  key={agent.kref}
                  value={`${agent.item_name} ${agent.name} ${agent.role} ${agent.agent_type}`}
                  keywords={[
                    agent.agent_type,
                    agent.role,
                    ...(agent.expertise ?? []),
                  ]}
                  onSelect={() => handlePick(agent.item_name)}
                  // Direct click handler — cmdk's internal `onSelect` is
                  // unreliable on mouse-click in the React 19 + cmdk 1.1 +
                  // portal combination this picker uses (keyboard / Enter
                  // path still works via `onSelect`).  Without this fallback
                  // the canvas badge silently fails to update when an agent
                  // is clicked in the popover.
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handlePick(agent.item_name);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 10px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    color: 'var(--construct-text-primary)',
                  }}
                >
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 24,
                      height: 24,
                      borderRadius: 6,
                      background: isSelected
                        ? 'var(--construct-signal-network-soft)'
                        : 'color-mix(in srgb, var(--pc-accent-glow) 60%, transparent)',
                      color: isSelected
                        ? 'var(--construct-signal-network)'
                        : 'var(--pc-accent)',
                      flexShrink: 0,
                    }}
                  >
                    <Bot size={13} />
                  </span>
                  <span
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      minWidth: 0,
                      flex: 1,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 12.5,
                        fontWeight: 600,
                        fontFamily: 'var(--pc-font-mono, ui-monospace, monospace)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {agent.item_name}
                    </span>
                    {agent.identity && (
                      <span
                        style={{
                          fontSize: 10.5,
                          color: 'var(--construct-text-secondary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {agent.identity}
                      </span>
                    )}
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--pc-font-mono, ui-monospace, monospace)',
                      fontSize: 9.5,
                      padding: '2px 6px',
                      borderRadius: 4,
                      background: 'var(--pc-hover)',
                      color: 'var(--construct-text-faint)',
                      flexShrink: 0,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    {agent.agent_type}
                  </span>
                </Command.Item>
              );
            })}
          </Command.List>

          {/* Clear assignment */}
          {value && (
            <button
              type="button"
              onClick={() => handlePick(null)}
              style={{
                margin: '0 8px 8px',
                padding: '6px 10px',
                fontSize: 11,
                fontWeight: 600,
                borderRadius: 6,
                border: '1px solid var(--construct-status-warning)',
                background: 'color-mix(in srgb, var(--construct-status-warning) 14%, transparent)',
                color: 'var(--construct-status-warning)',
                cursor: 'pointer',
              }}
            >
              Clear assignment
            </button>
          )}

          {/* Footer */}
          <div
            style={{
              padding: '8px 12px',
              borderTop: '1px solid var(--construct-border-soft)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: 11,
              color: 'var(--construct-text-faint)',
            }}
          >
            <span>{agents.length} agent{agents.length === 1 ? '' : 's'}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              <a
                href="/agents"
                target="_blank"
                rel="noreferrer"
                style={{
                  color: 'var(--construct-text-faint)',
                  textDecoration: 'none',
                  fontWeight: 500,
                }}
              >
                Open agents page →
              </a>
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                style={{
                  background: 'transparent',
                  border: 0,
                  padding: 0,
                  cursor: 'pointer',
                  color: 'var(--pc-accent)',
                  fontWeight: 600,
                  fontSize: 11,
                }}
              >
                + New pool agent
              </button>
            </span>
          </div>
        </Command>
      </div>

      <style>{`
        [cmdk-item][data-selected='true'] {
          background: var(--pc-accent-glow);
          box-shadow: inset 2px 0 0 var(--pc-accent);
        }
        [cmdk-item]:hover {
          background: var(--pc-hover);
        }
      `}</style>
    </div>
  );

  // Portal to body so position:fixed escapes any ancestor with
  // transform/filter/will-change that would otherwise become the
  // containing block and clip the popover behind the side panel.
  return (
    <>
      {createPortal(content, document.body)}
      <NewPoolAgentModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={async (agent) => {
          await refresh();
          setCreateOpen(false);
          handlePick(agent.item_name);
        }}
      />
    </>
  );
}
