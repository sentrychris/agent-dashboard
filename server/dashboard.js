import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogReader } from './logs.js';
import { normalizeOpenCodeUrl, readOpenCode } from './opencode.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const configPath = resolve(root, '.dashboard', 'settings.json');
const defaults = {
  folder: resolve(root, '..', 'aldervast-v1.14.96', 'agent-activity'),
  openCodeUrl: '',
  openCodeDirectory: '',
};

function send(response, status, value) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

async function readSettings() {
  try {
    const values = JSON.parse(await readFile(configPath, 'utf8'));
    return {
      folder: typeof values.folder === 'string' && isAbsolute(values.folder) ? values.folder : defaults.folder,
      openCodeUrl: values.openCodeUrl ? normalizeOpenCodeUrl(values.openCodeUrl) : '',
      openCodeDirectory: typeof values.openCodeDirectory === 'string' && isAbsolute(values.openCodeDirectory) ? values.openCodeDirectory : '',
    };
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn(`Could not load dashboard settings: ${error.message}`);
    return defaults;
  }
}

async function parseSettings(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8192) throw new Error('Settings request is too large.');
    chunks.push(chunk);
  }
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const folder = typeof input.folder === 'string' ? input.folder.trim() : '';
  if (!isAbsolute(folder)) throw new Error('Enter the full path to the activity folder.');
  const info = await stat(folder).catch(() => null);
  if (!info?.isDirectory()) throw new Error('The activity folder does not exist or cannot be read.');
  const directory = typeof input.openCodeDirectory === 'string' ? input.openCodeDirectory.trim() : '';
  if (directory && !isAbsolute(directory)) throw new Error('Enter the full path to the OpenCode project directory.');
  const url = typeof input.openCodeUrl === 'string' ? input.openCodeUrl.trim() : '';
  return {
    folder: normalize(folder),
    openCodeUrl: url ? normalizeOpenCodeUrl(url) : '',
    openCodeDirectory: directory ? normalize(directory) : '',
  };
}

export function createDashboardApi() {
  const readLogs = createLogReader();
  let settings = readSettings();
  let openCodeCache;
  let writes = Promise.resolve();

  function openCode(config, project) {
    if (!config.openCodeUrl) return { status: 'off', events: [], agents: [] };
    const directory = config.openCodeDirectory || dirname(config.folder);
    const key = JSON.stringify([config.openCodeUrl, directory, project]);
    if (openCodeCache?.key === key && (!openCodeCache.done || Date.now() < openCodeCache.expires)) {
      return openCodeCache.request;
    }
    const cache = { key, done: false, expires: 0 };
    cache.request = readOpenCode({ url: config.openCodeUrl, directory, project })
      .then((result) => ({ ...result, status: 'connected' }))
      .catch((error) => ({
        status: 'unavailable', events: [], agents: [],
        warning: `Couldn't read OpenCode at ${config.openCodeUrl}: ${error.message}`,
      }))
      .finally(() => {
        cache.done = true;
        cache.expires = Date.now() + 9000;
      });
    openCodeCache = cache;
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

    if (path === '/api/dashboard/settings' && request.method === 'PUT') {
      if (!request.headers['content-type']?.startsWith('application/json')) {
        return send(response, 415, { error: 'Use application/json settings.' });
      }
      try {
        const updated = await parseSettings(request);
        const write = writes.then(async () => {
          await mkdir(dirname(configPath), { recursive: true });
          await writeFile(`${configPath}.tmp`, JSON.stringify(updated, null, 2), 'utf8');
          await rename(`${configPath}.tmp`, configPath);
          settings = Promise.resolve(updated);
          openCodeCache = undefined;
        });
        writes = write.catch(() => {});
        await write;
        return send(response, 200, updated);
      } catch (error) {
        return send(response, 400, { error: error.message });
      }
    }

    if (path !== '/api/dashboard' || request.method !== 'GET') {
      return send(response, 404, { error: 'Dashboard API route not found.' });
    }

    try {
      const config = await settings;
      const logs = await readLogs(config.folder);
      const project = logs.events.find((event) => event.project)?.project ?? 'Aldervast';
      const open = await openCode(config, project);
      const taskIds = new Map(logs.events.filter((event) => event.task_id).map((event) => [event.task_id.toLowerCase(), event.task_id]));
      const taskId = (id) => id ? taskIds.get(id.toLowerCase()) ?? id : null;
      const nativeEvents = open.events.map((event) => ({ ...event, task_id: taskId(event.task_id) }));
      const events = [...logs.events, ...nativeEvents].sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
      return send(response, 200, {
        project, events, agents: open.agents.map((agent) => ({ ...agent, taskId: taskId(agent.taskId) })), settings: config,
        mirror: {
          files: logs.files, error: logs.error, warnings: logs.warnings,
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
