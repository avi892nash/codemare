/**
 * The result of a run, and the problem page on a phone:
 *   - an accepted solve reads headline → one line → reward → "Next problem" / "Back to the map" → a quiet row of numbers,
 *     all in view without scrolling, with no toast over it;
 *   - a wrong answer (and TLE, CE, RE) leads with what went wrong and the first failing test;
 *   - a percentile appears only when 30 accepted solutions back it;
 *   - in a gate attempt the next step is back to the gate;
 *   - at 375 px the page shows one pane at a time (Problem · Code · Result): Run and Submit are 44 px on one row with no
 *     keyboard glyphs, the statement's tabs all fit, nothing scrolls sideways, a new result takes the screen and is focused,
 *     and axe finds nothing in any of the three views, in both themes.
 *
 * PLAYWRIGHT_BASE_URL=http://localhost:4201 DATABASE_URL=<the app's database> npx playwright test e2e/results.spec.ts
 * (DATABASE_URL must be the database of the app under test: the percentile and gate tests seed rows into it and remove them.)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

const AXE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js';
const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

function reference(slug: string, language = 'python'): string {
  const q = JSON.parse(readFileSync(join(__dirname, '..', 'prisma', 'seed', 'data', 'questions', `${slug}.json`), 'utf8'));
  return q.reference_solutions[language];
}

const WRONG = 'def containsDuplicate(nums):\n    return False\n';
const TLE = 'def containsDuplicate(nums):\n    while True:\n        pass\n';
const CRASH = 'import os\n\ndef containsDuplicate(nums):\n    os._exit(3)\n';
const CPP_BROKEN = '#include <vector>\nusing namespace std;\n\nbool containsDuplicate(vector<int>& nums) {\n    return false\n}\n';

/**
 * Sign up a throwaway learner through the UI; returns their email. Sign-ups are limited per client address (5 an hour), and
 * this spec makes a dozen: each gets an address of its own.
 */
