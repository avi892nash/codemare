#!/usr/bin/env node
/**
 * Run a command with web/.env.local (then web/.env) loaded into the
 * environment. Variables already set win, so CI / Docker env is untouched.
 * Prisma's CLI only reads `.env`; the npm scripts use this so everything
 * works from `.env.local`:
 *
 *   node prisma/with-env.mjs prisma migrate deploy
 *   node prisma/with-env.mjs tsx prisma/seed/index.ts
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

for (const name of ['.env.local', '.env']) {
  const file = join(webRoot, name);
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trimStart().startsWith('#')) continue;
    const [, key, raw] = m;
    if (process.env[key] !== undefined) continue;
    process.env[key] = raw.replace(/^(['"])(.*)\1$/, '$2');
  }
}

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error('usage: node prisma/with-env.mjs <command> [...args]');
  process.exit(2);
}
const r = spawnSync(cmd, args, { stdio: 'inherit', env: process.env, shell: process.platform === 'win32' });
if (r.error) {
  console.error(r.error.message);
  process.exit(1);
}
process.exit(r.status ?? 1);
