import { Handle, Position, type NodeTypes } from '@xyflow/react';
import type { StepNodeData } from './yamlSync';

// ---------------------------------------------------------------------------
// Action → color mapping
// ---------------------------------------------------------------------------

const ACTION_COLORS: Record<string, string> = {
  code: 'var(--pc-accent)',
  review: '#a855f7',
  research: '#22c55e',
  deploy: '#f97316',
  test: '#06b6d4',
  build: '#eab308',
  notify: '#ec4899',
  approve: '#8b5cf6',
  summarize: '#14b8a6',
  greet: '#60a5fa',
};

const DEFAULT_ACTION_COLOR = '#6b7280';

function getActionColor(action: string): string {
  const key = action.toLowerCase().replace(/[^a-z]/g, '');
  for (const [prefix, color] of Object.entries(ACTION_COLORS)) {
    if (key.startsWith(prefix) || key.includes(prefix)) return color;
  }
  return DEFAULT_ACTION_COLOR;
}

// ---------------------------------------------------------------------------
// StepNode component
// ---------------------------------------------------------------------------

function StepNode({ data }: { data: StepNodeData }) {
  const color = getActionColor(data.type);

  return (
    <div
      className="px-4 py-3 rounded-xl shadow-lg"
      style={{
        position: 'relative',
        background: 'var(--pc-bg-elevated)',
        border: `2px solid ${color}`,
        minWidth: 200,
        maxWidth: 260,
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: color }} />

      {/* Step ID */}
      <div className="text-sm font-bold" style={{ color: 'var(--pc-text-primary)' }}>
        {data.label}
      </div>

      {/* Action */}
      <div className="flex items-center gap-1.5 mt-1.5">
        <span
          className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider"
          style={{ background: color + '22', color }}
        >
          {data.type}
        </span>
        {data.paramCount > 0 && (
          <span
            className="px-1.5 py-0.5 rounded text-[10px] font-medium"
            style={{ background: 'var(--pc-hover)', color: 'var(--pc-text-secondary)' }}
          >
            {data.paramCount} param{data.paramCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Agent assignment */}
      {data.agent && (
        <div
          className="text-[11px] mt-1.5 truncate"
          style={{ color: 'var(--pc-text-muted)', maxWidth: 220 }}
        >
          agent: {data.agent.replace(/^kref:\/\//, '').split('/').pop()}
        </div>
      )}

      {/* Dependency indicator */}
      {data.dependencyCount > 0 && (
        <div className="text-[10px] mt-1" style={{ color: 'var(--pc-text-faint)' }}>
          {data.dependencyCount} dep{data.dependencyCount !== 1 ? 's' : ''}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} style={{ background: color }} />
    </div>
  );
}

export const nodeTypes: NodeTypes = {
  stepNode: StepNode,
};

export default StepNode;
