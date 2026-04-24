import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ArrowLeft,
  AlertTriangle,
  X,
  Plus,
  LayoutGrid,
  Code,
  Zap,
  GitFork,
} from 'lucide-react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  MarkerType,
  type Node,
  type Edge,
  type Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { WorkflowDefinition } from '@/types/api';
// Skills are loaded on-demand via search in TaskSidePanel
import { taskNodeTypes } from './TaskNode';
import { gateNodeTypes } from './GateNode';
import TaskSidePanel from './TaskSidePanel';
import {
  type TaskNodeData,
  parseWorkflowYaml,
  parseWorkflowMeta,
  type WorkflowMeta,
  type InputDef,
  tasksToFlow,
  flowToTasks,
  tasksToYaml,
  GATE_EDGE_STYLES,
} from './yamlSync';

const allNodeTypes = { ...taskNodeTypes, ...gateNodeTypes };
import { hasCycle, layoutNodes } from '@/components/teams/graphHelpers';

function defaultNodeData(id: string, overrides?: Partial<TaskNodeData>): TaskNodeData {
  return {
    label: id,
    taskId: id,
    name: id,
    description: '',
    action: 'task',
    agentHints: [],
    skills: [],
    assign: '',
    paramCount: 0,
    dependencyCount: 0,
    condition: '',
    channel: '',
    channels: [],
    agentType: '',
    role: '',
    prompt: '',
    timeout: 300,
    parallelJoin: 'all',
    gotoTarget: '',
    gotoMaxIterations: 3,
    groupChatTopic: '',
    groupChatParticipants: [],
    groupChatMaxRounds: 8,
    supervisorTask: '',
    supervisorMaxIterations: 5,
    shellCommand: '',
    outputFormat: 'markdown',
    entityName: '',
    entityKind: '',
    entityTag: '',
    entitySpace: '',
    entityMetadata: {},
    handoffFrom: '',
    handoffTo: '',
    handoffReason: '',
    retry: 0,
    retryDelay: 5,
    model: '',
    shellTimeout: 60,
    shellAllowFailure: false,
    gotoCondition: '',
    parallelMaxConcurrency: 5,
    humanInputMessage: '',
    humanInputTimeout: 3600,
    humanApprovalMessage: '',
    humanApprovalTimeout: 3600,
    humanApprovalChannel: 'dashboard',
    humanApprovalChannelId: '',
    outputTemplate: '',
    a2aUrl: '',
    a2aSkillId: '',
    a2aMessage: '',
    a2aTimeout: 300,
    resolveKind: '',
    resolveTag: 'published',
    resolveNamePattern: '',
    resolveSpace: '',
    resolveMode: 'latest',
    resolveFields: [],
    resolveFailIfMissing: true,
    mapReduceTask: '',
    mapReduceSplits: [],
    mapReduceMapper: 'claude',
    mapReduceReducer: 'claude',
    mapReduceConcurrency: 3,
    mapReduceTimeout: 300,
    supervisorType: 'claude',
    supervisorTimeout: 300,
    groupChatModerator: 'claude',
    groupChatStrategy: 'moderator_selected',
    groupChatTimeout: 120,
    handoffTask: '',
    handoffTimeout: 300,
    forEachSteps: [],
    forEachRange: '',
    forEachItems: [],
    forEachVariable: 'item',
    forEachCarryForward: true,
    forEachFailFast: true,
    forEachMaxIterations: 20,
    notifyMessage: '',
    notifyTitle: '',
    ...overrides,
  };
}

interface WorkflowFormData {
  name: string;
  description: string;
  definition: string;
  version: string;
  tags: string[];
}

interface WorkflowEditorProps {
  workflow: WorkflowDefinition | null;
  onSave: (data: WorkflowFormData) => void;
  onCancel: () => void;
  saving: boolean;
  mode?: 'create' | 'edit' | 'duplicate';
  containerClassName?: string;
}

export default function WorkflowEditor(props: WorkflowEditorProps) {
  return (
    <ReactFlowProvider>
      <WorkflowEditorInner {...props} />
    </ReactFlowProvider>
  );
}

