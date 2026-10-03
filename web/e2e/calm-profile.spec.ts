/**
 * The calm profile and badges gallery (the UX pass, round 2): the two pages
 * look like the Map — the shared page header (one h1, 26 px), type only from the
 * scale (nothing under 12 px, at most eight sizes), no uppercase labels, an
 * identity header that does not wrap on a phone, the activity map only once a
 * week of it exists, 44 px targets on a phone — and the badge dialog still
 * opens, closes on Esc and gives focus back, at both widths.
 *
 * Needs the app (PLAYWRIGHT_BASE_URL) and the seeded database from
 * web/.env.local. Creates its own users and removes them.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
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
const password = randomBytes(12).toString('base64url');
const DAY = 86_400_000;
const utcMidnight = (t: number) => Math.floor(t / DAY) * DAY;
/** One o'clock UTC on that day — never later than a minute ago. */
const onDay = (daysAgo: number) => new Date(Math.min(utcMidnight(Date.now()) - daysAgo * DAY + 3_600_000, Date.now() - 60_000));

interface Who {
  id: string;
  email: string;
  handle: string;
  name: string;
}
/** A credentials sign-up names the account after its handle. */
const signUpLike = (key: string, handle = `e2e_calm_${key}_${tag}`) => ({ email: `e2e-calm-${key}-${tag}@codemare.test`, handle, name: handle });

let short: Who; // a short handle: the identity header fits on one line on a phone
let some: Who; // a few solves on 3 days, a badge, a lesson started: no activity map
let week: Who; // 6 active days, one more is added mid-test
let busy: Who; // 8 active days: the map shows
let named: Who; // a display name that is not the handle, and a role
const ids: string[] = [];

async function makeUser(u: { email: string; handle: string; name: string }, role: 'learner' | 'author' = 'learner'): Promise<Who> {
  const created = await prisma.user.create({ data: { ...u, role, passwordHash: await bcrypt.hash(password, 10) } });
  ids.push(created.id);
  return { id: created.id, ...u };
}

/** `days` consecutive UTC days ending today, one accepted solve of Two Sum on each. */
async function solveDays(userId: string, days: number, from = 0) {
  const q = await prisma.question.findFirstOrThrow({ where: { slug: 'two-sum' }, select: { id: true } });
  await prisma.submission.createMany({
    data: Array.from({ length: days }, (_, i) => ({
      userId,
      kind: 'submit' as const,
      questionId: q.id,
      language: 'python' as const,
      code: 'pass',
      status: 'OK' as const,
      totalPassed: 5,
      totalTests: 5,
      runtimeUs: BigInt(500 + i),
      memoryKb: 20,
      createdAt: onDay(from + i),
    })),
  });
}

test.beforeAll(async () => {
  short = await makeUser(signUpLike('short', `cm_${tag}`));
  some = await makeUser(signUpLike('some'));
  week = await makeUser(signUpLike('week'));
  busy = await makeUser(signUpLike('busy'));
  named = await makeUser({ email: `e2e-calm-named-${tag}@codemare.test`, handle: `e2e_calm_named_${tag}`, name: 'Ada Lovelace' }, 'author');

  // some: three solves on three days, one wrong answer, a badge, a lesson started
  const questions = await prisma.question.findMany({ where: { slug: { in: ['two-sum', 'valid-anagram', 'binary-search'] } }, select: { id: true } });
  await prisma.submission.createMany({
    data: [
      ...questions.map((q, i) => ({
        userId: some.id,
        kind: 'submit' as const,
        questionId: q.id,
        language: 'python' as const,
        code: 'pass',
        status: 'OK' as const,
        totalPassed: 5,
        totalTests: 5,
        runtimeUs: BigInt(300 + i * 100),
        memoryKb: 20,
        createdAt: onDay(i),
      })),
      {
        userId: some.id,
        kind: 'submit' as const,
        questionId: questions[0].id,
        language: 'python' as const,
        code: 'pass',
        status: 'WA' as const,
        totalPassed: 2,
        totalTests: 5,
        runtimeUs: BigInt(100),
        memoryKb: 20,
        createdAt: new Date(Date.now() - 30_000),
      },
    ],
  });
  const firstAccept = await prisma.badge.findUniqueOrThrow({ where: { slug: 'first-accept' } });
  await prisma.badgeAward.create({ data: { userId: some.id, badgeId: firstAccept.id } });
  const lesson = await prisma.lesson.findFirstOrThrow({ where: { module: { track: { slug: 'foundations' } } }, orderBy: { ord: 'asc' }, select: { id: true } });
  await prisma.lessonProgress.create({ data: { userId: some.id, lessonId: lesson.id, status: 'started' } });

  await solveDays(short.id, 2);
  await solveDays(week.id, 6);
  await solveDays(busy.id, 8);
  await solveDays(named.id, 2);
});

