import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity, ArrowRight, ArrowUpRight, Check, ChevronRight, ChevronsUpDown, CircleCheck, ClipboardList,
  Clock3, FolderOpen, GitFork, LayoutGrid, ListTodo, Menu, MessageSquare, Plus, Radio, RefreshCw,
  Search, Settings2, Terminal, Users, Workflow, X,
} from 'lucide-react';
import { agentStates, buildModel, eventType, eventTypes, initial, latestCheckResults, sourceName, taskStates, timeLabel } from './data.js';
import { RelationshipGraph } from './graph.jsx';
import { AttentionPanel, FreshnessPanel } from './overview.jsx';
import './styles.css';

const overviewViews = [
  ['overview', 'Overview', LayoutGrid],
  ['agents', 'Agents', Users],
  ['tasks', 'Tasks', ListTodo],
  ['activity', 'Activity log', Activity],
  ['relationships', 'Relationships', Workflow],
];

function currentView() {
  const hash = window.location.hash.slice(1);
  return overviewViews.some(([id]) => id === hash) ? hash : 'overview';
}

const eventIcons = {
  task_assigned: GitFork,
  task_status_changed: ClipboardList,
  agent_message: MessageSquare,
  tool_activity: Terminal,
  check_result: CircleCheck,
  error: Activity,
};
const conversationTypes = new Set(['task_assigned', 'agent_message', 'task_status_changed']);
const emptyProject = { name: '', folder: '', openCodeUrl: '', openCodeDirectory: '' };

async function projectRequest(route, method, input) {
  const response = await fetch(`/api/dashboard/${route}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not save the project.');
  return data;
}

function Badge({ state, dot = false }) {
  return <span className={`badge ${state.tone}`}>{dot && <span className="status-dot" />}{state.label}</span>;
}

function Empty({ icon: Icon = Activity, title, children }) {
  return <div className="empty"><Icon size={24} /><strong>{title}</strong>{children && <p>{children}</p>}</div>;
}

function Stat({ label, value, detail, icon: Icon, tone, view }) {
  return (
    <a className="stat panel" href={`#${view}`}>
      <span className={`icon-box ${tone}`}><Icon size={17} /></span>
      <ArrowUpRight className="stat-link" size={15} />
      <div className="stat-label">{label}</div>
      <strong>{value}</strong>
      <div className="stat-detail">{detail}</div>
    </a>
  );
}

function EventList({ events, names, onEvent, compact = false, conversation = false }) {
  if (!events.length) return <Empty title="No activity found">New events appear when a connected source records them.</Empty>;
  return (
    <ol className={`event-list${compact ? ' event-list-compact' : ''}${conversation ? ' event-list-conversation' : ''}`}>
      {events.map((event) => {
        const type = eventType(event.type);
        const Icon = Object.hasOwn(eventIcons, event.type) ? eventIcons[event.type] : Activity;
        const text = event.text || (conversation ? '' : event.blocker || event.next_action || event.verification || type.label);
        const status = event.type === 'agent_message' ? null : taskStates[event.status];
        return (
          <li key={event.id}>
            <button className="event-row" onClick={() => onEvent(event.id)} title="Open event and conversation">
              <span className={`icon-box event-icon ${type.tone}`}><Icon size={15} /></span>
              <span className="event-content">
                <span className="event-head">
                  <strong>{names.get(event.from) || event.from || (event.source === 'opencode' ? 'User' : type.label)}</strong>
                  {event.to && <><ArrowRight size={12} /><span>{names.get(event.to) || event.to}</span></>}
                </span>
                {text && <span className="event-text">{text}</span>}
                <span className="event-tags">
                  <span>{type.label}</span>
                  {!conversation && event.task_id && <span className="mono">{event.task_id}</span>}
                  {conversation && status && <Badge state={status} />}
                  {event.check_id && <span>{event.check_id}</span>}
                  {!compact && <span>{sourceName(event.source)}</span>}
                  {event.text_kind && <span>{event.text_kind === 'verbatim' ? 'Verbatim' : 'Summary'}</span>}
                </span>
              </span>
              <time dateTime={event.recorded_at} title={new Date(event.recorded_at).toLocaleString()}>{timeLabel(event.recorded_at)}</time>
            </button>
            {conversation && <TaskReportFields report={event} />}
          </li>
        );
      })}
    </ol>
  );
}