function WorkflowEditorInner({
  workflow,
  onSave,
  onCancel,
  saving,
  mode,
  containerClassName,
}: WorkflowEditorProps) {
  const resolvedMode: 'create' | 'edit' | 'duplicate' = mode ?? (workflow ? 'edit' : 'create');
  const [name, setName] = useState(workflow?.name ?? '');
  const [description, setDescription] = useState(workflow?.description ?? '');
  const [tags, setTags] = useState<string[]>(workflow?.tags ? [...workflow.tags] : []);
  const [tagInput, setTagInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  // skills state removed — TaskSidePanel loads skills on-demand via search
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [yamlText, setYamlText] = useState(workflow?.definition ?? '');

  const [workflowMeta, setWorkflowMeta] = useState<WorkflowMeta>({
    name: '', version: '1.0', description: '', tags: [],
    triggers: [], inputs: [], outputs: [],
    defaultCwd: '', defaultTimeout: 300, maxTotalTime: 3600, checkpoint: true,
  });

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const taskIdCounter = useRef(0);
  const connectingFrom = useRef<{ nodeId: string; handleType: string; handleId: string | null } | null>(null);
  const connectionMade = useRef(false);
  const { screenToFlowPosition } = useReactFlow();
  const canvasRef = useRef<HTMLDivElement>(null);

  // Parse initial workflow definition into graph
  const { initialNodes, initialEdges } = useMemo(() => {
    if (!workflow?.definition) return { initialNodes: [] as Node[], initialEdges: [] as Edge[] };
    const tasks = parseWorkflowYaml(workflow.definition);
    const meta = parseWorkflowMeta(workflow.definition);
    setWorkflowMeta(meta);
    const { nodes: rawNodes, edges } = tasksToFlow(tasks);
    const laidOut = layoutNodes(rawNodes, edges);
    // Restore saved positions if available
    const savedKey = `wf-positions:${workflow.name}`;
    try {
      const saved = JSON.parse(localStorage.getItem(savedKey) || '{}') as Record<string, { x: number; y: number }>;
      if (Object.keys(saved).length > 0) {
        for (const n of laidOut) {
          const s = saved[n.id];
          if (s) n.position = { x: s.x, y: s.y };
        }
      }
    } catch { /* ignore */ }
    taskIdCounter.current = tasks.length;
    return { initialNodes: laidOut, initialEdges: edges };
  }, [workflow]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Persist node positions to localStorage after drag
  const onNodeDragStop = useCallback((_: React.MouseEvent, _node: Node) => {
    const savedKey = `wf-positions:${name}`;
    const positions: Record<string, { x: number; y: number }> = {};
    for (const n of nodes) positions[n.id] = n.position;
    try { localStorage.setItem(savedKey, JSON.stringify(positions)); } catch { /* ignore */ }
  }, [nodes, name]);

  // Skills are loaded on-demand via search in TaskSidePanel

  // Sync YAML when switching to advanced view
  useEffect(() => {
    if (showAdvanced) {
      const tasks = flowToTasks(nodes as Node<TaskNodeData>[], edges);
      setYamlText(tasksToYaml(tasks, { ...workflowMeta, name, description }));
    }
  }, [showAdvanced]); // intentionally only on toggle

  // Get center of visible canvas in flow coordinates
  const getViewportCenter = useCallback(() => {
    const el = canvasRef.current;
    if (!el) return { x: 200, y: 200 };
    const rect = el.getBoundingClientRect();
    return screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
  }, [screenToFlowPosition]);

  // Add new task node
  const addTask = useCallback(() => {
    const id = `task-${++taskIdCounter.current}`;
    const center = getViewportCenter();
    const newNode: Node<TaskNodeData> = {
      id,
      type: 'taskNode',
      position: {
        x: center.x - 110,
        y: center.y - 40,
      },
      data: defaultNodeData(id),
    };
    setNodes((nds) => [...nds, newNode]);
    setSelectedNodeId(id);
  }, [getViewportCenter, setNodes]);

  // Add new gate node
  const addGate = useCallback(() => {
    const id = `gate-${++taskIdCounter.current}`;
    const center = getViewportCenter();
    const newNode: Node<TaskNodeData> = {
      id,
      type: 'gateNode',
      position: {
        x: center.x - 100,
        y: center.y - 40,
      },
      data: defaultNodeData(id, { action: 'gate' }),
    };
    setNodes((nds) => [...nds, newNode]);
    setSelectedNodeId(id);
  }, [getViewportCenter, setNodes]);

  // Connect nodes (dependency edge or gate branch)
  const onConnect = useCallback(
    (connection: Connection) => {
      connectionMade.current = true;
      if (!connection.source || !connection.target) return;
      // Prevent duplicate edges
      const exists = edges.some(
        (e) =>
          e.source === connection.source &&
          e.target === connection.target &&
          e.sourceHandle === (connection.sourceHandle ?? null),
      );
      if (exists) return;

      // Determine edge style based on source handle (gate branches)
      const branch = connection.sourceHandle as 'true' | 'false' | null;
      const isBranch = branch === 'true' || branch === 'false';
      const edgeStyle = isBranch ? GATE_EDGE_STYLES[branch] : GATE_EDGE_STYLES.default;
      const edgeColor = isBranch ? edgeStyle.stroke : '#f97316';

      const newEdge: Edge = {
        id: `${connection.source}->${branch ? branch + '->' : ''}${connection.target}`,
        source: connection.source,
        sourceHandle: connection.sourceHandle,
        target: connection.target,
        type: 'default',
        animated: true,
        selectable: true,
        interactionWidth: 20,
        style: edgeStyle,
        markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor },
        ...(isBranch ? {
          label: branch,
          labelStyle: { fill: edgeColor, fontSize: 10, fontWeight: 600 },
        } : {}),
      };
      setEdges((eds) => [...eds, newEdge]);

      // Update dependency count on target node (only for non-branch edges)
      if (!isBranch) {
        setNodes((nds) =>
          nds.map((n) =>
            n.id === connection.target
              ? { ...n, data: { ...n.data, dependencyCount: (n.data as TaskNodeData).dependencyCount + 1 } }
              : n,
          ),
        );
      }
    },
    [edges, setEdges, setNodes],
  );

  // Track connection start for drop-to-create
  const onConnectStart = useCallback(
    (_: unknown, params: { nodeId: string | null; handleType: string | null; handleId: string | null }) => {
      connectionMade.current = false;
      if (params.nodeId && params.handleType) {
        connectingFrom.current = { nodeId: params.nodeId, handleType: params.handleType, handleId: params.handleId || null };
      }
    },
    [],
  );

  // Drop noodle on empty space → create a new node and connect it
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent) => {
      const from = connectingFrom.current;
      connectingFrom.current = null;
      if (!from) return;

      // If onConnect already fired, the noodle landed on a valid target — don't create a node
      if (connectionMade.current) return;

      // Also check DOM in case onConnect didn't fire but we landed on a node/handle
      const target = (event as MouseEvent).target as HTMLElement;
      if (target?.closest('.react-flow__node') || target?.closest('.react-flow__handle')) return;

      // Get drop position in flow coordinates
      const touch = 'changedTouches' in event ? (event as TouchEvent).changedTouches?.[0] : null;
      const clientX = touch ? touch.clientX : (event as MouseEvent).clientX;
      const clientY = touch ? touch.clientY : (event as MouseEvent).clientY;
      const position = screenToFlowPosition({ x: clientX, y: clientY });

      // Create new node
      const id = `task-${++taskIdCounter.current}`;
      const newNode: Node<TaskNodeData> = {
        id,
        type: 'taskNode',
        position,
        data: defaultNodeData(id, {
          dependencyCount: from.handleType === 'source' && !from.handleId ? 1 : 0,
        }),
      };

      // Create edge: source handle → new node is a dependency, target handle → new node feeds into source
      const isFromSource = from.handleType === 'source';
      const edgeSource = isFromSource ? from.nodeId : id;
      const edgeTarget = isFromSource ? id : from.nodeId;

      // Determine if this is a gate branch edge
      const branch = from.handleId as 'true' | 'false' | null;
      const isBranch = branch === 'true' || branch === 'false';
      const edgeStyle = isBranch ? GATE_EDGE_STYLES[branch] : GATE_EDGE_STYLES.default;
      const edgeColor = isBranch ? edgeStyle.stroke : '#f97316';

      const newEdge: Edge = {
        id: `${edgeSource}->${branch ? branch + '->' : ''}${edgeTarget}`,
        source: edgeSource,
        sourceHandle: from.handleId,
        target: edgeTarget,
        type: 'default',
        animated: true,
        selectable: true,
        interactionWidth: 20,
        style: edgeStyle,
        markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor },
        ...(isBranch ? {
          label: branch,
          labelStyle: { fill: edgeColor, fontSize: 10, fontWeight: 600 },
        } : {}),
      };

      setNodes((nds) => {
        // Update dependency count on target node if it's an existing node
        const updated = isFromSource
          ? nds
          : nds.map((n) =>
              n.id === from.nodeId
                ? { ...n, data: { ...n.data, dependencyCount: (n.data as TaskNodeData).dependencyCount + 1 } }
                : n,
            );
        return [...updated, newNode];
      });
      setEdges((eds) => [...eds, newEdge]);
      setSelectedNodeId(id);
    },
    [screenToFlowPosition, setNodes, setEdges],
  );

  // Handle edge deletion
  const onEdgesDelete = useCallback(
    (deletedEdges: Edge[]) => {
      // Update dependency counts
      const targetCounts = new Map<string, number>();
      for (const e of deletedEdges) {
        targetCounts.set(e.target, (targetCounts.get(e.target) || 0) + 1);
      }
      setNodes((nds) =>
        nds.map((n) => {
          const dec = targetCounts.get(n.id);
          if (!dec) return n;
          return {
            ...n,
            data: {
              ...n.data,
              dependencyCount: Math.max(0, (n.data as TaskNodeData).dependencyCount - dec),
            },
          };
        }),
      );
    },
    [setNodes],
  );

  // Node selection
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  // Update node data from side panel
  const handleNodeUpdate = useCallback(
    (nodeId: string, updates: Partial<TaskNodeData>) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, ...updates } } : n,
        ),
      );
    },
    [setNodes],
  );

  // Delete node
  const handleNodeDelete = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      if (selectedNodeId === nodeId) setSelectedNodeId(null);
    },
    [setNodes, setEdges, selectedNodeId],
  );

  // Auto-layout
  const handleLayout = useCallback(() => {
    setNodes((nds) => layoutNodes([...nds], edges));
  }, [edges, setNodes]);

  // Import from YAML (advanced tab)
  const handleYamlImport = useCallback(() => {
    try {
      const tasks = parseWorkflowYaml(yamlText);
      if (tasks.length === 0) {
        setError('No tasks found in YAML. Ensure the YAML has a "steps:" section.');
        return;
      }
      const meta = parseWorkflowMeta(yamlText);
      setWorkflowMeta(meta);
      const { nodes: rawNodes, edges: newEdges } = tasksToFlow(tasks);
      const laidOut = layoutNodes(rawNodes, newEdges);
      setNodes(laidOut);
      setEdges(newEdges);
      taskIdCounter.current = tasks.length;
      setShowAdvanced(false);
      setError(null);
    } catch {
      setError('Failed to parse YAML. Check syntax.');
    }
  }, [yamlText, setNodes, setEdges]);

  // Tag handling
  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const value = tagInput.trim().toLowerCase();
      if (value && !tags.includes(value)) {
        setTags((t) => [...t, value]);
      }
      setTagInput('');
    }
    if (e.key === 'Backspace' && tagInput === '' && tags.length > 0) {
      setTags((t) => t.slice(0, -1));
    }
  };

  // Save
  const handleSave = useCallback(() => {
    setError(null);
    setWarning(null);

    if (!name.trim()) {
      setError('Workflow name is required.');
      return;
    }
    if (!description.trim()) {
      setError('Workflow description is required.');
      return;
    }
    if (nodes.length === 0) {
      setError('Add at least one task to the workflow.');
      return;
    }
    if (hasCycle(nodes, edges)) {
      setError('Cannot save: workflow has cycles. Remove a dependency to break the cycle.');
      return;
    }

    const tasks = flowToTasks(nodes as Node<TaskNodeData>[], edges);
    const definition = tasksToYaml(tasks, { ...workflowMeta, name: name.trim(), description: description.trim() });

    onSave({
      name: name.trim(),
      description: description.trim(),
      definition,
      version: workflowMeta.version || '', // managed by Kumiho revision
      tags,
    });
  }, [name, description, tags, nodes, edges, workflowMeta, onSave]);

  // Selected node for side panel
  const selectedNode = useMemo(
    () => (selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) : null),
    [selectedNodeId, nodes],
  );

  // MiniMap color
  const miniMapNodeColor = useCallback(() => 'var(--pc-accent)', []);

  return (
    <div className={containerClassName ?? 'flex flex-col h-[calc(100vh-3.5rem)] animate-fade-in'}>
      {/* Top bar */}
      <div
        className="flex items-center gap-3 px-5 py-2.5 border-b"
        style={{ borderColor: 'var(--pc-border)', background: 'var(--pc-bg-surface)' }}
      >
        <button className="btn-icon" onClick={onCancel} title="Back" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </button>

        <div className="flex-1 flex items-center gap-3 min-w-0">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Workflow Name"
            className="bg-transparent text-lg font-bold outline-none border-none"
            style={{ color: 'var(--pc-text-primary)', minWidth: 180, maxWidth: 300 }}
            disabled={resolvedMode === 'edit'}
          />
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description"
            className="bg-transparent text-sm outline-none border-none flex-1 min-w-0"
            style={{ color: 'var(--pc-text-muted)' }}
          />
        </div>

        <div className="flex items-center gap-2">
          {/* Revision (managed by Kumiho) */}
          {workflow && (
            <span className="text-xs font-mono px-2 py-0.5 rounded" style={{ color: 'var(--pc-text-muted)', background: 'var(--pc-bg-base)' }}>
              rev {workflow.revision_number}
            </span>
          )}

          {/* Tags */}
          <div
            className="flex items-center gap-1 px-2 py-1 rounded-lg border min-w-[120px] max-w-[240px]"
            style={{ borderColor: 'var(--pc-border)', background: 'var(--pc-bg-base)' }}
          >
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0"
                style={{ background: 'var(--pc-accent-glow)', color: 'var(--pc-accent-light)' }}
              >
                {tag}
                <button type="button" onClick={() => setTags((t) => t.filter((x) => x !== tag))} className="hover:opacity-70">
                  <X className="h-2 w-2" />
                </button>
              </span>
            ))}
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              placeholder={tags.length === 0 ? 'Tags...' : ''}
              className="flex-1 min-w-[40px] bg-transparent border-none outline-none text-[11px]"
              style={{ color: 'var(--pc-text-primary)' }}
            />
          </div>

          <button className="btn-secondary px-3 py-1.5 text-sm" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn-electric px-4 py-1.5 text-sm font-semibold"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? (
              <span className="flex items-center gap-2">
                <span className="h-3.5 w-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Saving...
              </span>
            ) : resolvedMode === 'edit' ? 'Update' : resolvedMode === 'duplicate' ? 'Create Copy' : 'Save Workflow'}
          </button>
        </div>
      </div>

      {/* Error / Warning */}
      {error && (
        <div
          className="mx-5 mt-2 rounded-xl border p-2.5 text-sm flex items-center justify-between animate-fade-in"
          style={{ background: 'rgba(239, 68, 68, 0.08)', borderColor: 'rgba(239, 68, 68, 0.2)', color: '#f87171' }}
        >
          <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{error}</span>
          <button className="btn-icon" onClick={() => setError(null)}><X className="h-4 w-4" /></button>
        </div>
      )}
      {warning && (
        <div
          className="mx-5 mt-2 rounded-xl border p-2.5 text-sm flex items-center justify-between animate-fade-in"
          style={{ background: 'rgba(249, 115, 22, 0.08)', borderColor: 'rgba(249, 115, 22, 0.2)', color: '#f97316' }}
        >
          <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{warning}</span>
          <button className="btn-icon" onClick={() => setWarning(null)}><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* Main area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left toolbar */}
        <div
          className="w-14 flex-shrink-0 border-r flex flex-col items-center py-3 gap-2"
          style={{ borderColor: 'var(--pc-border)', background: 'var(--pc-bg-surface)' }}
        >
          <button
            onClick={addTask}
            className="p-2.5 rounded-xl transition-all hover:scale-105"
            style={{ background: 'var(--pc-accent-glow)', color: 'var(--pc-accent-light)' }}
            title="Add task"
          >
            <Plus className="h-5 w-5" />
          </button>
          <button
            onClick={addGate}
            className="p-2.5 rounded-xl transition-all hover:scale-105"
            style={{ background: '#eab30822', color: '#eab308' }}
            title="Add gate (if/else)"
          >
            <GitFork className="h-5 w-5" />
          </button>
          <button
            onClick={handleLayout}
            className="p-2.5 rounded-xl transition-all hover:scale-105"
            style={{ background: 'var(--pc-bg-base)', color: 'var(--pc-text-muted)' }}
            title="Auto-layout"
          >
            <LayoutGrid className="h-5 w-5" />
          </button>
          <div className="flex-1" />
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="p-2.5 rounded-xl transition-all hover:scale-105"
            style={{
              background: showAdvanced ? 'var(--pc-accent-glow)' : 'var(--pc-bg-base)',
              color: showAdvanced ? 'var(--pc-accent-light)' : 'var(--pc-text-muted)',
            }}
            title="Advanced (YAML)"
          >
            <Code className="h-5 w-5" />
          </button>
        </div>

        {/* Advanced YAML panel */}
        {showAdvanced && (
          <div
            className="w-80 flex-shrink-0 border-r flex flex-col animate-fade-in"
            style={{ borderColor: 'var(--pc-border)', background: 'var(--pc-bg-surface)' }}
          >
            <div className="p-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--pc-border)' }}>
              <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--pc-text-muted)' }}>
                Advanced — YAML
              </h3>
              <button
                onClick={handleYamlImport}
                className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg"
                style={{ background: 'var(--pc-accent-glow)', color: 'var(--pc-accent-light)' }}
              >
                <Zap className="h-3 w-3" />
                Import to graph
              </button>
            </div>
            <textarea
              value={yamlText}
              onChange={(e) => setYamlText(e.target.value)}
              className="flex-1 p-3 bg-transparent border-none outline-none resize-none text-xs"
              style={{
                fontFamily: 'var(--pc-font-mono)',
                fontSize: 'var(--pc-font-size-mono)',
                color: 'var(--pc-text-primary)',
              }}
              spellCheck={false}
            />
          </div>
        )}

        {/* Center canvas */}
        <div ref={canvasRef} className="flex-1 relative" style={{ background: 'var(--pc-bg-base)' }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            onEdgesDelete={onEdgesDelete}
            onNodeClick={onNodeClick}
            onNodeDragStop={onNodeDragStop}
            onPaneClick={onPaneClick}
            nodeTypes={allNodeTypes}
            fitView
            elementsSelectable
            edgesFocusable
            deleteKeyCode={['Backspace', 'Delete']}
            style={{ background: 'var(--pc-bg-base)' }}
            defaultEdgeOptions={{
              type: 'default',
              animated: true,
              selectable: true,
              style: { stroke: '#f97316', strokeWidth: 2 },
              markerEnd: { type: MarkerType.ArrowClosed, color: '#f97316' },
              interactionWidth: 20,
            }}
          >
            <Background color="var(--pc-border)" gap={20} size={1} />
            <Controls
              style={{
                background: 'var(--pc-bg-elevated)',
                borderColor: 'var(--pc-border)',
                borderRadius: '12px',
                overflow: 'hidden',
              }}
            />
            {nodes.length <= 40 && (
              <MiniMap
                style={{
                  background: 'var(--pc-bg-surface)',
                  borderRadius: '12px',
                  border: '1px solid var(--pc-border)',
                }}
                maskColor="rgba(0, 0, 0, 0.6)"
                nodeColor={miniMapNodeColor}
              />
            )}
          </ReactFlow>

          {/* Empty canvas hint */}
          {nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <Zap className="h-12 w-12 mx-auto mb-3" style={{ color: 'var(--pc-text-faint)' }} />
                <p className="text-sm" style={{ color: 'var(--pc-text-muted)' }}>
                  Click <strong>+</strong> to add tasks, then drag between nodes to set dependencies
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--pc-text-faint)' }}>
                  Or use the Advanced (YAML) panel to import an existing definition
                </p>
              </div>
            </div>
          )}

          {/* Stats bar */}
          {nodes.length > 0 && (
            <div
              className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-1.5 rounded-full text-[11px] font-medium"
              style={{
                background: 'var(--pc-bg-elevated)',
                border: '1px solid var(--pc-border)',
                color: 'var(--pc-text-muted)',
              }}
            >
              <span>{nodes.length} task{nodes.length !== 1 ? 's' : ''}</span>
              <span style={{ color: 'var(--pc-border)' }}>|</span>
              <span>{edges.length} {edges.length === 1 ? 'dependency' : 'dependencies'}</span>
              {hasCycle(nodes, edges) && (
                <>
                  <span style={{ color: 'var(--pc-border)' }}>|</span>
                  <span style={{ color: '#f87171' }}>
                    <AlertTriangle className="h-3 w-3 inline mr-1" />cycle detected
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Right side panel */}
        {selectedNode && (
          <TaskSidePanel
            node={selectedNode as Node<TaskNodeData>}
            onUpdate={handleNodeUpdate}
            onDelete={handleNodeDelete}
          />
        )}

        {/* Workflow Settings Panel — shown when no node selected */}
        {!selectedNode && (
          <div className="w-80 border-l overflow-y-auto p-4 space-y-4" style={{ borderColor: 'var(--pc-border)', background: 'var(--pc-bg-elevated)' }}>
            <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--pc-accent)' }}>
              Workflow Settings
            </div>

            {/* Version */}
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--pc-text-faint)' }}>
                Version
              </label>
              <input
                type="text"
                value={workflowMeta.version}
                onChange={(e) => setWorkflowMeta(prev => ({ ...prev, version: e.target.value }))}
                className="input-electric w-full px-2 py-1.5 text-sm"
              />
            </div>

            {/* Execution Defaults */}
            <div className="space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--pc-text-muted)' }}>
                Execution Defaults
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--pc-text-faint)' }}>
                    Step Timeout (s)
                  </label>
                  <input
                    type="number"
                    value={workflowMeta.defaultTimeout}
                    onChange={(e) => setWorkflowMeta(prev => ({ ...prev, defaultTimeout: parseInt(e.target.value) || 300 }))}
                    className="input-electric w-full px-2 py-1.5 text-sm"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--pc-text-faint)' }}>
                    Max Total (s)
                  </label>
                  <input
                    type="number"
                    value={workflowMeta.maxTotalTime}
                    onChange={(e) => setWorkflowMeta(prev => ({ ...prev, maxTotalTime: parseInt(e.target.value) || 3600 }))}
                    className="input-electric w-full px-2 py-1.5 text-sm"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={workflowMeta.checkpoint}
                  onChange={(e) => setWorkflowMeta(prev => ({ ...prev, checkpoint: e.target.checked }))}
                  className="h-4 w-4 rounded accent-[var(--pc-accent)]"
                />
                <span className="text-xs" style={{ color: 'var(--pc-text-muted)' }}>Enable checkpoints</span>
              </label>
            </div>

            {/* Triggers */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#f59e0b' }}>
                  Triggers ({workflowMeta.triggers.length})
                </div>
                <button
                  className="text-xs px-2 py-0.5 rounded"
                  style={{ background: 'var(--pc-bg-elevated)', color: 'var(--pc-accent)' }}
                  onClick={() => setWorkflowMeta(prev => ({
                    ...prev,
                    triggers: [...prev.triggers, { onKind: '', onTag: 'ready', onNamePattern: '', inputMap: {} }],
                  }))}
                >
                  + Add
                </button>
              </div>
              {workflowMeta.triggers.map((trigger, ti) => (
                <div key={ti} className="rounded-lg border p-2 space-y-1.5" style={{ borderColor: 'var(--pc-border)', background: 'var(--pc-bg-base)' }}>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold" style={{ color: 'var(--pc-text-faint)' }}>
                      {trigger.inputMap.__cron ? 'Cron Trigger' : 'Entity Trigger'}
                    </span>
                    <button
                      className="text-[10px] px-1.5 py-0.5 rounded"
                      style={{ color: '#ef4444' }}
                      onClick={() => setWorkflowMeta(prev => ({
                        ...prev, triggers: prev.triggers.filter((_, i) => i !== ti),
                      }))}
                    >
                      Remove
                    </button>
                  </div>
                  {trigger.inputMap.__cron ? (
                    <input
                      type="text"
                      value={trigger.inputMap.__cron}
                      onChange={(e) => {
                        const triggers = [...workflowMeta.triggers];
                        triggers[ti] = { ...triggers[ti]!, inputMap: { ...triggers[ti]!.inputMap, __cron: e.target.value } };
                        setWorkflowMeta(prev => ({ ...prev, triggers }));
                      }}
                      placeholder="0 9 * * 1 (cron expression)"
                      className="input-electric w-full px-2 py-1 text-xs font-mono"
                    />
                  ) : (
                    <>
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          value={trigger.onKind}
                          onChange={(e) => {
                            const triggers = [...workflowMeta.triggers];
                            triggers[ti] = { ...triggers[ti]!, onKind: e.target.value };
                            setWorkflowMeta(prev => ({ ...prev, triggers }));
                          }}
                          placeholder="Entity kind"
                          className="input-electric flex-1 px-2 py-1 text-xs font-mono"
                        />
                        <input
                          type="text"
                          value={trigger.onTag}
                          onChange={(e) => {
                            const triggers = [...workflowMeta.triggers];
                            triggers[ti] = { ...triggers[ti]!, onTag: e.target.value };
                            setWorkflowMeta(prev => ({ ...prev, triggers }));
                          }}
                          placeholder="Tag"
                          className="input-electric w-20 px-2 py-1 text-xs font-mono"
                        />
                      </div>
                      {Object.entries(trigger.inputMap).filter(([k]) => k !== '__cron').map(([mk, mv]) => (
                        <div key={mk} className="flex gap-1 items-center text-[10px]">
                          <span className="font-mono" style={{ color: 'var(--pc-text-faint)' }}>{mk}:</span>
                          <span className="font-mono truncate" style={{ color: 'var(--pc-text-muted)' }}>{mv}</span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              ))}
            </div>

            {/* Inputs */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#22c55e' }}>
                  Inputs ({workflowMeta.inputs.length})
                </div>
                <button
                  className="text-xs px-2 py-0.5 rounded"
                  style={{ background: 'var(--pc-bg-elevated)', color: 'var(--pc-accent)' }}
                  onClick={() => setWorkflowMeta(prev => ({
                    ...prev,
                    inputs: [...prev.inputs, { name: '', type: 'string', required: true, default: '', description: '' }],
                  }))}
                >
                  + Add
                </button>
              </div>
              {workflowMeta.inputs.map((input, ii) => (
                <div key={ii} className="rounded-lg border p-2 space-y-1" style={{ borderColor: 'var(--pc-border)', background: 'var(--pc-bg-base)' }}>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={input.name}
                      onChange={(e) => {
                        const inputs = [...workflowMeta.inputs];
                        inputs[ii] = { ...inputs[ii]!, name: e.target.value };
                        setWorkflowMeta(prev => ({ ...prev, inputs }));
                      }}
                      placeholder="Parameter name"
                      className="input-electric flex-1 px-2 py-1 text-xs font-mono"
                    />
                    <select
                      value={input.type}
                      onChange={(e) => {
                        const inputs = [...workflowMeta.inputs];
                        inputs[ii] = { ...inputs[ii]!, type: e.target.value as InputDef['type'] };
                        setWorkflowMeta(prev => ({ ...prev, inputs }));
                      }}
                      className="input-electric w-20 px-1 py-1 text-[10px]"
                    >
                      <option value="string">string</option>
                      <option value="number">number</option>
                      <option value="boolean">boolean</option>
                      <option value="list">list</option>
                    </select>
                    <button
                      className="text-[10px] px-1"
                      style={{ color: '#ef4444' }}
                      onClick={() => setWorkflowMeta(prev => ({
                        ...prev, inputs: prev.inputs.filter((_, i) => i !== ii),
                      }))}
                    >
                      ×
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={input.required}
                        onChange={(e) => {
                          const inputs = [...workflowMeta.inputs];
                          inputs[ii] = { ...inputs[ii]!, required: e.target.checked };
                          setWorkflowMeta(prev => ({ ...prev, inputs }));
                        }}
                        className="h-3 w-3 rounded accent-[var(--pc-accent)]"
                      />
                      <span className="text-[10px]" style={{ color: 'var(--pc-text-muted)' }}>Required</span>
                    </label>
                    <input
                      type="text"
                      value={input.default}
                      onChange={(e) => {
                        const inputs = [...workflowMeta.inputs];
                        inputs[ii] = { ...inputs[ii]!, default: e.target.value };
                        setWorkflowMeta(prev => ({ ...prev, inputs }));
                      }}
                      placeholder="Default value"
                      className="input-electric flex-1 px-2 py-0.5 text-[10px]"
                    />
                  </div>
                  <input
                    type="text"
                    value={input.description}
                    onChange={(e) => {
                      const inputs = [...workflowMeta.inputs];
                      inputs[ii] = { ...inputs[ii]!, description: e.target.value };
                      setWorkflowMeta(prev => ({ ...prev, inputs }));
                    }}
                    placeholder="Description"
                    className="input-electric w-full px-2 py-0.5 text-[10px]"
                  />
                </div>
              ))}
            </div>

            {/* Outputs */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#3b82f6' }}>
                  Outputs ({workflowMeta.outputs.length})
                </div>
                <button
                  className="text-xs px-2 py-0.5 rounded"
                  style={{ background: 'var(--pc-bg-elevated)', color: 'var(--pc-accent)' }}
                  onClick={() => setWorkflowMeta(prev => ({
                    ...prev,
                    outputs: [...prev.outputs, { name: '', source: '', description: '' }],
                  }))}
                >
                  + Add
                </button>
              </div>
              {workflowMeta.outputs.map((output, oi) => (
                <div key={oi} className="rounded-lg border p-2 space-y-1" style={{ borderColor: 'var(--pc-border)', background: 'var(--pc-bg-base)' }}>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={output.name}
                      onChange={(e) => {
                        const outputs = [...workflowMeta.outputs];
                        outputs[oi] = { ...outputs[oi]!, name: e.target.value };
                        setWorkflowMeta(prev => ({ ...prev, outputs }));
                      }}
                      placeholder="Output name"
                      className="input-electric flex-1 px-2 py-1 text-xs font-mono"
                    />
                    <button
                      className="text-[10px] px-1"
                      style={{ color: '#ef4444' }}
                      onClick={() => setWorkflowMeta(prev => ({
                        ...prev, outputs: prev.outputs.filter((_, i) => i !== oi),
                      }))}
                    >
                      ×
                    </button>
                  </div>
                  <input
                    type="text"
                    value={output.source}
                    onChange={(e) => {
                      const outputs = [...workflowMeta.outputs];
                      outputs[oi] = { ...outputs[oi]!, source: e.target.value };
                      setWorkflowMeta(prev => ({ ...prev, outputs }));
                    }}
                    placeholder="${step_id.output}"
                    className="input-electric w-full px-2 py-0.5 text-[10px] font-mono"
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
