import { Handle, Position, type NodeTypes } from '@xyflow/react';
import { Bot } from 'lucide-react';
import { ACTION_TO_TYPE, type TaskNodeData } from './yamlSync';

// Action → color mapping
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
  human_input: '#f59e0b',
  task: '#6b7280',
  // Executor step types
  agent: '#3b82f6',
  parallel: '#8b5cf6',
  shell: '#64748b',
  goto: '#f59e0b',
  output: '#14b8a6',
  conditional: '#eab308',
  group_chat: '#ec4899',
  supervisor: '#f97316',
  map_reduce: '#06b6d4',
  handoff: '#a78bfa',
  a2a: '#34d399',
  resolve: '#818cf8',
  for_each: '#10b981',
};

// Resolved colors for gradient (can't mix css vars in gradients reliably)
const ACTION_RESOLVED: Record<string, string> = {
  code: '#00b4d8',
  review: '#a855f7',
  research: '#22c55e',
  deploy: '#f97316',
  test: '#06b6d4',
  build: '#eab308',
  notify: '#ec4899',
  approve: '#8b5cf6',
  summarize: '#14b8a6',
  greet: '#60a5fa',
  human_input: '#f59e0b',
  task: '#6b7280',
  // Executor step types
  agent: '#3b82f6',
  parallel: '#8b5cf6',
  shell: '#64748b',
  goto: '#f59e0b',
  output: '#14b8a6',
  conditional: '#eab308',
  group_chat: '#ec4899',
  supervisor: '#f97316',
  map_reduce: '#06b6d4',
  handoff: '#a78bfa',
  a2a: '#34d399',
  resolve: '#818cf8',
  for_each: '#10b981',
};

function getActionColor(action: string): string {
  const key = action.toLowerCase().replace(/[^a-z]/g, '');
  for (const [prefix, color] of Object.entries(ACTION_COLORS)) {
    if (key.startsWith(prefix) || key.includes(prefix)) return color;
  }
  return '#6b7280';
}

function getResolvedColor(action: string): string {
  const key = action.toLowerCase().replace(/[^a-z]/g, '');
  for (const [prefix, color] of Object.entries(ACTION_RESOLVED)) {
    if (key.startsWith(prefix) || key.includes(prefix)) return color;
  }
  return '#6b7280';
}

// Agent hint colors
const HINT_COLORS: Record<string, string> = {
  coder: 'var(--pc-accent)',
  researcher: '#22c55e',
  reviewer: '#a855f7',
};

// Run status colors
const STATUS_COLORS: Record<string, string> = {
  completed: '#22c55e',
  running: '#eab308',
  failed: '#ef4444',
  pending: '#6b7280',
  skipped: '#6b7280',
};

// Agent type badge colors
const AGENT_TYPE_COLORS: Record<string, string> = {
  claude: '#a855f7',
  codex: '#f97316',
};