function TaskTable({ tasks, names, onTask }) {
  if (!tasks.length) return <Empty icon={ListTodo} title="No matching tasks">Tasks are grouped by the IDs reported in activity events.</Empty>;
  return (
    <div className="table-scroll">
      <table className="task-table">
        <thead><tr><th>Task</th><th>Assigned to</th><th>Status</th><th>Last update</th><th aria-label="Details" /></tr></thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.id}>
              <td><button onClick={() => onTask(task.id)} className="task-title"><strong className="mono">{task.id}</strong><span>{task.summary || 'No description recorded'}</span></button></td>
              <td><span className="task-owner">{task.owner && <span className="avatar tiny">{initial(names.get(task.owner) || task.owner)}</span>}{names.get(task.owner) || task.owner || 'Unassigned'}</span></td>
              <td><Badge state={taskStates[task.status] ?? taskStates.unknown} dot /></td>
              <td><time dateTime={task.lastSeen}>{timeLabel(task.lastSeen)}</time></td>
              <td><button className="icon-button bare" onClick={() => onTask(task.id)} aria-label={`Open task ${task.id}`}><ChevronRight size={16} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PanelTitle({ icon: Icon, title, description, action }) {
  return <div className="panel-title"><div><h2>{Icon && <Icon size={17} />}{title}</h2><p>{description}</p></div>{action}</div>;
}

function ViewLink({ to, children }) {
  return <a className="view-link" href={`#${to}`}>{children}<ArrowUpRight size={14} /></a>;
}

function GraphPanel({ model, onAgent, onEdge, overview }) {
  return (
    <section className={`panel graph-panel ${overview ? '' : 'graph-large'}`}>
      <PanelTitle title="Agent relationships" description="Who’s assigning work and talking to whom"
        action={overview && <ViewLink to="relationships">Expand</ViewLink>} />
      <RelationshipGraph agents={model.agents} relationships={model.edges} onAgent={onAgent} onEdge={onEdge} />
      <div className="graph-legend"><span><i />Assignment / child session</span><span><i className="dashed" />Communication</span><span className="graph-hint">Select a node or link for details</span></div>
    </section>
  );
}

function AgentCards({ agents, onAgent }) {
  if (!agents.length) return <div className="panel"><Empty icon={Users} title="No agents yet">Agents appear when a source reports an assignment, message, or session.</Empty></div>;
  return <div className="agents-grid">{agents.map((agent) => (
    <button key={agent.id} className="panel agent-card" onClick={() => onAgent(agent.id)}>
      <span className={`avatar ${agent.id === 'coordinator' ? 'coordinator-avatar' : ''}`}>{initial(agent.name)}</span>
      <ArrowUpRight size={15} className="stat-link" />
      <strong>{agent.name}</strong>
      <span className="agent-source">{agent.source ? sourceName(agent.source) : 'Referenced in activity'}</span>
      <Badge state={agentStates[agent.status] ?? agentStates.unknown} dot />
      <span className="agent-card-footer"><span className="mono">{agent.taskId || 'No task linked'}</span><span>{timeLabel(agent.lastSeen)}</span></span>
    </button>
  ))}</div>;
}

function SearchBox({ value, onChange, placeholder }) {
  return <label className="search"><Search size={16} /><input type="search" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={placeholder} /></label>;
}

function TaskView({ tasks, names, onTask }) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const filtered = tasks.filter((task) => (filter === 'all' || task.status === filter) &&
    [task.id, task.owner, names.get(task.owner), task.summary].join(' ').toLowerCase().includes(query.toLowerCase().trim()));
  return <section className="panel">
    <PanelTitle title="Task list" description={`${tasks.length} tracked ${tasks.length === 1 ? 'task' : 'tasks'}`} />
    <div className="filter-bar">
      <SearchBox value={query} onChange={setQuery} placeholder="Search tasks…" />
      <select aria-label="Task status" value={filter} onChange={(event) => setFilter(event.target.value)}>
        <option value="all">All statuses</option>
        {Object.entries(taskStates).map(([id, state]) => <option key={id} value={id}>{state.label}</option>)}
      </select>
    </div>
    <TaskTable tasks={filtered} names={names} onTask={onTask} />
  </section>;
}

