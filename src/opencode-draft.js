const maximumLinkLength = 8000;

export function isHandoffId(value) {
  return typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(value);
}

export function handoffTaskLabel(taskId) {
  return taskId.replace(/\r\n?|\n/g, ' ').trim();
}

export function parseHandoffPrompt(text) {
  if (typeof text !== 'string' || !/^# Task handoff\r?\n/u.test(text)) return null;
  const heading = text.split(/\r?\n##[ \t]+/u, 1)[0];
  const taskId = heading.match(/^- Task: ([^\r\n]+)\r?$/mu)?.[1].trim();
  const id = heading.match(/^- Handoff ID: ([^\r\n]+)\r?$/mu)?.[1].trim();
  return taskId ? { taskId, handoffId: isHandoffId(id) ? id : null } : null;
}

export function openCodeDraftLink(directory, prompt) {
  const url = new URL('opencode://new-session');
  url.searchParams.set('directory', directory);
  if (prompt) url.searchParams.set('prompt', prompt);

  const prefilled = !!prompt && url.href.length <= maximumLinkLength;
  if (!prefilled) url.searchParams.delete('prompt');
  return { url: url.href, prefilled };
}
