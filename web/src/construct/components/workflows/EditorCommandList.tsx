/**
 * EditorCommandList — empty-canvas overlay for the workflow editor.
 *
 * Shows the Construct lockup and three primary actions with keyboard shortcuts:
 *   ⌘K — Add Step
 *   ⌘I — Import YAML
 *   ⌘G — Generate from prompt (disabled, P2)
 */

import { Plus, FileUp, Sparkles } from 'lucide-react';
import { appAssetPath } from '@/lib/basePath';

interface Props {
  onAddStep: () => void;
  onImportYaml: () => void;
  /** Mac vs non-mac shortcut prefix; default detects from navigator. */
  modKey?: string;
}

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

function ShortcutChip({ keys }: { keys: string[] }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {keys.map((k) => (
        <kbd
          key={k}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 22,
            height: 22,
            padding: '0 6px',
            borderRadius: 6,
            border: '1px solid var(--construct-border-soft)',
            background: 'var(--pc-bg-input)',
            color: 'var(--construct-text-secondary)',
            fontFamily: 'var(--pc-font-mono, ui-monospace, monospace)',
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}

export default function EditorCommandList({ onAddStep, onImportYaml, modKey }: Props) {
  const mod = modKey ?? (isMac ? '⌘' : 'Ctrl');

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 18,
          maxWidth: 360,
          padding: '24px 28px',
          pointerEvents: 'auto',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <img
            src={appAssetPath('construct-trans.png')}
            alt="Construct"
            style={{
              height: 56,
              width: 56,
              borderRadius: 14,
              objectFit: 'cover',
              opacity: 0.85,
            }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
          <div className="construct-kicker" style={{ letterSpacing: '0.24em' }}>
            Workflow Editor
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>
          <button
            type="button"
            onClick={onAddStep}
            style={commandRowStyle()}
          >
            <span style={iconWrapStyle()}>
              <Plus size={14} />
            </span>
            <span style={{ flex: 1, textAlign: 'left' }}>Add Step</span>
            <ShortcutChip keys={[mod, 'K']} />
          </button>

          <button
            type="button"
            onClick={onImportYaml}
            style={commandRowStyle()}
          >
            <span style={iconWrapStyle()}>
              <FileUp size={14} />
            </span>
            <span style={{ flex: 1, textAlign: 'left' }}>Import YAML</span>
            <ShortcutChip keys={[mod, 'I']} />
          </button>

          <button
            type="button"
            disabled
            title="Coming with Operator copilot (P2)"
            style={{
              ...commandRowStyle(),
              opacity: 0.5,
              cursor: 'not-allowed',
            }}
          >
            <span style={iconWrapStyle()}>
              <Sparkles size={14} />
            </span>
            <span style={{ flex: 1, textAlign: 'left' }}>Generate from prompt</span>
            <span
              style={{
                fontSize: 10,
                color: 'var(--construct-text-faint)',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
              }}
            >
              soon
            </span>
          </button>
        </div>

        <p
          style={{
            fontSize: 11,
            color: 'var(--construct-text-faint)',
            textAlign: 'center',
            lineHeight: 1.5,
          }}
        >
          Right-click the canvas for more actions, or drag a noodle from a node into empty space to insert and wire a step.
        </p>
      </div>
    </div>
  );
}

function commandRowStyle(): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 12px',
    borderRadius: 10,
    border: '1px solid var(--construct-border-soft)',
    background: 'color-mix(in srgb, var(--construct-bg-panel-strong) 78%, transparent)',
    color: 'var(--construct-text-secondary)',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'border-color 0.15s ease, color 0.15s ease, background 0.15s ease',
  };
}

function iconWrapStyle(): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 22,
    height: 22,
    borderRadius: 6,
    background: 'var(--pc-accent-glow)',
    color: 'var(--pc-accent)',
    flexShrink: 0,
  };
}
