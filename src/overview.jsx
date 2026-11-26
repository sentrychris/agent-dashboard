import { Bell, CircleCheck, Cloud, FolderOpen, MessageSquare, Radio } from 'lucide-react';
import { attentionTypes, buildAttention, mirrorFreshness } from './attention.js';
import { timeLabel } from './data.js';

function Age({ value, now, empty = 'No report yet' }) {
  if (!value) return <span>{empty}</span>;
  const seconds = Math.max(0, Math.floor((now - Date.parse(value)) / 1000));
  const minutes = Math.floor(seconds / 60);
  const age = seconds < 15 ? 'Just now' : seconds < 60 ? `${seconds}s ago` :
    minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`;
  return <time dateTime={value} title={new Date(value).toLocaleString()}>{age} · {timeLabel(value)}</time>;
}

export function AttentionPanel({ model, events, names, now, onOpen }) {
  const items = buildAttention(model, events, now);
  return <section className="panel attention-panel">
    <div className="panel-title">
      <div><h2><Bell size={16} /> Needs attention</h2><p>Blockers, approvals, failed checks, and unanswered assignments</p></div>
      <span className={`badge ${items.length ? 'orange' : 'muted'}`}>{items.length}</span>
    </div>
    {items.length ? <ul className="attention-list">
      {items.map((item) => {
        const state = attentionTypes[item.type];
        return <li key={item.id}>
          <button className="attention-item" onClick={() => onOpen(item.target.kind, item.target.id)}>
            <span className={`status-dot ${state.tone}`} />
            <span className="attention-content">
              <span className="attention-heading"><strong>{item.title}</strong><span className={`badge ${state.tone}`}>{state.label}</span></span>
              {item.description && <span className="attention-description">{item.description}</span>}
              <span className="attention-meta">
                <span>{item.actor ?? names.get(item.actorId) ?? item.actorId ?? 'Unassigned'}</span>
                <span>{item.timeLabel} <Age value={item.timestamp} now={now} /></span>
              </span>
            </span>
          </button>
        </li>;
      })}
    </ul> : <div className="attention-empty"><CircleCheck size={17} /><span>No issues flagged in the available data.</span></div>}
  </section>;
}

export function FreshnessPanel({ mirror, connectionError, events, names, now, onEvent }) {
  const heartbeat = mirror.heartbeat;
  const sync = mirrorFreshness(heartbeat, now);
  const report = events.find((event) => event.from && event.type !== 'tool_activity');
  const reportName = report && (names.get(report.from) ?? report.from);
  const local = connectionError ? { label: 'Dashboard disconnected', tone: 'red' } :
    mirror.error ? { label: 'Read failed', tone: 'red' } : { label: 'Readable', tone: 'green' };
  return <section className="panel freshness-panel">
    <div className="panel-title"><div><h2><Radio size={16} /> Source freshness</h2><p>Folder checks, cloud syncs, and agent reports</p></div></div>
    <dl className="freshness-list">
      <div>
        <dt><FolderOpen size={15} /> Last local folder check</dt>
        <dd><Age value={mirror.checkedAt} now={now} /><span className={`badge ${local.tone}`}>{local.label}</span></dd>
      </div>
      <div>
        <dt><Cloud size={15} /> Last successful cloud sync</dt>
        <dd><Age value={heartbeat?.lastSuccessAt} now={now} /><span className={`badge ${sync.tone}`}>{sync.label}</span></dd>
        {heartbeat?.status === 'unreported' && <dd className="freshness-note">Cloud mirrors can report syncs in <code>mirror-status.json</code>.</dd>}
        {heartbeat?.status === 'error' && <dd className="freshness-note">Last attempt <Age value={heartbeat.checkedAt} now={now} />{heartbeat.error && ` · ${heartbeat.error}`}</dd>}
        {heartbeat?.status === 'invalid' && <dd className="freshness-note">{heartbeat.error}</dd>}
      </div>
      <div>
        <dt><MessageSquare size={15} /> Latest agent report</dt>
        <dd><Age value={report?.recorded_at} now={now} />{report && <button className="text-button" onClick={() => onEvent(report.id)}>{reportName}</button>}</dd>
      </div>
    </dl>
  </section>;
}
