export const taskStates = {
  queued: { label: 'Queued', tone: 'muted' },
  in_progress: { label: 'In progress', tone: 'orange' },
  blocked: { label: 'Blocked', tone: 'red' },
  completed: { label: 'Completed', tone: 'green' },
  failed: { label: 'Failed', tone: 'red' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
  unknown: { label: 'Unknown', tone: 'muted' },
};

export const agentStates = {
  working: { label: 'Working', tone: 'orange' },
  approval: { label: 'Waiting for approval', tone: 'orange' },
  blocked: { label: 'Blocked', tone: 'red' },
  idle: { label: 'Idle', tone: 'muted' },
  unknown: { label: 'Unknown', tone: 'muted' },
};

export const eventTypes = {
  task_assigned: { label: 'Assignment', tone: 'orange' },
  task_status_changed: { label: 'Status update', tone: 'green' },
  agent_message: { label: 'Message', tone: 'blue' },
  tool_activity: { label: 'Tool', tone: 'muted' },
  error: { label: 'Error', tone: 'red' },
};

export function eventType(type) {
  return Object.hasOwn(eventTypes, type) ? eventTypes[type] : { label: type.replaceAll('_', ' '), tone: 'muted' };
}

const sourceLabels = new Map([
  ['claude-desktop', 'Claude Desktop'],
  ['claude-code-cloud', 'Claude Cloud'],
  ['claude-code', 'Claude Code'],
  ['opencode', 'OpenCode'],
  ['unknown', 'Unconfirmed source'],
]);

export function sourceName(source) {
  return sourceLabels.get(source) ?? source;
}

export function initial(name) {
  return name.split(/[\s_-]+/).filter(Boolean).slice(0, 2).map((word) => word[0].toUpperCase()).join('') || '?';
}

const dayFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });

export function timeLabel(value) {
  if (!value) return 'No activity yet';
  const date = new Date(value);
  const time = timeFormatter.format(date);
  return date.toDateString() === new Date().toDateString() ? time : `${dayFormatter.format(date)} · ${time}`;
}

export function buildModel(events, nativeAgents) {
  const agents = new Map(nativeAgents.map((agent) => [agent.id, { ...agent }]));
  const tasks = new Map();
  const edges = new Map();

  function addAgent(id, event) {
    if (!id) return;
    const publisher = event.file?.toLowerCase() === `${id.toLowerCase()}.jsonl`;
    const existing = agents.get(id);
    if (!existing) {
      agents.set(id, {
        id, name: id, source: publisher ? event.source : null, lastSeen: event.recorded_at,
        status: 'unknown', statusSource: 'Log', taskId: null, parentId: null, publisher,
      });
      return;
    }
    if (event.recorded_at > existing.lastSeen) existing.lastSeen = event.recorded_at;
    if (publisher) {
      existing.publisher = true;
      existing.source = event.source;
    }
  }

  function addEdge(from, to, event) {
    if (!from || !to || from === to) return;
    const id = JSON.stringify([from, to]);
    const edge = edges.get(id) ?? { id, from, to, count: 0, assignments: 0, kind: 'communication' };
    if (event) {
      edge.count++;
      if (event.type === 'task_assigned') edge.assignments++;
    } else {
      edge.kind = 'session';
    }
    edges.set(id, edge);
  }

  // The API orders events newest first. Apply state transitions from oldest to newest.
  for (const event of [...events].reverse()) {
    addAgent(event.from, event);
    addAgent(event.to, event);
    addEdge(event.from, event.to, event);
    if (!event.task_id) continue;

    const task = tasks.get(event.task_id) ?? {
      id: event.task_id, owner: null, status: 'unknown', explicitStatus: false,
      summary: '', parentId: null, lastSeen: null, sources: new Set(),
    };
    task.lastSeen = event.recorded_at;
    task.parentId = event.parent_task_id || task.parentId;
    task.sources.add(event.source);
    if (event.type === 'task_assigned') {
      task.owner = event.to || task.owner;
      task.summary = event.text || task.summary;
    } else if (!task.owner && event.type === 'task_status_changed') {
      task.owner = event.from;
    }
    if (!task.summary && event.text) task.summary = event.text;
    if (event.status) {
      const explicit = ['task_assigned', 'task_status_changed'].includes(event.type);
      if (explicit || !task.explicitStatus) task.status = event.status;
      if (explicit) task.explicitStatus = true;
    }
    tasks.set(task.id, task);
  }

  const taskList = [...tasks.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
  for (const agent of agents.values()) {
    if (agent.parentId && agents.has(agent.parentId)) addEdge(agent.parentId, agent.id);
    if (agent.source === 'opencode') {
      agent.statusSource = 'OpenCode session';
      continue;
    }
    const assigned = taskList.filter((task) => task.owner === agent.id);
    const current = assigned.find((task) => task.status === 'in_progress') ??
      assigned.find((task) => task.status === 'blocked') ?? assigned[0];
    agent.taskId = current?.id ?? null;
    if (current?.status === 'in_progress') agent.status = 'working';
    if (current?.status === 'blocked') agent.status = 'blocked';
    agent.statusSource = 'Latest reported task status';
  }

  const agentList = [...agents.values()].sort((a, b) => {
    if (a.id === 'coordinator') return -1;
    if (b.id === 'coordinator') return 1;
    return (b.lastSeen ?? '').localeCompare(a.lastSeen ?? '') || a.name.localeCompare(b.name);
  });
  return { agents: agentList, tasks: taskList, edges: [...edges.values()] };
}
