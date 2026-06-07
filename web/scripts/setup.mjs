#!/usr/bin/env node
/**
 * One-shot setup for a fresh clone:
 *
 *   1. copy .env.example → .env.local (only if missing)
 *   2. inject a fresh AUTH_SECRET so signing actually works
 *   3. `npx prisma generate` so the Prisma client is available
 *   4. if DATABASE_URL is reachable: `prisma db push` + seed Two Sum +
 *      Reverse String. If not: skip with a friendly message.
 *
 * Safe to re-run. Idempotent — seeds upsert by slug.
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

// ── 3. DB push + seed (best effort) ───────────────────────────────────
const envContent = readFileSync(ENV_LOCAL, 'utf8');
const dbUrl = envContent.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim() ?? '';
const placeholder = dbUrl === '' || /replace-me|user:pass@localhost/.test(dbUrl);

if (placeholder) {
  console.log(
    c.warn('•') +
      ' DATABASE_URL is the placeholder — skipping schema push + seed.\n' +
      c.dim('  Set DATABASE_URL in web/.env.local to enable submissions history.\n') +
      c.dim('  The app still works without it; runs just don’t persist.')
  );
} else {
  console.log(c.dim('•') + ' pushing schema to the database…');
  try {
    run('npx prisma db push --skip-generate', { stdio: ['ignore', 'ignore', 'inherit'] });
    console.log(c.ok('✓') + ' schema is up to date');
  } catch {
    console.log(c.warn('!') + ' prisma db push failed — DB may be unreachable. Skipping seed.');
    finish();
    process.exit(0);
  }

  console.log(c.dim('•') + ' seeding problems…');
  try {
    run('npx tsx prisma/seed.ts');
    console.log(c.ok('✓') + ' seed complete');
  } catch {
    console.log(c.warn('!') + ' seed failed — see error above');
  }
}

finish();

function finish() {
  console.log(c.bold('\nNext steps'));
  console.log('  ' + c.dim('# from the repo root'));
  console.log('  npm run dev          # http://localhost:3001\n');
}
