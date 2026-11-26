# Agent Dashboard

A local web dashboard for agent workflows. Follow assignments and task status, search agent messages and activity, and explore delegation and communication in an interactive graph. It works with any harness that writes the [activity log format](docs/activity-log.md) and can also read from a local OpenCode V2 server.

![Aldervast workspace overview showing Needs attention, Source freshness, agent relationships, and recent activity](docs/dashboard.png)

*Aldervast is the example workspace shown above. You can connect your own project.*

## Getting started

Requires Node.js 22.12 or newer.

```sh
git clone https://github.com/sentrychris/agent-dashboard.git
cd agent-dashboard
npm ci
npm run dev
```

1. Create a local folder for your project's activity logs. For a first run, save the two [example JSONL files](docs/activity-log.md#example-project) in that folder.
2. Open [http://127.0.0.1:4317](http://127.0.0.1:4317), select **Data sources**, enter the folder's absolute path under **Local log folder**, and save.
3. Have your agents or an integration append real events to that folder using the [JSONL schema](docs/activity-log.md). If your agents write logs in the cloud, mirror those files to the local folder.

The dashboard checks the folder every three seconds and discovers new `.jsonl` files automatically. It shows one project at a time and takes its name from the logs. The prefilled folder and fallback name are Aldervast defaults; you can replace the folder in **Data sources**.

To serve a built copy, run `npm run build` and then `npm start`.

## Monitoring

- **Needs attention** shows blocked or failed tasks, pending OpenCode approvals, and queued assignments with no acknowledgement after 30 minutes. Agents can also report [failed and passing checks](docs/activity-log.md#reporting-check-results) so a failure stays visible until it passes or the task closes. Select an item to open its source event or session.
- **Source freshness** shows when the dashboard last checked the local folder, when the cloud mirror last synced successfully, and when the most recent agent report was recorded. To report cloud syncs, have your mirror write [`mirror-status.json`](docs/activity-log.md#cloud-mirror-heartbeat) in the local activity folder after each attempt, including successful runs that copy zero lines.

Existing JSONL files still work as-is. Check results are optional, and the cloud sync is shown as **Not reported** until a heartbeat is available.

## Optional: connect OpenCode V2

In **Data sources**, enter the URL of a reachable loopback OpenCode V2 API. Set **Project directory** if the OpenCode workspace is somewhere other than the parent of your log folder. The dashboard reads recent sessions, their last 30 messages, tool activity, and pending approvals.

To attach an OpenCode session to a task in your logs, set the session's `metadata.task_id` to that task's ID. Title-based matching currently recognizes only `ALD-…` IDs; use metadata for other task ID formats. If the API expects an `Authorization` header, set `DASHBOARD_OPENCODE_AUTHORIZATION` before launching the dashboard.

The dashboard listens on loopback and saves source settings in `.dashboard/settings.json`. Agent statuses derived from logs reflect the latest report and may lag real activity.
