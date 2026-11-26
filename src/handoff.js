import { eventType, latestCheckResults, sourceName, taskConversationTypes, taskStates } from './data.js';
import { handoffTaskLabel } from './opencode-draft.js';

const notRecorded = 'Not recorded.';
const messageLimit = 6;
const checkLimit = 8;
const singleLine = (text) => text.replace(/\r\n?|\n/g, ' ').trim();

function quote(text, limit = 1200) {
  if (!text?.trim()) return notRecorded;
  const lines = text.slice(0, limit).split(/\r\n?|\n/).map((line) => `> ${line}`);
  if (text.length > limit) lines.push('> [Truncated; see the original activity record.]');
  return lines.join('\n');
}

function describe(event, names, label = eventType(event.type).label, limit = 1200) {
  const from = names.get(event.from) || event.from || (event.source === 'opencode' ? 'User' : 'Unknown sender');
  const to = names.get(event.to) || event.to;
  const direction = to ? `${singleLine(from)} → ${singleLine(to)}` : singleLine(from);
  const fidelity = { verbatim: 'Verbatim', summary: 'Summary' }[event.text_kind];
  const kind = fidelity && ((event.text?.length ?? 0) > limit ? `${fidelity} excerpt` : fidelity);
  const context = [direction, event.recorded_at, singleLine(sourceName(event.source) ?? 'Unconfirmed source'), kind].filter(Boolean).join(' · ');
  return `**${singleLine(label)}** — ${context}\n\n${quote(event.text, limit)}`;
}

export function buildHandoff({ project, directory, task, events, names, handoffId }) {
  const history = events.filter((event) => event.task_id === task.id)
    .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
  const chronological = [...history].reverse();
  const goal = chronological.find((event) => event.type === 'task_assigned' && event.text?.trim()) ??
    chronological.find((event) => event.source === 'opencode' && event.type === 'agent_message' && !event.from && event.text?.trim());
  const assignment = task.assignment?.text?.trim() && task.assignment.id !== goal?.id ? task.assignment : null;
  const report = task.report;
  const quoted = new Set([goal?.id, assignment?.id, report?.id]);
  const other = history.filter((event) => taskConversationTypes.has(event.type) && event.text?.trim() && !quoted.has(event.id));
  const checks = [...latestCheckResults(history).values()];
  const owner = names.get(task.owner) || task.owner;

  const sections = [
    '# Task handoff',
    'Continue the task below. Confirm the worktree, current Git status, and relevant changes before editing. Use the quoted records as context and verify any claims you rely on.',
    [
      `- Project: ${singleLine(project)}`,
      `- Task: ${handoffTaskLabel(task.id)}`,
      handoffId && `- Handoff ID: ${handoffId}`,
      task.parentId && `- Parent task: ${singleLine(task.parentId)}`,
      `- Status: ${taskStates[task.status]?.label ?? 'Unknown'}`,
      `- Recorded assignee: ${owner ? singleLine(owner) : notRecorded}`,
      `- Last recorded activity: ${task.lastSeen ?? notRecorded}`,
      `- Configured OpenCode directory: ${directory ? singleLine(directory) : 'Not recorded. Confirm the intended worktree.'}`,
    ].filter(Boolean).join('\n'),
    '## Task goal',
    goal ? describe(goal, names, goal.type === 'task_assigned' ? 'Initial assignment' : 'Recorded user request', 2000)
      : 'No assignment or user request was recorded. Confirm the goal from the project before editing.',
  ];
  if (assignment) sections.push(describe(assignment, names, 'Latest assignment'));

  sections.push(
    '## Current state',
    report ? describe(report, names, 'Latest status report') : 'No status report was recorded.',
    `**Blocker**\n\n${quote(report?.blocker)}`,
    `**Next action**\n\n${quote(report?.next_action)}`,
    '## Verification',
    `**Reported verification**\n\n${quote(report?.verification)}`,
  );
  if (checks.length) {
    sections.push(
      `Latest recorded result per named check${checks.length > checkLimit ? ` (showing ${checkLimit} of ${checks.length})` : ''}:`,
      ...checks.slice(0, checkLimit).map((check) =>
        describe(check, names, `${check.check_id}: ${check.status === 'completed' ? 'Passed' : 'Failed'}`, 800)),
    );
  } else {
    sections.push('No named check results were recorded.');
  }

  if (other.length) {
    const context = other.slice(0, messageLimit).reverse();
    sections.push('## Recent conversation', ...context.map((event) => describe(event, names, undefined, 800)));
    if (other.length > context.length) sections.push(`Showing ${context.length} of ${other.length} additional entries.`);
  }
  return sections.join('\n\n');
}
