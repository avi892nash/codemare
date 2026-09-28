import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The database the web tests run against: TEST_DATABASE_URL, else
 * DATABASE_URL (env or web/.env.local) with the database name swapped for
 * `codemare_test`. The name must end in `_test` — tests TRUNCATE every table.
 */
export function testDatabaseUrl(webRoot: string): string {
  const explicit = process.env.TEST_DATABASE_URL;
  const base = explicit ?? process.env.DATABASE_URL ?? envLocal(webRoot, 'DATABASE_URL');
  if (!base) {
    throw new Error(
      'Set TEST_DATABASE_URL (e.g. postgresql://user@localhost:5432/codemare_test) to run the web tests.'
    );
  }
  const url = new URL(base);
  if (!explicit) url.pathname = '/codemare_test';
  const name = databaseName(url.toString());
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to run tests against database "${name}": its name must end in "_test".`);
  }
  return url.toString();
}

export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

function envLocal(webRoot: string, key: string): string | undefined {
  try {
    const text = readFileSync(join(webRoot, '.env.local'), 'utf8');
    const m = text.match(new RegExp(`^${key}=(.*)$`, 'm'));
    return m?.[1]?.trim().replace(/^["']|["']$/g, '') || undefined;
  } catch {
    return undefined;
  }
}
