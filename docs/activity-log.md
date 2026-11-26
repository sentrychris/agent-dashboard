# Activity log schema

Write UTF-8 [JSON Lines](https://jsonlines.org/): one JSON object per line, in files ending in `.jsonl`. Put the files directly in the local activity folder configured in **Data sources**. The dashboard reads existing entries and discovers new files on refresh. Blank lines are ignored; malformed lines are skipped and reported in the dashboard.

## Event fields

Only `recorded_at` and `type` are required for a line to be read. Include `project`, `source`, and the relevant task and agent IDs so the dashboard can group and attribute the event.

| Field | Type | Meaning |
| --- | --- | --- |
| `recorded_at` | string, required | When the event was recorded. Use an ISO 8601 timestamp with a time zone, such as `2026-05-12T09:30:00Z`. |
| `type` | string, required | Event kind. Use one of the [event types](#event-types) below for built-in labels. |
| `project` | string | Display name of the project. Use the same value across all files in the folder. |
| `source` | string | Harness or integration that produced the event. For example, `claude-desktop`, `claude-code-cloud`, `opencode`, or your own source name. Defaults to `unknown`. |
| `task_id` | string or `null` | Stable task ID shared by all events about the task. Any naming convention works for log events, such as `DEMO-42`. |
| `parent_task_id` | string or `null` | Optional parent task ID, displayed in the task details. |
| `check_id` | string or `null` | Stable check ID for a `check_result` event, such as `unit-tests`. Use the same ID for a rerun. |
| `from` | string or `null` | Sender, assigner, or reporting agent. Use a stable agent ID. |
| `to` | string or `null` | Recipient or assignee. Leave empty for an update that has no recipient. |
| `status` | string or `null` | `queued`, `in_progress`, `blocked`, `completed`, `failed`, or `cancelled`. Missing or unrecognized values are treated as unset. |
| `text` | string | Message or brief description of the event. Escape line breaks as `\n` so the JSON object stays on one line. |
| `text_kind` | string or `null` | `verbatim` for the exact message; `summary` for a paraphrase or status report. |
| `event_id` | string | Optional unique identifier within the project. Reuse it when copying the same event to another file. Without it, the dashboard de-duplicates identical normalized records. |

## Event types

| `type` | When to use it |
| --- | --- |
| `task_assigned` | An agent assigns or reassigns a task. Set `from` to the assigner and `to` to the assignee. |
| `task_status_changed` | A task starts, becomes blocked, resumes, completes, or otherwise changes state. Include `task_id` and the new `status`. |
| `agent_message` | An agent sends a message to another agent. Set `from` and `to` to the actual participants. |
| `tool_activity` | An agent invokes a tool or reports its result. Specify the agent in `from` and describe the activity in `text`. |
| `check_result` | A named test, build, CI job, or other check has passed or failed. Include its `check_id` and outcome. |
| `error` | An agent or integration reports an error. Include the affected task ID when available. |

Use one writer per file, ideally named `<agent-id>.jsonl`. Append new events and have the sender log each message once. A reply is a separate event with its own ID. The graph uses `from` and `to` to show who communicated or delegated work; a status update with no `to` still appears in the activity log and task history.

The dashboard flags a queued assignment (or an assignment with no known status) after 30 minutes without a subsequent event from its assignee on that task. An `agent_message` from the assignee is enough to acknowledge it.

## Example project

Save these blocks as two separate files in the same activity folder. The dashboard will show a task assigned to `builder`, a reply to `coordinator`, and a later status update.

`coordinator.jsonl`:

```jsonl
{"event_id":"demo-42-assigned","recorded_at":"2026-05-12T09:30:00Z","project":"Example project","source":"custom-harness","type":"task_assigned","task_id":"DEMO-42","from":"coordinator","to":"builder","status":"queued","text":"Add an empty state to the task list.","text_kind":"verbatim"}
```

`builder.jsonl`:

```jsonl
{"event_id":"demo-42-reply","recorded_at":"2026-05-12T09:32:00Z","project":"Example project","source":"custom-harness","type":"agent_message","task_id":"DEMO-42","from":"builder","to":"coordinator","text":"I’ll check the existing empty-state component first.","text_kind":"verbatim"}
{"event_id":"demo-42-started","recorded_at":"2026-05-12T09:34:00Z","project":"Example project","source":"custom-harness","type":"task_status_changed","task_id":"DEMO-42","from":"builder","to":null,"status":"in_progress","text":"Found the shared component and started wiring it into the task list.","text_kind":"summary"}
```

## Reporting check results

Check reporting is optional. Append a `check_result` event when a named check finishes. Use `status: "failed"` for a failure and `status: "completed"` for a pass. Reuse the same `task_id` and `check_id` for a rerun. Checks without a task are grouped by the reporting agent and check ID.

```jsonl
{"recorded_at":"2026-05-12T09:38:00Z","project":"Example project","source":"custom-harness","type":"check_result","task_id":"DEMO-42","check_id":"unit-tests","from":"builder","status":"failed","text":"Two task-list tests failed.","text_kind":"summary"}
{"recorded_at":"2026-05-12T09:45:00Z","project":"Example project","source":"custom-harness","type":"check_result","task_id":"DEMO-42","check_id":"unit-tests","from":"builder","status":"completed","text":"All task-list tests passed on the rerun.","text_kind":"summary"}
```

A failure appears under **Needs attention** until a later passing result for the same check, or until its task is completed or cancelled. A failed check by itself does not change the task's status.

## Cloud mirror heartbeat

If you mirror cloud logs into a local activity folder, have the mirror update `mirror-status.json` in that folder after every attempt. Include successful runs that copied zero lines. This file contains a single JSON object with the latest sync state. Write it to a temporary file in the same folder, then replace `mirror-status.json` so the dashboard cannot read a half-written heartbeat.

```json
{
  "status": "ok",
  "checked_at": "2026-05-12T09:40:00Z",
  "last_success_at": "2026-05-12T09:40:00Z",
  "interval_seconds": 300
}
```

- `status`: `ok` if the sync completed, or `error` if the attempt failed.
- `checked_at`: When the attempt finished. Use ISO 8601 with a time zone.
- `last_success_at`: The last successful sync time. On success, set it to `checked_at` or omit it to use that value. On failure, preserve the previous success, or set it to `null` if none has occurred.
- `interval_seconds`: Expected seconds between attempts. Defaults to `300`. A successful heartbeat is marked overdue after two intervals.
- `error`: Optional description of the failure.

For example, if the next attempt fails after the successful run above:

```json
{
  "status": "error",
  "checked_at": "2026-05-12T09:45:00Z",
  "last_success_at": "2026-05-12T09:40:00Z",
  "interval_seconds": 300,
  "error": "Cloud folder could not be reached."
}
```

Without this file, the dashboard shows **Not reported** for cloud sync. It still shows the time of its local folder check and the latest agent report independently.
