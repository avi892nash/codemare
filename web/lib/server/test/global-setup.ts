import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { databaseName, testDatabaseUrl } from './database-url';

/**
 * Vitest global setup: make sure the test database exists and carries every
 * migration (the same `prisma migrate deploy` production runs — so the
 * append-only trigger and partial indexes are under test too).
 */
export default async function setup(): Promise<void> {
  const webRoot = fileURLToPath(new URL('../../../', import.meta.url));
  const url = testDatabaseUrl(webRoot);
  const name = databaseName(url);

  const maintenance = new URL(url);
  maintenance.pathname = '/postgres';
  const admin = new PrismaClient({ datasourceUrl: maintenance.toString() });
  try {
    const rows = await admin.$queryRaw<unknown[]>`SELECT 1 FROM pg_database WHERE datname = ${name}`;
    if (rows.length === 0) await admin.$executeRawUnsafe(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
  } catch (e) {
    throw new Error(
      `Cannot reach Postgres for the test database "${name}" (${(e as Error).message}). ` +
        'Start Postgres or set TEST_DATABASE_URL.'
    );
  } finally {
    await admin.$disconnect();
  }

  execSync('npx prisma migrate deploy', {
    cwd: webRoot,
    env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}
