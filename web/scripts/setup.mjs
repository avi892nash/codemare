#!/usr/bin/env node
/**
 * One-shot setup for a fresh clone:
 *
 *   1. copy .env.example → .env.local (only if missing)
 *   2. inject a fresh AUTH_SECRET so signing actually works
 *   3. `npx prisma generate` so the Prisma client is available
 *   4. if DATABASE_URL is set: `prisma migrate deploy` (the schemas `app` +
 *      `content`, incl. the ledger trigger and partial indexes), then seed
 *      the content (prisma/seed/data, or the tiny fixture set when the real
 *      content is absent). If the DB is unreachable: skip with a message.
 *
 * Safe to re-run: migrations apply once, the seed upserts by slug.
 * The npm scripts used here load web/.env.local themselves
 * (prisma/with-env.mjs), since Prisma's CLI only reads `.env`.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(here, '..');
const ENV_EXAMPLE = join(WEB_ROOT, '.env.example');
const ENV_LOCAL = join(WEB_ROOT, '.env.local');
const SEED_DATA = join(WEB_ROOT, 'prisma', 'seed', 'data');

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function run(cmd, opts = {}) {
  execSync(cmd, { cwd: WEB_ROOT, stdio: 'inherit', ...opts });
}

console.log(c.bold('\ncodemare web · setup\n'));

// ── 1. .env.local ─────────────────────────────────────────────────────
if (!existsSync(ENV_LOCAL)) {
  copyFileSync(ENV_EXAMPLE, ENV_LOCAL);
  const secret = randomBytes(32).toString('base64');
  let env = readFileSync(ENV_LOCAL, 'utf8');
  env = env.replace(/^AUTH_SECRET=.*$/m, `AUTH_SECRET=${secret}`);
  writeFileSync(ENV_LOCAL, env);
  console.log(c.ok('✓') + ' wrote web/.env.local with a fresh AUTH_SECRET');
} else {
  console.log(c.dim('•') + ' web/.env.local already exists — leaving it alone');
}

// ── 2. Prisma client ──────────────────────────────────────────────────
console.log(c.dim('•') + ' generating Prisma client…');
try {
  run('npx prisma generate', { stdio: ['ignore', 'ignore', 'inherit'] });
  console.log(c.ok('✓') + ' Prisma client generated');
} catch {
  console.log(c.warn('!') + ' prisma generate failed — see error above');
}

// ── 3. Migrations + seed (best effort) ────────────────────────────────
const envContent = readFileSync(ENV_LOCAL, 'utf8');
const dbUrl = process.env.DATABASE_URL ?? envContent.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim() ?? '';
const placeholder = dbUrl === '' || /replace-me|user:pass@localhost/.test(dbUrl);

if (placeholder) {
  console.log(
    c.warn('•') +
      ' DATABASE_URL is the placeholder — skipping migrations + seed.\n' +
      c.dim('  Set DATABASE_URL in web/.env.local, then re-run `npm run setup`.\n') +
      c.dim('  The app still renders without it; nothing persists.')
  );
} else {
  console.log(c.dim('•') + ' applying migrations…');
  try {
    run('npm run --silent db:deploy', { stdio: ['ignore', 'ignore', 'inherit'] });
    console.log(c.ok('✓') + ' database schema is up to date');
  } catch {
    console.log(c.warn('!') + ' prisma migrate deploy failed — DB may be unreachable. Skipping seed.');
    finish();
    process.exit(0);
  }

  const real = existsSync(SEED_DATA);
  console.log(c.dim('•') + (real ? ' seeding content…' : ' no prisma/seed/data yet — seeding the fixture set…'));
  try {
    run(real ? 'npm run --silent seed' : 'npm run --silent seed:fixtures');
    console.log(c.ok('✓') + ' seed complete');
  } catch {
    console.log(c.warn('!') + ' seed failed — see error above');
  }
}

finish();

function finish() {
  console.log(c.bold('\nNext steps'));
  console.log('  ' + c.dim('# from the repo root'));
  console.log('  npm run dev          # http://localhost:4001\n');
}
