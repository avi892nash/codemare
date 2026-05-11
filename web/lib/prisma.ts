import 'server-only';
import { PrismaClient } from '@prisma/client';

/**
 * PrismaClient singleton for the Next.js server. The `global` cache prevents
 * the dev-mode HMR from spawning a new connection pool on every reload.
 *
 * Reads DATABASE_URL from env. Schema lives in prisma/schema.prisma; run
 * `npx prisma migrate dev` once after setting DATABASE_URL to bring the DB
 * online.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
