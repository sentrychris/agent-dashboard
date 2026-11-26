import { dirname } from 'node:path';
import { createLogReader, readMirrorStatus } from './logs.js';
import { readOpenCode } from './opencode.js';
import { createProjectStore } from './projects.js';

function send(response, status, value) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

async function readRequest(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8192) throw new Error('Settings request is too large.');
    chunks.push(chunk);
  }
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Send a JSON object.');
  return input;
}

export function createDashboardApi(settingsPath) {
  const store = createProjectStore(settingsPath);
  const logReaders = new Map();
  const openCodeCache = new Map();
  const actions = new Map([
    ['PUT /api/dashboard/settings', store.edit],
    ['POST /api/dashboard/projects', store.add],
    ['PUT /api/dashboard/active-project', store.select],
  ]);

  function readLogs(config) {
    let entry = logReaders.get(config.id);
    if (entry?.folder !== config.folder) {
      entry = { folder: config.folder, read: createLogReader() };
      logReaders.set(config.id, entry);
    }
    return entry.read(config.folder);
  }

  function openCode(config, taskIds) {
    if (!config.openCodeUrl) return { status: 'off', events: [], agents: [] };
    const directory = config.openCodeDirectory || dirname(config.folder);
    const key = JSON.stringify([config.openCodeUrl, directory, config.name, taskIds]);
    const old = openCodeCache.get(config.id);
    if (old?.key === key && (!old.done || Date.now() < old.expires)) {
      return old.request;
    }
    const cache = { key, done: false, expires: 0 };
    cache.request = readOpenCode({ url: config.openCodeUrl, directory, project: config.name, taskIds })
      .then((result) => ({ ...result, status: 'connected' }))
      .catch((error) => ({
        status: 'unavailable', events: [], agents: [],
        warning: `Couldn't read OpenCode at ${config.openCodeUrl}: ${error.message}`,
      }))
      .finally(() => {
        cache.done = true;
        cache.expires = Date.now() + 9000;
      });
    openCodeCache.set(config.id, cache);
    return cache.request;
  }

  return async function dashboardApi(request, response, next) {
    const path = request.url?.split('?')[0];
    if (!path?.startsWith('/api/dashboard')) return next();

    const host = request.headers.host;
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(host ?? '') ||
        (request.headers.origin && request.headers.origin !== `http://${host}`)) {
      return send(response, 403, { error: 'The dashboard accepts same-origin localhost requests only.' });
    }

    const action = actions.get(`${request.method} ${path}`);
    if (action) {
      if (!request.headers['content-type']?.startsWith('application/json')) {
        return send(response, 415, { error: 'Use application/json settings.' });
      }
      try {
        return send(response, 200, await action(await readRequest(request)));
      } catch (error) {
        return send(response, 400, { error: error.message });
      }
    }

    if (path !== '/api/dashboard' || request.method !== 'GET') {
      return send(response, 404, { error: 'Dashboard API route not found.' });
    }

    try {
      const { activeProjectId, projects } = await store.read();
      const config = projects.find(({ id }) => id === activeProjectId);
      const [logs, heartbeat] = await Promise.all([readLogs(config), readMirrorStatus(config.folder)]);
      const checkedAt = new Date().toISOString();
      const taskIds = [...new Set(logs.events.map((event) => event.task_id).filter(Boolean))].sort();
      const open = await openCode(config, taskIds);
      const events = [...logs.events, ...open.events].sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
      return send(response, 200, {
        project: config.name, projects: projects.map(({ id, name }) => ({ id, name })),
        events, agents: open.agents, settings: config,
        mirror: {
          files: logs.files, error: logs.error, warnings: logs.warnings,
          checkedAt, heartbeat,
          lastEvent: logs.events.length ? events.find((event) => event.file)?.recorded_at : null,
        },
        openCode: { status: open.status, warning: open.warning ?? null },
      });
    } catch (error) {
      console.error(error);
      return send(response, 500, { error: 'Could not refresh the dashboard.' });
    }
  };
}
