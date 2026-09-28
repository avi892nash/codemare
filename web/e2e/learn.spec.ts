/**
 * Learn end to end (L1–L3, L6, L7): tracks, a lesson with a runnable
 * snippet and a visualization, mark complete, a checkpoint with review,
 * and track completion with its badges.
 *
 * Needs the app (PLAYWRIGHT_BASE_URL), the compile service, and the seeded
 * database from web/.env.local. Creates its own learner and removes it.
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
const learner = { email: `e2e-learn-${tag}@codemare.test`, handle: `e2e_learn_${tag}`, password: randomBytes(12).toString('base64url') };
let userId = '';
let context: BrowserContext;
let page: Page;

/** Sign in through Auth.js's credentials endpoint (independent of the sign-in UI). */
async function signIn(p: Page, who: { email: string; password: string }) {
  const { csrfToken } = await (await p.request.get('/api/auth/csrf')).json();
  const res = await p.request.post('/api/auth/callback/credentials', {
    form: { email: who.email, password: who.password, csrfToken, callbackUrl: '/learn', json: 'true' },
  });
  expect(res.ok()).toBeTruthy();
  const session = await (await p.request.get('/api/auth/session')).json();
  expect(session?.user?.handle).toBe(learner.handle);
}

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
  const user = await prisma.user.create({
    data: { email: learner.email, handle: learner.handle, name: 'E2E Learner', passwordHash: await bcrypt.hash(learner.password, 10) },
  });
  userId = user.id;
  // Distinct client address so repeated runs never share the login rate-limit bucket.
  context = await browser.newContext({
    reducedMotion: 'reduce',
    extraHTTPHeaders: { 'x-forwarded-for': `10.77.${randomBytes(1)[0]}.${randomBytes(1)[0]}` },
  });
  page = await context.newPage();
  await signIn(page, learner);
});

test.afterAll(async () => {
  await context?.close();
  if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  await prisma.$disconnect();
});

