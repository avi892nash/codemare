import 'server-only';
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/** Anything that can run Prisma queries: the client, or an interactive-transaction client. */
export type Db = PrismaClient | Prisma.TransactionClient;
/** An interactive-transaction client. */
export type Tx = Prisma.TransactionClient;

/**
 * Interactive-transaction limits. Balance-changing work queues on a per-user
 * advisory lock, so a burst of requests from one user waits its turn rather
 * than failing: allow a generous wait for a pooled connection.
 */
export const TX_OPTIONS = { maxWait: 15_000, timeout: 30_000 } as const;

/**
 * Take the user's transaction-scoped advisory lock (spec §3.3 step 1).
 * Everything that reads balances and then writes the ledger/unlocks runs
 * under it, so concurrent spends by one user serialize and can never
 * overdraw. Re-entrant within a transaction; released on commit/rollback.
 */
export async function lockUser(tx: Tx, userId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`;
}

/**
 * Run `fn` inside a transaction that holds `userId`'s advisory lock. Pass
 * an existing transaction as `tx` to join it instead of opening a new one.
 */
export function withUserLock<T>(userId: string, fn: (tx: Tx) => Promise<T>, tx?: Tx): Promise<T> {
  if (tx) return lockUser(tx, userId).then(() => fn(tx));
  return prisma.$transaction(async (t) => {
    await lockUser(t, userId);
    return fn(t);
  }, TX_OPTIONS);
}

export { prisma };
