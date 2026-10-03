/**
 * Learn, the IDE and Submissions in the map's dialect (the UX pass, round 2). On the pages a learner uses — Learn home, a
 * track, a lesson, a checkpoint, the IDE, the submissions list and one submission — at a laptop (1440 px) and a phone (375 px):
 *   - one `h1`, no text under 12 px, no uppercase labels, no sideways scroll;
 *   - Learn home has no zero-value stat tiles, no colour-coded level and exactly one primary action ("Start Foundations",
 *     or "Continue: <lesson>" once a lesson is open);
 *   - a lesson's one primary action is "Mark complete" (the snippets' Run is neutral);
 *   - on a phone the primary actions are 44 px, the fields 16 px, and no ⌘↵ glyph is printed (it is on a laptop);
 *   - a submission reads like the result card ("Accepted — all 9 tests passed") and shows "Faster than N% of other
 *     learners" only once 30 learners' accepted solutions back it.
 *
 * PLAYWRIGHT_BASE_URL=http://localhost:4201 DATABASE_URL=<the app's database> npx playwright test e2e/calm-learn.spec.ts
 * (DATABASE_URL must be the database of the app under test: the learners and submissions are written into it and removed.)
 *
 * The type-floor and uppercase checks look at everything on the page, the shared kit's pieces included (the language marks,
 * Kbd, a code block's header and Copy, a field's hint, a callout's title, the visualization's hints): they need the kit
 * at its own 12 px floor (round 2's kit branch) and fail on a tree without it.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { capsules } from './capsules';
import bcrypt from 'bcryptjs';

function envValue(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  try {
    const m = readFileSync(join(__dirname, '..', '.env.local'), 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'));
    return m?.[1]?.trim().replace(/^["']|["']$/g, '') || undefined;
  } catch {
    return undefined;
  }
}

const AXE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js';
const prisma = new PrismaClient({ datasourceUrl: envValue('DATABASE_URL') });
const tag = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;

type Learner = { id: string; email: string; handle: string; password: string };
let fresh: Learner; // nothing done yet
let resumer: Learner; // a lesson open (and nothing else visited, so it stays the one to continue)
let active: Learner; // the one that reads the pages: lessons, the IDE, submissions
const crowdIds: string[] = [];
let questionId = '';
const ids = { ok: '', wa: '', ce: '', attempt: '' };

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 375, height: 812 };

async function createLearner(name: string): Promise<Learner> {
  const password = randomBytes(12).toString('base64url');
  const u = await prisma.user.create({
    data: { email: `cl-${name}-${tag}@codemare.test`, handle: `cl_${name}_${tag}`.slice(0, 24), name: `Calm ${name}`, passwordHash: await bcrypt.hash(password, 4) },
  });
  return { id: u.id, email: u.email, handle: u.handle, password };
}

/** A browser context for one viewport (a phone is touch-only, like a real one), signed in as `who` through Auth.js's endpoints. */
async function open(browser: Browser, who: Learner, size: { width: number; height: number }): Promise<{ context: BrowserContext; page: Page }> {
  const octet = () => 1 + Math.floor(Math.random() * 250);
  const phone = size.width < 500;
  const context = await browser.newContext({
    viewport: size,
    isMobile: phone,
    hasTouch: phone,
    deviceScaleFactor: phone ? 2 : 1,
    reducedMotion: 'reduce',
    extraHTTPHeaders: { 'x-forwarded-for': `10.${octet()}.${octet()}.${octet()}` },
  });
  const page = await context.newPage();
  const { csrfToken } = await (await page.request.get('/api/auth/csrf')).json();
  const res = await page.request.post('/api/auth/callback/credentials', {
    form: { email: who.email, password: who.password, csrfToken, callbackUrl: '/learn', json: 'true' },
  });
  expect(res.ok()).toBeTruthy();
  const session = await (await page.request.get('/api/auth/session')).json();
  expect(session?.user?.handle).toBe(who.handle);
  return { context, page };
}