test('learn home lists the tracks and starts one', async () => {
  await visit(page, '/learn');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Learn the patterns behind the problems');
  for (const title of ['Foundations', 'Search & Order', 'Graphs & Optimization']) {
    await expect(page.getByRole('heading', { level: 3, name: title })).toBeVisible();
  }
  // No activity yet: no "continue" banner.
  await expect(page.getByText('Continue where you left off')).toHaveCount(0);

  await page.getByRole('link', { name: 'Start track: Foundations' }).click();
  await expect(page).toHaveURL(/\/learn\/foundations\/arrays-and-cost$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Arrays and what operations cost');

  // Opening a lesson records it: the home page now offers to continue it.
  await expect(page.getByRole('navigation', { name: /Module 1/ }).getByRole('link', { name: /Arrays and what operations cost/ })).toHaveAttribute('aria-current', 'page');
  await expect
    .poll(async () => (await prisma.lessonProgress.count({ where: { userId } })), { timeout: 10_000 })
    .toBe(1);
  await visit(page, '/learn');
  await expect(page.getByText('Continue where you left off')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Resume lesson' })).toHaveAttribute('href', '/learn/foundations/arrays-and-cost');
});

test('a lesson runs its snippets, steps its visualization, and can be completed', async () => {
  await visit(page, '/learn/foundations/hash-maps');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hash maps: remember what you have seen');
  await expect(page.locator('math')).toHaveCount(1); // the $$ formula, as MathML

  // The JavaScript Two Sum snippet (the lesson's second runnable block) runs on the compile service.
  await expect(page.getByRole('textbox', { name: 'JavaScript editor' })).toBeVisible();
  await page.getByRole('button', { name: /^Run/ }).nth(1).click();
  const output = page.getByLabel('Program output');
  await expect(output).toContainText('[ 4, 5 ]', { timeout: 30_000 });
  await expect(output).toContainText('[ 0, 1 ]');
  await expect(output).not.toContainText('\u001b');

  // The visualization does not autoplay under reduced motion; step through it.
  const viz = page.getByRole('group', { name: 'Two sum with a hash map' });
  await expect(viz).toBeVisible();
  await expect(viz.getByText('step 1 / 12')).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(viz.getByText('step 1 / 12')).toBeVisible();
  await viz.getByRole('button', { name: 'Next step' }).click();
  await expect(viz.getByText('step 2 / 12')).toBeVisible();
  await viz.focus();
  await page.keyboard.press('End');
  await expect(viz.getByText('step 12 / 12')).toBeVisible();
  await expect(viz).toContainText('Answer: (4, 5)');

  // A question card links to the problem.
  await expect(page.getByRole('link', { name: /Practice · Arrays & Hashing\s*Two Sum/ })).toHaveAttribute('href', '/problems/two-sum');

  await page.getByRole('button', { name: 'Mark complete' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Lesson complete' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continue' })).toBeFocused();
  await expect(page.getByRole('link', { name: 'Continue' })).toHaveAttribute('href', '/learn/foundations/counting-and-grouping');
  const row = await prisma.lessonProgress.findFirst({ where: { userId, status: 'completed' }, include: { lesson: true } });
  expect(row?.lesson.slug).toBe('hash-maps');

  await page.reload();
  await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible();
});

test('the checkpoint grades answers and explains them', async () => {
  await visit(page, '/learn/foundations/arrays-hashing/checkpoint');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Arrays & Hashing');

  // Submitting with blanks asks for every answer first.
  await page.getByRole('button', { name: 'Submit answers' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Answer every question first' })).toBeVisible();

  await page.getByRole('radio', { name: 'O(1)', exact: true }).check();
  await page.getByRole('radio', { name: 'So an element never pairs with itself' }).check();
  await page.getByRole('radio', { name: '4,950' }).check();
  await page.getByRole('textbox', { name: /Which class from Python/ }).fill('  counter ');
  await expect(page.getByText('4/4 answered')).toBeVisible();
  await page.getByRole('button', { name: 'Submit answers' }).click();

  await expect(page).toHaveURL(/checkpoint\?attempt=/);
  await expect(page.getByRole('heading', { name: /Checkpoint passed/ })).toBeVisible();
  await expect(page.getByText('Score 4 of 4.', { exact: false })).toBeAttached();
  await expect(page.getByText('Correct', { exact: true })).toHaveCount(4);
  await expect(page.getByText('jumps straight to its bucket')).toBeVisible(); // an explanation

  // The review survives a reload and offers a retake.
  await page.reload();
  await expect(page.getByRole('heading', { name: /Checkpoint passed/ })).toBeVisible();
  await page.getByRole('link', { name: 'Retake' }).click();
  await expect(page).toHaveURL(/\/checkpoint$/);
  await expect(page.getByRole('button', { name: 'Submit answers' })).toBeVisible();

  // The track page shows the pass.
  await visit(page, '/learn/foundations');
  await expect(page.getByText('Passed · 4/4')).toBeVisible();
});

test('finishing a track shows the completion page and its badges', async () => {
  // Fast-forward: every other Foundations lesson done, the other checkpoints passed.
  const track = await prisma.track.findUniqueOrThrow({
    where: { slug: 'foundations' },
    include: { modules: { include: { lessons: true, _count: { select: { checkpointQuestions: true } } } } },
  });
  const lessons = track.modules.flatMap((m) => m.lessons);
  const last = lessons.find((l) => l.slug === 'monotonic-stack')!;
  for (const l of lessons) {
    if (l.id === last.id) continue;
    await prisma.lessonProgress.upsert({
      where: { userId_lessonId: { userId, lessonId: l.id } },
      create: { userId, lessonId: l.id, status: 'completed', completedAt: new Date() },
      update: { status: 'completed', completedAt: new Date() },
    });
  }
  for (const m of track.modules.filter((m) => m.slug !== 'arrays-hashing')) {
    await prisma.checkpointAttempt.create({
      data: { userId, moduleId: m.id, score: m._count.checkpointQuestions, total: m._count.checkpointQuestions, passed: true, answers: {} },
    });
  }

  await visit(page, '/learn/foundations/complete');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Almost there: Foundations');
  await expect(page.getByRole('region', { name: 'Still to do' }).getByRole('link', { name: /The monotonic stack/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continue: The monotonic stack' })).toBeVisible();

  // Completing the last lesson runs badge evaluation through the domain layer.
  await visit(page, '/learn/foundations/monotonic-stack');
  await page.getByRole('button', { name: 'Mark complete' }).click();
  await expect(page.getByText('Badge earned: Graduate')).toBeVisible();
  await expect(page.getByText('Badge earned: Studious')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continue' })).toHaveAttribute('href', '/learn/foundations/complete');

  await page.getByRole('link', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('You finished Foundations');
  await expect(page.getByRole('heading', { name: 'Learning badges' })).toBeVisible();
  for (const name of ['Graduate', 'Studious']) {
    await expect(page.getByRole('link', { name: new RegExp(name) })).toHaveAttribute('href', new RegExp(`/u/${learner.handle}/badges\\?badge=`));
  }
  await expect(page.getByRole('heading', { name: 'Up next' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: 'Search & Order' })).toBeVisible();

  await visit(page, '/learn');
  await expect(page.getByRole('link', { name: 'Review: Foundations' })).toBeVisible();
});

test('unknown learn URLs 404, and a module slug leads to its module', async () => {
  const res = await visit(page, '/learn/foundations/no-such-lesson');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Lesson not found' })).toBeVisible();
  expect((await visit(page, '/learn/nope'))?.status()).toBe(404);
  expect((await visit(page, '/learn/foundations/two-pointers/checkpoint-x'))?.status()).toBe(404);

  await visit(page, '/learn/foundations/two-pointers');
  await expect(page).toHaveURL(/\/learn\/foundations#module-two-pointers$/);
});