function ActivityView({ events, model, names, onEvent }) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [agent, setAgent] = useState('all');
  const [limit, setLimit] = useState(50);
  const term = query.trim().toLowerCase();
  const filtered = events.filter((event) => (type === 'all' || event.type === type) &&
    (agent === 'all' || event.from === agent || event.to === agent) &&
    [event.text, event.blocker, event.next_action, event.verification, event.from, names.get(event.from), event.to,
      names.get(event.to), event.task_id, event.check_id, event.source].join(' ').toLowerCase().includes(term));
  return <section className="panel">
    <PanelTitle title="Activity log" description={`${filtered.length} ${filtered.length === 1 ? 'event' : 'events'} · newest first`} />
    <div className="filter-bar">
      <SearchBox value={query} onChange={setQuery} placeholder="Search activity…" />
      <select aria-label="Event type" value={type} onChange={(event) => setType(event.target.value)}>
        <option value="all">All event types</option>
        {Object.entries(eventTypes).map(([id, state]) => <option key={id} value={id}>{state.label}</option>)}
      </select>
      <select aria-label="Filter by agent" value={agent} onChange={(event) => setAgent(event.target.value)}>
        <option value="all">All agents</option>
        {model.agents.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
      </select>
    </div>
    <EventList events={filtered.slice(0, limit)} names={names} onEvent={onEvent} />
    {filtered.length > limit && <div className="more"><button className="button" onClick={() => setLimit((value) => value + 50)}>Show more events</button></div>}
  </section>;
}

function Dialog({ title, subtitle, onClose, children, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const element = ref.current;
    if (!element.open) element.showModal();
  }, []);
  return (
    <dialog ref={ref} className={wide ? 'settings-dialog' : 'detail-dialog'} aria-labelledby="dialog-title" onClose={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="dialog-content">
        <div className="dialog-header"><div><p className="eyebrow">{subtitle}</p><h2 id="dialog-title">{title}</h2></div>
          <button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={19} /></button></div>
        {children}
      </div>
    </dialog>
  );
}

function ProjectSwitcher({ name, activeId, projects, disabled, switching, onSelect, onAdd }) {
  const [open, setOpen] = useState(false);
  const container = useRef(null);
  const button = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onOutside = (event) => {
      if (!container.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onOutside);
    return () => document.removeEventListener('pointerdown', onOutside);
  }, [open]);

  function handleEscape(event) {
    if (event.key !== 'Escape' || !open) return;
    event.stopPropagation();
    setOpen(false);
    button.current?.focus();
  }

  return <div className="workspace-switcher" ref={container} onKeyDown={handleEscape}>
    <button type="button" ref={button} className="workspace" aria-label={`Switch project (${name})`}
      aria-expanded={open} aria-controls="project-switcher-options" disabled={disabled || switching}
      onClick={() => setOpen((value) => !value)}>
      <span className="workspace-icon">{initial(name)}</span>
      <span className="workspace-label"><strong>{name}</strong><small>{switching ? 'Switching project…' : 'Project workspace'}</small></span>
      <ChevronsUpDown size={14} className="workspace-chevrons" />
    </button>
    {open && <div id="project-switcher-options" className="project-options" role="group" aria-label="Saved projects">
      <div className="project-option-list">
        {projects.map((project) => <button type="button" className="project-option" key={project.id}
          aria-current={activeId === project.id ? 'true' : undefined}
          onClick={() => { setOpen(false); onSelect(project.id); }}>
          <span className="workspace-icon">{initial(project.name)}</span><strong>{project.name}</strong>
          {activeId === project.id && <Check size={15} />}
        </button>)}
      </div>
      <button type="button" className="project-option project-add" onClick={() => { setOpen(false); onAdd(); }}>
        <Plus size={16} /> Add project
      </button>
    </div>}
  </div>;
}

