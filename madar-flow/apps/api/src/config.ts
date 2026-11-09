import { config as loadDotenv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, type Env } from '@madar/shared';

const here = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(here, '../../..', '.env') });

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Env {
  return loadEnv(source);
}
