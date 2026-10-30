import { isAbsolute, join, resolve } from 'node:path';
import { env } from './env.js';

function resolveFromProject(value) {
  return isAbsolute(value) ? resolve(value) : resolve(env.projectRoot, value);
}

export const projectRoot = env.projectRoot;
export const dataDirectory = resolveFromProject(env.dataDirectory);
export const storageRoot = resolveFromProject(env.storageRoot);
export const databasePath = env.databasePath
  ? resolveFromProject(env.databasePath)
  : join(dataDirectory, 'madar-v2.sqlite');
export const schemaPath = join(projectRoot, 'server', 'database', 'schema.sql');
export const clientDistPath = join(projectRoot, 'client', 'dist');
