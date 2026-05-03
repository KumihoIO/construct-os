/**
 * WorkflowEditor — P0 redesign on Construct dashboard tokens.
 *
 * Replaces the legacy `web/src/components/workflows/WorkflowEditor.tsx`.
 * Reuses the same data layer (yamlSync) so the YAML schema and the rest of
 * the dashboard (Dashboard, Workflows page DAG view) keep working.
 *
 * Surfaces:
 *   - Toolbar `+ Add Step` button → opens StepTypePalette
 *   - ⌘K / Ctrl+K → opens StepTypePalette
 *   - Right-click on empty canvas → context menu
 *   - Drop a noodle on empty canvas → opens palette in "source" mode
 *   - Empty canvas → EditorCommandList overlay
 *
 * Side panel: StepConfigPanel (replacement for legacy TaskSidePanel).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Code,
  Crosshair,
  LayoutGrid,
  Plus,
  X,
  Zap,
} from 'lucide-react';
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type { WorkflowDefinition } from '@/types/api';
import { taskNodeTypes } from '@/components/workflows/TaskNode';
import { gateNodeTypes } from '@/components/workflows/GateNode';
import {
  GATE_EDGE_STYLES,
  flowToTasks,
  parseWorkflowMeta,
  parseWorkflowYaml,
  tasksToFlow,
  tasksToYaml,
  type InputDef,
  type TaskNodeData,
  type WorkflowMeta,
} from '@/components/workflows/yamlSync';
import { hasCycle, layoutNodes } from '@/components/teams/graphHelpers';

import Panel from '@/construct/components/ui/Panel';
import EditorCommandList from './EditorCommandList';
import StepConfigPanel from './StepConfigPanel';
import StepTypePalette from './StepTypePalette';
import { ADD_STEP_EVENT, type AddStepDetail } from './stepEvents';
import '@/construct/styles/editor-chrome.css';

const allNodeTypes = { ...taskNodeTypes, ...gateNodeTypes };

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

// ---------------------------------------------------------------------------
// Default node data — mirrors legacy editor (must include every TaskNodeData
// field or React Flow will see undefined).
// ---------------------------------------------------------------------------

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
    pythonScript: '',
    pythonCode: '',
    pythonArgs: '',
    pythonTimeout: 60,
    pythonAllowFailure: false,
    emailTo: '',
    emailSubject: '',
    emailBody: '',
    emailBodyHtml: '',
    emailFrom: '',
    emailCc: '',
    emailBcc: '',
    emailReplyTo: '',
    emailTrackClicks: false,
    emailTrackKref: '',
    emailTrackBaseUrl: '',
    emailSmtpHost: '',
    emailDryRun: false,
    emailTimeout: 30,
    tagItemKref: '',
    tagValue: '',
    tagUntag: '',
    deprecateItemKref: '',
    deprecateReason: '',
    ...overrides,
  };
}

// Map a step-type from the registry → legacy `action` field used by yamlSync.
function actionForType(type: string): string {
  // For "conditional" we still store action='gate' so legacy gate handles work.
  if (type === 'conditional') return 'gate';
  return type;
}

// Build initial node data overrides for a given step type (so a freshly
// inserted node starts with the right defaults, e.g. action=shell).
function defaultsForType(type: string): Partial<TaskNodeData> {
  const action = actionForType(type);
  return { action };
}

// ---------------------------------------------------------------------------
// Right-click context menu
// ---------------------------------------------------------------------------

interface ContextMenuState {
  screenX: number;
  screenY: number;
  flowX: number;
  flowY: number;
}

// ---------------------------------------------------------------------------
// Inner editor (uses ReactFlow context)
// ---------------------------------------------------------------------------

function WorkflowEditorInner({
  workflow,
  onSave,
  onCancel,
  saving,
  mode,
  containerClassName,
}: WorkflowEditorProps) {
  const resolvedMode: 'create' | 'edit' | 'duplicate' = mode ?? (workflow ? 'edit' : 'create');
  const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

  // ── Workflow-level state ────────────────────────────────────────────────
  const [name, setName] = useState(workflow?.name ?? '');
  const [description, setDescription] = useState(workflow?.description ?? '');
  const [tags, setTags] = useState<string[]>(workflow?.tags ? [...workflow.tags] : []);
  const [tagInput, setTagInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [yamlText, setYamlText] = useState(workflow?.definition ?? '');

  const [workflowMeta, setWorkflowMeta] = useState<WorkflowMeta>({
    name: '',
    version: '1.0',
    description: '',
    tags: [],
    triggers: [],
    inputs: [],
    outputs: [],
    defaultCwd: '',
    defaultTimeout: 300,
    maxTotalTime: 3600,
    checkpoint: true,
  });

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteContext, setPaletteContext] = useState<
    Pick<AddStepDetail, 'position' | 'source'> | undefined
  >(undefined);
  const [changeTypeFor, setChangeTypeFor] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const taskIdCounter = useRef(0);
  const connectingFrom = useRef<{ nodeId: string; handleType: string; handleId: string | null } | null>(null);
  const connectionMade = useRef(false);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const canvasRef = useRef<HTMLDivElement>(null);

  // Parse initial workflow definition.
  const { initialNodes, initialEdges } = useMemo(() => {
    if (!workflow?.definition) return { initialNodes: [] as Node[], initialEdges: [] as Edge[] };
    const tasks = parseWorkflowYaml(workflow.definition);
    const meta = parseWorkflowMeta(workflow.definition);
    setWorkflowMeta(meta);
    const { nodes: rawNodes, edges } = tasksToFlow(tasks);
    const laidOut = layoutNodes(rawNodes, edges);
    const savedKey = `wf-positions:${workflow.name}`;
    try {
      const saved = JSON.parse(localStorage.getItem(savedKey) || '{}') as Record<
        string,
        { x: number; y: number }
      >;
      if (Object.keys(saved).length > 0) {
        for (const n of laidOut) {
          const s = saved[n.id];
          if (s) n.position = { x: s.x, y: s.y };
        }
      }
    } catch {
      /* ignore */
    }
    taskIdCounter.current = tasks.length;
    return { initialNodes: laidOut, initialEdges: edges };
  }, [workflow]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const selectedNode = useMemo(
    () => (selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) ?? null : null),
    [selectedNodeId, nodes],
  );

  // ── Position helpers ────────────────────────────────────────────────────
  const getViewportCenter = useCallback(() => {
    const el = canvasRef.current;
    if (!el) return { x: 200, y: 200 };
    const rect = el.getBoundingClientRect();
    return screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  }, [screenToFlowPosition]);

  // ── Persist node positions ──────────────────────────────────────────────
  const onNodeDragStop = useCallback(() => {
    const savedKey = `wf-positions:${name}`;
    const positions: Record<string, { x: number; y: number }> = {};
    for (const n of nodes) positions[n.id] = n.position;
    try {
      localStorage.setItem(savedKey, JSON.stringify(positions));
    } catch {
      /* ignore */
    }
  }, [nodes, name]);

  // ── Add a new step (called via construct:add-step event) ────────────────
  const insertStep = useCallback(
    (detail: AddStepDetail) => {
      const id = `step-${++taskIdCounter.current}`;
      const isGate = detail.type === 'conditional';
      const position =
        detail.position ??
        (() => {
          const c = getViewportCenter();
          return { x: c.x - 110, y: c.y - 40 };
        })();

      const data = defaultNodeData(id, defaultsForType(detail.type));
      if (detail.presetSkill && !data.skills.includes(detail.presetSkill)) {
        data.skills = [...data.skills, detail.presetSkill];
      }

      const newNode: Node<TaskNodeData> = {
        id,
        type: isGate ? 'gateNode' : 'taskNode',
        position,
        data,
      };

      // If a source was provided, also create an edge from source → new node.
      let newEdge: Edge | null = null;
      if (detail.source?.taskId) {
        const handle = detail.source.handle ?? null;
        const isBranch = handle === 'true' || handle === 'false';
        const edgeStyle = isBranch ? GATE_EDGE_STYLES[handle] : GATE_EDGE_STYLES.default;
        const edgeColor = edgeStyle.stroke;
        newEdge = {
          id: `${detail.source.taskId}->${handle ? handle + '->' : ''}${id}`,
          source: detail.source.taskId,
          target: id,
          sourceHandle: handle,
          type: 'default',
          animated: true,
          selectable: true,
          interactionWidth: 20,
          style: edgeStyle,
          markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor },
          ...(isBranch
            ? { label: handle, labelStyle: { fill: edgeColor, fontSize: 10, fontWeight: 600 } }
            : {}),
        };
      }

      setNodes((nds) => {
        if (newEdge && !newEdge.sourceHandle) {
          // Bump dependency count for the new node
          newNode.data = { ...newNode.data, dependencyCount: 1 };
        }
        return [...nds, newNode];
      });
      if (newEdge) setEdges((eds) => [...eds, newEdge!]);
      setSelectedNodeId(id);
    },
    [getViewportCenter, setNodes, setEdges],
  );

  // ── Subscribe to global add-step events ─────────────────────────────────
  useEffect(() => {
    const handler = (event: Event) => {
      const ce = event as CustomEvent<AddStepDetail>;
      if (!ce.detail) return;
      insertStep(ce.detail);
    };
    window.addEventListener(ADD_STEP_EVENT, handler as EventListener);
    return () => window.removeEventListener(ADD_STEP_EVENT, handler as EventListener);
  }, [insertStep]);

  // Forward ref so the ⌘I keydown effect (registered before openYamlPanel
  // is declared) can dispatch to the latest callback.
  const openYamlPanelRef = useRef<() => void>(() => {});

  // ── ⌘K / ⌘I shortcuts ───────────────────────────────────────────────────
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const inField =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (inField) return;

      const mod = isMac ? event.metaKey : event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteContext(undefined);
        setChangeTypeFor(null);
        setPaletteOpen(true);
      } else if (mod && event.key.toLowerCase() === 'i') {
        event.preventDefault();
        openYamlPanelRef.current();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isMac]);

  // ── React Flow handlers ─────────────────────────────────────────────────
  const onConnect = useCallback(
    (connection: Connection) => {
      connectionMade.current = true;
      if (!connection.source || !connection.target) return;
      const exists = edges.some(
        (e) =>
          e.source === connection.source &&
          e.target === connection.target &&
          e.sourceHandle === (connection.sourceHandle ?? null),
      );
      if (exists) return;
      const branch = connection.sourceHandle as 'true' | 'false' | null;
      const isBranch = branch === 'true' || branch === 'false';
      const edgeStyle = isBranch ? GATE_EDGE_STYLES[branch] : GATE_EDGE_STYLES.default;
      const edgeColor = edgeStyle.stroke;

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
        ...(isBranch
          ? { label: branch, labelStyle: { fill: edgeColor, fontSize: 10, fontWeight: 600 } }
          : {}),
      };
      setEdges((eds) => [...eds, newEdge]);
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

  const onConnectStart = useCallback(
    (
      _: unknown,
      params: { nodeId: string | null; handleType: string | null; handleId: string | null },
    ) => {
      connectionMade.current = false;
      if (params.nodeId && params.handleType) {
        connectingFrom.current = {
          nodeId: params.nodeId,
          handleType: params.handleType,
          handleId: params.handleId || null,
        };
      }
    },
    [],
  );

  // Drop a noodle into empty space → open the palette with source context.
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent) => {
      const from = connectingFrom.current;
      connectingFrom.current = null;
      if (!from) return;
      if (connectionMade.current) return;
      const target = (event as MouseEvent).target as HTMLElement;
      if (target?.closest('.react-flow__node') || target?.closest('.react-flow__handle')) return;

      const touch = 'changedTouches' in event ? (event as TouchEvent).changedTouches?.[0] : null;
      const clientX = touch ? touch.clientX : (event as MouseEvent).clientX;
      const clientY = touch ? touch.clientY : (event as MouseEvent).clientY;
      const position = screenToFlowPosition({ x: clientX, y: clientY });

      // Only "from source" handles auto-wire the new node as a downstream
      // dependency. Reverse drops (target → empty) are out of P0 scope.
      if (from.handleType !== 'source') return;

      setPaletteContext({
        position,
        source: { taskId: from.nodeId, handle: from.handleId as 'true' | 'false' | null },
      });
      setChangeTypeFor(null);
      setPaletteOpen(true);
    },
    [screenToFlowPosition],
  );

  const onEdgesDelete = useCallback(
    (deletedEdges: Edge[]) => {
      const targetCounts = new Map<string, number>();
      for (const e of deletedEdges) targetCounts.set(e.target, (targetCounts.get(e.target) || 0) + 1);
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

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setContextMenu(null);
  }, []);

  // Right-click on canvas pane.
  const onPaneContextMenu = useCallback(
    (event: React.MouseEvent | MouseEvent) => {
      event.preventDefault();
      const flowPos = screenToFlowPosition({
        x: (event as MouseEvent).clientX,
        y: (event as MouseEvent).clientY,
      });
      setContextMenu({
        screenX: (event as MouseEvent).clientX,
        screenY: (event as MouseEvent).clientY,
        flowX: flowPos.x,
        flowY: flowPos.y,
      });
    },
    [screenToFlowPosition],
  );

  // ── Side panel updates ──────────────────────────────────────────────────
  const handleNodeUpdate = useCallback(
    (nodeId: string, updates: Partial<TaskNodeData>) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...updates } } : n)),
      );
    },
    [setNodes],
  );

  const handleNodeDelete = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      if (selectedNodeId === nodeId) setSelectedNodeId(null);
    },
    [setNodes, setEdges, selectedNodeId],
  );

  // Switch a node's type — keeps name/description/skills, drops type-specific
  // fields by re-creating data from defaults.
  const handleChangeType = useCallback(
    (nodeId: string, newType: string) => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== nodeId) return n;
          const old = n.data as TaskNodeData;
          const fresh = defaultNodeData(old.taskId, {
            ...defaultsForType(newType),
            taskId: old.taskId,
            label: old.label,
            name: old.name,
            description: old.description,
            agentHints: old.agentHints,
            skills: old.skills,
            assign: old.assign,
            paramCount: old.paramCount,
            dependencyCount: old.dependencyCount,
            retry: old.retry,
            retryDelay: old.retryDelay,
            channels: old.channels,
            channel: old.channel,
          });
          return {
            ...n,
            type: newType === 'conditional' ? 'gateNode' : 'taskNode',
            data: fresh,
          };
        }),
      );
    },
    [setNodes],
  );

  // ── Toolbar actions ─────────────────────────────────────────────────────
  const openPalette = useCallback((position?: { x: number; y: number }) => {
    setPaletteContext(position ? { position } : undefined);
    setChangeTypeFor(null);
    setPaletteOpen(true);
  }, []);

  const handleLayout = useCallback(() => {
    setNodes((nds) => layoutNodes([...nds], edges));
    requestAnimationFrame(() => {
      try {
        fitView({ padding: 0.2, duration: 240 });
      } catch {
        /* ignore */
      }
    });
  }, [edges, setNodes, fitView]);

  const handleFitView = useCallback(() => {
    try {
      fitView({ padding: 0.2, duration: 240 });
    } catch {
      /* ignore */
    }
  }, [fitView]);

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

  // Open YAML drawer (used by EditorCommandList row + ⌘I shortcut).
  const openYamlPanel = useCallback(() => {
    const tasks = flowToTasks(nodes as Node<TaskNodeData>[], edges);
    setYamlText(tasksToYaml(tasks, { ...workflowMeta, name, description }));
    setShowAdvanced(true);
  }, [nodes, edges, workflowMeta, name, description]);
  // Keep the ⌘I keydown effect's ref pointed at the latest closure.
  openYamlPanelRef.current = openYamlPanel;

  // ── Tag input ───────────────────────────────────────────────────────────
  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const value = tagInput.trim().toLowerCase();
      if (value && !tags.includes(value)) setTags((t) => [...t, value]);
      setTagInput('');
    }
    if (e.key === 'Backspace' && tagInput === '' && tags.length > 0) {
      setTags((t) => t.slice(0, -1));
    }
  };

  // ── Save ────────────────────────────────────────────────────────────────
  const handleSave = useCallback(() => {
    setError(null);
    setWarning(null);
    if (!name.trim()) return setError('Workflow name is required.');
    if (!description.trim()) return setError('Workflow description is required.');
    if (nodes.length === 0) return setError('Add at least one step to the workflow.');
    if (hasCycle(nodes, edges)) return setError('Cannot save: workflow has cycles.');

    const tasks = flowToTasks(nodes as Node<TaskNodeData>[], edges);
    const definition = tasksToYaml(tasks, {
      ...workflowMeta,
      name: name.trim(),
      description: description.trim(),
    });
    onSave({
      name: name.trim(),
      description: description.trim(),
      definition,
      version: workflowMeta.version || '',
      tags,
    });
  }, [name, description, tags, nodes, edges, workflowMeta, onSave]);

  // ── Sync YAML when toggling drawer ──────────────────────────────────────
  useEffect(() => {
    if (showAdvanced) {
      const tasks = flowToTasks(nodes as Node<TaskNodeData>[], edges);
      setYamlText(tasksToYaml(tasks, { ...workflowMeta, name, description }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAdvanced]);

  // ── Render ──────────────────────────────────────────────────────────────
  const isEmpty = nodes.length === 0;
  const cycleDetected = hasCycle(nodes, edges);

  return (
    <div
      className={`editor-chrome ${containerClassName ?? 'flex h-[calc(100vh-3.5rem)] flex-col'}`}
      style={{ background: 'var(--construct-bg-base, var(--pc-bg-base))' }}
    >
      {/* Top bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 20px',
          borderBottom: '1px solid var(--construct-border-soft)',
          background: 'var(--construct-bg-surface)',
        }}
      >
        <button
          type="button"
          onClick={onCancel}
          title="Back"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 32,
            borderRadius: 8,
            border: '1px solid var(--construct-border-soft)',
            background: 'transparent',
            color: 'var(--construct-text-secondary)',
            cursor: 'pointer',
          }}
        >
          <ArrowLeft size={16} />
        </button>

        <div style={{ display: 'flex', flex: 1, minWidth: 0, gap: 12, alignItems: 'center' }}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Workflow name"
            disabled={resolvedMode === 'edit'}
            style={{
              background: 'transparent',
              border: 0,
              outline: 'none',
              fontSize: 16,
              fontWeight: 700,
              color: 'var(--construct-text-primary)',
              minWidth: 180,
              maxWidth: 320,
            }}
          />
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description"
            style={{
              background: 'transparent',
              border: 0,
              outline: 'none',
              fontSize: 13,
              color: 'var(--construct-text-secondary)',
              flex: 1,
              minWidth: 0,
            }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {workflow && (
            <span
              style={{
                fontFamily: 'var(--pc-font-mono, ui-monospace, monospace)',
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 6,
                color: 'var(--construct-text-faint)',
                background: 'var(--pc-bg-input)',
              }}
            >
              rev {workflow.revision_number}
            </span>
          )}

          {/* Tag input */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 8px',
              borderRadius: 8,
              border: '1px solid var(--pc-border)',
              background: 'var(--pc-bg-input)',
              minWidth: 120,
              maxWidth: 240,
              flexWrap: 'wrap',
            }}
          >
            {tags.map((tag) => (
              <span
                key={tag}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 2,
                  padding: '2px 6px',
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 500,
                  background: 'var(--pc-accent-glow)',
                  color: 'var(--pc-accent-light)',
                }}
              >
                {tag}
                <button
                  type="button"
                  onClick={() => setTags((t) => t.filter((x) => x !== tag))}
                  style={{ background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer', padding: 0 }}
                >
                  <X size={9} />
                </button>
              </span>
            ))}
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              placeholder={tags.length === 0 ? 'Tags…' : ''}
              style={{
                flex: 1,
                minWidth: 40,
                background: 'transparent',
                border: 0,
                outline: 'none',
                fontSize: 11,
                color: 'var(--pc-text-primary)',
              }}
            />
          </div>

          <button type="button" onClick={onCancel} className="construct-button" style={{ padding: '6px 12px', fontSize: 12 }}>
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="construct-button"
            data-variant="primary"
            style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600 }}
          >
            {saving ? 'Saving…' : resolvedMode === 'edit' ? 'Update' : resolvedMode === 'duplicate' ? 'Create Copy' : 'Save'}
          </button>
        </div>
      </div>

      {/* Error / Warning */}
      {error && (
        <div
          style={{
            margin: '8px 20px 0',
            padding: '8px 12px',
            borderRadius: 10,
            border: '1px solid color-mix(in srgb, var(--construct-status-danger) 32%, transparent)',
            background: 'color-mix(in srgb, var(--construct-status-danger) 10%, transparent)',
            color: 'var(--construct-status-danger)',
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={14} />
            {error}
          </span>
          <button
            onClick={() => setError(null)}
            style={{ background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer' }}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {warning && (
        <div
          style={{
            margin: '8px 20px 0',
            padding: '8px 12px',
            borderRadius: 10,
            border: '1px solid color-mix(in srgb, var(--construct-status-warning) 32%, transparent)',
            background: 'color-mix(in srgb, var(--construct-status-warning) 10%, transparent)',
            color: 'var(--construct-status-warning)',
            fontSize: 13,
          }}
        >
          <AlertTriangle size={14} style={{ display: 'inline', marginRight: 6 }} />
          {warning}
        </div>
      )}

      {/* Body grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 22rem',
          gap: 12,
          padding: 12,
          flex: 1,
          minHeight: 0,
        }}
      >
        {/* Canvas panel */}
        <Panel className="overflow-hidden">
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Toolbar */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 12px',
                borderBottom: '1px solid var(--construct-border-soft)',
              }}
            >
              <div className="construct-kicker">Graph</div>
              <span style={{ fontSize: 11, color: 'var(--construct-text-faint)', marginLeft: 6 }}>
                {nodes.length} step{nodes.length === 1 ? '' : 's'} · {edges.length} edge
                {edges.length === 1 ? '' : 's'}
                {cycleDetected ? (
                  <>
                    {' · '}
                    <span style={{ color: 'var(--construct-status-danger)' }}>cycle detected</span>
                  </>
                ) : null}
              </span>
              <div style={{ flex: 1 }} />
              <button
                type="button"
                onClick={() => openPalette()}
                className="construct-button"
                data-variant="primary"
                title={`Add Step (${isMac ? '⌘' : 'Ctrl'}+K)`}
                style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600 }}
              >
                <Plus size={14} />
                Add Step
              </button>
              <button
                type="button"
                onClick={handleLayout}
                className="construct-button"
                title="Auto-layout"
                style={{ padding: '6px 10px' }}
              >
                <LayoutGrid size={14} />
              </button>
              <button
                type="button"
                onClick={handleFitView}
                className="construct-button"
                title="Fit to view"
                style={{ padding: '6px 10px' }}
              >
                <Crosshair size={14} />
              </button>
              <button
                type="button"
                onClick={() => setShowAdvanced((s) => !s)}
                className="construct-button"
                data-variant={showAdvanced ? 'primary' : undefined}
                title="Toggle YAML"
                style={{ padding: '6px 10px' }}
              >
                <Code size={14} />
              </button>
            </div>

            {/* Canvas + side YAML */}
            <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
              {showAdvanced && (
                <div
                  style={{
                    width: 320,
                    flexShrink: 0,
                    borderRight: '1px solid var(--construct-border-soft)',
                    display: 'flex',
                    flexDirection: 'column',
                    background: 'var(--construct-bg-surface)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      borderBottom: '1px solid var(--construct-border-soft)',
                    }}
                  >
                    <span className="construct-kicker">YAML</span>
                    <button
                      type="button"
                      onClick={handleYamlImport}
                      className="construct-button"
                      data-variant="primary"
                      style={{ padding: '4px 10px', fontSize: 11 }}
                    >
                      <Zap size={12} />
                      Import
                    </button>
                  </div>
                  <textarea
                    value={yamlText}
                    onChange={(e) => setYamlText(e.target.value)}
                    spellCheck={false}
                    style={{
                      flex: 1,
                      padding: 10,
                      background: 'transparent',
                      color: 'var(--pc-text-primary)',
                      border: 0,
                      outline: 'none',
                      resize: 'none',
                      fontFamily: 'var(--pc-font-mono, ui-monospace, monospace)',
                      fontSize: 11.5,
                    }}
                  />
                </div>
              )}

              <div
                ref={canvasRef}
                style={{ flex: 1, position: 'relative', background: 'var(--construct-bg-surface)' }}
                onContextMenu={(e) => {
                  // Only handle when right-clicking on the empty pane.
                  const target = e.target as HTMLElement;
                  if (target.closest('.react-flow__node') || target.closest('.react-flow__handle')) return;
                  onPaneContextMenu(e);
                }}
              >
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
                  style={{ background: 'transparent' }}
                  defaultEdgeOptions={{
                    type: 'default',
                    animated: true,
                    selectable: true,
                    style: GATE_EDGE_STYLES.default,
                    markerEnd: { type: MarkerType.ArrowClosed, color: GATE_EDGE_STYLES.default.stroke },
                    interactionWidth: 20,
                  }}
                >
                  <Background color="var(--construct-grid-line, var(--pc-border))" gap={20} size={1} />
                  <Controls
                    showInteractive={false}
                    style={{
                      background: 'var(--construct-bg-panel-strong)',
                      borderColor: 'var(--construct-border-soft)',
                      borderRadius: 12,
                      overflow: 'hidden',
                    }}
                  />
                  {nodes.length > 0 && nodes.length <= 40 && (
                    <MiniMap
                      position="bottom-right"
                      pannable
                      zoomable
                      style={{
                        background: 'var(--construct-bg-panel-strong)',
                        border: '1px solid var(--construct-border-soft)',
                        borderRadius: 12,
                        width: 200,
                        height: 140,
                      }}
                      maskColor="rgba(0,0,0,0.32)"
                      nodeColor={() => 'var(--pc-accent)'}
                    />
                  )}
                </ReactFlow>

                {/* Empty state */}
                {isEmpty && (
                  <EditorCommandList
                    onAddStep={() => openPalette()}
                    onImportYaml={openYamlPanel}
                  />
                )}

                {/* Right-click context menu */}
                {contextMenu && (
                  <ContextMenu
                    state={contextMenu}
                    canPaste={false}
                    onClose={() => setContextMenu(null)}
                    onAddStep={() => {
                      const ctx = contextMenu;
                      setContextMenu(null);
                      openPalette({ x: ctx.flowX, y: ctx.flowY });
                    }}
                    onAutoLayout={() => {
                      setContextMenu(null);
                      handleLayout();
                    }}
                    onFitToView={() => {
                      setContextMenu(null);
                      handleFitView();
                    }}
                    isMac={isMac}
                  />
                )}
              </div>
            </div>
          </div>
        </Panel>

        {/* Side panel */}
        {selectedNode ? (
          <StepConfigPanel
            node={selectedNode as Node<TaskNodeData>}
            onUpdate={handleNodeUpdate}
            onDelete={handleNodeDelete}
            onChangeType={() => {
              setChangeTypeFor(selectedNode.id);
              setPaletteContext(undefined);
              setPaletteOpen(true);
            }}
          />
        ) : (
          <WorkflowSettingsPanel meta={workflowMeta} setMeta={setWorkflowMeta} />
        )}
      </div>

      {/* Palette */}
      <StepTypePalette
        open={paletteOpen}
        onOpenChange={(o) => {
          setPaletteOpen(o);
          if (!o) setChangeTypeFor(null);
        }}
        context={paletteContext}
        onSelect={
          changeTypeFor
            ? (type) => {
                handleChangeType(changeTypeFor, type);
              }
            : undefined
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Right-click context menu
// ---------------------------------------------------------------------------

function ContextMenu({
  state,
  canPaste,
  onClose,
  onAddStep,
  onAutoLayout,
  onFitToView,
  isMac,
}: {
  state: ContextMenuState;
  canPaste: boolean;
  onClose: () => void;
  onAddStep: () => void;
  onAutoLayout: () => void;
  onFitToView: () => void;
  isMac: boolean;
}) {
  // Click outside closes the menu.
  useEffect(() => {
    const handler = () => onClose();
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: state.screenX,
        top: state.screenY,
        zIndex: 50,
        minWidth: 200,
        padding: 4,
        borderRadius: 10,
        border: '1px solid var(--construct-border-strong)',
        background: 'var(--construct-bg-panel-strong)',
        boxShadow: '0 12px 32px rgba(0,0,0,0.32)',
      }}
    >
      <ContextMenuItem onClick={onAddStep} label="Add Step" shortcut={`${isMac ? '⌘' : 'Ctrl'} K`} />
      <ContextMenuItem onClick={() => {}} label="Paste" disabled={!canPaste} />
      <ContextMenuSeparator />
      <ContextMenuItem onClick={onAutoLayout} label="Auto-layout" />
      <ContextMenuItem onClick={onFitToView} label="Fit to View" />
    </div>
  );
}

function ContextMenuItem({
  onClick,
  label,
  shortcut,
  disabled,
}: {
  onClick: () => void;
  label: string;
  shortcut?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        borderRadius: 8,
        border: 0,
        background: 'transparent',
        color: disabled ? 'var(--construct-text-faint)' : 'var(--construct-text-primary)',
        fontSize: 12,
        textAlign: 'left',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = 'var(--pc-hover)';
      }}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <span style={{ flex: 1 }}>{label}</span>
      {shortcut ? (
        <span
          style={{
            fontFamily: 'var(--pc-font-mono, ui-monospace, monospace)',
            fontSize: 10,
            color: 'var(--construct-text-faint)',
          }}
        >
          {shortcut}
        </span>
      ) : null}
    </button>
  );
}