/** Text a learner can see inside the page (not the top bar): its size, whether it is an uppercase label. Skips the sr-only and closed-<details> text. */
async function audit(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector('#main')!;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const small: string[] = [];
    const upper: string[] = [];
    const sizes = new Set<string>();
    const seen = new Set<Element>();
    while (walker.nextNode()) {
      const t = walker.currentNode as Text;
      const text = (t.nodeValue ?? '').replace(/\s+/g, ' ').trim();
      const el = t.parentElement;
      if (!text || !el || seen.has(el) || el.closest('svg, .monaco-editor, .sr-only, script, style')) continue;
      seen.add(el);
      const closed = el.closest('details:not([open])');
      if (closed && !closed.querySelector(':scope > summary')?.contains(el)) continue;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (cs.display === 'none' || cs.visibility === 'hidden' || r.width < 2 || r.height < 2) continue;
      const fs = parseFloat(cs.fontSize);
      sizes.add(String(Math.round(fs * 10) / 10));
      if (fs < 12) small.push(`"${text.slice(0, 28)}" ${fs}px`);
      if (cs.textTransform === 'uppercase') upper.push(`"${text.slice(0, 28)}"`);
    }
    const overflow = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth;
    return { small, upper, sizes: [...sizes].sort((a, b) => Number(a) - Number(b)), overflow };
  });
}

/** Wait for what loads after the first paint (the editor, the lesson's visualization). */
async function settle(page: Page, kind?: 'ide' | 'lesson') {
  if (kind === 'ide') await expect(page.locator('[data-testid="code-editor"][data-ready="true"]')).toBeVisible({ timeout: 60_000 });
  if (kind === 'lesson') await expect(page.getByRole('group', { name: 'Two sum with a hash map' })).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState('networkidle').catch(() => undefined);
}

const box = async (loc: ReturnType<Page['locator']>) => (await loc.boundingBox())!;

/** Serious / critical axe violations on the page as it is. */
async function axeViolations(page: Page): Promise<string[]> {
  await page.addScriptTag({ url: AXE_URL });
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: { id: string; impact?: string | null; nodes: { target: string[] }[] }[] }> } }).axe;
    const result = await axe.run(document, { exclude: [['nextjs-portal']], resultTypes: ['violations'] });
    return result.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  });
}

test.beforeAll(async () => {
  fresh = await createLearner('fresh');
  resumer = await createLearner('resume');
  active = await createLearner('active');

  // A lesson open (not finished), so Learn home offers to continue it.
  const lesson = await prisma.lesson.findFirstOrThrow({ where: { slug: 'arrays-and-cost' } });
  await prisma.lessonProgress.create({ data: { userId: resumer.id, lessonId: lesson.id, status: 'started' } });

  // Submissions to read back: a problem of their own (a draft, so it shows nowhere else and no other spec counts its solvers).
  const q = await prisma.question.create({
    data: {
      slug: `cl-${tag}`,
      title: `Calm ${tag}`,
      difficulty: 'Easy',
      statementMd: '',
      examples: [],
      constraints: [],
      functionName: 'solve',
      signature: { params: [{ name: 'n', type: 'int' }], returns: 'int' },
      starterCode: {},
      tests: [{ input: [1], expected: 1, hidden: false }],
      referenceSolutions: {},
      status: 'draft',
    },
  });
  questionId = q.id;
  const result = (idx: number, passed: boolean, hidden: boolean) => ({
    idx, passed, hidden, runtimeUs: 8, memoryKb: 1024,
    ...(hidden ? {} : { input: [idx + 1] as never, expected: (idx + 1) as never, actual: (passed ? idx + 1 : 0) as never, explainOnFail: passed ? null : 'the basic case' }),
  });
  const ok = await prisma.submission.create({
    data: { userId: active.id, kind: 'submit', questionId, language: 'python', status: 'OK', code: 'def solve(n):\n    return n\n', totalPassed: 9, totalTests: 9, runtimeUs: 412n, memoryKb: 9216, percentile: 87.34, createdAt: new Date(Date.now() - 5 * 60_000) },
  });
  await prisma.testResult.createMany({ data: Array.from({ length: 9 }, (_, i) => ({ submissionId: ok.id, ...result(i, true, i >= 3) })) });
  const wa = await prisma.submission.create({
    data: { userId: active.id, kind: 'submit', questionId, language: 'javascript', status: 'WA', code: 'function solve(n) {\n  return 0;\n}\n', totalPassed: 4, totalTests: 9, runtimeUs: 1830n, memoryKb: 40960, createdAt: new Date(Date.now() - 4 * 60_000) },
  });
  await prisma.testResult.createMany({ data: Array.from({ length: 9 }, (_, i) => ({ submissionId: wa.id, ...result(i, i !== 0, i >= 3) })) });
  const ce = await prisma.submission.create({
    data: { userId: active.id, kind: 'run', questionId, language: 'cpp', status: 'CE', code: 'int solve(int n) { return n }\n', error: "solution.cpp:1:30: error: expected ';' before '}' token", createdAt: new Date(Date.now() - 3 * 60_000) },
  });
  // A graded checkpoint attempt, for the review page.
  const mod = await prisma.learnModule.findFirstOrThrow({ where: { slug: 'arrays-hashing' }, include: { _count: { select: { checkpointQuestions: true } } } });
  const attempt = await prisma.checkpointAttempt.create({
    data: { userId: active.id, moduleId: mod.id, score: 1, total: mod._count.checkpointQuestions, passed: false, answers: {} },
  });
  Object.assign(ids, { ok: ok.id, wa: wa.id, ce: ce.id, attempt: attempt.id });
});

