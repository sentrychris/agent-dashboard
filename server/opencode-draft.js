import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { promisify } from 'node:util';
import { Service } from '@opencode/client/service';
import { openCodeDraftLink } from '../src/opencode-draft.js';

const run = promisify(execFile);

async function launch(url) {
  const options = { timeout: 10000, windowsHide: true };
  if (process.platform === 'win32') {
    // Pass the URL as data rather than interpolating it into a shell command.
    await run('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      'Start-Process -FilePath $env:AGENT_DASHBOARD_DRAFT_URL -ErrorAction Stop',
    ], { ...options, env: { ...process.env, AGENT_DASHBOARD_DRAFT_URL: url } });
  } else {
    await run(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], options);
  }
}

export async function prepareOpenCodeDraft(project, input) {
  if (!project?.openCodeUrl) throw new Error('Connect this project to OpenCode in Data sources first.');
  const directory = typeof input.directory === 'string' ? input.directory.trim() : '';
  if (!isAbsolute(directory) || /[\u0000-\u001f\u007f]/u.test(directory)) {
    throw new Error('Enter the full path to the local worktree.');
  }
  if (!(await stat(directory).catch(() => null))?.isDirectory()) {
    throw new Error('The chosen worktree directory could not be found.');
  }
  if (typeof input.prompt !== 'string') throw new Error('A handoff prompt is required.');

  const service = await Service.discover().catch(() => null);
  if (!service || new URL(service.url).origin !== project.openCodeUrl) {
    throw new Error('OpenCode Desktop drafts use the registered local service. Set its exact URL in Data sources.');
  }

  return openCodeDraftLink(directory, input.prompt);
}

export async function launchOpenCodeDraft({ url }) {
  try {
    await launch(url);
  } catch {
    throw new Error('Could not open the OpenCode desktop app. You can still copy the handoff.');
  }
}
