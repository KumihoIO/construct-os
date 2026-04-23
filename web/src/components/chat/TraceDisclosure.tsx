import { useState } from 'react';
import { ChevronDown, ChevronRight, Brain, Wrench } from 'lucide-react';
import type { ActivityEvent } from './types';

// ---------------------------------------------------------------------------
// Collapsible thinking trace — inspired by Paseo's ExpandableBadge pattern.
// Shows a compact badge that expands to reveal full reasoning or tool trace.
// ---------------------------------------------------------------------------

interface TraceDisclosureProps {
  /** Section label shown on the badge. */
  label: string;
  /** Number of items (shown as count badge). */
  count?: number;
  /** Badge accent color. */
  color?: string;
  /** Icon displayed before label. */
  icon?: React.ReactNode;
  children: React.ReactNode;
  /** Start expanded. */
  defaultOpen?: boolean;
}

export function TraceDisclosure({ label, count, color = 'var(--pc-text-muted)', icon, children, defaultOpen = false }: TraceDisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="mt-2 border-t" style={{ borderColor: 'var(--pc-border)' }}>
      <button
        className="flex items-center gap-1.5 w-full pt-1.5 text-xs cursor-pointer select-none"
        style={{ color, background: 'none', border: 'none', padding: '6px 0 2px', font: 'inherit' }}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {icon}
        <span>{label}</span>
        {count != null && (
          <span
            className="px-1.5 py-0.5 rounded-full text-[10px] font-medium"
            style={{ background: `color-mix(in srgb, ${color} 15%, transparent)`, color }}
          >
            {count}
          </span>
        )}
        {open
          ? <ChevronDown className="h-3 w-3 ml-auto flex-shrink-0" style={{ color: 'var(--pc-text-muted)' }} />
          : <ChevronRight className="h-3 w-3 ml-auto flex-shrink-0" style={{ color: 'var(--pc-text-muted)' }} />
        }
      </button>
      {open && (
        <div className="mt-1 animate-fade-in">
          {children}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pre-built disclosure variants
// ---------------------------------------------------------------------------

/** Collapsed thinking trace shown on agent messages. */
export function ThinkingTrace({ thinking }: { thinking: string }) {
  return (
    <TraceDisclosure
      label="Thinking"
      icon={<Brain className="h-3 w-3" />}
      color="var(--pc-text-muted)"
    >
      <pre
        className="text-xs whitespace-pre-wrap break-words leading-relaxed overflow-auto max-h-60 p-2 rounded-lg"
        style={{ color: 'var(--pc-text-muted)', background: 'var(--pc-bg-surface)' }}
      >
        {thinking}
      </pre>
    </TraceDisclosure>
  );
}

/** Collapsed operator activity log shown on agent messages. */
export function OperatorTrace({ events }: { events: ActivityEvent[] }) {
  return (
    <TraceDisclosure
      label="Operator activity"
      count={events.length}
      icon={<Wrench className="h-3 w-3" />}
      color="#8b5cf6"
    >
      <div className="space-y-0.5 text-xs" style={{ color: 'var(--pc-text-muted)' }}>
        {events.map((evt) => (
          <div key={evt.id} className="flex items-center gap-1.5 py-0.5">
            <span>{evt.label}</span>
          </div>
        ))}
      </div>
    </TraceDisclosure>
  );
}