test.afterAll(async () => {
  await prisma.user.deleteMany({ where: { OR: [{ id: { in: [fresh?.id, resumer?.id, active?.id, ...crowdIds].filter(Boolean) } }, { handle: { startsWith: `cl_crowd_${tag}`.slice(0, 24) } }] } });
  if (questionId) await prisma.question.delete({ where: { id: questionId } }).catch(() => undefined);
  await prisma.$disconnect();
});

for (const [label, size] of [['laptop', DESKTOP], ['phone', PHONE]] as const) {
  test.describe(`on a ${label}`, () => {
    const pages: Array<{ name: string; path: () => string; kind?: 'ide' | 'lesson'; sizes?: number; who?: 'resumer' }> = [
      { name: 'Learn home', path: () => '/learn', sizes: 8 },
      { name: 'Learn home (a track started)', path: () => '/learn', sizes: 8, who: 'resumer' },
      { name: 'a track', path: () => '/learn/foundations', sizes: 8 },
      { name: 'a track (started)', path: () => '/learn/foundations', sizes: 8, who: 'resumer' },
      { name: 'a lesson', path: () => '/learn/foundations/hash-maps', kind: 'lesson' },
      { name: 'a checkpoint', path: () => '/learn/foundations/arrays-hashing/checkpoint', sizes: 8 },
      { name: 'the IDE', path: () => '/ide', kind: 'ide' },
      { name: 'the submissions list', path: () => '/submissions', sizes: 8 },
      { name: 'a submission (accepted)', path: () => `/submissions/${ids.ok}` },
      { name: 'a submission (wrong answer)', path: () => `/submissions/${ids.wa}` },
      { name: 'a submission (compile error)', path: () => `/submissions/${ids.ce}` },
    ];

    for (const p of pages) {
      test(`${p.name}: one h1, nothing under 12 px, no uppercase labels, no sideways scroll`, async ({ browser }) => {
        const { context, page } = await open(browser, p.who === 'resumer' ? resumer : active, size);
        await page.goto(p.path());
        await settle(page, p.kind);
        await expect(page.locator('h1')).toHaveCount(1);
        const a = await audit(page);
        // Soft, so one run lists everything that is wrong on the page.
        expect.soft(a.overflow, `${p.name}: sideways scroll`).toBeLessThanOrEqual(0);
        expect.soft(a.small, `${p.name}: text under 12 px`).toEqual([]);
        expect.soft(a.upper, `${p.name}: uppercase labels`).toEqual([]);
        expect.soft(await capsules(page), `${p.name}: tags (a filled or outlined pill) — words are quieter`).toEqual([]);
        if (p.sizes) expect.soft(a.sizes.length, `${p.name}: font sizes in use ${a.sizes.join(' ')}`).toBeLessThanOrEqual(p.sizes);
        await context.close();
      });
    }
  });
}

