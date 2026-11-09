import './env.js';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');

  const files = (await readdir(migrationsDirectory)).filter((entry) => entry.endsWith('.sql')).sort();
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const tableResult = await client.query<{ reg: string | null }>(
      "SELECT to_regclass('public.schema_migrations')::text AS reg",
    );
    const applied = new Set<string>();
    if (tableResult.rows[0]?.reg) {
      const rows = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
      for (const row of rows.rows) applied.add(row.name);
    }

    for (const file of files) {
      console.log(`${applied.has(file) ? 'applied' : 'pending'}  ${file}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error('Status check failed:', error);
  process.exitCode = 1;
});