test.afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: ids } } }).catch(() => undefined);
  await prisma.$disconnect();
});

test.describe.configure({ mode: 'serial' });

/** Credentials sign-in through Auth.js's own endpoints, on a client address of its own (logins are rate-limited per IP). */
async function signIn(page: Page, who: Who) {
  const ip = `10.80.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;
  const { csrfToken } = await (await page.request.get('/api/auth/csrf')).json();
  const res = await page.request.post('/api/auth/callback/credentials', {
    form: { email: who.email, password, csrfToken, callbackUrl: '/', json: 'true' },
    headers: { 'x-forwarded-for': ip },
    maxRedirects: 0,
  });
  expect([200, 302]).toContain(res.status());
  const session = await (await page.request.get('/api/auth/session')).json();
  expect(session?.user?.email).toBe(who.email);
}

async function setTheme(page: Page, theme: 'dark' | 'light') {
  const base = test.info().project.use.baseURL ?? 'http://localhost:4001';
  await page.context().addCookies([{ name: 'cm-theme', value: theme, url: base }]);
}

/** page.goto, retried once on ERR_ABORTED (a first compile under `next dev` can abort the navigation; builds never do). */
async function visit(page: Page, url: string) {
  try {
    return await page.goto(url);
  } catch (e) {
    if (!String(e).includes('ERR_ABORTED')) throw e;
    return page.goto(url);
  }
}

interface Census {
  /** Text under 12 px, not counting decorative marks (aria-hidden, two characters or fewer: the language mark, avatar initials — components/ui). */
  small: { text: string; size: number }[];
  /** Decorative marks under 12 px (the shared kit sizes them). */
  marks: { text: string; size: number }[];
  /** Distinct font sizes in the page's content. */
  sizes: number[];
  upper: string[];
  h1: { count: number; size: number; text: string };
}

/** What is on screen in the page's content (not the top bar; not the inside of a closed <details>). */
async function census(page: Page): Promise<Census> {
  return page.evaluate(() => {
    const main = document.querySelector('main')!;
    const small: { text: string; size: number }[] = [];
    const marks: { text: string; size: number }[] = [];
    const sizes = new Set<number>();
    const upper = new Set<string>();
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.nodeValue ?? '').replace(/\s+/g, ' ').trim();
      const el = n.parentElement;
      if (!text || !el || el.closest('svg, script, style')) continue;
      const closed = el.closest('details:not([open])');
      if (closed && !el.closest('summary')) continue;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (cs.display === 'none' || cs.visibility === 'hidden' || r.width === 0 || r.height === 0) continue;
      const size = parseFloat(cs.fontSize);
      const decorative = !!el.closest('[aria-hidden="true"]') && text.length <= 2;
      if (size < 12) (decorative ? marks : small).push({ text, size });
      if (!decorative) sizes.add(Math.round(size * 10) / 10);
      if (cs.textTransform === 'uppercase') upper.add(text);
    }
    const h1s = [...document.querySelectorAll('h1')];
    return {
      small,
      marks,
      sizes: [...sizes].sort((a, b) => a - b),
      upper: [...upper],
      h1: { count: h1s.length, size: h1s[0] ? parseFloat(getComputedStyle(h1s[0]).fontSize) : 0, text: h1s[0]?.textContent ?? '' },
    };
  });
}

/** Decorative marks under 12 px belong to components/ui (LangMark, Avatar): say so in the report instead of failing this page's test. */
function noteMarks(c: Census) {
  if (c.marks.length) {
    test.info().annotations.push({ type: 'kit-marks', description: `${c.marks.length} decorative mark(s) under 12 px: ${[...new Set(c.marks.map((m) => `${m.text} ${m.size}px`))].join(', ')}` });
  }
}

/** How far the page's content reaches past the viewport (the app scrolls an inner <main>, so look at both). */
async function sidewaysScroll(page: Page): Promise<number> {
  return page.evaluate(() => {
    const main = document.querySelector('main')!;
    return Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth, main.scrollWidth - main.clientWidth);
  });
}

const VIEWS = [
  { w: 1440, h: 900 },
  { w: 375, h: 812 },
] as const;

test('the profile and the badges gallery set no text under 12 px, in both themes at 1440 and 375', async ({ page }) => {
  test.setTimeout(150_000);
  await signIn(page, some);
  for (const { w, h } of VIEWS) {
    await page.setViewportSize({ width: w, height: h });
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(page, theme);
      for (const path of [`/u/${some.handle}`, `/u/${some.handle}/badges`]) {
        await visit(page, path);
        await expect(page.locator('main h1')).toBeVisible();
        const c = await census(page);
        const where = `${path} at ${w} px (${theme})`;
        expect(c.small, `${where}: text under 12 px`).toEqual([]);
        expect(c.upper, `${where}: uppercase labels`).toEqual([]);
        expect(c.sizes.length, `${where}: font sizes ${c.sizes.join(' · ')}`).toBeLessThanOrEqual(8);
        expect(c.h1.count, `${where}: h1s`).toBe(1);
        expect(c.h1.size, `${where}: h1 size`).toBe(26);
        noteMarks(c);
      }
    }
  }
});

test('the activity map, with its labels, is also set in the scale', async ({ page }) => {
  await signIn(page, busy);
  for (const { w, h } of VIEWS) {
    await page.setViewportSize({ width: w, height: h });
    await visit(page, `/u/${busy.handle}`);
    await expect(page.getByRole('grid')).toBeVisible();
    const c = await census(page);
    expect(c.small, `at ${w} px`).toEqual([]);
    expect(c.sizes.length, `at ${w} px: ${c.sizes.join(' · ')}`).toBeLessThanOrEqual(8);
    noteMarks(c);
  }
});

test('the activity map appears with a week of activity and not before', async ({ page }) => {
  await signIn(page, week);
  await visit(page, `/u/${week.handle}`);
  // six active days: no map, and no stand-in for it
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(week.name);
  await expect(page.getByRole('grid')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Activity' })).toHaveCount(0);

  // the seventh active day: the map is there, naming the year
  await solveDays(week.id, 1, 6);
  await visit(page, `/u/${week.handle}`);
  await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible();
  await expect(page.getByRole('grid', { name: /7 submissions in the last year, on 7 days/ })).toBeVisible();
});

test('the identity header is the page header: one h1, the name, one line of context, no wrapping on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page, short);
  await visit(page, `/u/${short.handle}`);
  // a sign-up names the account after its handle: said once, in the title; the context is "Joined … · This is you"
  const h1 = page.getByRole('heading', { level: 1 });
  await expect(h1).toHaveText(short.handle);
  await expect(page.getByText(`@${short.handle}`)).toHaveCount(0);
  await expect(page.getByText(/^Joined .* 20\d\d/).first()).toBeVisible();
  await expect(page.getByText('This is you')).toBeVisible();
  const box = async (loc: ReturnType<Page['locator']>) => (await loc.boundingBox())!;
  // the title and the context are one line each (26 px × 1.2 and 14 px × 1.55 leave no room for a second); nothing scrolls sideways
  expect((await box(h1)).height).toBeLessThan(40);
  expect((await box(page.locator('main header p'))).height).toBeLessThan(26);
  expect(await sidewaysScroll(page)).toBe(0);

  // the longest handle (24 characters, no break in it) wraps in the title instead of scrolling the page
  await signIn(page, some);
  await visit(page, `/u/${some.handle}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(some.handle);
  expect(await sidewaysScroll(page)).toBe(0);

  // a display name that is not the handle: the handle joins the context, in parts that never break inside
  await signIn(page, named);
  await visit(page, `/u/${named.handle}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ada Lovelace');
  await expect(page.getByText(`@${named.handle}`)).toBeVisible();
  await expect(page.getByText('Author', { exact: true })).toBeVisible();
  const parts = await page.locator('main header p span').evaluateAll((els) =>
    els.filter((e) => (e.textContent ?? '').trim().length > 1).map((e) => ({ text: e.textContent, h: e.getBoundingClientRect().height }))
  );
  expect(parts.length).toBeGreaterThanOrEqual(3); // @handle, Joined …, Author
  for (const p of parts) expect(p.h, `"${p.text}" stays on one line`).toBeLessThan(26);
  expect(await sidewaysScroll(page)).toBe(0);
});

test('on a phone the page’s primary actions are 44 px targets', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page, some);
  await visit(page, `/u/${some.handle}`);
  const targets = [
    page.getByText('More stats'),
    page.getByRole('link', { name: /^All submissions/ }),
    page.getByRole('link', { name: /^View all/ }),
    page.getByRole('link', { name: /First Accept/ }),
    page.getByRole('link', { name: 'Two Sum' }).first(),
    page.getByRole('link', { name: /^Learn/ }).last(),
  ];
  for (const t of targets) {
    await t.scrollIntoViewIfNeeded();
    const b = (await t.boundingBox())!;
    expect(Math.min(b.width, b.height), await t.innerText()).toBeGreaterThanOrEqual(44);
  }
  await visit(page, `/u/${some.handle}/badges`);
  for (const t of [page.getByRole('tab', { name: /^All/ }), page.getByRole('button', { name: /^First Accept/ }), page.getByRole('link', { name: 'Your profile' })]) {
    const b = (await t.boundingBox())!;
    expect(Math.min(b.width, b.height), await t.innerText()).toBeGreaterThanOrEqual(44);
  }
});

test('the badge dialog opens, closes on Esc and returns focus, at both widths', async ({ page }) => {
  await signIn(page, some);
  for (const { w, h } of VIEWS) {
    await page.setViewportSize({ width: w, height: h });
    await visit(page, `/u/${some.handle}/badges`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your badges');
    await expect(page.getByText('1 of 15 earned')).toBeVisible();

    const card = page.getByRole('button', { name: /^First Accept/ });
    await card.click();
    const dialog = page.getByRole('dialog', { name: 'First Accept' });
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/\?badge=first-accept$/);
    // the dialog is set in the scale too
    const small = await dialog.evaluate((d) =>
      [...d.querySelectorAll('*')]
        .filter((e) => [...e.childNodes].some((c) => c.nodeType === 3 && c.nodeValue!.trim()))
        .map((e) => ({ text: (e.textContent ?? '').trim().slice(0, 30), size: parseFloat(getComputedStyle(e).fontSize) }))
        .filter((t) => t.size < 12)
    );
    expect(small, `dialog at ${w} px`).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(card).toBeFocused();

    // a locked badge opens too, with its progress; Close returns focus the same way
    const locked = page.getByRole('button', { name: /^Getting Warm/ });
    await locked.click();
    const warm = page.getByRole('dialog', { name: 'Getting Warm' });
    await expect(warm.getByRole('progressbar', { name: 'Your progress' })).toHaveAttribute('aria-valuetext', '3 / 10 problems solved');
    await warm.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(warm).toBeHidden();
    await expect(locked).toBeFocused();
  }
});
