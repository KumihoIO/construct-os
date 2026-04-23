import { useState, useCallback, useEffect, useMemo } from 'react';
import { Trash2, X, Sparkles, Search, Loader2 } from 'lucide-react';
import type { Node } from '@xyflow/react';
import { ACTION_TO_TYPE, type TaskNodeData } from './yamlSync';
import type { SkillDefinition, AgentDefinition } from '@/types/api';
import { fetchSkills, fetchAgents, getChannels } from '@/lib/api';

const AGENT_HINT_OPTIONS = ['coder', 'researcher', 'reviewer'];

const ACTION_OPTIONS = [
  'task', 'code', 'review', 'research', 'deploy', 'test',
  'build', 'notify', 'approve', 'summarize', 'human_input',
];

const EXECUTOR_STEP_TYPES = [
  'agent', 'parallel', 'for_each', 'shell', 'goto', 'output', 'conditional',
  'human_approval', 'human_input', 'group_chat', 'supervisor', 'map_reduce',
  'handoff', 'a2a', 'resolve',
];


export default function TaskSidePanel({
  node,
  onUpdate,
  onDelete,
}: {
  node: Node<TaskNodeData>;
  onUpdate: (nodeId: string, updates: Partial<TaskNodeData>) => void;
  onDelete: (nodeId: string) => void;
}) {
  const data = node.data;
  /** Resolved executor step type — maps friendly actions (code, research…) to their executor type (agent) */
  const stepType = ACTION_TO_TYPE[data.action] || 'agent';
  const [skillSearch, setSkillSearch] = useState('');
  const [showSkillPicker, setShowSkillPicker] = useState(false);
  const [allSkills, setAllSkills] = useState<SkillDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [channelOptions, setChannelOptions] = useState<string[]>(['dashboard']);
  const [poolAgents, setPoolAgents] = useState<AgentDefinition[]>([]);
  const [poolSearch, setPoolSearch] = useState('');
  const [showPoolPicker, setShowPoolPicker] = useState(false);
  const [poolLoading, setPoolLoading] = useState(false);

  // Load active channels for human_input / notify actions
  useEffect(() => {
    if (stepType !== 'human_input' && stepType !== 'notify' && stepType !== 'human_approval') return;
    getChannels()
      .then((channels) => {
        const active = channels
          .filter((ch) => ch.enabled && ch.status === 'active')
          .map((ch) => ch.name);
        // Always include 'dashboard' as a channel option
        const options = Array.from(new Set(['dashboard', ...active]));
        setChannelOptions(options);
      })
      .catch(() => setChannelOptions(['dashboard']));
  }, [stepType]);

  // Load all skills once when the picker opens
  useEffect(() => {
    if (!showSkillPicker || allSkills.length > 0) return;
    setLoading(true);
    fetchSkills(false, 1, 50)
      .then((data) => setAllSkills(data.skills))
      .catch(() => setAllSkills([]))
      .finally(() => setLoading(false));
  }, [showSkillPicker, allSkills.length]);

  // Load pool agents lazily when Agent Config is visible
  useEffect(() => {
    if (stepType !== 'agent' || poolAgents.length > 0) return;
    setPoolLoading(true);
    fetchAgents(false, 1, 100)
      .then((res) => setPoolAgents(res.agents))
      .catch(() => setPoolAgents([]))
      .finally(() => setPoolLoading(false));
  }, [stepType, poolAgents.length]);

  // Filter pool agents by search
  const filteredPoolAgents = useMemo(() => {
    if (!poolSearch) return poolAgents;
    const q = poolSearch.toLowerCase();
    return poolAgents.filter(
      (a) =>
        a.item_name.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        a.role.toLowerCase().includes(q) ||
        (a.identity && a.identity.toLowerCase().includes(q)),
    );
  }, [poolSearch, poolAgents]);

  // Instant client-side filtering
  const searchResults = useMemo(() => {
    const assigned = new Set(data.skills);
    const available = allSkills.filter((s) => !assigned.has(s.name));
    if (!skillSearch) return available;
    const q = skillSearch.toLowerCase();
    return available.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.description && s.description.toLowerCase().includes(q)) ||
        (s.domain && s.domain.toLowerCase().includes(q)),
    );
  }, [skillSearch, data.skills, allSkills]);

  const toggleHint = useCallback(
    (hint: string) => {
      const current = data.agentHints;
      const next = current.includes(hint)
        ? current.filter((h) => h !== hint)
        : [...current, hint];
      onUpdate(node.id, { agentHints: next });
    },
    [node.id, data.agentHints, onUpdate],
  );

  const addSkill = useCallback(
    (skillName: string) => {
      if (!data.skills.includes(skillName)) {
        onUpdate(node.id, { skills: [...data.skills, skillName] });
      }
    },
    [node.id, data.skills, onUpdate],
  );

  const removeSkill = useCallback(
    (skillName: string) => {
      onUpdate(node.id, { skills: data.skills.filter((s) => s !== skillName) });
    },
    [node.id, data.skills, onUpdate],
  );

  const toggleChannel = useCallback(
    (ch: string) => {
      const current = data.channels ?? [];
      const next = current.includes(ch)
        ? current.filter((c) => c !== ch)
        : [...current, ch];
      onUpdate(node.id, { channels: next });
    },
    [node.id, data.channels, onUpdate],
  );

  return (
    <div
      className="w-80 flex-shrink-0 border-l flex flex-col animate-fade-in overflow-y-auto"
      style={{ borderColor: 'var(--pc-border)', background: 'var(--pc-bg-surface)' }}
    >
      <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--pc-border)' }}>
        <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--pc-text-muted)' }}>
          Task Details
        </h3>
      </div>

      <div className="p-4 space-y-4 flex-1">
        {/* Task ID (read-only) */}
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--pc-text-faint)' }}>
            Task ID
          </label>
          <div className="text-xs font-mono px-2 py-1.5 rounded" style={{ background: 'var(--pc-bg-base)', color: 'var(--pc-text-muted)' }}>
            {data.taskId}
          </div>
        </div>

        {/* Name */}
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--pc-text-faint)' }}>
            Name
          </label>
          <input
            type="text"
            value={data.name}
            onChange={(e) => onUpdate(node.id, { name: e.target.value, label: e.target.value })}
            className="input-electric w-full px-2 py-1.5 text-sm"
          />
        </div>

        {/* Action (hidden for gates) */}
        {data.action !== 'gate' && (
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--pc-text-faint)' }}>
              Action
            </label>
            <select
              value={data.action}
              onChange={(e) => onUpdate(node.id, { action: e.target.value })}
              className="input-electric w-full px-2 py-1.5 text-sm"
              style={{ background: 'var(--pc-bg-base)', color: 'var(--pc-text-primary)' }}
            >
              <optgroup label="Actions">
                {ACTION_OPTIONS.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </optgroup>
              <optgroup label="Step Types">
                {EXECUTOR_STEP_TYPES.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </optgroup>
            </select>
          </div>
        )}

        {/* Gate / Conditional: type badge */}
        {(data.action === 'gate' || stepType === 'conditional') && (
          <div>
            <span
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-semibold"
              style={{ background: '#eab30822', color: '#eab308', border: '1px solid #eab30844' }}
            >
              <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
                <path d="M8 1L15 8L8 15L1 8Z" />
              </svg>
              If / Else Gate
            </span>
          </div>
        )}

        {/* Gate / Conditional: Condition */}
        {(data.action === 'gate' || stepType === 'conditional') && (
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--pc-text-faint)' }}>
              Condition
            </label>
            <textarea
              value={data.condition || ''}
              onChange={(e) => onUpdate(node.id, { condition: e.target.value })}
              placeholder="e.g. review.status == 'passed'"
              className="input-electric w-full px-2 py-1.5 text-sm font-mono"
              rows={2}
              style={{ fontSize: 'var(--pc-font-size-mono)' }}
            />
            <p className="text-[9px] mt-1" style={{ color: 'var(--pc-text-faint)' }}>
              Connect the green (true) and red (false) handles to branch targets
            </p>
          </div>
        )}

        {/* Description */}
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--pc-text-faint)' }}>
            Description
          </label>
          <textarea
            value={data.description}
            onChange={(e) => onUpdate(node.id, { description: e.target.value })}
            placeholder={data.action === 'gate' ? 'What this gate checks...' : 'What this task requires...'}
            className="input-electric w-full px-2 py-1.5 text-sm"
            rows={3}
          />
        </div>

        {/* Retry Config (all step types) */}
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--pc-text-faint)' }}>
              Retry
            </label>
            <input
              type="number"
              min={0}
              max={5}
              value={data.retry}
              onChange={(e) => onUpdate(node.id, { retry: parseInt(e.target.value) || 0 })}
              className="input-electric w-full px-2 py-1.5 text-sm"
            />
          </div>
          <div className="flex-1">
            <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--pc-text-faint)' }}>
              Retry Delay (s)
            </label>
            <input
              type="number"
              min={0}
              step={1}
              value={data.retryDelay}
              onChange={(e) => onUpdate(node.id, { retryDelay: parseFloat(e.target.value) || 5 })}
              className="input-electric w-full px-2 py-1.5 text-sm"
            />
          </div>
        </div>

        {/* ── Agent step properties ── */}
        {stepType === 'agent' && (
          <div className="space-y-3 p-3 rounded-lg" style={{ background: 'var(--pc-bg-base)', border: '1px solid var(--pc-border)' }}>
            <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--pc-text-faint)' }}>
              Agent Config
            </div>

            {/* Pool Agent Template selector */}
            <div className="relative">
              <label className="block text-[9px] font-medium mb-0.5" style={{ color: 'var(--pc-text-faint)' }}>Pool Agent</label>
              <div className="flex items-center gap-1">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={showPoolPicker ? poolSearch : (data.assign || '')}
                    onChange={(e) => {
                      setPoolSearch(e.target.value);
                      if (!showPoolPicker) setShowPoolPicker(true);
                    }}
                    onFocus={() => {
                      setPoolSearch(data.assign || '');
                      setShowPoolPicker(true);
                    }}
                    onBlur={() => {
                      // Delay to allow click on dropdown items
                      setTimeout(() => setShowPoolPicker(false), 200);
                    }}
                    placeholder="Search pool agents…"
                    className="input-electric w-full px-2 py-1 text-[11px] font-mono"
                  />
                  {showPoolPicker && (
                    <div
                      className="absolute z-20 w-full mt-1 max-h-48 overflow-y-auto rounded-lg border shadow-lg"
                      style={{ background: 'var(--pc-bg-surface)', borderColor: 'var(--pc-border)' }}
                    >
                      {poolLoading ? (
                        <div className="p-2 text-center text-[10px]" style={{ color: 'var(--pc-text-faint)' }}>
                          <Loader2 className="inline animate-spin mr-1" size={10} /> Loading…
                        </div>
                      ) : filteredPoolAgents.length === 0 ? (
                        <div className="p-2 text-center text-[10px]" style={{ color: 'var(--pc-text-faint)' }}>
                          No agents found
                        </div>
                      ) : (
                        filteredPoolAgents.map((agent) => (
                          <button
                            key={agent.kref}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              onUpdate(node.id, {
                                assign: agent.item_name,
                                agentType: agent.agent_type || 'claude',
                                role: agent.role || 'coder',
                              });
                              setPoolSearch('');
                              setShowPoolPicker(false);
                            }}
                            className="w-full text-left px-2 py-1.5 text-[11px] transition-colors"
                            style={{ color: 'var(--pc-text-primary)' }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--pc-bg-base)')}
                            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                          >
                            <div className="font-mono font-medium truncate">{agent.item_name}</div>
                            <div className="text-[9px] truncate" style={{ color: 'var(--pc-text-faint)' }}>
                              {agent.agent_type} · {agent.role}{agent.identity ? ` · ${agent.identity.slice(0, 50)}` : ''}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                {data.assign && (
                  <button
                    onClick={() => onUpdate(node.id, { assign: '' })}
                    className="p-0.5 rounded hover:bg-white/10 transition-colors"
                    style={{ color: 'var(--pc-text-faint)' }}
                    title="Clear pool agent"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
              {data.assign && (
                <div
                  className="mt-1 px-2 py-0.5 rounded-md text-[10px] font-semibold truncate inline-flex items-center gap-1"
                  style={{
                    background: '#6366f122',
                    color: '#818cf8',
                    border: '1px solid #6366f144',
                    maxWidth: '100%',
                  }}
                >
                  <span style={{ fontSize: '8px' }}>●</span>
                  {data.assign}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[9px] font-medium mb-0.5" style={{ color: 'var(--pc-text-faint)' }}>Type</label>
                <select
                  value={data.agentType || 'claude'}
                  onChange={(e) => onUpdate(node.id, { agentType: e.target.value })}
                  className="input-electric w-full px-2 py-1 text-[11px]"
                  style={{ background: 'var(--pc-bg-surface)', color: 'var(--pc-text-primary)' }}
                >
                  <option value="claude">claude</option>
                  <option value="codex">codex</option>
                </select>
              </div>
              <div>
                <label className="block text-[9px] font-medium mb-0.5" style={{ color: 'var(--pc-text-faint)' }}>Role</label>
                <input
                  type="text"
                  value={data.role || ''}
                  onChange={(e) => onUpdate(node.id, { role: e.target.value })}
                  placeholder="coder"
                  className="input-electric w-full px-2 py-1 text-[11px]"
                />
              </div>
            </div>
            <div>
              <label className="block text-[9px] font-medium mb-0.5" style={{ color: 'var(--pc-text-faint)' }}>Timeout (sec)</label>
              <input
                type="number"
                value={data.timeout || 300}
                onChange={(e) => onUpdate(node.id, { timeout: parseInt(e.target.value) || 300 })}
                className="input-electric w-20 px-2 py-1 text-[11px]"
                min={10}
                max={3600}
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--pc-text-faint)' }}>
                Model Override
              </label>
              <input
                type="text"
                value={data.model}
                onChange={(e) => onUpdate(node.id, { model: e.target.value })}
                placeholder="e.g. claude-sonnet-4-5-20250514"
                className="input-electric w-full px-2 py-1.5 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--pc-text-faint)' }}>
                Prompt
              </label>
              <textarea
                value={data.prompt}
                onChange={(e) => onUpdate(node.id, { prompt: e.target.value })}
                placeholder="Agent prompt template (supports ${step_id.output} interpolation)"
                className="input-electric w-full px-2 py-1.5 text-sm font-mono"
                rows={6}
              />
            </div>
          </div>
        )}

        {/* ── Parallel step properties ── */}
        {stepType === 'parallel' && (
          <div className="space-y-2 p-3 rounded-lg" style={{ background: 'var(--pc-bg-base)', border: '1px solid var(--pc-border)' }}>
            <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--pc-text-faint)' }}>
              Parallel Config
            </div>
            <div>
              <label className="block text-[9px] font-medium mb-0.5" style={{ color: 'var(--pc-text-faint)' }}>Join Strategy</label>
              <select
                value={data.parallelJoin || 'all'}
                onChange={(e) => onUpdate(node.id, { parallelJoin: e.target.value })}
                className="input-electric w-full px-2 py-1 text-[11px]"
                style={{ background: 'var(--pc-bg-surface)', color: 'var(--pc-text-primary)' }}
              >
                <option value="all">all — wait for every branch</option>
                <option value="any">any — first success wins</option>
                <option value="majority">majority — &gt;50% must succeed</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--pc-text-faint)' }}>
                Max Concurrency
              </label>
              <input
                type="number"
                min={1}
                max={10}
                value={data.parallelMaxConcurrency}
                onChange={(e) => onUpdate(node.id, { parallelMaxConcurrency: parseInt(e.target.value) || 5 })}
                className="input-electric w-full px-2 py-1.5 text-sm"
              />
            </div>
            <p className="text-[9px]" style={{ color: 'var(--pc-text-faint)' }}>
              Child steps are managed by connecting nodes on the canvas
            </p>
          </div>
        )}

        {/* ── ForEach (loop) properties ── */}
        {stepType === 'for_each' && (
          <div className="space-y-2 p-3 rounded-lg" style={{ background: 'var(--pc-bg-base)', border: '1px solid var(--pc-border)' }}>
            <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#10b981' }}>
              ForEach Config
            </div>
            <div>
              <label className="block text-[9px] font-medium mb-0.5" style={{ color: 'var(--pc-text-faint)' }}>Range</label>
              <input
                type="text"
                value={data.forEachRange || ''}
                onChange={(e) => onUpdate(node.id, { forEachRange: e.target.value })}
                placeholder="e.g. 1..8 or ${resolve_arc.output_data.episode_range}"
                className="input-electric w-full px-2 py-1 text-[11px] font-mono"
              />
              <p className="text-[8px] mt-0.5" style={{ color: 'var(--pc-text-faint)' }}>
                Numeric range (N..M or N-M). Supports $&#123;expressions&#125;.
              </p>
            </div>
            <div>
              <label className="block text-[9px] font-medium mb-0.5" style={{ color: 'var(--pc-text-faint)' }}>Items (alternative to range)</label>
              <input
                type="text"
                defaultValue={(data.forEachItems || []).join(', ')}
                onBlur={(e) => {
                  const items = e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean);
                  onUpdate(node.id, { forEachItems: items });
                }}
                placeholder="item1, item2, item3"
                className="input-electric w-full px-2 py-1 text-[11px] font-mono"
              />
              <p className="text-[8px] mt-0.5" style={{ color: 'var(--pc-text-faint)' }}>
                Comma-separated values. Used when range is empty.
              </p>
            </div>
            <div>
              <label className="block text-[9px] font-medium mb-0.5" style={{ color: 'var(--pc-text-faint)' }}>Loop Variable</label>
              <input
                type="text"
                value={data.forEachVariable || 'item'}
                onChange={(e) => onUpdate(node.id, { forEachVariable: e.target.value })}
                placeholder="item"
                className="input-electric w-full px-2 py-1 text-[11px] font-mono"
              />
              <p className="text-[8px] mt-0.5" style={{ color: 'var(--pc-text-faint)' }}>
                Access via $&#123;for_each.{data.forEachVariable || 'item'}&#125;, $&#123;for_each.index&#125;, $&#123;for_each.iteration&#125;
              </p>
            </div>
            <div>
              <label className="block text-[9px] font-medium mb-0.5" style={{ color: 'var(--pc-text-faint)' }}>Sub-steps</label>
              <input
                type="text"
                defaultValue={(data.forEachSteps || []).join(', ')}
                onBlur={(e) => {
                  const steps = e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean);
                  onUpdate(node.id, { forEachSteps: steps });
                }}
                placeholder="step_a, step_b, step_c"
                className="input-electric w-full px-2 py-1 text-[11px] font-mono"
              />
              <p className="text-[8px] mt-0.5" style={{ color: 'var(--pc-text-faint)' }}>
                Comma-separated step IDs executed sequentially per iteration
              </p>
            </div>
            <div>
              <label className="block text-[9px] font-medium mb-0.5" style={{ color: 'var(--pc-text-faint)' }}>Max Iterations</label>
              <input
                type="number"
                min={1}
                max={100}
                value={data.forEachMaxIterations || 20}
                onChange={(e) => onUpdate(node.id, { forEachMaxIterations: parseInt(e.target.value) || 20 })}
                className="input-electric w-full px-2 py-1 text-[11px]"
              />
            </div>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={data.forEachCarryForward ?? true}
                  onChange={(e) => onUpdate(node.id, { forEachCarryForward: e.target.checked })}
                  className="h-4 w-4 rounded accent-[#10b981]"
                />
                <span className="text-[10px]" style={{ color: 'var(--pc-text-muted)' }}>Carry forward</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={data.forEachFailFast ?? true}
                  onChange={(e) => onUpdate(node.id, { forEachFailFast: e.target.checked })}
                  className="h-4 w-4 rounded accent-[#10b981]"
                />
                <span className="text-[10px]" style={{ color: 'var(--pc-text-muted)' }}>Fail fast</span>
              </label>
            </div>
          </div>
        )}

        {/* ── Goto (loop) properties ── */}
        {stepType === 'goto' && (
          <div className="space-y-2 p-3 rounded-lg" style={{ background: 'var(--pc-bg-base)', border: '1px solid var(--pc-border)' }}>
            <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--pc-text-faint)' }}>
              Loop Config
            </div>
            <div>
              <label className="block text-[9px] font-medium mb-0.5" style={{ color: 'var(--pc-text-faint)' }}>Target Step</label>
              <input
                type="text"
                value={data.gotoTarget || ''}
                onChange={(e) => onUpdate(node.id, { gotoTarget: e.target.value })}
                placeholder="step-id to loop back to"
                className="input-electric w-full px-2 py-1 text-[11px] font-mono"
              />
            </div>
            <div>
              <label className="block text-[9px] font-medium mb-0.5" style={{ color: 'var(--pc-text-faint)' }}>Max Iterations</label>
              <input
                type="number"
                value={data.gotoMaxIterations || 3}
                onChange={(e) => onUpdate(node.id, { gotoMaxIterations: parseInt(e.target.value) || 3 })}
                className="input-electric w-20 px-2 py-1 text-[11px]"
                min={1}
                max={20}
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--pc-text-faint)' }}>
                Condition Guard
              </label>
              <input
                type="text"
                value={data.gotoCondition}
                onChange={(e) => onUpdate(node.id, { gotoCondition: e.target.value })}
                placeholder="Optional: only goto if expression is truthy"
                className="input-electric w-full px-2 py-1.5 text-sm font-mono"
              />
            </div>
          </div>
        )}

        {/* ── Group Chat properties ── */}
        {stepType === 'group_chat' && (
          <div className="space-y-2 p-3 rounded-lg" style={{ background: 'var(--pc-bg-base)', border: '1px solid var(--pc-border)' }}>
            <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--pc-text-faint)' }}>
              Group Chat Config
            </div>
            <div>
              <label className="block text-[9px] font-medium mb-0.5" style={{ color: 'var(--pc-text-faint)' }}>Topic</label>
              <input
                type="text"
                value={data.groupChatTopic || ''}
                onChange={(e) => onUpdate(node.id, { groupChatTopic: e.target.value })}
                placeholder="Discussion topic"
                className="input-electric w-full px-2 py-1 text-[11px]"
              />
            </div>
            <div>
              <label className="block text-[9px] font-medium mb-0.5" style={{ color: 'var(--pc-text-faint)' }}>Participants</label>
              <input
                type="text"
                value={(data.groupChatParticipants || []).join(', ')}
                onChange={(e) => onUpdate(node.id, { groupChatParticipants: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                placeholder="claude, codex"
                className="input-electric w-full px-2 py-1 text-[11px] font-mono"
              />
              <p className="text-[8px] mt-0.5" style={{ color: 'var(--pc-text-faint)' }}>Comma-separated agent types or template names</p>
            </div>
            <div>
              <label className="block text-[9px] font-medium mb-0.5" style={{ color: 'var(--pc-text-faint)' }}>Max Rounds</label>
              <input
                type="number"
                value={data.groupChatMaxRounds || 8}
                onChange={(e) => onUpdate(node.id, { groupChatMaxRounds: parseInt(e.target.value) || 8 })}
                className="input-electric w-20 px-2 py-1 text-[11px]"
                min={2}
                max={20}
              />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--pc-text-faint)' }}>
                  Moderator
                </label>
                <select
                  value={data.groupChatModerator}
                  onChange={(e) => onUpdate(node.id, { groupChatModerator: e.target.value })}
                  className="input-electric w-full px-2 py-1.5 text-sm"
                >
                  <option value="claude">Claude</option>
                  <option value="codex">Codex</option>
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--pc-text-faint)' }}>
                  Strategy
                </label>
                <select
                  value={data.groupChatStrategy}
                  onChange={(e) => onUpdate(node.id, { groupChatStrategy: e.target.value })}
                  className="input-electric w-full px-2 py-1.5 text-sm"
                >
                  <option value="moderator_selected">Moderator Selected</option>
                  <option value="round_robin">Round Robin</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--pc-text-faint)' }}>
                Timeout (s)
              </label>
              <input
                type="number"
                min={1}
                value={data.groupChatTimeout}
                onChange={(e) => onUpdate(node.id, { groupChatTimeout: parseInt(e.target.value) || 120 })}
                className="input-electric w-full px-2 py-1.5 text-sm"
              />
            </div>
          </div>
        )}

        {/* ── Supervisor properties ── */}
        {stepType === 'supervisor' && (
          <div className="space-y-2 p-3 rounded-lg" style={{ background: 'var(--pc-bg-base)', border: '1px solid var(--pc-border)' }}>
            <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--pc-text-faint)' }}>
              Supervisor Config
            </div>
            <div>
              <label className="block text-[9px] font-medium mb-0.5" style={{ color: 'var(--pc-text-faint)' }}>Task</label>
              <textarea
                value={data.supervisorTask || ''}
                onChange={(e) => onUpdate(node.id, { supervisorTask: e.target.value })}
                placeholder="Task to decompose and delegate"
                className="input-electric w-full px-2 py-1 text-[11px]"
                rows={2}
              />
            </div>
            <div>
              <label className="block text-[9px] font-medium mb-0.5" style={{ color: 'var(--pc-text-faint)' }}>Max Iterations</label>
              <input
                type="number"
                value={data.supervisorMaxIterations || 5}
                onChange={(e) => onUpdate(node.id, { supervisorMaxIterations: parseInt(e.target.value) || 5 })}
                className="input-electric w-20 px-2 py-1 text-[11px]"
                min={1}
                max={10}
              />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--pc-text-faint)' }}>
                  Agent Type
                </label>
                <select
                  value={data.supervisorType}
                  onChange={(e) => onUpdate(node.id, { supervisorType: e.target.value })}
                  className="input-electric w-full px-2 py-1.5 text-sm"
                >
                  <option value="claude">Claude</option>
                  <option value="codex">Codex</option>
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--pc-text-faint)' }}>
                  Timeout (s)
                </label>
                <input
                  type="number"
                  min={1}
                  value={data.supervisorTimeout}
                  onChange={(e) => onUpdate(node.id, { supervisorTimeout: parseInt(e.target.value) || 300 })}
                  className="input-electric w-full px-2 py-1.5 text-sm"
                />
              </div>
            </div>
          </div>
        )}

        {/* ── Shell properties ── */}
        {stepType === 'shell' && (
          <div className="space-y-2 p-3 rounded-lg" style={{ background: 'var(--pc-bg-base)', border: '1px solid var(--pc-border)' }}>
            <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--pc-text-faint)' }}>
              Shell Config
            </div>
            <div>
              <label className="block text-[9px] font-medium mb-0.5" style={{ color: 'var(--pc-text-faint)' }}>Command</label>
              <input
                type="text"
                value={data.shellCommand || ''}
                onChange={(e) => onUpdate(node.id, { shellCommand: e.target.value })}
                placeholder="e.g. npm run build"
                className="input-electric w-full px-2 py-1 text-[11px] font-mono"
              />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--pc-text-faint)' }}>
                  Timeout (s)
                </label>
                <input
                  type="number"
                  min={1}
                  value={data.shellTimeout}
                  onChange={(e) => onUpdate(node.id, { shellTimeout: parseInt(e.target.value) || 60 })}
                  className="input-electric w-full px-2 py-1.5 text-sm"
                />
              </div>
              <div className="flex-1 flex items-end pb-1">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={data.shellAllowFailure}
                    onChange={(e) => onUpdate(node.id, { shellAllowFailure: e.target.checked })}
                    className="h-4 w-4 rounded accent-[var(--pc-accent)]"
                  />
                  <span className="text-xs" style={{ color: 'var(--pc-text-muted)' }}>Allow failure</span>
                </label>
              </div>
            </div>
          </div>
        )}

        {/* ── Output properties ── */}
        {stepType === 'output' && (
          <div className="space-y-2 p-3 rounded-lg" style={{ background: 'var(--pc-bg-base)', border: '1px solid var(--pc-border)' }}>
            <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--pc-text-faint)' }}>
              Output Config
            </div>
            <div>
              <label className="block text-[9px] font-medium mb-0.5" style={{ color: 'var(--pc-text-faint)' }}>Format</label>
              <select
                value={data.outputFormat || 'markdown'}
                onChange={(e) => onUpdate(node.id, { outputFormat: e.target.value })}
                className="input-electric w-full px-2 py-1 text-[11px]"
                style={{ background: 'var(--pc-bg-surface)', color: 'var(--pc-text-primary)' }}
              >
                <option value="markdown">markdown</option>
                <option value="json">json</option>
                <option value="text">text</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--pc-text-faint)' }}>
                Template
              </label>
              <textarea
                value={data.outputTemplate}
                onChange={(e) => onUpdate(node.id, { outputTemplate: e.target.value })}
                placeholder="Output template with ${step_id.output} interpolation"
                className="input-electric w-full px-2 py-1.5 text-sm font-mono"
                rows={6}
              />
            </div>

            {/* Kumiho Entity Registry */}
            <div className="pt-1 mt-1" style={{ borderTop: '1px solid var(--pc-border)' }}>
              <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#a855f7' }}>
                Kumiho Entity
              </div>
              <div className="space-y-1.5">
                <div>
                  <label className="block text-[9px] font-medium mb-0.5" style={{ color: 'var(--pc-text-faint)' }}>Entity Name</label>
                  <input
                    type="text"
                    value={data.entityName || ''}
                    onChange={(e) => onUpdate(node.id, { entityName: e.target.value })}
                    placeholder="e.g. ep-${inputs.episode}-draft"
                    className="input-electric w-full px-2 py-1 text-[11px] font-mono"
                  />
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-[9px] font-medium mb-0.5" style={{ color: 'var(--pc-text-faint)' }}>Kind</label>
                    <input
                      type="text"
                      value={data.entityKind || ''}
                      onChange={(e) => onUpdate(node.id, { entityKind: e.target.value })}
                      placeholder="e.g. qs-episode-draft"
                      className="input-electric w-full px-2 py-1 text-[11px] font-mono"
                    />
                  </div>
                  <div className="w-24">
                    <label className="block text-[9px] font-medium mb-0.5" style={{ color: 'var(--pc-text-faint)' }}>Tag</label>
                    <input
                      type="text"
                      value={data.entityTag || ''}
                      onChange={(e) => onUpdate(node.id, { entityTag: e.target.value })}
                      placeholder="ready"
                      className="input-electric w-full px-2 py-1 text-[11px] font-mono"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[9px] font-medium mb-0.5" style={{ color: 'var(--pc-text-faint)' }}>Space</label>
                  <input
                    type="text"
                    value={data.entitySpace || ''}
                    onChange={(e) => onUpdate(node.id, { entitySpace: e.target.value })}
                    placeholder="CognitiveMemory/creative/..."
                    className="input-electric w-full px-2 py-1 text-[11px] font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-medium mb-0.5" style={{ color: 'var(--pc-text-faint)' }}>Metadata</label>
                  {Object.entries(data.entityMetadata || {}).map(([mk, mv]) => (
                    <div key={mk} className="flex gap-1 mb-1 items-center">
                      <input
                        type="text"
                        value={mk}
                        readOnly
                        className="input-electric w-28 px-1.5 py-0.5 text-[10px] font-mono"
                        style={{ opacity: 0.7 }}
                      />
                      <span className="text-[10px]" style={{ color: 'var(--pc-text-faint)' }}>=</span>
                      <input
                        type="text"
                        value={String(mv ?? '')}
                        onChange={(e) => {
                          const updated = { ...data.entityMetadata, [mk]: e.target.value };
                          onUpdate(node.id, { entityMetadata: updated });
                        }}
                        className="input-electric flex-1 px-1.5 py-0.5 text-[10px] font-mono"
                      />
                      <button
                        onClick={() => {
                          const updated = { ...data.entityMetadata };
                          delete updated[mk];
                          onUpdate(node.id, { entityMetadata: updated });
                        }}
                        className="text-[10px] px-1 hover:text-red-400 transition-colors"
                        style={{ color: 'var(--pc-text-faint)' }}
                      >
                        x
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => {
                      const key = prompt('Metadata key:');
                      if (key) {
                        const updated = { ...(data.entityMetadata || {}), [key]: '' };
                        onUpdate(node.id, { entityMetadata: updated });
                      }
                    }}
                    className="text-[9px] px-1.5 py-0.5 rounded hover:opacity-80 transition-opacity"
                    style={{ background: '#a855f722', color: '#c084fc' }}
                  >
                    + Add metadata
                  </button>
                </div>
                <p className="text-[8px]" style={{ color: 'var(--pc-text-faint)' }}>
                  Publishes output as a Kumiho entity for downstream triggers
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── Handoff properties ── */}
        {stepType === 'handoff' && (
          <div className="space-y-2 p-3 rounded-lg" style={{ background: 'var(--pc-bg-base)', border: '1px solid var(--pc-border)' }}>
            <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--pc-text-faint)' }}>
              Handoff Config
            </div>
            <div>
              <label className="block text-[9px] font-medium mb-0.5" style={{ color: 'var(--pc-text-faint)' }}>From Step</label>
              <input
                type="text"
                value={data.handoffFrom || ''}
                onChange={(e) => onUpdate(node.id, { handoffFrom: e.target.value })}
                placeholder="step-id"
                className="input-electric w-full px-2 py-1 text-[11px] font-mono"
              />
            </div>
            <div>
              <label className="block text-[9px] font-medium mb-0.5" style={{ color: 'var(--pc-text-faint)' }}>To Agent Type</label>
              <select
                value={data.handoffTo || 'codex'}
                onChange={(e) => onUpdate(node.id, { handoffTo: e.target.value })}
                className="input-electric w-full px-2 py-1 text-[11px]"
                style={{ background: 'var(--pc-bg-surface)', color: 'var(--pc-text-primary)' }}
              >
                <option value="claude">claude</option>
                <option value="codex">codex</option>
              </select>
            </div>
            <div>
              <label className="block text-[9px] font-medium mb-0.5" style={{ color: 'var(--pc-text-faint)' }}>Reason</label>
              <input
                type="text"
                value={data.handoffReason || ''}
                onChange={(e) => onUpdate(node.id, { handoffReason: e.target.value })}
                placeholder="Continuing the task"
                className="input-electric w-full px-2 py-1 text-[11px]"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--pc-text-faint)' }}>
                Task
              </label>
              <textarea
                value={data.handoffTask}
                onChange={(e) => onUpdate(node.id, { handoffTask: e.target.value })}
                placeholder="Specific task for the receiving agent"
                className="input-electric w-full px-2 py-1.5 text-sm"
                rows={2}
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--pc-text-faint)' }}>
                Timeout (s)
              </label>
              <input
                type="number"
                min={1}
                value={data.handoffTimeout}
                onChange={(e) => onUpdate(node.id, { handoffTimeout: parseInt(e.target.value) || 300 })}
                className="input-electric w-full px-2 py-1.5 text-sm"
              />
            </div>
          </div>
        )}

        {/* Human Input Config */}
        {stepType === 'human_input' && (
          <div className="space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#f59e0b' }}>
              Human Input Config
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--pc-text-faint)' }}>
                Message
              </label>
              <textarea
                value={data.humanInputMessage}
                onChange={(e) => onUpdate(node.id, { humanInputMessage: e.target.value })}
                placeholder="Prompt message sent to the channel"
                className="input-electric w-full px-2 py-1.5 text-sm"
                rows={4}
              />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--pc-text-faint)' }}>
                  Channel
                </label>
                <select
                  value={data.channel}
                  onChange={(e) => onUpdate(node.id, { channel: e.target.value })}
                  className="input-electric w-full px-2 py-1.5 text-sm"
                >
                  <option value="dashboard">Dashboard</option>
                  <option value="discord">Discord</option>
                  <option value="slack">Slack</option>
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--pc-text-faint)' }}>
                  Timeout (s)
                </label>
                <input
                  type="number"
                  min={60}
                  value={data.humanInputTimeout}
                  onChange={(e) => onUpdate(node.id, { humanInputTimeout: parseInt(e.target.value) || 3600 })}
                  className="input-electric w-full px-2 py-1.5 text-sm"
                />
              </div>
            </div>
          </div>
        )}

        {/* Human Approval Config */}
        {stepType === 'human_approval' && (
          <div className="space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#f59e0b' }}>
              Human Approval Config
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--pc-text-faint)' }}>
                Channel
              </label>
              <select
                value={data.humanApprovalChannel}
                onChange={(e) => onUpdate(node.id, { humanApprovalChannel: e.target.value })}
                className="input-electric w-full px-2 py-1.5 text-sm"
              >
                {channelOptions.map((ch) => (
                  <option key={ch} value={ch}>{ch}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--pc-text-faint)' }}>
                Channel ID Override
              </label>
              <input
                type="text"
                value={data.humanApprovalChannelId}
                onChange={(e) => onUpdate(node.id, { humanApprovalChannelId: e.target.value })}
                placeholder="Channel/thread ID override (optional)"
                className="input-electric w-full px-2 py-1.5 text-sm"
              />
              <p className="text-[9px] mt-0.5" style={{ color: 'var(--pc-text-faint)' }}>
                Override target channel — supports interpolation e.g. {'${inputs.channel}'}
              </p>
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--pc-text-faint)' }}>
                Approval Message
              </label>
              <textarea
                value={data.humanApprovalMessage}
                onChange={(e) => onUpdate(node.id, { humanApprovalMessage: e.target.value })}
                placeholder="Message shown when requesting approval"
                className="input-electric w-full px-2 py-1.5 text-sm"
                rows={3}
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--pc-text-faint)' }}>
                Timeout (s)
              </label>
              <input
                type="number"
                min={60}
                value={data.humanApprovalTimeout}
                onChange={(e) => onUpdate(node.id, { humanApprovalTimeout: parseInt(e.target.value) || 3600 })}
                className="input-electric w-full px-2 py-1.5 text-sm"
              />
            </div>
          </div>
        )}

        {/* A2A Config */}
        {stepType === 'a2a' && (
          <div className="space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#06b6d4' }}>
              A2A Config
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--pc-text-faint)' }}>
                Endpoint URL
              </label>
              <input
                type="text"
                value={data.a2aUrl}
                onChange={(e) => onUpdate(node.id, { a2aUrl: e.target.value })}
                placeholder="https://agent.example.com/a2a"
                className="input-electric w-full px-2 py-1.5 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--pc-text-faint)' }}>
                Skill ID
              </label>
              <input
                type="text"
                value={data.a2aSkillId}
                onChange={(e) => onUpdate(node.id, { a2aSkillId: e.target.value })}
                placeholder="Optional skill ID"
                className="input-electric w-full px-2 py-1.5 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--pc-text-faint)' }}>
                Message
              </label>
              <textarea
                value={data.a2aMessage}
                onChange={(e) => onUpdate(node.id, { a2aMessage: e.target.value })}
                placeholder="Message to send to the A2A agent"
                className="input-electric w-full px-2 py-1.5 text-sm"
                rows={3}
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--pc-text-faint)' }}>
                Timeout (s)
              </label>
              <input
                type="number"
                min={1}
                value={data.a2aTimeout}
                onChange={(e) => onUpdate(node.id, { a2aTimeout: parseInt(e.target.value) || 300 })}
                className="input-electric w-full px-2 py-1.5 text-sm"
              />
            </div>
          </div>
        )}

        {/* ── Resolve properties ── */}
        {stepType === 'resolve' && (
          <div className="space-y-2 p-3 rounded-lg" style={{ background: 'var(--pc-bg-base)', border: '1px solid var(--pc-border)' }}>
            <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--pc-text-faint)' }}>
              Resolve Config
            </div>
            <div>
              <label className="block text-[9px] font-medium mb-0.5" style={{ color: 'var(--pc-text-faint)' }}>Entity Kind</label>
              <input
                type="text"
                value={data.resolveKind || ''}
                onChange={(e) => onUpdate(node.id, { resolveKind: e.target.value })}
                placeholder="e.g. qs-episode-draft"
                className="input-electric w-full px-2 py-1 text-[11px] font-mono"
              />
            </div>
            <div>
              <label className="block text-[9px] font-medium mb-0.5" style={{ color: 'var(--pc-text-faint)' }}>Tag</label>
              <input
                type="text"
                value={data.resolveTag || 'published'}
                onChange={(e) => onUpdate(node.id, { resolveTag: e.target.value })}
                placeholder="published"
                className="input-electric w-full px-2 py-1 text-[11px] font-mono"
              />
            </div>
            <div>
              <label className="block text-[9px] font-medium mb-0.5" style={{ color: 'var(--pc-text-faint)' }}>Name Pattern</label>
              <input
                type="text"
                value={data.resolveNamePattern || ''}
                onChange={(e) => onUpdate(node.id, { resolveNamePattern: e.target.value })}
                placeholder="e.g. qs-episode-*"
                className="input-electric w-full px-2 py-1 text-[11px] font-mono"
              />
            </div>
            <div>
              <label className="block text-[9px] font-medium mb-0.5" style={{ color: 'var(--pc-text-faint)' }}>Space</label>
              <input
                type="text"
                value={data.resolveSpace || ''}
                onChange={(e) => onUpdate(node.id, { resolveSpace: e.target.value })}
                placeholder="e.g. Construct/WorkflowOutputs"
                className="input-electric w-full px-2 py-1 text-[11px] font-mono"
              />
            </div>
            <div>
              <label className="block text-[9px] font-medium mb-0.5" style={{ color: 'var(--pc-text-faint)' }}>Mode</label>
              <select
                value={data.resolveMode || 'latest'}
                onChange={(e) => onUpdate(node.id, { resolveMode: e.target.value })}
                className="input-electric w-full px-2 py-1 text-[11px]"
                style={{ background: 'var(--pc-bg-surface)', color: 'var(--pc-text-primary)' }}
              >
                <option value="latest">latest</option>
                <option value="all">all</option>
              </select>
            </div>
            <div>
              <label className="block text-[9px] font-medium mb-0.5" style={{ color: 'var(--pc-text-faint)' }}>Fields</label>
              <input
                type="text"
                defaultValue={(data.resolveFields || []).join(', ')}
                onBlur={(e) => {
                  const fields = e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean);
                  onUpdate(node.id, { resolveFields: fields });
                }}
                placeholder="part, episode_number, episode_goal"
                className="input-electric w-full px-2 py-1 text-[11px] font-mono"
              />
              <p className="text-[8px] mt-0.5" style={{ color: 'var(--pc-text-faint)' }}>Comma-separated metadata fields to extract</p>
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={data.resolveFailIfMissing ?? true}
                  onChange={(e) => onUpdate(node.id, { resolveFailIfMissing: e.target.checked })}
                  className="h-4 w-4 rounded accent-[var(--pc-accent)]"
                />
                <span className="text-xs" style={{ color: 'var(--pc-text-muted)' }}>Fail if missing</span>
              </label>
            </div>
          </div>
        )}

        {/* MapReduce Config */}
        {stepType === 'map_reduce' && (
          <div className="space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#8b5cf6' }}>
              MapReduce Config
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--pc-text-faint)' }}>
                Task
              </label>
              <textarea
                value={data.mapReduceTask}
                onChange={(e) => onUpdate(node.id, { mapReduceTask: e.target.value })}
                placeholder="Overall task description"
                className="input-electric w-full px-2 py-1.5 text-sm"
                rows={2}
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--pc-text-faint)' }}>
                Splits (comma-separated)
              </label>
              <input
                type="text"
                value={data.mapReduceSplits.join(', ')}
                onChange={(e) => onUpdate(node.id, { mapReduceSplits: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                placeholder="segment1, segment2, segment3"
                className="input-electric w-full px-2 py-1.5 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--pc-text-faint)' }}>
                  Mapper
                </label>
                <select
                  value={data.mapReduceMapper}
                  onChange={(e) => onUpdate(node.id, { mapReduceMapper: e.target.value })}
                  className="input-electric w-full px-2 py-1.5 text-sm"
                >
                  <option value="claude">Claude</option>
                  <option value="codex">Codex</option>
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--pc-text-faint)' }}>
                  Reducer
                </label>
                <select
                  value={data.mapReduceReducer}
                  onChange={(e) => onUpdate(node.id, { mapReduceReducer: e.target.value })}
                  className="input-electric w-full px-2 py-1.5 text-sm"
                >
                  <option value="claude">Claude</option>
                  <option value="codex">Codex</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--pc-text-faint)' }}>
                  Concurrency
                </label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={data.mapReduceConcurrency}
                  onChange={(e) => onUpdate(node.id, { mapReduceConcurrency: parseInt(e.target.value) || 3 })}
                  className="input-electric w-full px-2 py-1.5 text-sm"
                />
              </div>
              <div className="flex-1">
                <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--pc-text-faint)' }}>
                  Timeout (s)
                </label>
                <input
                  type="number"
                  min={1}
                  value={data.mapReduceTimeout}
                  onChange={(e) => onUpdate(node.id, { mapReduceTimeout: parseInt(e.target.value) || 300 })}
                  className="input-electric w-full px-2 py-1.5 text-sm"
                />
              </div>
            </div>
          </div>
        )}

        {/* Notify channels (multi-select) */}
        {stepType === 'notify' && (
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--pc-text-faint)' }}>
              Channels
            </label>
            <div className="flex gap-1.5 flex-wrap">
              {channelOptions.map((ch) => {
                const active = (data.channels ?? []).includes(ch);
                return (
                  <button
                    key={ch}
                    onClick={() => toggleChannel(ch)}
                    className="px-2 py-1 rounded-lg text-[11px] font-medium transition-all"
                    style={{
                      background: active ? 'var(--pc-accent-glow)' : 'var(--pc-bg-base)',
                      color: active ? 'var(--pc-accent-light)' : 'var(--pc-text-muted)',
                      border: `1px solid ${active ? 'var(--pc-accent-dim)' : 'var(--pc-border)'}`,
                    }}
                  >
                    {ch}
                  </button>
                );
              })}
            </div>
            <p className="text-[9px] mt-1" style={{ color: 'var(--pc-text-faint)' }}>
              Select one or more channels to broadcast to
            </p>
          </div>
        )}

        {/* Agent Hints (tasks only) */}
        {stepType !== 'conditional' && stepType !== 'human_input' && stepType !== 'notify' && data.action !== 'gate' && <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--pc-text-faint)' }}>
            Agent Hints
          </label>
          <div className="flex gap-1.5 flex-wrap">
            {AGENT_HINT_OPTIONS.map((hint) => {
              const active = data.agentHints.includes(hint);
              return (
                <button
                  key={hint}
                  onClick={() => toggleHint(hint)}
                  className="px-2 py-1 rounded-lg text-[11px] font-medium transition-all"
                  style={{
                    background: active ? 'var(--pc-accent-glow)' : 'var(--pc-bg-base)',
                    color: active ? 'var(--pc-accent-light)' : 'var(--pc-text-muted)',
                    border: `1px solid ${active ? 'var(--pc-accent-dim)' : 'var(--pc-border)'}`,
                  }}
                >
                  {hint}
                </button>
              );
            })}
          </div>
          <p className="text-[9px] mt-1" style={{ color: 'var(--pc-text-faint)' }}>
            Suggestions for the operator — final assignment is automatic
          </p>
        </div>}

        {/* Skills (tasks only, not gates, human_input, or notify) */}
        {stepType !== 'conditional' && stepType !== 'human_input' && stepType !== 'notify' && data.action !== 'gate' && <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--pc-text-faint)' }}>
            Skills
          </label>
          {data.skills.length > 0 && (
            <div className="flex gap-1 flex-wrap mb-2">
              {data.skills.map((skill) => (
                <span
                  key={skill}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium"
                  style={{ background: 'var(--pc-accent-glow)', color: 'var(--pc-accent-light)', border: '1px solid var(--pc-accent-dim)' }}
                >
                  {skill}
                  <button type="button" onClick={() => removeSkill(skill)} className="hover:opacity-70">
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <button
            onClick={() => setShowSkillPicker(!showSkillPicker)}
            className="flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-lg transition-all"
            style={{
              color: 'var(--pc-accent-light)',
              background: showSkillPicker ? 'var(--pc-accent-glow)' : 'transparent',
            }}
          >
            <Sparkles className="h-3 w-3" />
            {showSkillPicker ? 'Hide skill picker' : 'Add skills'}
          </button>
          {showSkillPicker && (
            <div className="mt-2 rounded-xl border overflow-hidden" style={{ borderColor: 'var(--pc-border)', background: 'var(--pc-bg-base)' }}>
              <div className="relative p-2">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-3 w-3" style={{ color: 'var(--pc-text-faint)' }} />
                <input
                  type="text"
                  value={skillSearch}
                  onChange={(e) => setSkillSearch(e.target.value)}
                  placeholder="Search skills..."
                  className="input-electric w-full pl-7 pr-2 py-1 text-[11px]"
                />
              </div>
              <div className="max-h-32 overflow-y-auto">
                {loading ? (
                  <div className="flex items-center justify-center gap-1.5 py-3">
                    <Loader2 className="h-3 w-3 animate-spin" style={{ color: 'var(--pc-text-faint)' }} />
                    <span className="text-[10px]" style={{ color: 'var(--pc-text-faint)' }}>Loading skills...</span>
                  </div>
                ) : searchResults.length === 0 ? (
                  <p className="text-[10px] text-center py-3" style={{ color: 'var(--pc-text-faint)' }}>
                    {allSkills.length === 0 ? 'No skills available' : 'No matching skills'}
                  </p>
                ) : (
                  searchResults.slice(0, 20).map((skill) => (
                    <button
                      key={skill.kref}
                      onClick={() => addSkill(skill.name)}
                      className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-[var(--pc-hover)] transition-colors"
                      style={{ color: 'var(--pc-text-secondary)' }}
                    >
                      <div className="font-medium" style={{ color: 'var(--pc-text-primary)' }}>{skill.name}</div>
                      {skill.description && (
                        <div className="text-[10px] truncate" style={{ color: 'var(--pc-text-faint)' }}>{skill.description}</div>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>}

        {/* Dependencies (read-only, managed by edges) */}
        {data.dependencyCount > 0 && (
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--pc-text-faint)' }}>
              Dependencies
            </label>
            <div className="text-[11px]" style={{ color: 'var(--pc-text-muted)' }}>
              {data.dependencyCount} incoming {data.dependencyCount === 1 ? 'dependency' : 'dependencies'}
            </div>
            <p className="text-[9px] mt-0.5" style={{ color: 'var(--pc-text-faint)' }}>
              Managed by connecting nodes on the canvas
            </p>
          </div>
        )}

        {/* Delete */}
        <button
          onClick={() => onDelete(node.id)}
          className="w-full btn-secondary px-3 py-2 text-xs font-medium flex items-center justify-center gap-2 mt-4"
          style={{ color: '#f87171' }}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete Task
        </button>
      </div>
    </div>
  );
}