function ContextMenuSeparator() {
  return <div style={{ height: 1, margin: '4px 6px', background: 'var(--construct-border-soft)' }} />;
}

// ---------------------------------------------------------------------------
// Workflow settings panel (when no node is selected)
// ---------------------------------------------------------------------------

function WorkflowSettingsPanel({
  meta,
  setMeta,
}: {
  meta: WorkflowMeta;
  setMeta: React.Dispatch<React.SetStateAction<WorkflowMeta>>;
}) {
  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 10,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: 'var(--pc-text-faint)',
    marginBottom: 4,
  };
  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '6px 8px',
    borderRadius: 8,
    border: '1px solid var(--pc-border)',
    background: 'var(--pc-bg-input)',
    color: 'var(--pc-text-primary)',
    fontSize: 12,
    outline: 'none',
  };

  return (
    <Panel variant="primary" className="overflow-hidden">
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--construct-border-soft)' }}>
          <div className="construct-kicker">Workflow Settings</div>
        </div>
        <div style={{ overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelStyle}>Version</label>
            <input
              type="text"
              value={meta.version}
              onChange={(e) => setMeta((m) => ({ ...m, version: e.target.value }))}
              style={inputStyle}
            />
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Step Timeout (s)</label>
              <input
                type="number"
                value={meta.defaultTimeout}
                onChange={(e) => setMeta((m) => ({ ...m, defaultTimeout: parseInt(e.target.value) || 300 }))}
                style={inputStyle}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Max Total (s)</label>
              <input
                type="number"
                value={meta.maxTotalTime}
                onChange={(e) => setMeta((m) => ({ ...m, maxTotalTime: parseInt(e.target.value) || 3600 }))}
                style={inputStyle}
              />
            </div>
          </div>

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={meta.checkpoint}
              onChange={(e) => setMeta((m) => ({ ...m, checkpoint: e.target.checked }))}
              style={{ accentColor: 'var(--pc-accent)' }}
            />
            <span style={{ fontSize: 12, color: 'var(--pc-text-muted)' }}>Enable checkpoints</span>
          </label>

          {/* Triggers */}
          <SectionGroup
            kicker="Triggers"
            count={meta.triggers.length}
            onAdd={() =>
              setMeta((m) => ({
                ...m,
                triggers: [...m.triggers, { onKind: '', onTag: 'ready', onNamePattern: '', inputMap: {} }],
              }))
            }
          >
            {meta.triggers.map((trigger, ti) => (
              <div
                key={ti}
                style={{
                  padding: 8,
                  borderRadius: 8,
                  border: '1px solid var(--pc-border)',
                  background: 'var(--pc-bg-base)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: 'var(--pc-text-faint)' }}>
                    {trigger.inputMap.__cron ? 'Cron' : 'Entity'}
                  </span>
                  <button
                    onClick={() =>
                      setMeta((m) => ({ ...m, triggers: m.triggers.filter((_, i) => i !== ti) }))
                    }
                    style={{
                      background: 'transparent',
                      border: 0,
                      color: 'var(--construct-status-danger)',
                      fontSize: 10,
                      cursor: 'pointer',
                    }}
                  >
                    Remove
                  </button>
                </div>
                {trigger.inputMap.__cron ? (
                  <input
                    type="text"
                    value={trigger.inputMap.__cron}
                    onChange={(e) =>
                      setMeta((m) => {
                        const triggers = [...m.triggers];
                        triggers[ti] = {
                          ...triggers[ti]!,
                          inputMap: { ...triggers[ti]!.inputMap, __cron: e.target.value },
                        };
                        return { ...m, triggers };
                      })
                    }
                    placeholder="0 9 * * 1 (cron)"
                    style={{ ...inputStyle, fontFamily: 'var(--pc-font-mono, ui-monospace, monospace)' }}
                  />
                ) : (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="text"
                      value={trigger.onKind}
                      onChange={(e) =>
                        setMeta((m) => {
                          const triggers = [...m.triggers];
                          triggers[ti] = { ...triggers[ti]!, onKind: e.target.value };
                          return { ...m, triggers };
                        })
                      }
                      placeholder="Entity kind"
                      style={{ ...inputStyle, flex: 1, fontFamily: 'var(--pc-font-mono, ui-monospace, monospace)' }}
                    />
                    <input
                      type="text"
                      value={trigger.onTag}
                      onChange={(e) =>
                        setMeta((m) => {
                          const triggers = [...m.triggers];
                          triggers[ti] = { ...triggers[ti]!, onTag: e.target.value };
                          return { ...m, triggers };
                        })
                      }
                      placeholder="Tag"
                      style={{ ...inputStyle, width: 80, fontFamily: 'var(--pc-font-mono, ui-monospace, monospace)' }}
                    />
                  </div>
                )}
              </div>
            ))}
          </SectionGroup>

          {/* Inputs */}
          <SectionGroup
            kicker="Inputs"
            count={meta.inputs.length}
            onAdd={() =>
              setMeta((m) => ({
                ...m,
                inputs: [
                  ...m.inputs,
                  { name: '', type: 'string', required: true, default: '', description: '' },
                ],
              }))
            }
          >
            {meta.inputs.map((input, ii) => (
              <div
                key={ii}
                style={{
                  padding: 8,
                  borderRadius: 8,
                  border: '1px solid var(--pc-border)',
                  background: 'var(--pc-bg-base)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    type="text"
                    value={input.name}
                    onChange={(e) =>
                      setMeta((m) => {
                        const inputs = [...m.inputs];
                        inputs[ii] = { ...inputs[ii]!, name: e.target.value };
                        return { ...m, inputs };
                      })
                    }
                    placeholder="Param name"
                    style={{ ...inputStyle, flex: 1, fontFamily: 'var(--pc-font-mono, ui-monospace, monospace)' }}
                  />
                  <select
                    value={input.type}
                    onChange={(e) =>
                      setMeta((m) => {
                        const inputs = [...m.inputs];
                        inputs[ii] = { ...inputs[ii]!, type: e.target.value as InputDef['type'] };
                        return { ...m, inputs };
                      })
                    }
                    style={{ ...inputStyle, width: 90 }}
                  >
                    <option value="string">string</option>
                    <option value="number">number</option>
                    <option value="boolean">boolean</option>
                    <option value="list">list</option>
                  </select>
                  <button
                    onClick={() => setMeta((m) => ({ ...m, inputs: m.inputs.filter((_, i) => i !== ii) }))}
                    style={{
                      background: 'transparent',
                      border: 0,
                      color: 'var(--construct-status-danger)',
                      cursor: 'pointer',
                    }}
                  >
                    ×
                  </button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={input.required}
                      onChange={(e) =>
                        setMeta((m) => {
                          const inputs = [...m.inputs];
                          inputs[ii] = { ...inputs[ii]!, required: e.target.checked };
                          return { ...m, inputs };
                        })
                      }
                      style={{ accentColor: 'var(--pc-accent)' }}
                    />
                    <span style={{ fontSize: 10, color: 'var(--pc-text-muted)' }}>Required</span>
                  </label>
                  <input
                    type="text"
                    value={input.default}
                    onChange={(e) =>
                      setMeta((m) => {
                        const inputs = [...m.inputs];
                        inputs[ii] = { ...inputs[ii]!, default: e.target.value };
                        return { ...m, inputs };
                      })
                    }
                    placeholder="Default"
                    style={{ ...inputStyle, flex: 1 }}
                  />
                </div>
                <input
                  type="text"
                  value={input.description}
                  onChange={(e) =>
                    setMeta((m) => {
                      const inputs = [...m.inputs];
                      inputs[ii] = { ...inputs[ii]!, description: e.target.value };
                      return { ...m, inputs };
                    })
                  }
                  placeholder="Description"
                  style={inputStyle}
                />
              </div>
            ))}
          </SectionGroup>

          {/* Outputs */}
          <SectionGroup
            kicker="Outputs"
            count={meta.outputs.length}
            onAdd={() =>
              setMeta((m) => ({
                ...m,
                outputs: [...m.outputs, { name: '', source: '', description: '' }],
              }))
            }
          >
            {meta.outputs.map((output, oi) => (
              <div
                key={oi}
                style={{
                  padding: 8,
                  borderRadius: 8,
                  border: '1px solid var(--pc-border)',
                  background: 'var(--pc-bg-base)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="text"
                    value={output.name}
                    onChange={(e) =>
                      setMeta((m) => {
                        const outputs = [...m.outputs];
                        outputs[oi] = { ...outputs[oi]!, name: e.target.value };
                        return { ...m, outputs };
                      })
                    }
                    placeholder="Output name"
                    style={{ ...inputStyle, flex: 1, fontFamily: 'var(--pc-font-mono, ui-monospace, monospace)' }}
                  />
                  <button
                    onClick={() => setMeta((m) => ({ ...m, outputs: m.outputs.filter((_, i) => i !== oi) }))}
                    style={{
                      background: 'transparent',
                      border: 0,
                      color: 'var(--construct-status-danger)',
                      cursor: 'pointer',
                    }}
                  >
                    ×
                  </button>
                </div>
                <input
                  type="text"
                  value={output.source}
                  onChange={(e) =>
                    setMeta((m) => {
                      const outputs = [...m.outputs];
                      outputs[oi] = { ...outputs[oi]!, source: e.target.value };
                      return { ...m, outputs };
                    })
                  }
                  placeholder="${step_id.output}"
                  style={{ ...inputStyle, fontFamily: 'var(--pc-font-mono, ui-monospace, monospace)' }}
                />
              </div>
            ))}
          </SectionGroup>
        </div>
      </div>
    </Panel>
  );
}

function SectionGroup({
  kicker,
  count,
  onAdd,
  children,
}: {
  kicker: string;
  count: number;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="construct-kicker">
          {kicker} ({count})
        </span>
        <button
          type="button"
          onClick={onAdd}
          className="construct-button"
          style={{ padding: '2px 8px', fontSize: 10 }}
        >
          + Add
        </button>
      </div>
      {children}
    </div>
  );
}