test.describe('Learn home', () => {
  test('has no stat tiles, no colour-coded level, and one primary action: start the first track', async ({ browser }) => {
    const { context, page } = await open(browser, fresh, DESKTOP);
    await page.goto('/learn');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Learn');

    // The three tiles (lessons done, checkpoints passed, tracks complete) are gone; progress is one quiet line.
    for (const gone of ['Lessons done', 'Checkpoints passed', 'Tracks complete']) await expect(page.getByText(gone, { exact: true })).toHaveCount(0);
    await expect(page.locator('#main dl')).toHaveCount(0);
    await expect(page.getByText(`0 of ${await prisma.lesson.count()} lessons complete`)).toBeVisible();
    await expect(page.getByText(/0 checkpoints? passed/)).toHaveCount(0);
    // A track that has not been started shows no empty bar and no "0%".
    await expect(page.getByRole('progressbar')).toHaveCount(0);
    await expect(page.getByText('0%')).toHaveCount(0);

    // One primary button, and it says where to start.
    await expect(page.locator('#main [class*="Button_primary"]')).toHaveCount(1);
    const start = page.getByTestId('learn-primary-action');
    await expect(start).toHaveText('Start Foundations');
    await expect(start).toHaveAttribute('href', '/learn/foundations/arrays-and-cost');
    await expect(page.getByTestId('learn-recommendation')).toContainText('Start here');

    // The level is a word, not a pill: no fill, no border.
    const level = page.getByText(/^Advanced · \d+ lessons · /);
    await expect(level).toBeVisible();
    expect(await level.evaluate((el) => { const cs = getComputedStyle(el); return [cs.backgroundColor, cs.borderTopWidth]; })).toEqual(['rgba(0, 0, 0, 0)', '0px']);
    for (const title of ['Foundations', 'Search & Order', 'Graphs & Optimization']) {
      await expect(page.getByRole('heading', { level: 3, name: title })).toBeVisible();
    }
    await context.close();
  });

  test('offers to continue the lesson that is open, as the one primary action', async ({ browser }) => {
    const { context, page } = await open(browser, resumer, DESKTOP);
    await page.goto('/learn');
    await expect(page.locator('#main [class*="Button_primary"]')).toHaveCount(1);
    await expect(page.getByTestId('learn-recommendation')).toContainText('Continue where you left off');
    const go = page.getByTestId('learn-primary-action');
    await expect(go).toHaveText('Continue: Arrays and what operations cost');
    await expect(go).toHaveAttribute('href', '/learn/foundations/arrays-and-cost');
    // Only the track that has been started shows how far along it is (once: the card does not repeat it).
    await expect(page.getByRole('progressbar')).toHaveCount(1);
    await expect(page.getByTestId('learn-recommendation').getByRole('progressbar')).toHaveCount(0);
    await context.close();
  });
});

