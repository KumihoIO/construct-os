import { Handle, Position, type NodeTypes } from '@xyflow/react';
import type { AgentNodeData } from '@/components/teams/AgentNode';
import { getRoleColor } from '@/construct/lib/graphHelpers';

function TeamNode({ data, selected }: { data: AgentNodeData; selected?: boolean }) {
  const accent = getRoleColor(data.role);

  return (
    <div
      className="rounded-[14px] border px-4 py-3 shadow-sm"
      style={{
        minWidth: 200,
        maxWidth: 240,
        borderColor: selected ? accent : 'color-mix(in srgb, var(--construct-border-soft) 75%, transparent)',
        background: selected
          ? `linear-gradient(135deg, color-mix(in srgb, ${accent} var(--construct-node-accent-selected), transparent), transparent 78%), var(--construct-bg-panel-strong)`
          : `linear-gradient(180deg, color-mix(in srgb, ${accent} var(--construct-node-accent-idle), transparent), transparent 42%), var(--construct-bg-panel-strong)`,
        boxShadow: selected ? `0 0 0 1px ${accent}, 0 0 26px color-mix(in srgb, ${accent} 24%, transparent)` : 'var(--construct-shadow-panel)',
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: accent, width: 9, height: 9 }} />
      <div className="truncate text-sm font-semibold" style={{ color: 'var(--construct-text-primary)' }}>
        {data.label}
      </div>
      <p className="mt-2 line-clamp-2 text-[11px] leading-5" style={{ color: 'var(--construct-text-secondary)' }}>
        {data.identity}
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="rounded-md px-1.5 py-0.5 text-[10px] font-medium" style={{ background: 'color-mix(in srgb, var(--construct-bg-elevated) 85%, transparent)', color: accent }}>
          {data.role}
        </span>
        <span className="rounded-md px-1.5 py-0.5 text-[10px] font-medium" style={{ background: 'var(--construct-signal-network-soft)', color: 'var(--construct-signal-network)' }}>
          {data.agentType}
        </span>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: accent, width: 9, height: 9 }} />
    </div>
  );
}

export const teamNodeTypesV2: NodeTypes = {
  agentNode: TeamNode,
};
