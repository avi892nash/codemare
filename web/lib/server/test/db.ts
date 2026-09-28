import { afterAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';

export { prisma };

let tables: string[] | undefined;

/** TRUNCATE every app.* and content.* table (TRUNCATE bypasses the ledger's append-only trigger). */
export async function resetDatabase(): Promise<void> {
  tables ??= (
    await prisma.$queryRaw<{ t: string }[]>`
      SELECT format('%I.%I', schemaname, tablename) AS t
      FROM pg_tables WHERE schemaname IN ('app', 'content')`
  ).map((r) => r.t);
  if (tables.length) await prisma.$executeRawUnsafe(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
}

/** Call at the top of a DB test file: a clean database before every test. */
export function setupTestDatabase(): void {
  beforeEach(resetDatabase);
  afterAll(() => prisma.$disconnect());
}
