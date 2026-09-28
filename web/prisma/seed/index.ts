/**
 * Seed CLI — `npm run seed -w web` (also Prisma's `prisma.seed` hook).
 *
 *   npm run seed -w web                       # web/prisma/seed/data
 *   npm run seed:fixtures -w web              # web/prisma/seed/fixtures
 *   SEED_DIR=path npm run seed -w web         # any directory
 *   tsx prisma/seed/index.ts --dir <path>
 *
 * Idempotent: upserts by slug; safe to re-run. Validates everything first
 * and writes nothing if any file is invalid. Needs DATABASE_URL (the npm
 * scripts load web/.env.local via prisma/with-env.mjs).
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { SeedError } from './load';
import { DEFAULT_SEED_DIR, runSeed } from './run';

function dirArg(argv: string[]): string | undefined {
  const i = argv.indexOf('--dir');
  if (i >= 0) return argv[i + 1];
  return argv.find((a) => a.startsWith('--dir='))?.slice('--dir='.length);
}

async function main(): Promise<void> {
  const requested = dirArg(process.argv.slice(2)) ?? process.env.SEED_DIR;
  const dir = requested ? resolve(requested) : DEFAULT_SEED_DIR;
  if (!requested && !existsSync(dir)) {
    throw new SeedError(
      [`${dir} does not exist yet — seed the fixtures instead: npm run seed:fixtures -w web`],
      'no seed content'
    );
  }

  const prisma = new PrismaClient();
  try {
    console.log(`seed: loading ${dir}`);
    const { counts, warnings } = await runSeed({ dir, prisma });
    for (const w of warnings) console.warn(`seed: warning: ${w}`);
    const summary = Object.entries(counts)
      .map(([kind, n]) => `${n} ${kind}`)
      .join(', ');
    console.log(`seed: done (${summary})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof SeedError ? `seed: ${e.message}` : e);
  process.exit(1);
});
