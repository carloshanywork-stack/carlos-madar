import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

export interface CreateDatabaseOptions {
  max?: number;
  applicationName?: string;
}

export function createDatabase(connectionString: string, options: CreateDatabaseOptions = {}) {
  const pool = new Pool({
    connectionString,
    max: options.max ?? 10,
    application_name: options.applicationName ?? 'madar-flow',
  });
  const db = drizzle(pool, { schema });
  return {
    db,
    pool,
    close: async () => {
      await pool.end();
    },
  };
}

export type Database = ReturnType<typeof createDatabase>['db'];
export type DatabasePool = ReturnType<typeof createDatabase>['pool'];
export type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type DatabaseExecutor = Database | DatabaseTransaction;
export { schema };