test.describe('a track and a lesson', () => {
  test('a track has one primary action in its header; lessons carry the map’s progress glyphs', async ({ browser }) => {
    const { context, page } = await open(browser, resumer, DESKTOP);
    await page.goto('/learn/foundations');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Foundations');
    await expect(page.locator('#main [class*="Button_primary"]')).toHaveCount(1);
    await expect(page.getByTestId('learn-primary-action')).toHaveText('Continue');
    await expect(page.getByText(/^Beginner · \d+ modules · \d+ lessons · /)).toBeVisible();
    // The open lesson is a half circle; the others are open circles; each has a screen-reader label.
    const open1 = page.getByRole('link', { name: /Arrays and what operations cost/ });
    await expect(open1).toContainText('In progress');
    await expect(page.getByRole('link', { name: /Hash maps: remember what you have seen/ })).toContainText('Not started');
    await context.close();
  });

  test('a lesson has one primary action (Mark complete); its snippets’ Run is neutral', async ({ browser }) => {
    const { context, page } = await open(browser, active, DESKTOP);
    await page.goto('/learn/foundations/hash-maps');
    await settle(page, 'lesson');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hash maps: remember what you have seen');
    await expect(page.getByText('Module 1 · Arrays & Hashing · 10 min')).toBeVisible();
    await expect(page.locator('#main [class*="Button_primary"]')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Mark complete' })).toBeVisible();
    // Related problems are the map's rows: a glyph, the title, Easy · Medium · Hard as quiet text.
    const practice = page.getByRole('region', { name: 'Practice what you learned' });
    await expect(practice.getByRole('link', { name: /Two Sum/ })).toContainText('Easy');
    await context.close();
  });
});

test.describe('phone: touch targets, fields and shortcuts', () => {
  test('page-level buttons are 44 px, and a long label wraps instead of scrolling the page sideways at 320 px', async ({ browser }) => {
    const empty = await open(browser, fresh, PHONE);
    await empty.page.goto('/submissions');
    expect((await box(empty.page.getByRole('link', { name: 'Find a problem on the map' }))).height, 'a default-size button').toBeGreaterThanOrEqual(44);
    await empty.context.close();

    const narrow = await open(browser, resumer, { width: 320, height: 640 });
    await narrow.page.goto('/learn/foundations/complete');
    const cta = narrow.page.getByTestId('learn-primary-action');
    await expect(cta).toContainText('Continue: Arrays and what operations cost');
    const b = await box(cta);
    expect(b.x + b.width, 'the button stays inside a 320 px screen').toBeLessThanOrEqual(320);
    expect(b.height).toBeGreaterThanOrEqual(44);
    expect((await audit(narrow.page)).overflow, 'sideways scroll at 320 px').toBeLessThanOrEqual(0);
    await narrow.context.close();
  });

  test('the primary actions are 44 px and the fields are 16 px', async ({ browser }) => {
    const { context, page } = await open(browser, active, PHONE);

    await page.goto('/learn');
    expect((await box(page.getByTestId('learn-primary-action'))).height).toBeGreaterThanOrEqual(44);
    await page.goto('/learn/foundations');
    expect((await box(page.getByTestId('learn-primary-action'))).height).toBeGreaterThanOrEqual(44);

    await page.goto('/learn/foundations/hash-maps');
    await settle(page, 'lesson');
    expect((await box(page.getByRole('button', { name: 'Mark complete' }))).height).toBeGreaterThanOrEqual(44);
    for (const run of await page.getByRole('button', { name: /^Run/ }).all()) expect((await box(run)).height).toBeGreaterThanOrEqual(44);
    // The code editor of a snippet is a textarea: 16 px, or iOS zooms into it.
    for (const editor of await page.locator('#main textarea').all()) {
      expect(await editor.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
    }

    await page.goto('/learn/foundations/arrays-hashing/checkpoint');
    expect((await box(page.getByRole('button', { name: 'Submit answers' }))).height).toBeGreaterThanOrEqual(44);
    for (const radio of await page.locator('#main label').all()) expect((await box(radio)).height).toBeGreaterThanOrEqual(44);
    const answer = page.getByRole('textbox', { name: /Which class from Python/ });
    expect(await answer.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
    expect((await box(answer.locator('xpath=..'))).height).toBeGreaterThanOrEqual(44); // the field's box: tapping it focuses the input

    await page.goto('/ide');
    await settle(page, 'ide');
    expect((await box(page.getByTestId('ide-run'))).height).toBeGreaterThanOrEqual(44);
    expect((await box(page.getByRole('tablist', { name: /Code, test cases or output/ }).getByRole('tab', { name: 'Output' }))).height).toBeGreaterThanOrEqual(44);
    const fields = async () => {
      for (const field of await page.locator('#main textarea:visible, #main select:visible').all()) {
        const inMonaco = await field.evaluate((el) => !!el.closest('.monaco-editor'));
        if (!inMonaco) expect(await field.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
      }
    };
    await fields(); // the language select
    await page.getByRole('tab', { name: 'Test cases' }).click();
    await expect(page.getByTestId('ide-stdin-0')).toBeVisible();
    await fields(); // the case fields
    expect((await box(page.getByRole('button', { name: /^Case 1/ }))).height).toBeGreaterThanOrEqual(44);

    await page.goto('/submissions');
    for (const select of await page.locator('#main select').all()) {
      expect(await select.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
      expect((await box(select.locator('xpath=..'))).height).toBeGreaterThanOrEqual(44); // the field's box (the select fills it)
    }
    for (const row of await page.locator('ol[aria-label="Submissions"] > li a').all()) expect((await box(row)).height).toBeGreaterThanOrEqual(44);
    await context.close();
  });

  test('no keyboard shortcut is printed on a touch device; on a laptop it is', async ({ browser }) => {
    const touch = await open(browser, active, PHONE);
    await touch.page.goto('/ide');
    await settle(touch.page, 'ide');
    await expect(touch.page.getByTestId('ide-run')).toBeVisible();
    await expect(touch.page.locator('#main kbd')).toHaveCount(0);
    await touch.page.goto('/learn/foundations/hash-maps');
    await settle(touch.page, 'lesson');
    // (the visualization's own key hints are hidden on a phone by its frame; Run in a snippet prints none)
    await expect(touch.page.getByRole('button', { name: /^Run/ }).first().locator('kbd')).toHaveCount(0);
    await touch.context.close();

    const laptop = await open(browser, active, DESKTOP);
    await laptop.page.goto('/ide');
    await settle(laptop.page, 'ide');
    await expect(laptop.page.getByTestId('ide-run').locator('kbd')).toBeVisible();
    await laptop.page.goto('/learn/foundations/hash-maps');
    await settle(laptop.page, 'lesson');
    await expect(laptop.page.getByRole('button', { name: /^Run/ }).first().locator('kbd')).toBeVisible();
    await laptop.context.close();
  });

  test('the IDE shows one pane at a time, and a finished run takes the screen', async ({ browser }) => {
    const { context, page } = await open(browser, active, PHONE);
    await page.goto('/ide');
    await settle(page, 'ide');
    const tabs = page.getByRole('tablist', { name: /Code, test cases or output/ });
    await expect(tabs.getByRole('tab', { name: 'Code' })).toHaveAttribute('aria-selected', 'true');
    // Only the code is in view; the cases and the output wait behind their tabs.
    await expect(page.getByTestId('ide-run')).toBeInViewport();
    await expect(page.getByTestId('ide-cases')).toBeHidden();
    await expect(page.getByTestId('ide-output')).toBeHidden();

    await page.getByTestId('ide-run').click();
    await expect(tabs.getByRole('tab', { name: 'Output' })).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 });
    await expect(page.getByTestId('ide-case-0')).toBeInViewport();
    await expect(page.getByTestId('ide-output')).toContainText('2 of 2 expected outputs matched');
    await expect(page.getByTestId('ide-output')).toBeFocused();
    // Back to the code: the editor is still there.
    await tabs.getByRole('tab', { name: 'Code' }).click();
    await expect(page.getByTestId('ide-run')).toBeInViewport();
    await expect(page.getByTestId('ide-output')).toBeHidden();
    await context.close();
  });
});

test.describe('after a run', () => {
  test('the playground shows verdicts as words, and its scrolling output can be reached with the keyboard', async ({ browser }) => {
    const { context, page } = await open(browser, active, DESKTOP);
    await page.goto('/ide');
    await settle(page, 'ide');
    await page.getByTestId('ide-run').click();
    const output = page.getByTestId('ide-output');
    await expect(output).toContainText('expected output', { timeout: 40_000 });
    await expect(output).toContainText('All matched');
    await expect(output.getByTestId('ide-case-0')).toContainText('OK');
    expect(await capsules(page), 'the playground after a run').toEqual([]);
    await expect(output.locator('[tabindex="0"]')).toHaveCount(1);
    expect((await axeViolations(page)).filter((v) => v.startsWith('scrollable-region-focusable')), 'axe: scrollable region').toEqual([]);
    await context.close();
  });

  test('a lesson’s snippet says it ran, in words', async ({ browser }) => {
    const { context, page } = await open(browser, active, DESKTOP);
    await page.goto('/learn/foundations/hash-maps');
    await settle(page, 'lesson');
    await page.getByRole('button', { name: /^Run/ }).nth(1).click();
    await expect(page.getByLabel('Program output')).toContainText('[ 4, 5 ]', { timeout: 40_000 });
    await expect(page.getByText('Ran', { exact: true })).toBeVisible();
    expect(await capsules(page), 'a lesson after a snippet ran').toEqual([]);
    await context.close();
  });
});

test.describe('a submission', () => {
  test('reads like the result card: the verdict as the headline, one quiet row of numbers', async ({ browser }) => {
    const { context, page } = await open(browser, active, DESKTOP);

    await page.goto(`/submissions/${ids.ok}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Calm ${tag}`);
    await expect(page.getByTestId('submission-headline')).toHaveText('Accepted — all 9 tests passed');
    const metrics = page.getByTestId('submission-metrics');
    await expect(metrics).toContainText(/Runtime\s*412\s*µs/);
    await expect(metrics).toContainText(/Memory\s*9\s*MB/);
    await expect(metrics).toContainText('µs = microseconds');
    await expect(page.getByText('Beats')).toHaveCount(0);
    // One primary action (Open problem), and the breadcrumb is the way back: no second "All submissions" button.
    await expect(page.locator('#main [class*="Button_primary"]')).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'All submissions' })).toHaveCount(0);

    await page.goto(`/submissions/${ids.wa}`);
    await expect(page.getByTestId('submission-headline')).toHaveText('Wrong answer — 4 of 9 tests passed');
    await expect(page).toHaveTitle(/Wrong answer · Calm /);

    await page.goto(`/submissions/${ids.ce}`);
    await expect(page.getByTestId('submission-headline')).toHaveText('Compilation error — nothing ran');
    await expect(page.getByRole('heading', { name: 'Compiler output' })).toBeVisible();
    await context.close();
  });

  test('"Faster than N% of other learners" appears only once 30 learners’ accepted solutions back it', async ({ browser }) => {
    const { context, page } = await open(browser, active, DESKTOP);
    /** One more learner with an accepted python submit of the problem, slower than the fixture's 412 µs. */
    const addSolver = async (i: number) => {
      const u = await prisma.user.create({ data: { email: `cl-crowd-${tag}-${i}@codemare.test`, handle: `cl_crowd_${tag}_${i}`.slice(0, 24) } });
      crowdIds.push(u.id);
      await prisma.submission.create({
        data: { userId: u.id, kind: 'submit', questionId, language: 'python', code: 'pass', status: 'OK', totalPassed: 9, totalTests: 9, runtimeUs: BigInt(5_000_000 + i) },
      });
    };

    // The fixture's own solve is the only one: 87.34% is stored, and not shown.
    await page.goto(`/submissions/${ids.ok}`);
    await expect(page.getByTestId('submission-headline')).toBeVisible();
    await expect(page.getByTestId('percentile')).toHaveCount(0);

    // 29 learners with an accepted solution: still not.
    for (let i = 0; i < 28; i++) await addSolver(i);
    await page.reload();
    await expect(page.getByTestId('percentile')).toHaveCount(0);

    // The 30th: the stored number is shown, worded as the result card words it.
    await addSolver(28);
    await page.reload();
    await expect(page.getByTestId('percentile')).toContainText('Faster than 87.3% of other learners');
    await expect(page.getByTestId('submission-metrics')).toBeVisible();

    // Only an accepted submit has one: the wrong answer of the same learner still shows none.
    await page.goto(`/submissions/${ids.wa}`);
    await expect(page.getByTestId('submission-headline')).toBeVisible();
    await expect(page.getByTestId('percentile')).toHaveCount(0);
    await context.close();
  });
});

