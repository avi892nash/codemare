/**
 * Seed modes (spec §6.1):
 *
 *   upsert          the JSON files are the source of truth: every seeded row
 *                   is created or overwritten, owned child sets are replaced.
 *                   The default for `npm run seed -w web` (development).
 *   insert-missing  the database is the source of truth (production, where
 *                   staff edit content in Directus): only rows whose natural
 *                   key does not exist yet are created, together with what
 *                   they own; existing rows and their children are never
 *                   touched. The web image's default (deploy/web/docker-entrypoint.sh).
 *
 * Chosen with `--mode <m>` (or `--mode=<m>`), else SEED_MODE, else upsert.
 */
import { SeedError } from './load';

export const SEED_MODES = ['upsert', 'insert-missing'] as const;
export type SeedMode = (typeof SEED_MODES)[number];
export const DEFAULT_SEED_MODE: SeedMode = 'upsert';

export function isSeedMode(value: string): value is SeedMode {
  return (SEED_MODES as readonly string[]).includes(value);
}

function flag(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0) return argv[i + 1] ?? '';
  return argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

/** `--mode` beats SEED_MODE beats the default. Throws SeedError for an unknown mode. */
export function seedModeFrom(argv: readonly string[], env: Readonly<Record<string, string | undefined>>): SeedMode {
  const fromFlag = flag(argv, 'mode');
  const [value, source] = fromFlag !== undefined ? [fromFlag, '--mode'] : [env.SEED_MODE || undefined, 'SEED_MODE'];
  if (value === undefined) return DEFAULT_SEED_MODE;
  if (!isSeedMode(value)) {
    throw new SeedError([`${source}: "${value}" is not a seed mode (expected ${SEED_MODES.join(' or ')})`], 'bad arguments');
  }
  return value;
}

/** `--dir <path>` / `--dir=<path>`, if given. */
export function dirFrom(argv: readonly string[]): string | undefined {
  return flag(argv, 'dir') || undefined;
}
