import 'server-only';
import { PrismaClient } from '@prisma/client';

/**
 * PrismaClient singleton for the Next.js server. The `global` cache prevents
 * the dev-mode HMR from spawning a new connection pool on every reload.
 *
 * Reads DATABASE_URL from env. Schema lives in prisma/schema.prisma (Postgres
 * schemas `app` + `content`); bring a database up with
 * `npm run db:deploy -w web` (migrations) and `npm run seed -w web`.
 *
 * Domain rules live in lib/server/* — prefer those over raw queries.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const env = process.env.NODE_ENV;

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Tests assert on expected errors (e.g. the append-only trigger); keep them quiet.
    log: env === 'development' ? ['warn', 'error'] : env === 'test' ? [] : ['error'],
  });

if (env !== 'production') {
  globalForPrisma.prisma = prisma;
}