test.describe('accessibility', () => {
  for (const theme of ['dark', 'light'] as const) {
    for (const [label, size] of [['laptop', DESKTOP], ['phone', PHONE]] as const) {
      test(`no serious axe violations on a ${label}, ${theme} theme`, async ({ browser }) => {
        test.setTimeout(180_000);
        const { context, page } = await open(browser, active, size);
        const base = test.info().project.use.baseURL ?? 'http://localhost:4001';
        await context.addCookies([{ name: 'cm-theme', value: theme, url: base }]);
        const paths: Array<[string, 'ide' | 'lesson' | undefined]> = [
          ['/learn', undefined],
          ['/learn/foundations', undefined],
          ['/learn/foundations/hash-maps', 'lesson'],
          ['/learn/foundations/arrays-hashing/checkpoint', undefined],
          [`/learn/foundations/arrays-hashing/checkpoint?attempt=${ids.attempt}`, undefined],
          ['/learn/foundations/complete', undefined],
          ['/ide', 'ide'],
          ['/submissions', undefined],
          [`/submissions/${ids.ok}`, undefined],
          [`/submissions/${ids.wa}`, undefined],
          [`/submissions/${ids.ce}`, undefined],
        ];
        for (const [path, kind] of paths) {
          await page.goto(path);
          await settle(page, kind);
          expect(await axeViolations(page), `${path} (${theme}, ${label})`).toEqual([]);
        }
        await context.close();
      });
    }
  }
});
