/**
 * Profile (06) and badges (B1–B3) end to end: the /profile redirect, stats
 * (the figures a learner looks at, the rest under "More stats"), the
 * keyboard-navigable activity heatmap (shown from a week of activity),
 * viewing someone else's profile, 404 for unknown handles, and the badge
 * gallery's deep-linked modal. The calm look of both pages is in
 * calm-profile.spec.ts.
 *
 * Needs the app (PLAYWRIGHT_BASE_URL) and the seeded database from
 * web/.env.local. Creates its own users and removes them.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync(join(__dirname, '..', '.env.local'), 'utf8');
  const m = env.match(/^DATABASE_URL=(.*)$/m);
  if (!m) throw new Error('DATABASE_URL is not set and web/.env.local has none');
  return m[1].trim().replace(/^["']|["']$/g, '');
}

const prisma = new PrismaClient({ datasourceUrl: databaseUrl() });
const tag = randomBytes(4).toString('hex');
const me = { email: `e2e-prof-${tag}@codemare.test`, handle: `e2e_prof_${tag}`, name: 'E2E Profile', password: randomBytes(12).toString('base64url') };
const other = { email: `e2e-other-${tag}@codemare.test`, handle: `e2e_other_${tag}`, name: 'E2E Other' };
/** Seven active UTC days (today and the six before it): the least activity that shows the heatmap. */
const busy = { email: `e2e-busy-${tag}@codemare.test`, handle: `e2e_busy_${tag}`, name: 'E2E Busy', password: randomBytes(12).toString('base64url') };
const ids: string[] = [];
let context: BrowserContext;
let page: Page;
let busyPage: Page;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY = 86_400_000;
const utcMidnight = (t: number) => Math.floor(t / DAY) * DAY;
const longDate = (t: number) => {
  const d = new Date(t);
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
};

/**
 * page.goto, retried once on ERR_ABORTED: under `next dev`, a route that
 * compiles for the first time can hot-reload the page being left and abort
 * the navigation. Production builds never do this.
 */
async function visit(p: Page, url: string) {
  try {
    return await p.goto(url);
  } catch (e) {
    if (!String(e).includes('ERR_ABORTED')) throw e;
    return p.goto(url);
  }
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  const u = await prisma.user.create({
    data: { email: me.email, handle: me.handle, name: me.name, passwordHash: await bcrypt.hash(me.password, 10) },
  });
  const o = await prisma.user.create({ data: { email: other.email, handle: other.handle, name: other.name } });
  const b = await prisma.user.create({
    data: { email: busy.email, handle: busy.handle, name: busy.name, passwordHash: await bcrypt.hash(busy.password, 10) },
  });
  ids.push(u.id, o.id, b.id);

  // Three accepted solves on the last three UTC days (a streak of 3), one wrong answer.
  const today = utcMidnight(Date.now());
  const qs = await prisma.question.findMany({
    where: { slug: { in: ['two-sum', 'valid-anagram', 'binary-search'] } },
    select: { id: true, slug: true },
  });
  const bySlug = new Map(qs.map((q) => [q.slug, q.id]));
  const solve = (slug: string, daysAgo: number, runtimeUs: number, status: 'OK' | 'WA' = 'OK') => ({
    userId: u.id,
    kind: 'submit' as const,
    questionId: bySlug.get(slug)!,
    language: 'python' as const,
    code: 'pass',
    status,
    totalPassed: status === 'OK' ? 5 : 2,
    totalTests: 5,
    runtimeUs: BigInt(runtimeUs),
    createdAt: new Date(today - daysAgo * DAY + 3_600_000),
  });
  await prisma.submission.createMany({
    data: [solve('two-sum', 2, 900), solve('valid-anagram', 1, 350), solve('binary-search', 0, 1_200), solve('binary-search', 0, 5_000, 'WA')],
  });
  const firstAccept = await prisma.badge.findUniqueOrThrow({ where: { slug: 'first-accept' } });
  await prisma.badgeAward.create({ data: { userId: u.id, badgeId: firstAccept.id } });

  // busy: one accepted solve a day for the last seven days, and a wrong answer today — 8 submissions on 7 days.
  await prisma.submission.createMany({
    data: [
      ...Array.from({ length: 7 }, (_, d) => ({ ...solve('two-sum', d, 800 + d * 10), userId: b.id })),
      { ...solve('two-sum', 0, 5_000, 'WA'), userId: b.id },
    ],
  });

  context = await browser.newContext({
    reducedMotion: 'reduce',
    // Distinct client address so repeated runs never share the login rate-limit bucket.
    extraHTTPHeaders: { 'x-forwarded-for': `10.78.${randomBytes(1)[0]}.${randomBytes(1)[0]}` },
  });
  page = await context.newPage();
  const { csrfToken } = await (await page.request.get('/api/auth/csrf')).json();
  const res = await page.request.post('/api/auth/callback/credentials', {
    form: { email: me.email, password: me.password, csrfToken, callbackUrl: '/profile', json: 'true' },
  });
  expect(res.ok()).toBeTruthy();

  // The busy learner signs in on a context of their own.
  const busyContext = await browser.newContext({
    reducedMotion: 'reduce',
    extraHTTPHeaders: { 'x-forwarded-for': `10.79.${randomBytes(1)[0]}.${randomBytes(1)[0]}` },
  });
  busyPage = await busyContext.newPage();
  const token = (await (await busyPage.request.get('/api/auth/csrf')).json()).csrfToken;
  const busyRes = await busyPage.request.post('/api/auth/callback/credentials', {
    form: { email: busy.email, password: busy.password, csrfToken: token, callbackUrl: '/profile', json: 'true' },
  });
  expect(busyRes.ok()).toBeTruthy();
});

