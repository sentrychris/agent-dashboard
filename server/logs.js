import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const statuses = new Set(['queued', 'in_progress', 'blocked', 'completed', 'failed', 'cancelled']);
const string = (value) => typeof value === 'string' && value.trim() ? value : null;

function parseEvent(line, file) {
  const input = JSON.parse(line);
  const timestamp = Date.parse(input?.recorded_at);
  if (!Number.isFinite(timestamp) || !string(input?.type)) {
    throw new Error('Missing event type or valid recorded_at');
  }

  const event = {
    recorded_at: new Date(timestamp).toISOString(),
    project: string(input.project),
    source: string(input.source) ?? 'unknown',
    type: input.type,
    task_id: string(input.task_id),
    parent_task_id: string(input.parent_task_id),
    from: string(input.from),
    to: string(input.to),
    status: statuses.has(input.status) ? input.status : null,
    text: typeof input.text === 'string' ? input.text : '',
    text_kind: ['verbatim', 'summary'].includes(input.text_kind) ? input.text_kind : null,
  };
  const id = string(input.event_id) ?? createHash('sha256').update(JSON.stringify(event)).digest('hex');
  return { ...event, id: `log:${event.project ?? ''}:${id}`, file };
}

export function createLogReader() {
  const cache = new Map();

  return async function readLogs(folder) {
    let files;
    try {
      files = (await readdir(folder, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && /\.jsonl$/i.test(entry.name))
        .map((entry) => entry.name).sort();
    } catch (error) {
      return { files: [], events: [], warnings: [], error: `Can't read the activity folder (${error.code ?? 'read error'}).` };
    }

    const events = new Map();
    const warnings = [];
    const paths = new Set(files.map((file) => join(folder, file)));
    for (const path of cache.keys()) {
      if (!paths.has(path)) cache.delete(path);
    }

    await Promise.all(files.map(async (file) => {
      const path = join(folder, file);
      try {
        const info = await stat(path);
        const fingerprint = `${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
        if (cache.get(path)?.fingerprint === fingerprint) return;

        const content = await readFile(path, 'utf8');
        const entries = [];
        const badLines = [];
        for (const [offset, chunk] of content.split('\n').entries()) {
          const line = chunk.trim();
          if (!line) continue;
          try {
            entries.push(parseEvent(line, file));
          } catch {
            badLines.push(offset + 1);
          }
        }
        cache.set(path, { fingerprint, entries, badLines });
      } catch (error) {
        warnings.push(`${file}: ${error.code ?? 'read error'}.`);
      }
    }));

    for (const file of files) {
      const record = cache.get(join(folder, file));
      if (!record) continue;
      if (record.badLines.length) {
        const sample = record.badLines.slice(0, 5).join(', ');
        warnings.push(`${file}: skipped ${record.badLines.length} invalid ${record.badLines.length === 1 ? 'line' : 'lines'} (${sample}${record.badLines.length > 5 ? ', …' : ''}).`);
      }
      for (const event of record.entries) {
        const previous = events.get(event.id);
        if (!previous || file.toLowerCase() === `${event.from?.toLowerCase()}.jsonl`) {
          events.set(event.id, event);
        }
      }
    }
    return { files, events: [...events.values()], warnings, error: null };
  };
}
