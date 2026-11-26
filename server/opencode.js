export function normalizeOpenCodeUrl(value) {
  const url = new URL(value);
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (!local || !['http:', 'https:'].includes(url.protocol) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use a loopback OpenCode URL such as http://127.0.0.1:4096.');
  }
  return url.origin;
}

function sessionEvents(session, messages, project) {
  const from = `opencode:${session.id}`;
  const metadataTask = session.metadata?.task_id;
  const taskId = typeof metadataTask === 'string' && metadataTask.trim()
    ? metadataTask.trim() : session.title?.match(/\bALD-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/i)?.[0] ?? null;
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

  return { taskId, events };
}

export async function readOpenCode({ url, directory, project }) {
  const authorization = process.env.DASHBOARD_OPENCODE_AUTHORIZATION;
  async function get(path) {
    const response = await fetch(`${url}${path}`, {
      headers: { Accept: 'application/json', ...(authorization && { Authorization: authorization }) },
      redirect: 'error',
      signal: AbortSignal.timeout(4000),
    });
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
      running ? get(`${path}/permission`) : [],
    ]);
    const data = messages.status === 'fulfilled' && Array.isArray(messages.value) ? messages.value : [];
    const pending = permissions.status === 'fulfilled' && Array.isArray(permissions.value) && permissions.value.length > 0;
    const { taskId, events } = sessionEvents(session, data, project);
    return {
      agent: {
        id: `opencode:${session.id}`,
        name: session.title || session.agent || 'OpenCode session',
        parentId: session.parentID ? `opencode:${session.parentID}` : null,
        source: 'opencode', taskId,
        status: pending ? 'approval' : running ? 'working' : 'idle',
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
