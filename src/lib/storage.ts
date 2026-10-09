import { openDB } from 'idb';
import type { Project } from './model';

const db = () => openDB('ferti-demo', 1, { upgrade(database) {
  database.createObjectStore('projects', { keyPath: 'id' });
  database.createObjectStore('files');
} });
export async function saveProject(project: Project) { await (await db()).put('projects', project); }
export async function listProjects(): Promise<Project[]> { return (await db()).getAll('projects'); }
export async function deleteProject(id: string) { const database = await db(); await database.delete('projects', id); await database.delete('files', id); }
export async function saveFile(id: string, file: File) { await (await db()).put('files', file, id); }
export async function loadFile(id: string): Promise<File | undefined> { return (await db()).get('files', id); }