async function signUp(page: Page): Promise<string> {
  const id = `res_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const octet = () => 1 + Math.floor(Math.random() * 250);
  await page.context().setExtraHTTPHeaders({ 'x-forwarded-for': `10.${octet()}.${octet()}.${octet()}` });
  await page.goto('/signup');
  await page.getByLabel('Username').fill(id);
  await page.getByLabel('Email').fill(`${id}@test.dev`);
  await page.getByLabel('Password', { exact: true }).fill(`pw-${id}-Secure1`);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL((url) => url.pathname !== '/signup', { timeout: 30_000 });
  return `${id}@test.dev`;
}

/** Monaco is mounted (it is, even while its pane is hidden on a phone's Problem view). */
async function editorMounted(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="code-editor"][data-ready="true"]')).toBeAttached({ timeout: 60_000 });
  await page.waitForFunction(() => (window as unknown as { monaco?: { editor: { getEditors(): unknown[] } } }).monaco?.editor.getEditors().length);
}

async function openProblem(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await editorMounted(page);
}

/** Keyboard input into Monaco is unreliable across platforms: set the model through its API. */
async function setCode(page: Page, code: string): Promise<void> {
  await page.evaluate((c) => {
    const monaco = (window as unknown as { monaco: { editor: { getEditors(): { setValue(v: string): void }[] } } }).monaco;
    monaco.editor.getEditors()[0].setValue(c);
  }, code);
}

const verdict = (page: Page) => page.getByTestId('verdict-title');
/** One segment of the phone's Problem · Code · Result switch (the console has a "Result" tab of its own). */
const viewTab = (page: Page, name: 'Problem' | 'Code' | 'Result') => page.getByRole('tablist', { name: 'Problem, code or result' }).getByRole('tab', { name, exact: true });
const toasts = (page: Page) => page.locator('section[aria-label="Notifications"] [role="log"] > *');

async function submitCode(page: Page, code: string, expected: string, timeout = 30_000): Promise<void> {
  await setCode(page, code);
  await page.getByTestId('submit-button').click();
  await expect(verdict(page)).toHaveText(expected, { timeout });
}

/** Top edge of a test id's element (the page is a viewport-height app: positions are on screen). */
async function top(page: Page, testId: string): Promise<number> {
  const box = await page.getByTestId(testId).boundingBox();
  expect(box, `${testId} has a box`).not.toBeNull();
  return box!.y;
}

function database(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('results.spec seeds rows: set DATABASE_URL to the database of the app under test.');
  return new PrismaClient({ datasourceUrl: url });
}

test.describe('a result on a desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('an accepted solve: headline, one line, the reward, then where to go — all in view, nothing over it', async ({ page }) => {
    await signUp(page);
    await openProblem(page, '/problems/contains-duplicate');
    await submitCode(page, reference('contains-duplicate'), 'Accepted');

    await expect(page.getByTestId('verdict-summary')).toHaveText('All 8 tests passed.');
    const rewards = page.getByTestId('rewards');
    await expect(rewards).toContainText('+1 token');
    await expect(rewards).toContainText('Arrays & Hashing');
    await expect(rewards).toContainText('Badge earned');
    await expect(rewards).toContainText('First Accept');

    // The order a learner reads it in.
    const order = [await top(page, 'verdict-title'), await top(page, 'verdict-summary'), await top(page, 'rewards'), await top(page, 'result-actions'), await top(page, 'verdict-metrics')];
    expect(order, 'headline, line, reward, buttons, numbers').toEqual([...order].sort((a, b) => a - b));
    expect(new Set(order).size).toBe(order.length);

    // The first screen of the card is everything that matters: no scrolling to reach it.
    for (const id of ['verdict-title', 'verdict-summary', 'rewards', 'next-problem', 'back-to-map']) {
      await expect(page.getByTestId(id), id).toBeInViewport({ ratio: 1 });
    }

    // Where the buttons go: the next unsolved problem of the topic, and the map.
    await expect(page.getByTestId('next-problem')).toHaveText('Next problem');
    await expect(page.getByTestId('next-problem')).toHaveAttribute('href', '/problems/two-sum');
    await expect(page.getByTestId('back-to-map')).toHaveAttribute('href', '/map');

    // The numbers are still there, smaller, with µs explained.
    const metrics = page.getByTestId('verdict-metrics');
    await expect(metrics).toContainText(/Runtime\s+\d+(\.\d+)?\s*(µs|ms|s)/);
    await expect(metrics).toContainText('Memory');
    // µs is spelled out once, and only when the runtime is in µs (a slower machine prints ms).
    if (/Runtime\s+\d+(\.\d+)?\s*µs/.test(await metrics.innerText())) await expect(metrics).toContainText('µs = microseconds');
    else await expect(metrics).not.toContainText('µs = microseconds');
    const sizes = await page.evaluate(() => {
      const px = (id: string) => parseFloat(getComputedStyle(document.querySelector(`[data-testid="${id}"]`)!).fontSize);
      return { title: px('verdict-title'), metrics: px('verdict-metrics') };
    });
    expect(sizes.metrics).toBeLessThan(sizes.title);

    await expect(metrics).not.toContainText('Beats');

    // Nothing floats over the card: no toast, and the card is what is on top at its own corners.
    await expect(toasts(page)).toHaveCount(0);
    const covered = await page.evaluate(() => {
      const r = document.querySelector('[data-testid="results-hero"]')!.getBoundingClientRect();
      const hero = document.querySelector('[data-testid="results-hero"]')!;
      return [[r.left + 20, r.top + 20], [r.right - 20, r.top + 20], [r.left + 20, Math.min(r.bottom, innerHeight) - 20], [r.right - 20, Math.min(r.bottom, innerHeight) - 20]].filter(([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return !el || !hero.contains(el);
      }).length;
    });
    expect(covered).toBe(0);

    // "Next problem" goes there: a fresh page with that problem's starter code and no result yet.
    await page.getByTestId('next-problem').click();
    await expect(page).toHaveURL(/\/problems\/two-sum$/);
    await expect(page.getByTestId('problem-title')).toHaveText('Two Sum');
    await editorMounted(page);
    await page.waitForFunction(() => (window as unknown as { monaco: { editor: { getEditors(): { getValue(): string }[] } } }).monaco.editor.getEditors()[0].getValue().includes('def twoSum'));
    await expect(verdict(page)).toHaveCount(0);
  });

  test('"Back to the map" goes to the map', async ({ page }) => {
    // (That it is the only button when nothing is left to suggest is covered by the unit tests of the choice.)
    await signUp(page);
    await openProblem(page, '/problems/contains-duplicate');
    await submitCode(page, reference('contains-duplicate'), 'Accepted');
    await page.getByTestId('back-to-map').click();
    await expect(page).toHaveURL(/\/map$/);
  });
});

test.describe('what failed leads', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  let cookies: Awaited<ReturnType<BrowserContext['cookies']>> = [];

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    await signUp(await context.newPage());
    cookies = await context.cookies();
    await context.close();
  });
  test.beforeEach(async ({ context }) => {
    await context.addCookies(cookies);
  });

  test('a wrong answer: the headline, "n of 8 tests passed", the first failing test in words — then the numbers', async ({ page }) => {
    await openProblem(page, '/problems/contains-duplicate');
    await submitCode(page, WRONG, 'Wrong answer');
    await expect(page.getByTestId('verdict-summary')).toHaveText(/^\d of 8 tests passed\.$/);

    const failing = page.getByTestId('first-failure');
    await expect(failing).toContainText('Test 1 failed');
    await expect(failing).toContainText('Input');
    await expect(failing).toContainText('nums = [1,2,3,1]');
    await expect(failing).toContainText('Expected');
    await expect(failing.getByText('true', { exact: true })).toBeVisible();
    await expect(failing).toContainText('Your output');
    await expect(failing.getByText('false', { exact: true })).toBeVisible();
    await expect(failing).toContainText('What this test checks');
    await expect(failing.getByRole('heading')).toBeInViewport({ ratio: 1 });

    // Metrics come after it and are secondary; no reward, no way forward from a wrong answer.
    expect(await top(page, 'first-failure')).toBeLessThan(await top(page, 'verdict-metrics'));
    await expect(page.getByTestId('rewards')).toHaveCount(0);
    await expect(page.getByTestId('next-problem')).toHaveCount(0);
    // The per-test list stays below, every test one row.
    await expect(page.getByTestId('test-breakdown').locator('li')).toHaveCount(8);
    await expect(toasts(page)).toHaveCount(0);
  });

  test('Time limit exceeded, Runtime error and Compilation error: what happened, what to try, the code as a small label', async ({ page }) => {
    await openProblem(page, '/problems/contains-duplicate');

    await submitCode(page, TLE, 'Time limit exceeded', 60_000);
    await expect(page.getByTestId('verdict-summary')).toContainText('before the run hit its');
    await expect(page.getByTestId('verdict-advice')).toContainText('asymptotically faster');
    await expect(page.getByTestId('verdict-metrics')).toContainText('Limit');
    await expect(page.getByTestId('results-hero').getByText('TLE', { exact: true })).toBeVisible();

    await submitCode(page, CRASH, 'Runtime error', 60_000);
    await expect(page.getByTestId('verdict-summary')).toContainText('Crashed on test 1');
    await expect(page.getByTestId('verdict-advice')).toContainText('last line of the error');

    await page.selectOption('[data-testid="language-select"]', 'cpp');
    await submitCode(page, CPP_BROKEN, 'Compilation error', 60_000);
    await expect(page.getByTestId('verdict-summary')).toContainText('didn’t compile');
    await expect(page.getByTestId('verdict-advice')).toContainText('line reference');
    await expect(page.getByRole('button', { name: /solution\.cpp:5:\d+/ })).toBeVisible();
    await expect(page.getByTestId('results-hero').getByText('CE', { exact: true })).toBeVisible();
    await expect(page.getByTestId('first-failure')).toHaveCount(0);
  });
});

test.describe('the percentile', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  const prefix = `rs_${run}`;
  let prisma: PrismaClient;

  test.beforeAll(() => {
    prisma = database();
  });
  test.afterAll(async () => {
    await prisma.user.deleteMany({ where: { handle: { startsWith: prefix } } });
    await prisma.$disconnect();
  });

  /** `others` learners with an accepted python submit of valid-parentheses, slower than anything a real run takes. */
  async function crowd(others: number): Promise<void> {
    const q = await prisma.question.findUniqueOrThrow({ where: { slug: 'valid-parentheses' }, select: { id: true } });
    for (let i = 0; i < others; i++) {
      const u = await prisma.user.create({ data: { email: `${prefix}_${i}@codemare.test`, handle: `${prefix}_${i}`.slice(0, 24) } });
      await prisma.submission.create({
        data: { userId: u.id, kind: 'submit', questionId: q.id, language: 'python', code: 'pass', status: 'OK', totalPassed: 8, totalTests: 8, runtimeUs: BigInt(5_000_000 + i) },
      });
    }
  }

  test('is left out while fewer than 30 accepted solutions exist to compare against', async ({ page }) => {
    const solvers = await prisma.submission.groupBy({
      by: ['userId'],
      where: { question: { slug: 'valid-palindrome' }, kind: 'submit', status: 'OK', language: 'python' },
    });
    test.skip(solvers.length >= 29, 'this database already holds enough solutions of valid-palindrome');
    await signUp(page);
    await openProblem(page, '/problems/valid-palindrome');
    await submitCode(page, reference('valid-palindrome'), 'Accepted');
    // A learner who beat two people has learned nothing from "faster than 67%": the line is not there, nor is the header's.
    await expect(page.getByTestId('rewards')).toContainText('+1 token');
    await expect(page.getByTestId('verdict-metrics')).toBeVisible();
    await expect(page.getByTestId('percentile')).toHaveCount(0);
    await expect(page.getByTitle('Your best runtime on this problem, compared with other learners')).toHaveCount(0);
  });

  test('shows "Faster than N% of other learners" once 30 accepted solutions exist to compare against', async ({ page }) => {
    await crowd(29); // 29 + the learner's own = 30
    await signUp(page);
    await openProblem(page, '/problems/valid-parentheses');
    await submitCode(page, reference('valid-parentheses'), 'Accepted');
    const percentile = page.getByTestId('percentile');
    await expect(percentile).toContainText(/Faster than \d+(\.\d)?% of other learners/);
    await expect(percentile).toBeVisible();
    // …and it is the same number the header says, for the same reason.
    await expect(page.getByTitle('Your best runtime on this problem, compared with other learners')).toContainText('Best: faster than');
  });
});

test.describe('a gate attempt', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  let prisma: PrismaClient;
  let email = '';

  test.beforeAll(() => {
    prisma = database();
  });
  test.afterAll(async () => {
    if (email) await prisma.user.deleteMany({ where: { email } });
    await prisma.$disconnect();
  });

  test('the next step is back to the gate — and there is no toast saying so over the card', async ({ page }) => {
    email = await signUp(page);
    const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
    const gate = await prisma.gate.findFirstOrThrow({ where: { questions: { some: { question: { slug: 'contains-duplicate' } } } }, select: { id: true } });
    const attempt = await prisma.gateAttempt.create({ data: { userId: user.id, gateId: gate.id, deadlineAt: new Date(Date.now() + 60 * 60_000) }, select: { id: true } });

    await openProblem(page, `/problems/contains-duplicate?attempt=${attempt.id}`);
    await expect(page.getByTestId('gate-banner')).toBeVisible();
    await submitCode(page, reference('contains-duplicate'), 'Accepted');
    await expect(page.getByTestId('verdict-summary')).toHaveText('All 8 tests passed. This counts for the gate.');
    await expect(page.getByTestId('back-to-gate')).toHaveAttribute('href', `/map/gates/${attempt.id}`);
    await expect(page.getByTestId('back-to-gate')).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('next-problem')).toHaveCount(0);
    await expect(page.getByTestId('rewards').getByText(/token/)).toHaveCount(0); // gate submissions earn no tokens
    await expect(toasts(page)).toHaveCount(0);
    await expect(page.getByTestId('gate-banner')).toContainText('1 of 4 solved');
  });
});

test.describe('on a phone (375 px)', () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  /** Page-level sideways overflow in px (0 = none), and the same for the workspace itself. */
  const overflow = (page: Page) =>
    page.evaluate(() => ({
      page: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth,
      main: (() => {
        const m = document.querySelector('main')!;
        return m.scrollWidth - m.clientWidth;
      })(),
    }));

  test('opens on the problem; the first example is open, the rest is one tap away; the statement’s tabs all fit', async ({ page }) => {
    await signUp(page);
    await openProblem(page, '/problems/product-of-array-except-self');
    await expect(viewTab(page, 'Problem')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('region', { name: 'Example 1' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Example 2' })).toBeHidden();
    await expect(page.getByRole('region', { name: 'Constraints' })).toBeHidden();

    const more = page.getByRole('button', { name: /^More/ });
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    expect((await more.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await more.tap();
    await expect(page.getByRole('button', { name: /^Less/ })).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('region', { name: 'Example 2' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Constraints' })).toBeVisible();

    // Description · Editorial · Submissions · Hints: every one inside the screen (it was clipped at x = 404).
    for (const name of ['Description', 'Editorial', 'Submissions', 'Hints']) {
      const box = await page.getByRole('tab', { name: new RegExp(`^${name}`) }).boundingBox();
      expect(box, name).not.toBeNull();
      expect(box!.x, `${name} starts on screen`).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, `${name} ends on screen`).toBeLessThanOrEqual(375);
      expect(box!.height, `${name} is a touch target`).toBeGreaterThanOrEqual(44);
    }
    await page.getByRole('tab', { name: /^Hints/ }).tap();
    const reveal = page.getByRole('button', { name: /^Reveal the nudge hint/ });
    await expect(reveal).toBeVisible();
    expect((await reveal.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await overflow(page)).toEqual({ page: 0, main: 0 });
  });

  test('Code: the editor is one tap away; Run and Submit are 44 px, side by side, with no keyboard glyphs', async ({ page }) => {
    await signUp(page);
    await openProblem(page, '/problems/contains-duplicate');
    await viewTab(page, 'Code').tap();
    await expect(page.getByTestId('code-editor')).toBeVisible();

    const editor = (await page.getByTestId('code-editor').boundingBox())!;
    expect(editor.y, 'the editor starts at the top of the screen, not 1,000 px down').toBeLessThan(260);
    const run = (await page.getByTestId('run-button').boundingBox())!;
    const submit = (await page.getByTestId('submit-button').boundingBox())!;
    expect(run.height).toBeGreaterThanOrEqual(44);
    expect(submit.height).toBeGreaterThanOrEqual(44);
    expect(Math.abs(run.y - submit.y), 'one row').toBeLessThan(2);
    expect(run.x + run.width).toBeLessThanOrEqual(submit.x + 1);
    await expect(page.locator('kbd:visible')).toHaveCount(0); // ⌘↵ is for keyboards
    expect(await overflow(page)).toEqual({ page: 0, main: 0 });

    // Tapping into the editor works and typing reaches the model.
    await page.touchscreen.tap(editor.x + editor.width / 2, editor.y + 80);
    await page.keyboard.type('# note');
    expect(await page.evaluate(() => (window as unknown as { monaco: { editor: { getEditors(): { getValue(): string }[] } } }).monaco.editor.getEditors()[0].getValue().includes('# note'))).toBe(true);
  });

  test('after Submit the result takes the screen: headline focused, the reward and "Next problem" in view, 44 px', async ({ page }) => {
    await signUp(page);
    await openProblem(page, '/problems/contains-duplicate');
    await viewTab(page, 'Code').tap();
    await setCode(page, reference('contains-duplicate'));
    await page.getByTestId('submit-button').tap();
    await expect(verdict(page)).toHaveText('Accepted', { timeout: 30_000 });

    await expect(viewTab(page, 'Result')).toHaveAttribute('aria-selected', 'true');
    await expect(verdict(page)).toBeFocused();
    for (const id of ['verdict-title', 'verdict-summary', 'rewards', 'next-problem', 'back-to-map']) {
      await expect(page.getByTestId(id), id).toBeInViewport({ ratio: 1 });
    }
    expect((await page.getByTestId('next-problem').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await page.getByTestId('back-to-map').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(toasts(page)).toHaveCount(0);
    expect(await overflow(page)).toEqual({ page: 0, main: 0 });
    // Type sizes: nothing in the result is under 12 px.
    const smallest = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="console"]')!;
      let min = 99;
      for (const el of root.querySelectorAll('*')) {
        if (el.closest('svg')) continue;
        const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.nodeValue!.trim()).length;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (!own || cs.display === 'none' || cs.visibility === 'hidden' || r.width < 2) continue;
        min = Math.min(min, parseFloat(cs.fontSize));
      }
      return min;
    });
    expect(smallest).toBeGreaterThanOrEqual(12);

    // The code is still there, in the same editor, one tap back.
    await viewTab(page, 'Code').tap();
    await expect(page.getByTestId('code-editor')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { monaco: { editor: { getEditors(): { getValue(): string }[] } } }).monaco.editor.getEditors()[0].getValue().includes('seen'))).toBe(true);
  });

  test('a wrong answer on a phone shows the failing test in view, and a compile error line jumps back to the editor', async ({ page }) => {
    await signUp(page);
    await openProblem(page, '/problems/contains-duplicate');
    await viewTab(page, 'Code').tap();
    await setCode(page, WRONG);
    await page.getByTestId('submit-button').tap();
    await expect(verdict(page)).toHaveText('Wrong answer', { timeout: 30_000 });
    await expect(page.getByTestId('first-failure').getByRole('heading')).toBeInViewport({ ratio: 1 });

    await viewTab(page, 'Code').tap();
    await page.selectOption('[data-testid="language-select"]', 'cpp');
    await setCode(page, CPP_BROKEN);
    await page.getByTestId('submit-button').tap();
    await expect(verdict(page)).toHaveText('Compilation error', { timeout: 60_000 });
    await page.getByRole('button', { name: /solution\.cpp:5:\d+/ }).tap();
    await expect(viewTab(page, 'Code')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('code-editor')).toBeVisible();
  });

  for (const theme of ['dark', 'light'] as const) {
    test(`axe finds nothing serious in the Problem, Code and Result views (${theme})`, async ({ page, context }) => {
      test.setTimeout(120_000);
      await context.addCookies([{ name: 'cm-theme', value: theme, url: test.info().project.use.baseURL ?? 'http://localhost:4001' }]);
      await signUp(page);
      await openProblem(page, '/problems/contains-duplicate');
      const audit = async (label: string) => {
        await page.addScriptTag({ url: AXE_URL });
        const found = await page.evaluate(async () => {
          const axe = (window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: { id: string; impact?: string | null; nodes: { target: string[] }[] }[] }> } }).axe;
          const result = await axe.run(document, { exclude: [['nextjs-portal']], resultTypes: ['violations'] });
          return result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
        });
        expect(found, `${label} (${theme})`).toEqual([]);
        expect(await overflow(page), `${label} overflow`).toEqual({ page: 0, main: 0 });
      };
      await audit('Problem');
      await page.getByRole('button', { name: /^More/ }).tap();
      await page.getByRole('tab', { name: /^Hints/ }).tap();
      await audit('Problem, More open, Hints tab');
      await viewTab(page, 'Code').tap();
      await audit('Code');
      await setCode(page, WRONG);
      await page.getByTestId('submit-button').tap();
      await expect(verdict(page)).toHaveText('Wrong answer', { timeout: 30_000 });
      await audit('Result (wrong answer)');
      await viewTab(page, 'Code').tap();
      await setCode(page, reference('contains-duplicate'));
      await page.getByTestId('submit-button').tap();
      await expect(verdict(page)).toHaveText('Accepted', { timeout: 30_000 });
      await audit('Result (accepted)');
    });
  }
});