function SettingsDialog({ editor, onClose, onSaved }) {
  const { settings, openCode, mirror, isNew } = editor;
  const [values, setValues] = useState(settings);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await projectRequest(isNew ? 'projects' : 'settings', isNew ? 'POST' : 'PUT', values);
      onSaved();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setSaving(false);
    }
  }
  function field(name) {
    return { value: values[name], onChange: (event) => setValues({ ...values, [name]: event.target.value }) };
  }
  return <Dialog wide title={isNew ? 'Add project' : 'Data sources'} subtitle={isNew ? 'Dashboard settings' : settings.name} onClose={onClose}>
    <form className="settings-form" onSubmit={save}>
      <section>
        <h3>Project details</h3>
        <label>Project name<input required {...field('name')} placeholder="Example project" /></label>
      </section>
      <section>
        <h3><FolderOpen size={17} /> Activity folder {mirror && <Badge state={{ label: mirror.error ? 'Unavailable' : `${mirror.files.length} log files`, tone: mirror.error ? 'red' : 'green' }} />}</h3>
        <label>Local log folder<input required {...field('folder')} placeholder="C:\path\to\agent-activity" /></label>
        <p>The dashboard reads <code>.jsonl</code> files from this folder. Use a separate folder for each project.</p>
        {mirror?.error && <p className="form-error">{mirror.error}</p>}
      </section>
      <section>
        <h3><Terminal size={17} /> OpenCode V2 <Badge state={{ label: { off: 'Optional', connected: 'Connected', unavailable: 'Unavailable' }[openCode?.status ?? 'off'], tone: openCode?.status === 'connected' ? 'green' : 'muted' }} /></h3>
        <label>Local API URL<input type="url" {...field('openCodeUrl')} placeholder="http://127.0.0.1:4096" /></label>
        <label>Project directory <span>Optional</span><input {...field('openCodeDirectory')} placeholder="Defaults to the parent of the log folder" /></label>
        <p>Use a reachable OpenCode V2 server on this PC. A known task ID in a session title links its activity to that task in this project.</p>
        {openCode?.warning && <p className="form-error">{openCode.warning}</p>}
      </section>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button" onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={saving}>{saving ? 'Saving…' : isNew ? 'Add project' : 'Save sources'}</button></div>
    </form>
  </Dialog>;
}

