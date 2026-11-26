# Agent Dashboard

A local web dashboard for following agents across Claude and OpenCode. See who’s working on what, follow task status and agent conversations, and explore how agents delegate work. The screenshot shows the dashboard tracking Aldervast.

![Aldervast workspace overview showing agent and task counts, a relationship graph, recent activity, and tracked tasks](docs/dashboard.png)

## Getting started

Requires Node.js 22.12 or newer. From the repository directory:

```powershell
npm ci
npm run dev
```

Open [http://127.0.0.1:4317](http://127.0.0.1:4317) and use **Data sources** to connect a folder of activity logs. To serve a built copy instead, run `npm run build` and then `npm start`.

## Activity sources

- The default log folder is `../aldervast-v1.14.96/agent-activity`, relative to this repository. Set your own path in **Data sources**. The dashboard checks the folder every three seconds and picks up new `.jsonl` files as the mirror writes them. Cloud-to-PC delay depends on the mirror’s schedule.
- Each line is a JSON event. The dashboard uses `recorded_at`, `type`, `task_id`, `from`, `to`, `status`, `text`, and `text_kind`, plus `project` and `source` when provided. An optional `event_id` identifies the same event across files; otherwise identical records are de-duplicated. Verbatim messages and summaries remain distinct.
- To add OpenCode, enter the URL of a reachable local **V2** API and, if needed, its project directory. The dashboard reads recent sessions, their last 30 messages, tool status, and pending approvals. Include an Aldervast task ID such as `ALD-112-perf` in a session title (or set its `task_id` metadata) to see that session’s activity alongside the task. If the server expects an `Authorization` header, set `DASHBOARD_OPENCODE_AUTHORIZATION` before launching the dashboard.

The dashboard serves only on loopback. Source settings are saved in `.dashboard/settings.json`. Claude states reflect reported task status and can lag real activity; the activity view identifies each event’s source and whether its text is verbatim or a summary.
