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
| `error` | An agent or integration reports an error. Include the affected task ID when available. |

Use one writer per file, ideally named `<agent-id>.jsonl`. Append new events and have the sender log each message once. A reply is a separate event with its own ID. The graph uses `from` and `to` to show who communicated or delegated work; a status update with no `to` still appears in the activity log and task history.

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
