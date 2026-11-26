import { dirname, join } from 'node:path';
import { handoffTaskLabel, isHandoffId, parseHandoffPrompt } from '../src/opencode-draft.js';
import { createHandoffStore } from './handoffs.js';
import { createLogReader, readMirrorStatus } from './logs.js';
import { readOpenCode } from './opencode.js';
import { launchOpenCodeDraft, prepareOpenCodeDraft } from './opencode-draft.js';
import { createProjectStore } from './projects.js';

const openCodeDirectory = (project) => project.openCodeDirectory || dirname(project.folder);

function send(response, status, value) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

async function readRequest(request, maxSize = 8192) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxSize) throw new Error('Dashboard request is too large.');
    chunks.push(chunk);
  }
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Send a JSON object.');
  return input;
}

export function createDashboardApi(settingsPath) {
  const store = createProjectStore(settingsPath);
  const handoffs = createHandoffStore(settingsPath && join(dirname(settingsPath), 'handoffs.json'));
  const logReaders = new Map();
  const openCodeCache = new Map();
  const actions = new Map([
    ['PUT /api/dashboard/settings', store.edit],
    ['POST /api/dashboard/projects', store.add],
    ['PUT /api/dashboard/active-project', store.select],
    ['POST /api/dashboard/handoff/open', async (input) => {
      const { projects } = await store.read();
      const project = projects.find(({ id }) => id === input.projectId);
      if (!project) throw new Error('That project is no longer available.');
      if (input.directory !== openCodeDirectory(project)) {
        throw new Error('The worktree does not match this project’s OpenCode directory. Update Data sources or reopen the handoff review.');
      }
      if (!isHandoffId(input.handoffId) || typeof input.taskId !== 'string' || !input.taskId.trim()) {
        throw new Error('This draft needs a task and a handoff ID. Reopen the handoff review.');
      }
      if (input.prompt) {
        const marker = parseHandoffPrompt(input.prompt);
        if (marker?.handoffId !== input.handoffId || marker.taskId !== handoffTaskLabel(input.taskId)) {
          throw new Error('The draft prompt does not match this handoff. Reopen the handoff review.');
        }
      }
      const draft = await prepareOpenCodeDraft(project, input);
      const { record, launch } = await handoffs.begin({
        id: input.handoffId, projectId: project.id, taskId: input.taskId, directory: input.directory,
        prefilled: draft.prefilled,
      });
      if (launch) {
        try {
          await launchOpenCodeDraft(draft);
        } catch (error) {
          await handoffs.finish(record.id, 'failed', error.message).catch(console.error);
          throw error;
        }
        await handoffs.finish(record.id, 'opened').catch(console.error);
      }
      return { prefilled: record.prefilled };
    }],
  ]);

  function readLogs(config) {
    let entry = logReaders.get(config.id);
    if (entry?.folder !== config.folder) {
      entry = { folder: config.folder, read: createLogReader() };
      logReaders.set(config.id, entry);
    }
    return entry.read(config.folder);
  }

  function openCode(config, taskIds, trackHandoffs) {
    if (!config.openCodeUrl) return { status: 'off', events: [], agents: [] };
    const directory = openCodeDirectory(config);
    const key = JSON.stringify([config.openCodeUrl, directory, config.name, taskIds, trackHandoffs]);
    const old = openCodeCache.get(config.id);
    if (old?.key === key && (!old.done || Date.now() < old.expires)) {
      return old.request;
    }
    const cache = { key, done: false, expires: 0 };
    cache.request = readOpenCode({ url: config.openCodeUrl, directory, project: config.name, taskIds, trackHandoffs })
      .then((result) => ({ ...result, status: 'connected' }))
      .catch((error) => ({
        status: 'unavailable', events: [], agents: [],
        warning: `Couldn't read OpenCode at ${config.openCodeUrl}: ${error.message}`,
      }))
      .then((result) => ({ ...result, checkedAt: new Date().toISOString() }))
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
        const limit = path === '/api/dashboard/handoff/open' ? 128 * 1024 : undefined;
        return send(response, 200, await action(await readRequest(request, limit)));
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
      const [logs, heartbeat, stored] = await Promise.all([
        readLogs(config), readMirrorStatus(config.folder), handoffs.list(config.id),
      ]);
      const checkedAt = new Date().toISOString();
      const taskIds = [...new Set([
        ...logs.events.map(({ task_id }) => task_id).filter(Boolean),
        ...stored.handoffs.map(({ taskId }) => taskId),
      ])].sort();
      const trackHandoffs = stored.handoffs.some((record) => !record.pickup && record.directory === openCodeDirectory(config));
      const open = await openCode(config, taskIds, trackHandoffs);
      const history = await handoffs.observe(config.id, openCodeDirectory(config), open.agents).catch((error) => {
        console.error(error);
        return { ...stored, handoffWarning: 'Could not save the latest handoff history.' };
      });
      const events = [...logs.events, ...open.events].sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
      return send(response, 200, {
        project: config.name, projects: projects.map(({ id, name }) => ({ id, name })),
        events, agents: open.agents, settings: config, ...history,
        mirror: {
          files: logs.files, error: logs.error, warnings: logs.warnings,
          checkedAt, heartbeat,
          lastEvent: logs.events.length ? events.find((event) => event.file)?.recorded_at : null,
        },
        openCode: {
          status: open.status, warning: open.warning ?? null, checkedAt: open.checkedAt ?? null,
          directory: config.openCodeUrl ? openCodeDirectory(config) : config.openCodeDirectory,
        },
      });
    } catch (error) {
      console.error(error);
      return send(response, 500, { error: 'Could not refresh the dashboard.' });
    }
  };
}
