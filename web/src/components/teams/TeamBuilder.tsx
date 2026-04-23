import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Users,
  Search,
  ArrowLeft,
  AlertTriangle,
  X,
  Trash2,
} from 'lucide-react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  MarkerType,
  type Node,
  type Edge,
  type Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type {
  TeamDefinition,
  TeamEdge,
  AgentDefinition,
} from '@/types/api';
import { fetchAgents } from '@/lib/api';
import { nodeTypes, type AgentNodeData } from './AgentNode';
import EdgeTypeSelector from './EdgeTypeSelector';
import {
  type TeamEdgeType,
  EDGE_TYPES,
  getEdgeStyle,
  getEdgeLabel,
  getEdgeBadgeColors,
  getRoleColor,
  hasCycle,
  getDisconnectedNodes,
  layoutNodes,
} from './graphHelpers';

export default function TeamBuilder({
  editingTeam,
  onSave,
  onCancel,
  saving,
}: {
  editingTeam: TeamDefinition | null; // null = create new
  onSave: (name: string, description: string, memberKrefs: string[], edges: TeamEdge[], kref?: string) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [teamName, setTeamName] = useState(editingTeam?.name ?? '');
  const [teamDescription, setTeamDescription] = useState(editingTeam?.description ?? '');
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [agentSearch, setAgentSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  // Pending connection for edge type selection
  const [pendingConnection, setPendingConnection] = useState<Connection | null>(null);
  const [selectorPosition, setSelectorPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Selected node/edge for right panel
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  // ReactFlow state — build edges once, share between layout and state
  const buildEdges = useCallback((team: TeamDefinition): Edge[] => {
    return team.edges.map((e) => {
      const style = getEdgeStyle(e.edge_type);
      return {
        id: `edge-${e.from_kref.replace(/[:/]/g, '-')}-${e.to_kref.replace(/[:/]/g, '-')}-${e.edge_type}`,
        source: e.from_kref,
        target: e.to_kref,
        label: getEdgeLabel(e.edge_type),
        type: 'default',
        style: {
          stroke: style.stroke,
          strokeWidth: 2,
          strokeDasharray: style.strokeDasharray,
        },
        animated: style.animated ?? false,
        markerEnd: { type: MarkerType.ArrowClosed, color: style.stroke },
        data: { edgeType: e.edge_type },
      };
    });
  }, []);

  const initialEdges = useMemo(() => {
    if (!editingTeam) return [] as Edge[];
    return buildEdges(editingTeam);
  }, [editingTeam, buildEdges]);

  const initialNodes = useMemo(() => {
    if (!editingTeam) return [] as Node[];
    const ns: Node[] = editingTeam.members.map((m) => ({
      id: m.kref,
      type: 'agentNode',
      position: { x: 0, y: 0 },
      data: {
        label: m.name,
        role: m.role,
        agentType: m.agent_type,
        identity: m.identity,
        kref: m.kref,
      },
    }));
    return layoutNodes(ns, initialEdges);
  }, [editingTeam, initialEdges]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const edgeIdCounter = useRef(editingTeam ? editingTeam.edges.length : 0);

  // Sync graph state when editingTeam updates (e.g. async detail fetch resolves)
  useEffect(() => {
    if (!editingTeam || editingTeam.members.length === 0) return;
    const newEdges = buildEdges(editingTeam);
    const ns: Node[] = editingTeam.members.map((m) => ({
      id: m.kref,
      type: 'agentNode',
      position: { x: 0, y: 0 },
      data: {
        label: m.name,
        role: m.role,
        agentType: m.agent_type,
        identity: m.identity,
        kref: m.kref,
      },
    }));
    setNodes(layoutNodes(ns, newEdges));
    setEdges(newEdges);
    edgeIdCounter.current = editingTeam.edges.length;
  }, [editingTeam, buildEdges, setNodes, setEdges]);

  // Load available agents
  useEffect(() => {
    fetchAgents(false, 1, 500)
      .then((data) => setAgents(data.agents))
      .catch(() => {});
  }, []);

  // Filter agents for sidebar (exclude already added ones)
  const addedKrefs = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);
  const filteredAgents = useMemo(() => {
    const q = agentSearch.toLowerCase();
    return agents.filter((a) => {
      if (addedKrefs.has(a.kref)) return false;
      if (!q) return true;
      return (
        a.name.toLowerCase().includes(q) ||
        a.role.toLowerCase().includes(q) ||
        a.agent_type.toLowerCase().includes(q)
      );
    });
  }, [agents, agentSearch, addedKrefs]);

  // Add agent to canvas
  const addAgentToCanvas = useCallback(
    (agent: AgentDefinition) => {
      const nodeCount = nodes.length;
      const newNode: Node = {
        id: agent.kref,
        type: 'agentNode',
        position: {
          x: 100 + (nodeCount % 3) * 250,
          y: 50 + Math.floor(nodeCount / 3) * 180,
        },
        data: {
          label: agent.name,
          role: agent.role,
          agentType: agent.agent_type,
          identity: agent.identity,
          kref: agent.kref,
        },
      };
      setNodes((nds) => [...nds, newNode]);
    },
    [nodes.length, setNodes],
  );

  // Memoized MiniMap color to prevent re-render cascades
  const miniMapNodeColor = useCallback((node: Node) => {
    const data = node.data as AgentNodeData;
    return getRoleColor(data.role);
  }, []);

  // Handle new connection
  const onConnect = useCallback(
    (connection: Connection) => {
      setPendingConnection(connection);
      setSelectorPosition({ x: window.innerWidth / 2 - 90, y: window.innerHeight / 2 - 60 });
    },
    [],
  );

  const handleEdgeTypeSelect = useCallback(
    (type: TeamEdgeType) => {
      if (!pendingConnection) return;
      const style = getEdgeStyle(type);
      const id = `edge-${edgeIdCounter.current++}`;
      const newEdge: Edge = {
        id,
        source: pendingConnection.source!,
        target: pendingConnection.target!,
        label: getEdgeLabel(type),
        type: 'default',
        style: {
          stroke: style.stroke,
          strokeWidth: 2,
          strokeDasharray: style.strokeDasharray,
        },
        animated: style.animated ?? false,
        markerEnd: { type: MarkerType.ArrowClosed, color: style.stroke },
        data: { edgeType: type },
      };
      setEdges((eds) => addEdge(newEdge, eds));
      setPendingConnection(null);
    },
    [pendingConnection, setEdges],
  );

  // Handle node selection
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
  }, []);

  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    setSelectedEdgeId(edge.id);
    setSelectedNodeId(null);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, []);

  // Delete selected edge
  const deleteSelectedEdge = useCallback(() => {
    if (!selectedEdgeId) return;
    setEdges((eds) => eds.filter((e) => e.id !== selectedEdgeId));
    setSelectedEdgeId(null);
  }, [selectedEdgeId, setEdges]);

  // Remove node from canvas
  const removeNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      if (selectedNodeId === nodeId) setSelectedNodeId(null);
    },
    [setNodes, setEdges, selectedNodeId],
  );

  // Change edge type
  const changeEdgeType = useCallback(
    (edgeId: string, newType: TeamEdgeType) => {
      const style = getEdgeStyle(newType);
      setEdges((eds) =>
        eds.map((e) =>
          e.id === edgeId
            ? {
                ...e,
                label: getEdgeLabel(newType),
                style: { stroke: style.stroke, strokeWidth: 2, strokeDasharray: style.strokeDasharray },
                animated: style.animated ?? false,
                markerEnd: { type: MarkerType.ArrowClosed, color: style.stroke },
                data: { ...e.data, edgeType: newType },
              }
            : e,
        ),
      );
    },
    [setEdges],
  );

  // Save handler
  const handleSave = useCallback(() => {
    setError(null);
    setWarning(null);

    if (!teamName.trim()) {
      setError('Team name is required.');
      return;
    }
    if (nodes.length === 0) {
      setError('Add at least one agent to the team.');
      return;
    }

    // Check for cycles
    if (hasCycle(nodes, edges)) {
      setError('Cannot save: the team graph contains cycles. Remove a connection to break the cycle.');
      return;
    }

    // Warn about disconnected nodes
    const disconnected = getDisconnectedNodes(nodes, edges);
    if (disconnected.length > 0 && edges.length > 0) {
      setWarning(`Note: ${disconnected.join(', ')} ${disconnected.length === 1 ? 'is' : 'are'} not connected to any other agent.`);
    }

    const memberKrefs = nodes.map((n) => n.id);
    const teamEdges: TeamEdge[] = edges.map((e) => ({
      from_kref: e.source,
      to_kref: e.target,
      edge_type: ((e.data as Record<string, unknown>)?.edgeType as TeamEdgeType) ?? 'REPORTS_TO',
    }));

    onSave(teamName.trim(), teamDescription.trim(), memberKrefs, teamEdges, editingTeam?.kref);
  }, [teamName, teamDescription, nodes, edges, editingTeam, onSave]);

  // Selected node data
  const selectedNode = useMemo(
    () => (selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) : null),
    [selectedNodeId, nodes],
  );
  const selectedEdge = useMemo(
    () => (selectedEdgeId ? edges.find((e) => e.id === selectedEdgeId) : null),
    [selectedEdgeId, edges],
  );

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] animate-fade-in">
      {/* Top bar */}
      <div className="flex items-center gap-4 px-6 py-3 border-b" style={{ borderColor: 'var(--pc-border)', background: 'var(--pc-bg-surface)' }}>
        <button className="btn-icon" onClick={onCancel} title="Back to list" aria-label="Back to list">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 flex items-center gap-4">
          <input
            type="text"
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder="Team Name"
            className="bg-transparent text-lg font-bold outline-none border-none"
            style={{ color: 'var(--pc-text-primary)', minWidth: 200 }}
          />
          <input
            type="text"
            value={teamDescription}
            onChange={(e) => setTeamDescription(e.target.value)}
            placeholder="Description (optional)"
            className="bg-transparent text-sm outline-none border-none flex-1"
            style={{ color: 'var(--pc-text-muted)' }}
          />
        </div>
        <button className="btn-secondary px-4 py-2 text-sm" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="btn-electric px-5 py-2 text-sm font-semibold"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? (
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Saving...
            </span>
          ) : editingTeam ? 'Update Team' : 'Save Team'}
        </button>
      </div>

      {/* Error / Warning banners */}
      {error && (
        <div
          className="mx-6 mt-3 rounded-2xl border p-3 text-sm flex items-center justify-between animate-fade-in"
          style={{ background: 'rgba(239, 68, 68, 0.08)', borderColor: 'rgba(239, 68, 68, 0.2)', color: '#f87171' }}
        >
          <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{error}</span>
          <button className="btn-icon" onClick={() => setError(null)} aria-label="Dismiss error">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {warning && (
        <div
          className="mx-6 mt-3 rounded-2xl border p-3 text-sm flex items-center justify-between animate-fade-in"
          style={{ background: 'rgba(249, 115, 22, 0.08)', borderColor: 'rgba(249, 115, 22, 0.2)', color: '#f97316' }}
        >
          <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{warning}</span>
          <button className="btn-icon" onClick={() => setWarning(null)} aria-label="Dismiss warning">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Main builder area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar — Available Agents */}
        <div
          className="w-64 flex-shrink-0 border-r flex flex-col"
          style={{ borderColor: 'var(--pc-border)', background: 'var(--pc-bg-surface)' }}
        >
          <div className="p-4 border-b" style={{ borderColor: 'var(--pc-border)' }}>
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--pc-text-muted)' }}>
              Available Agents
            </h3>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: 'var(--pc-text-faint)' }} />
              <input
                type="text"
                value={agentSearch}
                onChange={(e) => setAgentSearch(e.target.value)}
                placeholder="Filter agents..."
                className="input-electric w-full pl-8 pr-3 py-2 text-xs"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {filteredAgents.length === 0 ? (
              <p className="text-xs text-center py-4" style={{ color: 'var(--pc-text-faint)' }}>
                {agents.length === 0 ? 'No agents available' : 'All agents added or no match'}
              </p>
            ) : (
              filteredAgents.map((agent) => {
                const borderColor = getRoleColor(agent.role);
                return (
                  <button
                    key={agent.kref}
                    className="w-full text-left p-3 rounded-xl border transition-all hover:scale-[1.02]"
                    style={{
                      background: 'var(--pc-bg-elevated)',
                      borderColor: 'var(--pc-border)',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = borderColor; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--pc-border)'; }}
                    onClick={() => addAgentToCanvas(agent)}
                    title={`Click to add ${agent.name}`}
                  >
                    <div className="text-sm font-semibold truncate" style={{ color: 'var(--pc-text-primary)' }}>
                      {agent.name}
                    </div>
                    <div className="flex gap-1 mt-1.5">
                      <span
                        className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                        style={{ background: borderColor + '22', color: borderColor }}
                      >
                        {agent.role}
                      </span>
                      <span
                        className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                        style={{ background: 'var(--pc-hover)', color: 'var(--pc-text-secondary)' }}
                      >
                        {agent.agent_type}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Center canvas */}
        <div className="flex-1 relative" style={{ background: 'var(--pc-bg-base)' }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            fitView
            style={{
              background: 'var(--pc-bg-base)',
            }}
            defaultEdgeOptions={{
              type: 'default',
              markerEnd: { type: MarkerType.ArrowClosed },
            }}
          >
            <Background
              color="var(--pc-border)"
              gap={20}
              size={1}
            />
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

          {/* Loading spinner when editing team and members haven't loaded yet */}
          {nodes.length === 0 && editingTeam && editingTeam.members.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <div
                  className="h-10 w-10 mx-auto mb-3 border-2 rounded-full animate-spin"
                  style={{
                    borderColor: 'var(--pc-border)',
                    borderTopColor: 'var(--pc-accent)',
                  }}
                />
                <p className="text-sm" style={{ color: 'var(--pc-text-muted)' }}>
                  Loading team graph…
                </p>
              </div>
            </div>
          )}

          {/* Hint when canvas is empty (new team) */}
          {nodes.length === 0 && (!editingTeam || editingTeam.members.length > 0) && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <Users className="h-12 w-12 mx-auto mb-3" style={{ color: 'var(--pc-text-faint)' }} />
                <p className="text-sm" style={{ color: 'var(--pc-text-muted)' }}>
                  Click agents from the left panel to add them to the canvas
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--pc-text-faint)' }}>
                  Drag between nodes to create relationships
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Right sidebar — Selection details */}
        {(selectedNode || selectedEdge) && (
          <div
            className="w-64 flex-shrink-0 border-l flex flex-col animate-fade-in"
            style={{ borderColor: 'var(--pc-border)', background: 'var(--pc-bg-surface)' }}
          >
            <div className="p-4 border-b" style={{ borderColor: 'var(--pc-border)' }}>
              <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--pc-text-muted)' }}>
                {selectedNode ? 'Agent Details' : 'Edge Details'}
              </h3>
            </div>
            <div className="p-4 space-y-4">
              {selectedNode && (
                <>
                  <div>
                    <div className="text-sm font-bold" style={{ color: 'var(--pc-text-primary)' }}>
                      {(selectedNode.data as AgentNodeData).label}
                    </div>
                    <div className="text-xs mt-1" style={{ color: 'var(--pc-text-muted)' }}>
                      {(selectedNode.data as AgentNodeData).identity}
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <span
                      className="px-2 py-0.5 rounded text-[11px] font-medium"
                      style={{
                        background: getRoleColor((selectedNode.data as AgentNodeData).role) + '22',
                        color: getRoleColor((selectedNode.data as AgentNodeData).role),
                      }}
                    >
                      {(selectedNode.data as AgentNodeData).role}
                    </span>
                    <span
                      className="px-2 py-0.5 rounded text-[11px] font-medium"
                      style={{ background: 'var(--pc-hover)', color: 'var(--pc-text-secondary)' }}
                    >
                      {(selectedNode.data as AgentNodeData).agentType}
                    </span>
                  </div>
                  <button
                    className="w-full btn-secondary px-3 py-2 text-xs font-medium flex items-center justify-center gap-2"
                    onClick={() => removeNode(selectedNode.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove from Team
                  </button>
                </>
              )}
              {selectedEdge && (
                <>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--pc-text-muted)' }}>
                      Edge Type
                    </div>
                    {EDGE_TYPES.map((type) => {
                      const isSelected = (selectedEdge.data as Record<string, unknown>)?.edgeType === type;
                      const colors = getEdgeBadgeColors(type);
                      const eStyle = getEdgeStyle(type);
                      return (
                        <button
                          key={type}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors mb-1"
                          style={{
                            background: isSelected ? colors.bg : 'transparent',
                            color: isSelected ? colors.text : 'var(--pc-text-secondary)',
                            border: isSelected ? `1px solid ${colors.text}33` : '1px solid transparent',
                          }}
                          onClick={() => changeEdgeType(selectedEdge.id, type)}
                        >
                          <span
                            className="w-3 h-0.5 rounded-full flex-shrink-0"
                            style={{ background: eStyle.stroke }}
                          />
                          {getEdgeLabel(type)}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    className="w-full btn-secondary px-3 py-2 text-xs font-medium flex items-center justify-center gap-2"
                    onClick={deleteSelectedEdge}
                    style={{ color: '#f87171' }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete Edge
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Edge type selector popup */}
      {pendingConnection && (
        <EdgeTypeSelector
          position={selectorPosition}
          onSelect={handleEdgeTypeSelect}
          onCancel={() => setPendingConnection(null)}
        />
      )}
    </div>
  );
}
