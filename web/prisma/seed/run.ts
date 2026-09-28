import { fileURLToPath } from 'node:url';
import type { PrismaClient } from '@prisma/client';
import { loadSeedDir, SeedError } from './load';
import { validateSeed } from './validate';
import { writeSeed, type SeedSummary } from './write';

/** The real content (written by the content authors). */
export const DEFAULT_SEED_DIR = fileURLToPath(new URL('./data', import.meta.url));
/** A tiny, complete dataset for tests and fresh clones. */
export const FIXTURES_DIR = fileURLToPath(new URL('./fixtures', import.meta.url));

/**
 * Load every file in `dir`, validate it (schemas, then cross-file checks),
 * and write it in one transaction. Throws SeedError listing every problem;
 * nothing is written unless the whole directory is valid.
 */
export async function runSeed(opts: { dir: string; prisma: PrismaClient }): Promise<SeedSummary> {
  const seed = loadSeedDir(opts.dir);
  const report = validateSeed(seed);
  if (report.errors.length > 0) throw new SeedError(report.errors);
  const summary = await writeSeed(opts.prisma, seed);
  return { counts: summary.counts, warnings: [...report.warnings, ...summary.warnings] };
}
