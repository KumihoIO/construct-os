import { Handle, Position, type NodeTypes } from '@xyflow/react';
import { getRoleColor } from './graphHelpers';

export interface AgentNodeData {
  label: string;
  role: string;
  agentType: string;
  identity: string;
  kref: string;
  [key: string]: unknown;
}

function AgentNode({ data }: { data: AgentNodeData }) {
  const borderColor = getRoleColor(data.role);

  return (
    <div
      className="px-4 py-3 rounded-xl shadow-lg"
      style={{
        background: 'var(--pc-bg-elevated)',
        border: `2px solid ${borderColor}`,
        minWidth: 180,
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: borderColor }} />
      <div className="text-sm font-bold" style={{ color: 'var(--pc-text-primary)' }}>
        {data.label}
      </div>
      <div
        className="text-xs mt-1 line-clamp-2"
        style={{ color: 'var(--pc-text-muted)', maxWidth: 200 }}
      >
        {data.identity}
      </div>
      <div className="flex gap-1 mt-2">
        <span
          className="px-1.5 py-0.5 rounded text-[10px] font-medium"
          style={{ background: borderColor + '22', color: borderColor }}
        >
          {data.role}
        </span>
        <span
          className="px-1.5 py-0.5 rounded text-[10px] font-medium"
          style={{
            background: 'var(--pc-hover)',
            color: 'var(--pc-text-secondary)',
          }}
        >
          {data.agentType}
        </span>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: borderColor }} />
    </div>
  );
}

export const nodeTypes: NodeTypes = {
  agentNode: AgentNode,
};

export default AgentNode;