function TaskNode({ data, selected }: { data: TaskNodeData; selected?: boolean }) {
  const color = getActionColor(data.action);
  const resolved = getResolvedColor(data.action);

  return (
    <div
      className="px-4 py-3 rounded-xl shadow-lg transition-all"
      style={{
        position: 'relative',
        background: selected
          ? `linear-gradient(135deg, ${resolved}30 0%, ${resolved}18 40%, rgba(20,20,30,0.95) 100%)`
          : `linear-gradient(135deg, ${resolved}12 0%, rgba(30,30,40,0.98) 50%, rgba(20,20,30,0.95) 100%)`,
        border: `2px solid ${selected ? resolved : resolved + '60'}`,
        minWidth: 220,
        maxWidth: 280,
        boxShadow: selected
          ? `0 0 20px ${resolved}30, inset 0 1px 0 ${resolved}20`
          : `0 4px 12px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.04)`,
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: color, width: 10, height: 10 }} />

      {/* Task name */}
      <div className="text-sm font-bold truncate" style={{ color: selected ? '#fff' : 'var(--pc-text-primary)' }}>
        {data.name || data.taskId}
      </div>

      {/* Action badge */}
      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
        <span
          className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider"
          style={{ background: color + '22', color }}
        >
          {data.action}
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

      {/* Description preview */}
      {data.description && (
        <div
          className="text-[11px] mt-1.5 line-clamp-2"
          style={{ color: 'var(--pc-text-muted)', lineHeight: '1.3' }}
        >
          {data.description}
        </div>
      )}

      {/* Assigned pool agent — clickable to open picker */}
      {!data.runInfo && (data.assign || ACTION_TO_TYPE[data.action] === 'agent') && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            window.dispatchEvent(
              new CustomEvent('construct:open-agent-picker', {
                detail: { taskId: data.taskId, anchorRect: rect },
              }),
            );
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          className="mt-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold truncate inline-flex items-center gap-1 cursor-pointer transition-colors"
          style={{
            background: data.assign
              ? 'var(--construct-signal-network-soft)'
              : 'color-mix(in srgb, var(--construct-status-warning) 12%, transparent)',
            color: data.assign
              ? 'var(--construct-signal-network)'
              : 'var(--construct-status-warning)',
            border: data.assign
              ? '1px solid color-mix(in srgb, var(--construct-signal-network) 28%, transparent)'
              : '1px solid color-mix(in srgb, var(--construct-status-warning) 28%, transparent)',
            maxWidth: '100%',
          }}
          title={data.assign ? `Assigned: ${data.assign} (click to change)` : 'Click to assign a pool agent'}
        >
          <Bot className="h-2.5 w-2.5 flex-shrink-0" />
          <span className="truncate">{data.assign || 'Unassigned'}</span>
        </button>
      )}

      {/* Agent hints */}
      {data.agentHints.length > 0 && (
        <div className="flex gap-1 mt-1.5 flex-wrap">
          {data.agentHints.map((hint) => (
            <span
              key={hint}
              className="px-1.5 py-0.5 rounded text-[9px] font-medium"
              style={{
                background: (HINT_COLORS[hint] || '#6b7280') + '18',
                color: HINT_COLORS[hint] || '#6b7280',
              }}
            >
              {hint}
            </span>
          ))}
        </div>
      )}

      {/* Skills */}
      {data.skills.length > 0 && (
        <div className="flex gap-1 mt-1 flex-wrap">
          {data.skills.slice(0, 3).map((skill) => {
            // Show just the skill name, not the full kref path
            const short = skill.replace(/^kref:\/\/.*\//, '').replace(/\.skilldef$/, '');
            return (
              <span
                key={skill}
                className="px-1.5 py-0.5 rounded text-[9px] font-medium truncate"
                style={{ background: 'var(--pc-accent-glow)', color: 'var(--pc-accent-light)', maxWidth: '100%' }}
                title={skill}
              >
                {short}
              </span>
            );
          })}
          {data.skills.length > 3 && (
            <span
              className="px-1.5 py-0.5 rounded text-[9px] font-medium"
              style={{ background: 'var(--pc-hover)', color: 'var(--pc-text-faint)' }}
            >
              +{data.skills.length - 3}
            </span>
          )}
        </div>
      )}

      {/* Run info overlay — shown when viewing a workflow run */}
      {data.runInfo && (
        <div className="mt-2 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* Status badge */}
            <span
              className="px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider"
              style={{
                background: (STATUS_COLORS[data.runInfo.status] || '#6b7280') + '22',
                color: STATUS_COLORS[data.runInfo.status] || '#6b7280',
              }}
            >
              {data.runInfo.status}
            </span>
            {/* Agent type badge */}
            {data.runInfo.agent_type && (
              <span
                className="px-1.5 py-0.5 rounded text-[9px] font-medium"
                style={{
                  background: (AGENT_TYPE_COLORS[data.runInfo.agent_type] || '#6b7280') + '18',
                  color: AGENT_TYPE_COLORS[data.runInfo.agent_type] || '#6b7280',
                }}
              >
                {data.runInfo.agent_type}
              </span>
            )}
            {/* Role badge */}
            {data.runInfo.role && (
              <span
                className="px-1.5 py-0.5 rounded text-[9px] font-medium"
                style={{
                  background: (HINT_COLORS[data.runInfo.role] || '#6b7280') + '18',
                  color: HINT_COLORS[data.runInfo.role] || '#6b7280',
                }}
              >
                {data.runInfo.role}
              </span>
            )}
          </div>
          {/* Pool agent (assigned template) — prominent badge */}
          {data.runInfo.template_name && (
            <div
              className="mt-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold truncate inline-flex items-center gap-1"
              style={{
                background: 'rgba(99,102,241,0.15)',
                color: '#818cf8',
                border: '1px solid rgba(99,102,241,0.25)',
                maxWidth: '100%',
              }}
              title={`Pool Agent: ${data.runInfo.template_name}`}
            >
              <span style={{ fontSize: '8px' }}>●</span>
              {data.runInfo.template_name}
            </div>
          )}
          {/* Agent ID — shown when agent is running or completed */}
          {data.runInfo.agent_id && (
            <div
              className="text-[8px] mt-1 font-mono truncate"
              style={{ color: 'var(--pc-text-faint)', letterSpacing: '0.02em' }}
              title={data.runInfo.agent_id}
            >
              id:{data.runInfo.agent_id.slice(0, 12)}
            </div>
          )}
          {/* Skills — shown with active indicator during execution */}
          {data.runInfo.skills && data.runInfo.skills.length > 0 && (
            <div className="flex gap-1 mt-1.5 flex-wrap">
              {data.runInfo.skills.slice(0, 3).map((skill) => (
                <span
                  key={skill}
                  className="px-1.5 py-0.5 rounded text-[8px] font-medium inline-flex items-center gap-0.5"
                  style={{
                    background: data.runInfo!.status === 'running'
                      ? 'rgba(34,211,238,0.18)'
                      : data.runInfo!.status === 'completed'
                        ? 'rgba(52,211,153,0.15)'
                        : 'var(--pc-accent-glow)',
                    color: data.runInfo!.status === 'running'
                      ? '#22d3ee'
                      : data.runInfo!.status === 'completed'
                        ? '#34d399'
                        : 'var(--pc-accent-light)',
                  }}
                >
                  {data.runInfo!.status === 'running' && (
                    <span
                      className="inline-block h-1 w-1 rounded-full"
                      style={{ background: '#22d3ee', animation: 'pulse-dot 1.5s ease-in-out infinite' }}
                    />
                  )}
                  {data.runInfo!.status === 'completed' && (
                    <span style={{ fontSize: '7px' }}>✓</span>
                  )}
                  {skill}
                </span>
              ))}
              {data.runInfo.skills.length > 3 && (
                <span
                  className="px-1.5 py-0.5 rounded text-[8px] font-medium"
                  style={{ background: 'var(--pc-hover)', color: 'var(--pc-text-faint)' }}
                >
                  +{data.runInfo.skills.length - 3}
                </span>
              )}
            </div>
          )}
          {/* Duration + Trust score */}
          <div className="flex items-center gap-2 mt-1">
            {data.runInfo.duration_s != null && data.runInfo.duration_s > 0 && (
              <span className="text-[9px]" style={{ color: 'var(--pc-text-faint)' }}>
                {data.runInfo.duration_s < 60
                  ? `${data.runInfo.duration_s.toFixed(1)}s`
                  : `${(data.runInfo.duration_s / 60).toFixed(1)}m`}
              </span>
            )}
            {data.runInfo.trust_score != null && (
              <span
                className="text-[9px] font-medium"
                style={{
                  color: data.runInfo.trust_score >= 0.8 ? '#34d399'
                    : data.runInfo.trust_score >= 0.5 ? '#eab308'
                    : '#f87171',
                }}
              >
                trust {(data.runInfo.trust_score * 100).toFixed(0)}%
              </span>
            )}
          </div>
        </div>
      )}

      <Handle type="source" position={Position.Bottom} style={{ background: color, width: 10, height: 10 }} />
    </div>
  );
}

export const taskNodeTypes: NodeTypes = {
  taskNode: TaskNode,
};

export default TaskNode;
