export const acknowledgementDelay = 30 * 60 * 1000;

export const attentionTypes = {
  approval: { label: 'Approval needed', tone: 'orange', priority: 0 },
  blocked: { label: 'Blocked', tone: 'red', priority: 1 },
  failedTask: { label: 'Task failed', tone: 'red', priority: 2 },
  failedCheck: { label: 'Check failed', tone: 'red', priority: 2 },
  unacknowledged: { label: 'Awaiting acknowledgement', tone: 'orange', priority: 3 },
};

export function buildAttention(model, events, now) {
  const items = [];
  const tasks = new Map(model.tasks.map((task) => [task.id, task]));

  for (const agent of model.agents) {
    if (agent.status !== 'approval') continue;
    const count = agent.approvalCount;
    const actions = agent.approvalActions?.join(', ');
    items.push({
      id: `approval:${agent.id}`, type: 'approval', title: agent.name,
      description: `${count ?? 'Pending'} ${count === 1 ? 'request' : 'requests'}${actions ? ` · ${actions}` : ''}`,
      actor: 'You, in OpenCode', timestamp: agent.lastSeen, timeLabel: 'Session updated',
      target: { kind: 'agent', id: agent.id },
    });
  }

  for (const task of model.tasks) {
    const { statusEvent, assignment } = task;
    if (task.status === 'blocked' || task.status === 'failed') {
      items.push({
        id: `task:${task.id}`, type: task.status === 'blocked' ? 'blocked' : 'failedTask', title: task.id,
        description: statusEvent?.text || task.summary,
        actorId: task.owner ?? statusEvent?.from, timestamp: statusEvent?.recorded_at ?? task.lastSeen, timeLabel: 'Reported',
        target: statusEvent ? { kind: 'event', id: statusEvent.id } : { kind: 'task', id: task.id },
      });
    } else if (assignment && !task.acknowledged && ['queued', 'unknown'].includes(task.status) &&
        now - Date.parse(assignment.recorded_at) >= acknowledgementDelay) {
      items.push({
        id: `assignment:${task.id}`, type: 'unacknowledged', title: task.id,
        description: assignment.text, actorId: assignment.to, timestamp: assignment.recorded_at, timeLabel: 'Assigned',
        target: { kind: 'event', id: assignment.id },
      });
    }
  }

  const seenChecks = new Set();
  for (const event of events) {
    if (event.type !== 'check_result' || !event.check_id || !['failed', 'completed'].includes(event.status)) continue;
    const key = JSON.stringify([event.task_id, event.task_id ? null : event.from, event.check_id]);
    if (seenChecks.has(key)) continue;
    seenChecks.add(key);

    const task = tasks.get(event.task_id);
    if (event.status !== 'failed' || ['completed', 'cancelled'].includes(task?.status)) continue;
    items.push({
      id: `check:${key}`, type: 'failedCheck', title: event.task_id ? `${event.check_id} · ${event.task_id}` : event.check_id,
      description: event.text, actorId: task?.owner ?? event.from, timestamp: event.recorded_at, timeLabel: 'Reported',
      target: { kind: 'event', id: event.id },
    });
  }

  return items.sort((a, b) => attentionTypes[a.type].priority - attentionTypes[b.type].priority ||
    (b.timestamp ?? '').localeCompare(a.timestamp ?? ''));
}

export function mirrorFreshness(heartbeat, now) {
  if (heartbeat?.status === 'error') return { label: 'Sync failed', tone: 'red' };
  if (heartbeat?.status === 'invalid') return { label: 'Invalid heartbeat', tone: 'red' };
  if (heartbeat?.status !== 'ok') return { label: 'Not reported', tone: 'muted' };
  if (now - Date.parse(heartbeat.lastSuccessAt) > 2 * heartbeat.intervalSeconds * 1000) {
    return { label: 'Overdue', tone: 'orange' };
  }
  return { label: 'On schedule', tone: 'green' };
}