test.afterAll(async () => {
  await busyPage?.context().close();
  await context?.close();
  await prisma.user.deleteMany({ where: { id: { in: ids } } }).catch(() => undefined);
  await prisma.$disconnect();
});

test('/profile redirects to the viewer’s public profile with their stats', async () => {
  await visit(page, '/profile');
  await expect(page).toHaveURL(new RegExp(`/u/${me.handle}$`));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(me.name);
  await expect(page.getByText(`@${me.handle}`)).toBeVisible();
  await expect(page.getByText('This is you')).toBeVisible();

  // The figures a learner looks at are on the page: solved (by difficulty), the streak.
  await expect(page.getByText(/^Longest 3 days/)).toBeVisible();
  await expect(page.getByText('Easy', { exact: true }).first()).toBeVisible();
  // Acceptance and the fastest run are one click away, under "More stats".
  await expect(page.getByText('3 of 4 submissions accepted')).toBeHidden();
  await page.getByText('More stats').click();
  await expect(page.getByText('3 of 4 submissions accepted')).toBeVisible();
  await expect(page.getByText('75', { exact: true })).toBeVisible(); // acceptance %
  await expect(page.getByText('350', { exact: true })).toBeVisible(); // fastest run, µs
  await expect(page.getByRole('link', { name: 'Valid Anagram' }).first()).toHaveAttribute('href', '/problems/valid-anagram');
  await expect(page.getByRole('link', { name: /First Accept/ })).toHaveAttribute('href', `/u/${me.handle}/badges?badge=first-accept`);
  await expect(page.getByRole('heading', { name: 'Recent submissions' })).toBeVisible();
  // Three active days are not enough for the activity map.
  await expect(page.getByRole('grid')).toHaveCount(0);
});

