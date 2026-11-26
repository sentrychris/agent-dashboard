import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogReader } from './logs.js';
import { normalizeOpenCodeUrl } from './opencode.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const configPath = resolve(root, '.dashboard', 'settings.json');
const defaultProject = {
  id: 'default', name: 'Aldervast',
  folder: resolve(root, '..', 'aldervast-v1.14.96', 'agent-activity'),
  openCodeUrl: '', openCodeDirectory: '',
};

const text = (value) => typeof value === 'string' ? value.trim() : '';

function connectionFields(input) {
  const directory = text(input.openCodeDirectory);
  if (directory && !isAbsolute(directory)) throw new Error('Enter the full path to the OpenCode project directory.');
  const url = text(input.openCodeUrl);
  return {
    openCodeUrl: url ? normalizeOpenCodeUrl(url) : '',
    openCodeDirectory: directory ? normalize(directory) : '',
  };
}

async function readSettings(file) {
  try {
    const input = JSON.parse(await readFile(file, 'utf8'));
    if (Array.isArray(input.projects) && input.projects.length) {
      const projects = input.projects.map((project) => {
        if (!text(project.id) || !text(project.name) || !isAbsolute(text(project.folder))) {
          throw new Error('A saved project is missing its ID, name, or activity folder.');
        }
        return { id: project.id, name: text(project.name), folder: normalize(project.folder), ...connectionFields(project) };
      });
      const active = projects.find(({ id }) => id === input.activeProjectId) ?? projects[0];
      return { activeProjectId: active.id, projects };
    }

    // Import the settings created before the dashboard supported saved projects.
    const folder = isAbsolute(text(input.folder)) ? normalize(input.folder) : defaultProject.folder;
    const { events } = await createLogReader()(folder);
    const label = basename(folder) === 'agent-activity' ? basename(dirname(folder)) : basename(folder);
    const name = events.find((event) => event.project)?.project ||
      (folder === defaultProject.folder ? defaultProject.name : label || 'Local project');
    const project = { ...defaultProject, folder, name, ...connectionFields(input) };
    return { activeProjectId: project.id, projects: [project] };
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn(`Could not load dashboard settings: ${error.message}`);
    return { activeProjectId: defaultProject.id, projects: [defaultProject] };
  }
}

function findProject(settings, id) {
  const project = settings.projects.find((entry) => entry.id === id);
  if (!project) throw new Error('That project is no longer available.');
  return project;
}

export function createProjectStore(file = configPath) {
  let state = readSettings(file);
  let writes = Promise.resolve();

  function save(update) {
    const write = writes.then(async () => {
      const settings = await update(await state);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(`${file}.tmp`, JSON.stringify(settings, null, 2), 'utf8');
      await rename(`${file}.tmp`, file);
      state = Promise.resolve(settings);
      return findProject(settings, settings.activeProjectId);
    });
    writes = write.catch(() => {});
    return write;
  }

  return {
    read: () => state,
    select: (input) => save((settings) => ({
      ...settings, activeProjectId: findProject(settings, input.id).id,
    })),
    edit: (input) => save(async (settings) => {
      const current = findProject(settings, input.id ?? settings.activeProjectId);
      const project = await projectFields(input, current.name);
      return {
        ...settings,
        projects: settings.projects.map((entry) => entry.id === current.id ? { id: entry.id, ...project } : entry),
      };
    }),
    add: (input) => save(async (settings) => {
      const project = { id: randomUUID(), ...await projectFields(input) };
      return { activeProjectId: project.id, projects: [...settings.projects, project] };
    }),
  };
}

async function projectFields(input, defaultName = '') {
  const name = input.name === undefined ? defaultName : text(input.name);
  if (!name) throw new Error('Enter a project name.');
  const folder = text(input.folder);
  if (!isAbsolute(folder)) throw new Error('Enter the full path to the activity folder.');
  const info = await stat(folder).catch(() => null);
  if (!info?.isDirectory()) throw new Error('The activity folder does not exist or cannot be read.');
  return { name, folder: normalize(folder), ...connectionFields(input) };
}
