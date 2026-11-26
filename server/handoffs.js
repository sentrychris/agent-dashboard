import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultPath = fileURLToPath(new URL('../.dashboard/handoffs.json', import.meta.url));

function validRecord(record) {
  return record && ['id', 'projectId', 'taskId', 'directory'].every((key) => typeof record[key] === 'string') &&
    Number.isFinite(Date.parse(record.requestedAt)) &&
    (!record.pickup || (typeof record.pickup.agentId === 'string' && Number.isFinite(Date.parse(record.pickup.at))));
}

async function load(file) {
  try {
    const records = JSON.parse(await readFile(file, 'utf8'));
    if (!Array.isArray(records) || !records.every(validRecord)) throw new Error('Invalid handoff history format');
    return { records, warning: null };
  } catch (error) {
    return { records: [], warning: error.code === 'ENOENT' ? null : 'Could not read saved handoff history.' };
  }
}

export function createHandoffStore(file = defaultPath) {
  let state = load(file);
  let writes = Promise.resolve();

  function update(action) {
    const write = writes.then(async () => {
      const { records, warning } = await state;
      if (warning) throw new Error(warning);
      const { next, result } = action(records);
      if (next !== records) {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(`${file}.tmp`, JSON.stringify(next, null, 2), 'utf8');
        await rename(`${file}.tmp`, file);
        state = Promise.resolve({ records: next, warning: null });
      }
      return result;
    });
    writes = write.catch(() => {});
    return write;
  }

  async function list(projectId) {
    const { records, warning } = await state;
    return { handoffs: records.filter((record) => record.projectId === projectId), handoffWarning: warning };
  }

  return {
    list,
    begin(details) {
      return update((records) => {
        const previous = records.find(({ id }) => id === details.id);
        if (previous) {
          if (previous.projectId !== details.projectId || previous.taskId !== details.taskId ||
              previous.directory !== details.directory) throw new Error('This handoff belongs to a different task or worktree.');
          if (previous.launchStatus === 'opened' || previous.pickup) {
            return { next: records, result: { record: previous, launch: false } };
          }
          if (previous.launchStatus === 'requested') {
            throw new Error('This draft was already requested. Check OpenCode before opening another.');
          }
        }
        const record = {
          ...details, requestedAt: previous?.requestedAt ?? new Date().toISOString(),
          launchStatus: 'requested', error: null, pickup: null,
        };
        const next = previous ? records.map((item) => item.id === record.id ? record : item) : [record, ...records];
        return { next, result: { record, launch: true } };
      });
    },
    finish(id, launchStatus, error = null) {
      return update((records) => ({
        next: records.map((record) => record.id === id ? { ...record, launchStatus, error } : record),
      }));
    },
    async observe(projectId, directory, agents) {
      const candidates = agents.filter((agent) => agent.handoffPickup)
        .sort((a, b) => a.handoffPickup.at.localeCompare(b.handoffPickup.at));
      if (!candidates.length) return list(projectId);

      const stored = await list(projectId);
      if (stored.handoffWarning || !stored.handoffs.some((record) => !record.pickup && record.directory === directory)) return stored;
      await update((records) => {
        let changed = false;
        const next = records.map((record) => {
          if (record.projectId !== projectId || record.directory !== directory || record.pickup) return record;
          const agent = candidates.find(({ handoffPickup, taskId }) => handoffPickup.id === record.id &&
            taskId?.toLowerCase() === record.taskId.toLowerCase() && handoffPickup.at >= record.requestedAt);
          if (!agent) return record;
          changed = true;
          return { ...record, pickup: { agentId: agent.id, title: agent.name, at: agent.handoffPickup.at } };
        });
        return { next: changed ? next : records };
      });
      return list(projectId);
    },
  };
}
