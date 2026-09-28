/**
 * Accessibility + layout regression net across the product: for a
 * representative route per section, in both themes, no serious or critical
 * axe-core violations and exactly one <h1>; on phones (375 px) no
 * horizontal page scroll on the pages that must work there (catalog, learn,
 * profile, map, My Library, library). The editor-like pages (problem, IDE)
 * are checked at desktop width, where they are supported.
 *
 * axe-core is injected from cdnjs per page (not a dependency). A staff user
 * is created straight in the database (so /author and the hidden /library
 * are covered too) and removed afterwards.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const AXE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js';

function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync(join(__dirname, '..', '.env.local'), 'utf8');
  return env.match(/^DATABASE_URL=(.*)$/m)![1].trim().replace(/^["']|["']$/g, '');
}

const prisma = new PrismaClient({ datasourceUrl: databaseUrl() });
const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const PASSWORD = `e2e-${run}-pw`;
let user: { id: string; email: string; handle: string } | null = null;

type Theme = 'dark' | 'light';
interface Finding {
  id: string;
  impact: string | null | undefined;
  help: string;
  targets: string[];
}

/** Credentials sign-in through Auth.js's own endpoints, on a fresh client address (logins are rate-limited per IP). */
async function signIn(page: Page, email: string) {
  const ip = `10.${[0, 0, 0].map(() => Math.floor(Math.random() * 250) + 1).join('.')}`;
  const { csrfToken } = await (await page.request.get('/api/auth/csrf')).json();
  await page.request.post('/api/auth/callback/credentials', {
    form: { email, password: PASSWORD, csrfToken, callbackUrl: '/' },
    headers: { 'x-forwarded-for': ip },
    maxRedirects: 0,
  });
  const session = await (await page.request.get('/api/auth/session')).json();
  expect(session?.user?.email).toBe(email);
}

/** The theme cookie the root layout reads, so SSR renders the theme under test. */
async function setTheme(page: Page, theme: Theme) {
  const base = test.info().project.use.baseURL ?? 'http://localhost:4001';
  await page.context().addCookies([{ name: 'cm-theme', value: theme, url: base }]);
}

/** Serious / critical axe violations on the current page. */
async function axeViolations(page: Page): Promise<Finding[]> {
  await page.addScriptTag({ url: AXE_URL });
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: { id: string; impact?: string | null; help: string; nodes: { target: string[] }[] }[] }> } }).axe;
    const result = await axe.run(document, { exclude: [['nextjs-portal']], resultTypes: ['violations'] });
    return result.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => ({ id: v.id, impact: v.impact, help: v.help, targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }));
  });
}

async function h1Count(page: Page): Promise<number> {
  return page.locator('h1').count();
}

/** Page-level horizontal overflow in px (0 = none). */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
}

async function open(page: Page, path: string) {
  const res = await page.goto(path, { waitUntil: 'load' });
  expect(res?.ok() || res?.status() === 404, `${path} → ${res?.status()}`).toBeTruthy();
  // Let client components mount (dynamic imports, portals) before auditing.
  await page.waitForLoadState('networkidle').catch(() => undefined);
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const handle = `e2e_a11y_${run}`.slice(0, 24);
  const created = await prisma.user.create({
    data: { email: `e2e-a11y-${run}@codemare.test`, handle, name: 'A11y Check', role: 'staff', passwordHash: await bcrypt.hash(PASSWORD, 4) },
  });
  user = { id: created.id, email: created.email, handle: created.handle };
});

test.afterAll(async () => {
  if (user) await prisma.user.deleteMany({ where: { id: user.id } });
  await prisma.$disconnect();
});

test('signed-out pages: no serious axe violations, one h1, no overflow at 375 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme);
    for (const path of ['/signin', '/signup', '/forgot']) {
      await open(page, path);
      expect(await axeViolations(page), `${path} (${theme})`).toEqual([]);
      expect(await h1Count(page), `${path} h1`).toBe(1);
      expect(await horizontalOverflow(page), `${path} overflow`).toBe(0);
    }
  }
});

test('signed-in sections at desktop width: no serious axe violations and one h1, in both themes', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, user!.email);
  const routes = [
    '/problems',
    '/problems/two-sum',
    '/ide',
    '/submissions',
    '/learn',
    '/learn/foundations',
    '/learn/foundations/hash-maps',
    `/u/${user!.handle}`,
    `/u/${user!.handle}/badges`,
    '/map',
    '/queue',
    '/me/library',
    '/author',
    '/library',
    '/this-page-does-not-exist',
  ];
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme);
    for (const path of routes) {
      await open(page, path);
      expect(await axeViolations(page), `${path} (${theme})`).toEqual([]);
      expect(await h1Count(page), `${path} h1 (${theme})`).toBe(1);
    }
  }
});

test('phone width (375 px): no horizontal page scroll where phones are supported', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page, user!.email);
  await setTheme(page, 'dark');
  for (const path of ['/problems', '/learn', '/learn/foundations', `/u/${user!.handle}`, '/map', '/me/library', '/library', '/submissions']) {
    await open(page, path);
    expect(await horizontalOverflow(page), `${path} overflow at 375 px`).toBe(0);
    expect(await axeViolations(page), `${path} at 375 px`).toEqual([]);
  }
});
