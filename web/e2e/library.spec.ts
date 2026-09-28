/**
 * The hidden Library end to end: a plain 404 below staff, noindex, the
 * robots.txt rules, and a staff reader going index → area → article, running
 * the article's C++ on the judge, stepping the visualization and marking
 * the article read. Needs the app (PLAYWRIGHT_BASE_URL), its compile
 * service, and the seeded library content (npm run seed -w web).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { PrismaClient, type Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync(join(__dirname, '..', '.env.local'), 'utf8');
  return env.match(/^DATABASE_URL=(.*)$/m)![1].trim().replace(/^["']|["']$/g, '');
}

const prisma = new PrismaClient({ datasourceUrl: databaseUrl() });
const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const PASSWORD = `e2e-${run}-pw`;
const created: string[] = [];

async function makeUser(role: Role, tag: string) {
  const handle = `e2e_${tag}_${run}`.slice(0, 24);
  const user = await prisma.user.create({
    data: { email: `e2e-${tag}-${run}@codemare.test`, handle, name: handle, role, passwordHash: await bcrypt.hash(PASSWORD, 10) },
  });
  created.push(user.id);
  return user;
}

/**
 * Credentials sign-in through Auth.js. Each call claims its own client
 * address: the app rate-limits logins per IP (lib/rateLimit.ts), and every
 * local request would otherwise share one bucket across test runs.
 */
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

test.afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: created } } }); // library_progress cascades
  await prisma.$disconnect();
});

const LIBRARY_URLS = ['/library', '/library/number-theory', '/library/number-theory/sieve-of-eratosthenes'];

test('the library is a plain 404 for learners and authors', async ({ page }) => {
  for (const role of ['learner', 'author'] as const) {
    const user = await makeUser(role, role.slice(0, 3));
    await signIn(page, user.email);
    for (const path of LIBRARY_URLS) {
      const res = await page.goto(path);
      expect(res?.status(), `${role} ${path}`).toBe(404);
      await expect(page).toHaveTitle('Not found · Codemare');
      await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
      await expect(page.getByText(/library/i)).toHaveCount(0);
    }
  }
});

test('robots.txt disallows the hidden routes', async ({ page }) => {
  const user = await makeUser('learner', 'rob');
  await signIn(page, user.email);
  const res = await page.request.get('/robots.txt');
  expect(res.status()).toBe(200);
  const body = await res.text();
  for (const path of ['/library', '/author', '/dev']) expect(body).toContain(`Disallow: ${path}`);
});

test('robots.txt is served to signed-out crawlers', async ({ request }) => {
  const res = await request.get('/robots.txt', { maxRedirects: 0 });
  expect(res.status()).toBe(200);
});

test('staff read an article: formula, runnable C++, visualization, mark as read', async ({ page }) => {
  test.setTimeout(120_000);
  const staff = await makeUser('staff', 'stf');
  await signIn(page, staff.email);

  await page.goto('/library');
  await expect(page.getByRole('heading', { level: 1, name: 'Algorithms library' })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  const areas = page.getByRole('list', { name: 'Areas' }).getByRole('listitem');
  await expect(areas).toHaveCount(4);
  const total = await prisma.libraryArticle.count({ where: { status: 'published' } });
  await expect(page.getByRole('progressbar', { name: 'Articles read', exact: true })).toHaveAttribute('aria-valuetext', `0 of ${total} articles`);

  await page.getByRole('link', { name: /Number theory/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Number theory' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Primes/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Modular arithmetic/ })).toBeVisible();

  await page.getByRole('link', { name: /^Sieve of Eratosthenes/ }).click(); // the chapter row, not the "Start:" button
  await expect(page.getByRole('heading', { level: 1, name: 'Sieve of Eratosthenes' })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  for (const name of ['Idea', 'Formula', 'Implementation', 'Visualization', 'Applications', 'Pitfalls']) {
    await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
  }
  await expect(page.locator('#formula math')).toHaveCount(1);

  // Runnable C++ on the judge.
  await page.locator('#implementation').getByRole('button', { name: /^Run/ }).click();
  await expect(page.getByLabel('Program output')).toContainText('primes up to one million: 78498', { timeout: 60_000 });
  await expect(page.locator('#implementation').getByText('Accepted', { exact: true })).toBeVisible();

  // The visualization loads lazily and steps.
  const viz = page.getByRole('group', { name: /Sieve of Eratosthenes · n = 40/ });
  await viz.scrollIntoViewIfNeeded();
  await viz.getByRole('button', { name: 'Last step' }).click();
  await expect(viz).toContainText(/step \d+ \/ \d+/);
  await expect(viz).toContainText('The 12 unmarked numbers are the primes.');

  await page.getByRole('button', { name: 'Mark as read' }).click();
  await expect(page.getByText(/^Read · /).first()).toBeVisible();
  expect(await prisma.libraryProgress.count({ where: { userId: staff.id } })).toBe(1);

  await page.goto('/library');
  await expect(page.getByRole('progressbar', { name: 'Articles read', exact: true })).toHaveAttribute('aria-valuetext', `1 of ${total} articles`);
  await expect(page.getByRole('link', { name: /Continue:/ })).toBeVisible();
});