function TaskReportFields({ report }) {
  const fields = [['Blocker', report.blocker], ['Next action', report.next_action], ['Verification', report.verification]]
    .filter(([, value]) => value);
  if (!fields.length) return null;
  return <dl className="task-report-fields">
    {fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
  </dl>;
}

function checkState(event) {
  return event.status === 'completed' ? { label: 'Passed', tone: 'green' } : taskStates[event.status];
}

function TaskBrief({ task, events, names, open }) {
  const report = task.report;
  const checks = [...latestCheckResults(events).values()];
  return <div className="detail-card">
    <div><Badge state={taskStates[task.status]} dot /><span>{timeLabel(task.lastSeen)}</span></div>
    {task.owner && <div><strong>Assigned to</strong><button className="text-button" onClick={() => open('agent', task.owner)}>{names.get(task.owner) || task.owner}</button></div>}
    {task.parentId && <div><strong>Parent task</strong><span className="mono">{task.parentId}</span></div>}
    {report && <section className="task-brief-section">
      <div className="task-brief-heading">
        <h3>Latest status report</h3>
        <button className="text-button" onClick={() => open('event', report.id)} title="Open the recorded status report">
          {names.get(report.from) || report.from || sourceName(report.source)} · {timeLabel(report.recorded_at)}
        </button>
      </div>
      <TaskReportFields report={report} />
      {report.text && <p>{report.text}</p>}
    </section>}
    {checks.length > 0 && <section className="task-brief-section">
      <h3>Reported checks</h3>
      <ul className="task-checks">
        {checks.map((event) => <li key={event.id}>
          <button onClick={() => open('event', event.id)} title={event.text}>
            <span>{event.check_id}</span><Badge state={checkState(event)} dot /><time dateTime={event.recorded_at}>{timeLabel(event.recorded_at)}</time>
          </button>
        </li>)}
      </ul>
    </section>}
    {(!report || (task.summary && task.summary !== report.text)) && <section className="task-brief-section">
      <h3>{task.assignment ? 'Assignment' : 'Description'}</h3>
      <p>{task.summary || 'No description recorded.'}</p>
    </section>}
  </div>;
}

function TaskHistory({ events, names, onEvent }) {
  const [showAll, setShowAll] = useState(false);
  const [limit, setLimit] = useState(50);
  const conversation = events.filter((event) => conversationTypes.has(event.type))
    .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
  const visible = showAll ? events : conversation;

  function switchView(all) {
    if (all === showAll) return;
    setShowAll(all);
    setLimit(50);
  }

  return <section className="task-history" aria-labelledby="task-history-title">
    <div className="task-history-header">
      <h3 id="task-history-title">Task history</h3>
      <div className="history-controls" role="group" aria-label="Task history view">
        <button type="button" aria-pressed={!showAll} onClick={() => switchView(false)}>Conversation <span aria-hidden="true">{conversation.length}</span></button>
        <button type="button" aria-pressed={showAll} onClick={() => switchView(true)}>All activity <span aria-hidden="true">{events.length}</span></button>
      </div>
      <p>{showAll ? 'Newest first · All recorded task events' : 'Oldest first · Assignments, replies, and status updates'}</p>
    </div>
    {!showAll && !visible.length
      ? <Empty icon={MessageSquare} title="No conversation recorded">Check All activity for other events on this task.</Empty>
      : <EventList events={visible.slice(0, limit)} names={names} onEvent={onEvent} conversation={!showAll} />}
    {visible.length > limit && <div className="more">
      <button className="button" onClick={() => setLimit((count) => count + 50)}>Show more events</button>
    </div>}
  </section>;
}

function Detail({ detail, data, model, names, open, close }) {
  const [limit, setLimit] = useState(50);
  useEffect(() => setLimit(50), [detail]);
  let title, subtitle, info, events;
  if (detail.kind === 'agent') {
    const agent = model.agents.find(({ id }) => id === detail.id);
    if (!agent) return null;
    title = agent.name;
    subtitle = agent.id === 'coordinator' ? 'Coordinator' : 'Agent details';
    events = data.events.filter((event) => event.from === agent.id || event.to === agent.id);
    info = <div className="detail-card">
      <div><Badge state={agentStates[agent.status] ?? agentStates.unknown} dot /><span>{agent.statusSource}</span></div>
      <div><strong>Source</strong><span>{agent.source ? sourceName(agent.source) : 'Referenced in activity'}</span></div>
      <div><strong>Last observed</strong><span>{timeLabel(agent.lastSeen)}</span></div>
      <div><strong>Last agent report</strong>{agent.lastReport
        ? <button className="text-button" onClick={() => open('event', agent.lastReport.id)}>{timeLabel(agent.lastReport.recorded_at)}</button>
        : <span>No report recorded</span>}</div>
      {agent.approvalCount > 0 && <div><strong>Pending approvals ({agent.approvalCount})</strong><span>{agent.approvalActions.join(', ') || 'OpenCode'}</span></div>}
      {agent.taskId && <div><strong>Current task</strong>{model.tasks.some((task) => task.id === agent.taskId)
        ? <button className="text-button mono" onClick={() => open('task', agent.taskId)}>{agent.taskId}</button>
        : <span className="mono">{agent.taskId}</span>}</div>}
    </div>;
  } else if (detail.kind === 'task') {
    const task = model.tasks.find(({ id }) => id === detail.id);
    if (!task) return null;
    title = task.id;
    subtitle = 'Task brief';
    events = data.events.filter((event) => event.task_id === task.id);
    info = <TaskBrief task={task} events={events} names={names} open={open} />;
  } else if (detail.kind === 'edge') {
    const edge = detail.id;
    const { from, to } = edge;
    title = `${names.get(from) || from} ↔ ${names.get(to) || to}`;
    subtitle = edge.kind === 'session' ? 'Related sessions' : 'Agent conversation';
    events = data.events.filter((event) => (event.from === from && event.to === to) || (event.from === to && event.to === from));
    info = <div className="detail-card"><div><strong>{events.length} {events.length === 1 ? 'exchange' : 'exchanges'}</strong>
      <span>{edge.kind === 'session' ? 'Parent and child OpenCode sessions' : 'Both directions · newest first'}</span></div></div>;
  } else {
    const event = data.events.find(({ id }) => id === detail.id);
    if (!event) return null;
    const type = eventType(event.type);
    title = type.label;
    subtitle = 'Recorded activity';
    events = event.task_id ? data.events.filter((item) => item.id !== event.id && item.task_id === event.task_id) : [];
    info = <div className="detail-card">
      <div><strong>{[names.get(event.from) || event.from, names.get(event.to) || event.to].filter(Boolean).join(' → ') || sourceName(event.source)}</strong><time dateTime={event.recorded_at}>{new Date(event.recorded_at).toLocaleString()}</time></div>
      <div><span>{sourceName(event.source)}{event.file ? ` · ${event.file}` : ''}</span>{event.text_kind && <Badge state={{ label: event.text_kind === 'verbatim' ? 'Verbatim' : 'Summary', tone: 'muted' }} />}</div>
      {event.check_id && <div><strong>Check</strong><span>{event.check_id}</span></div>}
      <TaskReportFields report={event} />
      {(event.text || !(event.blocker || event.next_action || event.verification)) && <p>{event.text || 'No message text recorded.'}</p>}
      {(event.task_id || event.status) && <div>
        {event.task_id && <button className="text-button mono" onClick={() => open('task', event.task_id)}>{event.task_id}</button>}
        {event.status && <Badge state={event.type === 'check_result' ? checkState(event) : taskStates[event.status]} dot />}
      </div>}
    </div>;
  }
  const onEvent = (id) => open('event', id);
  const dialogKey = `${detail.kind}:${detail.kind === 'edge' ? detail.id.id : detail.id}`;
  return <Dialog key={dialogKey} title={title} subtitle={subtitle} onClose={close}>
    <div className="detail-body">{info}
      {detail.kind === 'task' ? <TaskHistory events={events} names={names} onEvent={onEvent} /> : <>
        <h3>{detail.kind === 'event' ? 'Related task activity' : 'Recorded activity'}</h3>
        <EventList events={events.slice(0, limit)} names={names} onEvent={onEvent} />
        {events.length > limit && <div className="more"><button className="button" onClick={() => setLimit(limit + 50)}>Show more events</button></div>}
      </>}
    </div>
  </Dialog>;
}

const headings = {
  overview: ['Workspace overview', 'Agents, tasks, and conversations across your active work.'],
  agents: ['Agents', 'See who’s involved, what they’re working on, and their last observed activity.'],
  tasks: ['Tasks', 'Follow assignments, status changes, and handoffs by task.'],
  activity: ['Activity log', 'Read the recorded conversations and updates from your connected sources.'],
  relationships: ['Relationships', 'Explore delegations and conversations between agents.'],
};

function App() {
  const [view, setView] = useState(currentView);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [projectError, setProjectError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [editor, setEditor] = useState(null);
  const [detail, setDetail] = useState(null);
  const [menu, setMenu] = useState(false);
  const request = useRef(null);
  const activeProject = useRef(null);
  const refresh = useCallback(async (force = false) => {
    if (request.current && !force) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (force) setRefreshing(true);
    try {
      const result = await fetch('/api/dashboard', { signal: controller.signal, cache: 'no-store' });
      const payload = await result.json();
      if (!result.ok) throw new Error(payload.error || 'Dashboard data is unavailable.');
      if (request.current !== controller) return;
      if (activeProject.current !== payload.settings.id) {
        activeProject.current = payload.settings.id;
        setDetail(null);
        setProjectError('');
      }
      setData(payload);
      setError('');
    } catch (failure) {
      if (request.current === controller && !controller.signal.aborted) setError(failure.message);
    } finally {
      if (request.current === controller) {
        request.current = null;
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    const updateView = () => { setView(currentView()); setMenu(false); window.scrollTo(0, 0); };
    const refreshId = setInterval(refresh, 3000);
    const resume = () => { if (!document.hidden) refresh(); };
    window.addEventListener('hashchange', updateView);
    document.addEventListener('visibilitychange', resume);
    refresh();
    return () => {
      clearInterval(refreshId);
      window.removeEventListener('hashchange', updateView);
      document.removeEventListener('visibilitychange', resume);
      request.current?.abort();
    };
  }, [refresh]);

  async function selectProject(id) {
    setMenu(false);
    if (id === data.settings.id) return;
    setSwitching(true);
    setProjectError('');
    try {
      await projectRequest('active-project', 'PUT', { id });
      await refresh(true);
    } catch (failure) {
      setProjectError(failure.message);
    } finally {
      setSwitching(false);
    }
  }

  function configureProject() {
    setMenu(false);
    if (!data) return;
    const { settings, openCode, mirror } = data;
    setEditor({ settings, openCode, mirror, isNew: false });
  }

  const model = useMemo(() => buildModel(data?.events ?? [], data?.agents ?? []), [data]);
  const names = useMemo(() => new Map(model.agents.map(({ id, name }) => [id, name])), [model]);
  const counts = {
    working: model.agents.filter(({ status }) => status === 'working').length,
    inProgress: model.tasks.filter(({ status }) => status === 'in_progress').length,
    completed: model.tasks.filter(({ status }) => status === 'completed').length,
    messages: data?.events.filter((event) => event.from && event.to && ['agent_message', 'task_assigned'].includes(event.type)).length ?? 0,
  };
  const open = (kind, id) => setDetail({ kind, id });
  const onAgent = (id) => open('agent', id);
  const onTask = (id) => open('task', id);
  const onEvent = (id) => open('event', id);
  const onEdge = (edge) => open('edge', edge);
  const mirrorStatus = error || data?.mirror.error ? 'Unavailable' : !data ? 'Connecting' : data.mirror.files.length ? 'Local mirror' : 'No logs yet';
  const project = data?.project ?? 'Aldervast';
  const projectId = data?.settings.id;
  const [title, description] = headings[view];
  const now = Date.now();

  return (
    <div className="app">
      <aside className={`sidebar ${menu ? 'sidebar-open' : ''}`}>
        <a className="brand" href="#overview" onClick={() => setMenu(false)}><span className="brand-mark"><Workflow size={21} /></span><span>Agent Dashboard<small>Local workspace</small></span></a>
        <ProjectSwitcher name={project} activeId={projectId} projects={data?.projects ?? []}
          disabled={!data} switching={switching} onSelect={selectProject}
          onAdd={() => { setMenu(false); setEditor({ settings: emptyProject, isNew: true }); }} />
        <nav aria-label="Dashboard navigation"><span className="nav-label">WORKSPACE</span>{overviewViews.map(([id, label, Icon]) => (
          <a key={id} className={view === id ? 'nav-item active' : 'nav-item'} href={`#${id}`} aria-current={view === id ? 'page' : undefined} onClick={() => setMenu(false)}><Icon size={18} />{label}</a>
        ))}</nav>
        <div className="sidebar-bottom">
          <button className="nav-item" onClick={configureProject} disabled={!data || switching}><Settings2 size={18} /> Data sources</button>
          <div className="sidebar-status"><span className={`status-dot ${mirrorStatus === 'Local mirror' ? 'green' : mirrorStatus === 'Unavailable' ? 'red' : 'muted'}`} /><div><strong>{mirrorStatus}</strong><small>{data?.mirror.files.length ?? 0} log files detected</small></div></div>
        </div>
      </aside>
      {menu && <button className="menu-backdrop" aria-label="Close navigation" onClick={() => setMenu(false)} />}
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb"><button className="icon-button menu-toggle" aria-label="Toggle navigation" onClick={() => setMenu(!menu)}><Menu size={20} /></button><span>{project}</span><ChevronRight size={14} /><strong>{overviewViews.find(([id]) => id === view)?.[1]}</strong></div>
          <div className="topbar-actions"><span className="updated"><Clock3 size={14} /> Last event {data?.mirror.lastEvent ? timeLabel(data.mirror.lastEvent) : '—'}</span>
            <button className="icon-button" title="Refresh activity" aria-label="Refresh activity" onClick={() => refresh(true)} disabled={refreshing}><RefreshCw size={16} className={refreshing ? 'spinning' : ''} /></button></div>
        </header>
        <div className="main-content" key={projectId}>
          <div className="page-heading"><div><p className="eyebrow"><span /> {project} / workspace</p><h1>{title}</h1><p>{description}</p></div>
            <button className="button sources-button" onClick={configureProject} disabled={!data || switching}><Settings2 size={16} /> Data sources</button></div>
          {(error || projectError || data?.mirror.error || data?.mirror.warnings.length > 0 || data?.openCode.warning) && <div className="notice" role="status">
            <Activity size={17} /><div>{[error, projectError, data?.mirror.error, ...(data?.mirror.warnings ?? []), data?.openCode.warning].filter(Boolean).map((message) => <p key={message}>{message}</p>)}</div>
          </div>}
          {!data && !error && <div className="panel"><Empty icon={RefreshCw} title="Loading project activity" /></div>}
          {data && view === 'overview' && <>
            <div className="stats">
              <Stat icon={Users} tone="orange" label="Agents observed" value={model.agents.length} detail={`${counts.working} reported working`} view="agents" />
              <Stat icon={ClipboardList} tone="blue" label="Tasks in progress" value={counts.inProgress} detail={`${model.tasks.length} tracked in total`} view="tasks" />
              <Stat icon={CircleCheck} tone="green" label="Tasks completed" value={counts.completed} detail="Recorded as complete" view="tasks" />
              <Stat icon={MessageSquare} tone="purple" label="Agent communications" value={counts.messages} detail="Messages and assignments" view="activity" />
            </div>
            <div className="overview-grid watch-grid">
              <AttentionPanel model={model} events={data.events} names={names} now={now} onOpen={open} />
              <FreshnessPanel mirror={data.mirror} connectionError={error} events={data.events} names={names} now={now} onEvent={onEvent} />
            </div>
            <div className="overview-grid">
              <GraphPanel model={model} onAgent={onAgent} onEdge={onEdge} overview />
              <section className="panel recent-panel"><PanelTitle title="Recent activity" description="Latest recorded updates" action={<ViewLink to="activity">View log</ViewLink>} />
                <EventList events={data.events.slice(0, 4)} names={names} onEvent={onEvent} compact /></section>
            </div>
            <section className="panel task-panel"><PanelTitle title="Tracked tasks" description="Latest assignment and status for each task" action={<ViewLink to="tasks">View tasks</ViewLink>} />
              <TaskTable tasks={model.tasks.slice(0, 7)} names={names} onTask={onTask} /></section>
          </>}
          {data && view === 'agents' && <AgentCards agents={model.agents} onAgent={onAgent} />}
          {data && view === 'tasks' && <TaskView tasks={model.tasks} names={names} onTask={onTask} />}
          {data && view === 'activity' && <ActivityView events={data.events} model={model} names={names} onEvent={onEvent} />}
          {data && view === 'relationships' && <GraphPanel model={model} onAgent={onAgent} onEdge={onEdge} />}
          <footer><span><Radio size={14} /> Auto-refreshes locally every 3 seconds</span><span>Statuses reflect the latest available report.</span></footer>
        </div>
      </main>
      {editor && <SettingsDialog editor={editor} onClose={() => setEditor(null)}
        onSaved={() => { setEditor(null); refresh(true); }} />}
      {detail && data && <Detail detail={detail} data={data} model={model} names={names} open={open} close={() => setDetail(null)} />}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