test('the activity heatmap (from seven active days) is a labelled, keyboard-navigable grid', async () => {
  await visit(busyPage, `/u/${busy.handle}`);
  const grid = busyPage.getByRole('grid', { name: /8 submissions in the last year, on 7 days/ });
  await expect(grid).toBeVisible();
  const today = utcMidnight(Date.now());

  // Exactly one cell is in the tab order: today.
  const current = grid.locator('[role="gridcell"][tabindex="0"]');
  await expect(current).toHaveCount(1);
  await expect(current).toHaveAttribute('aria-label', `2 submissions on ${longDate(today)}`);
  await current.focus();

  await busyPage.keyboard.press('ArrowLeft'); // one week back
  await expect(busyPage.locator(':focus')).toHaveAttribute('aria-label', `No submissions on ${longDate(today - 7 * DAY)}`);
  await busyPage.keyboard.press('ArrowRight');
  await expect(busyPage.locator(':focus')).toHaveAttribute('aria-label', `2 submissions on ${longDate(today)}`);
  if (new Date(today).getUTCDay() > 0) {
    await busyPage.keyboard.press('ArrowUp'); // one day back, same week
    await expect(busyPage.locator(':focus')).toHaveAttribute('aria-label', `1 submission on ${longDate(today - DAY)}`);
  }
  await busyPage.keyboard.press('Control+Home'); // the first day shown
  await expect(busyPage.locator(':focus')).toHaveAttribute('aria-label', `No submissions on ${longDate(today - 364 * DAY)}`);
  await busyPage.keyboard.press('Control+End');
  await expect(busyPage.locator(':focus')).toHaveAttribute('aria-label', `2 submissions on ${longDate(today)}`);
  // Roving tabindex follows focus.
  await expect(grid.locator('[role="gridcell"][tabindex="0"]')).toHaveCount(1);
});

test('any signed-in user can view another profile, which never shows an email', async () => {
  await visit(page, `/u/${other.handle.toUpperCase()}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(other.name);
  await expect(page.getByText('This is you')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'No submissions yet' })).toBeVisible();
  expect(await page.content()).not.toContain(other.email);

  const res = await visit(page, '/u/nobody_goes_by_this');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'No one goes by that handle' })).toBeVisible();
  expect((await visit(page, `/u/${me.handle}/badges/extra`))?.status()).toBe(404);
});

test('the badge gallery opens a focus view that deep-links, closes on Esc and restores focus', async () => {
  await visit(page, `/u/${me.handle}/badges`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your badges');
  await expect(page.getByRole('tab', { name: /Earned\s*1/ })).toBeVisible();

  const tile = page.getByRole('button', { name: /^First Accept/ });
  await tile.click();
  const dialog = page.getByRole('dialog', { name: 'First Accept' });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\?badge=first-accept$/);
  await expect(dialog.getByText(/You earned this on/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page).not.toHaveURL(/badge=/);
  await expect(tile).toBeFocused();

  // Back closes a badge opened from the gallery.
  await page.getByRole('button', { name: /^Getting Warm/ }).click();
  await expect(page.getByRole('dialog', { name: 'Getting Warm' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('dialog')).toBeHidden();

  // A deep link opens the focus view directly; closing it lands on its tile.
  await visit(page, `/u/${me.handle}/badges?badge=getting-warm`);
  const warm = page.getByRole('dialog', { name: 'Getting Warm' });
  await expect(warm).toBeVisible();
  await expect(warm.getByText('How to earn it')).toBeVisible();
  await expect(warm.getByText('Solve 10 different problems.')).toBeVisible();
  await expect(warm.getByRole('progressbar', { name: 'Your progress' })).toHaveAttribute('aria-valuetext', '3 / 10 problems solved');
  await expect(warm.getByRole('link', { name: 'Find a problem on the map' })).toHaveAttribute('href', '/map');
  await page.keyboard.press('Escape');
  await expect(warm).toBeHidden();
  await expect(page.getByRole('button', { name: /^Getting Warm/ })).toBeFocused();

  // Filters.
  await page.getByRole('tab', { name: /Earned/ }).click();
  await expect(page.getByRole('button', { name: /^Getting Warm/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^First Accept/ })).toBeVisible();
});

test('someone else’s gallery shows their progress, without calls to action', async () => {
  await visit(page, `/u/${other.handle}/badges?badge=getting-warm`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${other.name}’s badges`);
  const dialog = page.getByRole('dialog', { name: 'Getting Warm' });
  await expect(dialog.getByRole('progressbar', { name: `${other.name}’s progress` })).toHaveAttribute('aria-valuetext', '0 / 10 problems solved');
  await expect(dialog.getByRole('link', { name: 'Find a problem on the map' })).toHaveCount(0);
});
