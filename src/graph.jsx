import { useEffect, useMemo } from 'react';
import { Background, BaseEdge, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, getBezierPath, useReactFlow } from '@xyflow/react';
import { Maximize, Minus, Plus, Workflow } from 'lucide-react';
import { agentStates, initial } from './data.js';
import '@xyflow/react/dist/style.css';

function GraphNode({ data, selected }) {
  const state = agentStates[data.status] ?? agentStates.unknown;
  const coordinator = data.id === 'coordinator';
  return (
    <div className={`graph-node ${coordinator ? 'graph-root' : ''} ${selected ? 'graph-selected' : ''}`}>
      <Handle id="left-in" type="target" position={Position.Left} isConnectable={false} style={{ top: '36%' }} />
      <Handle id="left-out" type="source" position={Position.Left} isConnectable={false} style={{ top: '66%' }} />
      <div className="avatar graph-avatar">{initial(data.name)}</div>
      <div className="graph-node-text">
        <strong title={data.name}>{data.name}</strong>
        <span>{coordinator ? 'Coordinator' : data.source === 'opencode' ? 'OpenCode session' : 'Worker'}</span>
      </div>
      <span className={`status-dot ${state.tone}`} aria-label={state.label} title={state.label} />
      <Handle id="right-out" type="source" position={Position.Right} isConnectable={false} style={{ top: '36%' }} />
      <Handle id="right-in" type="target" position={Position.Right} isConnectable={false} style={{ top: '66%' }} />
      <Handle id="top-in" type="target" position={Position.Top} isConnectable={false} className="vertical-handle" style={{ left: '57%' }} />
      <Handle id="top-out" type="source" position={Position.Top} isConnectable={false} className="vertical-handle" style={{ left: '43%' }} />
      <Handle id="bottom-in" type="target" position={Position.Bottom} isConnectable={false} className="vertical-handle" style={{ left: '43%' }} />
      <Handle id="bottom-out" type="source" position={Position.Bottom} isConnectable={false} className="vertical-handle" style={{ left: '57%' }} />
    </div>
  );
}

function GraphEdge({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style, interactionWidth }) {
  const [path] = getBezierPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
    curvature: sourceX > targetX ? 0.3 : 0.22,
  });
  return <BaseEdge path={path} style={style} markerEnd={markerEnd} interactionWidth={interactionWidth} />;
}

const nodeTypes = { agent: GraphNode };
const edgeTypes = { relationship: GraphEdge };

function makeGraph(agents, relationships) {
  const ids = new Set(agents.map(({ id }) => id));
  const roots = agents.filter(({ id }) => id === 'coordinator' ||
    !relationships.some((edge) => edge.to === id && (edge.assignments || edge.kind === 'session')));
  if (!roots.length && agents.length) roots.push(agents[0]);
  const depths = new Map(roots.map(({ id }) => [id, 0]));
  const queue = roots.map(({ id }) => id);
  for (let index = 0; index < queue.length; index++) {
    const from = queue[index];
    for (const edge of relationships) {
      if (edge.from !== from || depths.has(edge.to) || !(edge.assignments || edge.kind === 'session')) continue;
      depths.set(edge.to, depths.get(from) + 1);
      queue.push(edge.to);
    }
  }
  const columns = new Map();
  for (const agent of agents) {
    const depth = depths.get(agent.id) ?? 0;
    if (!columns.has(depth)) columns.set(depth, []);
    columns.get(depth).push(agent);
  }
  const nodes = [...columns].flatMap(([depth, column]) => column.map((agent, index) => ({
    id: agent.id, type: 'agent', data: agent,
    position: { x: depth * 260, y: (index - (column.length - 1) / 2) * 103 },
    draggable: false, ariaLabel: `Agent ${agent.name}`,
  })));
  const positions = new Map(nodes.map(({ id, position }) => [id, position]));
  const edges = relationships.filter(({ from, to }) => ids.has(from) && ids.has(to)).map((edge) => {
    const emphasis = edge.assignments || edge.kind === 'session';
    const color = emphasis ? '#a67b55' : '#707d8b';
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    const [sourceSide, targetSide] = from.x === to.x
      ? (from.y < to.y ? ['bottom', 'top'] : ['top', 'bottom'])
      : (from.x < to.x ? ['right', 'left'] : ['left', 'right']);
    return {
      id: edge.id, source: edge.from, target: edge.to, type: 'relationship', data: edge,
      sourceHandle: `${sourceSide}-out`, targetHandle: `${targetSide}-in`,
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
      style: { stroke: color, strokeWidth: 1.5, strokeDasharray: emphasis ? undefined : '5 5' },
      interactionWidth: 15, ariaLabel: `${edge.from} to ${edge.to}`,
    };
  });
  return { nodes, edges };
}

function GraphCanvas({ agents, relationships, onAgent, onEdge }) {
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const graph = useMemo(() => makeGraph(agents, relationships), [agents, relationships]);
  const layoutKey = graph.nodes.map(({ id, position }) => `${id}:${position.x}:${position.y}`).join('|');
  useEffect(() => {
    const frame = requestAnimationFrame(() => fitView({ padding: 0.18, maxZoom: 1.12 }));
    return () => cancelAnimationFrame(frame);
  }, [layoutKey, fitView]);

  function inspectFromKeyboard(event) {
    if (event.key !== 'Enter') return;
    const node = event.target.closest('.react-flow__node');
    const edge = event.target.closest('.react-flow__edge');
    if (node) onAgent(node.dataset.id);
    if (edge) {
      const relationship = relationships.find(({ id }) => id === edge.dataset.id);
      if (relationship) onEdge(relationship);
    }
  }

  return (
    <div className="graph-interaction" onKeyDown={inspectFromKeyboard}>
      <ReactFlow
        nodes={graph.nodes} edges={graph.edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        colorMode="dark" fitView fitViewOptions={{ padding: 0.18, maxZoom: 1.12 }}
        minZoom={0.08} maxZoom={2} nodesConnectable={false} zoomOnScroll={false}
        onNodeClick={(_, node) => onAgent(node.id)}
        onEdgeClick={(_, edge) => onEdge(edge.data)}
      >
        <Background gap={19} size={1.15} color="#343539" />
      </ReactFlow>
      <div className="graph-controls" aria-label="Graph zoom controls">
        <button title="Zoom in" aria-label="Zoom in" onClick={() => zoomIn({ duration: 160 })}><Plus size={16} /></button>
        <button title="Zoom out" aria-label="Zoom out" onClick={() => zoomOut({ duration: 160 })}><Minus size={16} /></button>
        <button title="Fit graph" aria-label="Fit graph" onClick={() => fitView({ padding: 0.18, maxZoom: 1.12, duration: 180 })}><Maximize size={14} /></button>
      </div>
    </div>
  );
}

export function RelationshipGraph(props) {
  if (!props.agents.length) {
    return <div className="graph-empty"><Workflow size={24} /><p>Agent relationships appear as activity is recorded.</p></div>;
  }
  return <div className="graph-canvas"><ReactFlowProvider><GraphCanvas {...props} /></ReactFlowProvider></div>;
}
