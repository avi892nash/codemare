/**
 * Seed CLI — `npm run seed -w web` (also Prisma's `prisma.seed` hook).
 *
 *   npm run seed -w web                              # web/prisma/seed/data, upsert
 *   npm run seed:fixtures -w web                     # web/prisma/seed/fixtures
 *   SEED_DIR=path npm run seed -w web                # any directory
 *   npm run seed -w web -- --mode insert-missing     # or SEED_MODE=insert-missing
 *   tsx prisma/seed/index.ts --dir <path> [--mode upsert|insert-missing]
 *
 * Modes (mode.ts, spec §6.1): `upsert` (default) makes the database match
 * the files — safe to re-run, but it overwrites seeded rows edited since, in
 * Directus too. `insert-missing` only creates rows whose slug (natural key)
 * is not in the database yet and never changes existing ones; the web image
 * uses it (deploy/web/docker-entrypoint.sh). Validates everything first and
 * writes nothing if any file is invalid. Needs DATABASE_URL (the npm scripts
 * load web/.env.local via prisma/with-env.mjs).
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { SeedError } from './load';
import { dirFrom, seedModeFrom } from './mode';
import { DEFAULT_SEED_DIR, runSeed } from './run';

const list = (counts: Record<string, number>) =>
  Object.entries(counts)
    .map(([kind, n]) => `${n} ${kind}`)
    .join(', ');

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const mode = seedModeFrom(argv, process.env);
  const requested = dirFrom(argv) ?? process.env.SEED_DIR;
  const dir = requested ? resolve(requested) : DEFAULT_SEED_DIR;
  if (!requested && !existsSync(dir)) {
    throw new SeedError(
      [`${dir} does not exist yet — seed the fixtures instead: npm run seed:fixtures -w web`],
      'no seed content'
    );
  }

  const prisma = new PrismaClient();
  try {
    console.log(`seed: loading ${dir} (mode ${mode})`);
    const { counts, kept, warnings } = await runSeed({ dir, prisma, mode });
    for (const w of warnings) console.warn(`seed: warning: ${w}`);
    if (mode === 'insert-missing') {
      const existing = list(kept);
      console.log(
        `seed: done — created ${list(counts) || 'nothing'}; ` +
          (existing ? `${existing} already existed and were left as they are (with everything under them)` : 'nothing existed yet')
      );
    } else {
      console.log(`seed: done (${list(counts)})`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof SeedError ? `seed: ${e.message}` : e);
  process.exit(1);
});
