import { Service } from '@opencode/client/service';

export function normalizeOpenCodeUrl(value) {
  const url = new URL(value);
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (!local || !['http:', 'https:'].includes(url.protocol) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use a loopback OpenCode URL such as http://127.0.0.1:4096.');
  }
  return url.origin;
}

async function requestHeaders(url) {
  const authorization = process.env.DASHBOARD_OPENCODE_AUTHORIZATION;
  if (authorization) return { Accept: 'application/json', Authorization: authorization };

  const endpoint = await Service.discover().catch(() => null);
  if (endpoint && new URL(endpoint.url).origin === url) {
    return { Accept: 'application/json', ...Service.headers(endpoint) };
  }
  return { Accept: 'application/json' };
}

function taskMatcher(taskIds) {
  const known = new Map(taskIds.map((id) => [id.toLowerCase(), id]));
  const candidates = [...known.keys()].filter((id) => /[\p{L}\p{N}]/u.test(id))
    .sort((a, b) => b.length - a.length)
    .map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const token = '[\\p{L}\\p{M}\\p{N}_-]';
  const pattern = candidates.length ? new RegExp(`(?<!${token})(?:${candidates.join('|')})(?!${token})`, 'u') : null;
  return (session) => {
    const metadataTask = typeof session.metadata?.task_id === 'string' ? session.metadata.task_id.trim() : '';
    if (metadataTask) return known.get(metadataTask.toLowerCase()) ?? metadataTask;
    const match = pattern && typeof session.title === 'string' ? session.title.toLowerCase().match(pattern)?.[0] : null;
    return match ? known.get(match) : null;
  };
}

function sessionEvents(session, messages, project, taskId) {
  const from = `opencode:${session.id}`;
  const events = [];
  function add(id, millis, type, text, sender, recipient, kind) {
    if (!text?.trim() || !Number.isFinite(millis)) return;
    events.push({
      id: `opencode:${session.id}:${id}`,
      recorded_at: new Date(millis).toISOString(),
      project, source: 'opencode', type, task_id: taskId,
      from: sender, to: recipient, status: null, text, text_kind: kind, file: null,
    });
  }

  for (const message of messages) {
    const created = message.time?.created;
    if (message.type === 'user') {
      add(message.id, created, 'agent_message', message.text, null, from, 'verbatim');
    } else if (message.type === 'assistant') {
      const content = Array.isArray(message.content) ? message.content : [];
      const text = content.filter((part) => part.type === 'text').map((part) => part.text).join('\n\n');
      add(message.id, message.time?.completed ?? created, 'agent_message', text, from, null, 'verbatim');
      for (const part of content.filter((entry) => entry.type === 'tool')) {
        const status = part.state?.status;
        const summary = status ? `${part.name} · ${status}` : part.name;
        add(`${message.id}:${part.id}`, part.time?.completed ?? part.time?.created, 'tool_activity', summary, from, null, 'summary');
      }
      if (message.error) {
        const error = typeof message.error.data?.message === 'string' ? message.error.data.message : 'The session reported an error.';
        add(`${message.id}:error`, message.time?.completed ?? created, 'error', error, from, null, 'summary');
      }
    } else if (message.type === 'shell') {
      add(message.id, message.time?.completed ?? created, 'tool_activity',
        `Shell · ${message.status}${typeof message.exit === 'number' ? ` (${message.exit})` : ''}`, from, null, 'summary');
    }
  }

  return events;
}

export async function readOpenCode({ url, directory, project, taskIds = [] }) {
  const headers = await requestHeaders(url);
  const matchTask = taskMatcher(taskIds);
  async function get(path) {
    const response = await fetch(`${url}${path}`, {
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(4000),
    });
    if (response.status === 401) {
      throw new Error('Authentication failed (HTTP 401). Use the exact URL from opencode service status, or set DASHBOARD_OPENCODE_AUTHORIZATION for a separately configured server.');
    }
    if (!response.ok) throw new Error(`OpenCode returned HTTP ${response.status}.`);
    const body = await response.json();
    if (!body || typeof body.data !== 'object' || !body.data) throw new Error('Unexpected OpenCode V2 response.');
    return body.data;
  }

  const query = new URLSearchParams({ directory, archived: 'false', limit: '20', order: 'desc' });
  const [sessions, active] = await Promise.all([get(`/api/session?${query}`), get('/api/session/active')]);
  if (!Array.isArray(sessions) || Array.isArray(active)) throw new Error('Unexpected OpenCode V2 session list.');
  const results = await Promise.all(sessions.map(async (session) => {
    const path = `/api/session/${encodeURIComponent(session.id)}`;
    const running = session.id in active;
    const [messages, permissions] = await Promise.allSettled([
      get(`${path}/message?limit=30&order=desc`),
      get(`${path}/permission`),
    ]);
    const data = messages.status === 'fulfilled' && Array.isArray(messages.value) ? messages.value : [];
    const requests = permissions.status === 'fulfilled' && Array.isArray(permissions.value) ? permissions.value : [];
    const approvalActions = [...new Set(requests.map(({ action }) => action).filter(Boolean))];
    const taskId = matchTask(session);
    const events = sessionEvents(session, data, project, taskId);
    return {
      agent: {
        id: `opencode:${session.id}`,
        name: session.title || session.agent || 'OpenCode session',
        parentId: session.parentID ? `opencode:${session.parentID}` : null,
        source: 'opencode', taskId,
        status: requests.length ? 'approval' : running ? 'working' : 'idle',
        approvalCount: requests.length, approvalActions,
        lastSeen: new Date(session.time.updated).toISOString(),
      },
      events,
      incomplete: messages.status === 'rejected' || permissions.status === 'rejected',
    };
  }));

  return {
    agents: results.map(({ agent }) => agent),
    events: results.flatMap(({ events }) => events),
    warning: results.some(({ incomplete }) => incomplete) ? 'Some OpenCode session details could not be loaded.' : null,
  };
}
