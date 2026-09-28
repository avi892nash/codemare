import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

/**
 * Submissions (artboard 05): the history list (filters, pagination, empty
 * state) and the detail page (verdict hero, code, per-test breakdown, hidden
 * tests reduced to pass/fail), including who may see a submission. Fixture
 * submissions are written straight to the dev server's database for users
 * this spec creates and removes.
 */

function envValue(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  try {
    const m = readFileSync(join(__dirname, '..', '.env.local'), 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'));
    return m?.[1]?.trim().replace(/^["']|["']$/g, '') || undefined;
  } catch {
    return undefined;
  }
}

const prisma = new PrismaClient({ datasourceUrl: envValue('DATABASE_URL') });

type TestUser = { id: string; email: string; password: string; handle: string };
const users: TestUser[] = [];
let owner: TestUser;
let stranger: TestUser;
let staff: TestUser;
let empty: TestUser;
const ids = { ok: '', wa: '', ce: '' };
const EXTRA_RUNS = 21;

async function createUser(tag: string, role: 'learner' | 'staff' = 'learner'): Promise<TestUser> {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const password = `pw-${id}-secret`;
  const u = await prisma.user.create({
    data: {
      email: `e2e-sub-${tag}-${id}@test.dev`,
      handle: `e2e_${tag}_${id}`.slice(0, 24),
      name: `Submissions ${tag}`,
      role,
      passwordHash: await bcrypt.hash(password, 4),
    },
  });
  const t = { id: u.id, email: u.email, password, handle: u.handle };
  users.push(t);
  return t;
}

async function signIn(page: Page, who: TestUser, next: string) {
  await page.goto(`/signin?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password', { exact: true }).fill(who.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((url) => `${url.pathname}${url.search}` === next);
}

const rows = (page: Page) => page.locator('ol[aria-label="Submissions"] > li');
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

test.beforeAll(async () => {
  [owner, stranger, staff, empty] = await Promise.all([
    createUser('own'),
    createUser('other'),
    createUser('staff', 'staff'),
    createUser('none'),
  ]);
  const twoSum = await prisma.question.findUniqueOrThrow({ where: { slug: 'two-sum' } });
  const tests = twoSum.tests as Array<{ input: unknown[]; expected: unknown; hidden: boolean; explain_on_fail?: string }>;
  const visible = tests.filter((t) => !t.hidden);
  const hidden = tests.filter((t) => t.hidden);

  // Accepted python submit: every test passes; runtime 412 µs total, beats 87.3%.
  const ok = await prisma.submission.create({
    data: {
      userId: owner.id, kind: 'submit', questionId: twoSum.id, language: 'python', status: 'OK',
      code: 'def twoSum(nums, target):\n    seen = {}\n    for i, x in enumerate(nums):\n        if target - x in seen:\n            return [seen[target - x], i]\n        seen[x] = i\n',
      totalPassed: tests.length, totalTests: tests.length, runtimeUs: 412n, memoryKb: 9216, percentile: 87.34, createdAt: minutesAgo(5),
    },
  });
  // Wrong answer: the second visible test and the first hidden test fail.
  const wa = await prisma.submission.create({
    data: {
      userId: owner.id, kind: 'submit', questionId: twoSum.id, language: 'javascript', status: 'WA',
      code: 'function twoSum(nums, target) {\n  return [0, 0];\n}\n',
      totalPassed: tests.length - 2, totalTests: tests.length, runtimeUs: 1830n, memoryKb: 40960, createdAt: minutesAgo(4),
    },
  });
  await prisma.testResult.createMany({
    data: [
      ...visible.map((t, i) => ({
        submissionId: wa.id, idx: i, passed: i !== 1, hidden: false, runtimeUs: 150, memoryKb: 40000,
        input: t.input as never, expected: t.expected as never, actual: (i === 1 ? [0, 0] : t.expected) as never,
        explainOnFail: i === 1 ? t.explain_on_fail ?? 'visible explanation' : null,
      })),
      ...hidden.map((_test, j) => ({
        submissionId: wa.id, idx: visible.length + j, passed: j !== 0, hidden: true, runtimeUs: 150, memoryKb: 40000,
        explainOnFail: j === 0 ? 'HIDDEN-EXPLANATION-MUST-NOT-LEAK' : null,
        error: j === 0 ? 'HIDDEN-ERROR-MUST-NOT-LEAK' : null,
      })),
    ],
  });
  const ce = await prisma.submission.create({
    data: {
      userId: owner.id, kind: 'submit', questionId: twoSum.id, language: 'cpp', status: 'CE',
      code: 'vector<int> twoSum(vector<int>& nums, int target) { return {} }\n',
      error: "solution.cpp:1:62: error: expected ';' before '}' token", createdAt: minutesAgo(3),
    },
  });
  await prisma.submission.createMany({
    data: Array.from({ length: EXTRA_RUNS }, (_, i) => ({
      userId: owner.id, kind: 'run' as const, questionId: twoSum.id, language: 'go' as const, status: 'RE' as const,
      code: `// attempt ${i}`, totalPassed: 0, totalTests: 3, runtimeUs: BigInt(2000 + i), memoryKb: 7000,
      createdAt: minutesAgo(60 + i),
    })),
  });
  await prisma.submission.create({
    data: { userId: stranger.id, kind: 'submit', questionId: twoSum.id, language: 'python', code: 'pass', status: 'WA' },
  });
  Object.assign(ids, { ok: ok.id, wa: wa.id, ce: ce.id });
});

test.beforeEach(async ({ context }) => {
  const octet = () => Math.floor(Math.random() * 250) + 1;
  await context.setExtraHTTPHeaders({ 'x-forwarded-for': `10.${octet()}.${octet()}.${octet()}` });
});

test.afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
  await prisma.$disconnect();
});

test('lists your submissions newest first, filters by status and language, and paginates', async ({ page }) => {
  const total = 3 + EXTRA_RUNS;
  await signIn(page, owner, '/submissions');
  await expect(page.getByRole('heading', { name: 'Submissions', level: 1 })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'submissions' })).toContainText(`${total} submissions`);
  await expect(rows(page)).toHaveCount(20);

  const first = rows(page).first();
  await expect(first).toContainText('CE');
  await expect(first).toContainText('Two Sum');
  await expect(first).toContainText('C++');
  await expect(rows(page).nth(1)).toContainText('1.83 ms'); // WA javascript: 1830 µs
  await expect(rows(page).nth(2)).toContainText('412 µs'); // the accepted run, still in µs
  await expect(rows(page).nth(2)).toContainText('9 MB'); // 9216 KB, formatted like the editor's results

  await page.getByRole('navigation', { name: 'Pagination' }).getByRole('link', { name: 'Next' }).click();
  await expect(page).toHaveURL(/\/submissions\?page=2$/);
  await expect(rows(page)).toHaveCount(total - 20);

  await page.getByRole('combobox', { name: 'Status' }).selectOption('WA');
  await expect(page).toHaveURL(/\/submissions\?status=WA$/);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('JavaScript');

  await page.getByRole('combobox', { name: 'Status' }).selectOption('');
  await page.getByRole('combobox', { name: 'Language' }).selectOption('go');
  await expect(page).toHaveURL(/\/submissions\?language=go$/);
  await expect(rows(page)).toHaveCount(EXTRA_RUNS > 20 ? 20 : EXTRA_RUNS);
  await page.getByRole('combobox', { name: 'Kind' }).selectOption('submit');
  await expect(page).toHaveURL(/\/submissions\?language=go&kind=submit$/);
  await expect(page.getByRole('heading', { name: 'No submissions match these filters' })).toBeVisible();
  await page.getByRole('link', { name: 'Clear filters' }).click();
  await expect(page).toHaveURL(/\/submissions$/);
});

test('detail: verdict hero, code and tests, with hidden tests reduced to pass/fail', async ({ page }) => {
  await signIn(page, owner, '/submissions');
  await rows(page).nth(1).getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/submissions/${ids.wa}$`));
  await expect(page).toHaveTitle(/Wrong Answer · Two Sum/);

  await expect(page.getByRole('heading', { name: 'Two Sum', level: 1 })).toBeVisible();
  const hero = page.getByRole('region', { name: 'Result' });
  await expect(hero).toContainText('1.83');
  await expect(hero).toContainText('ms');
  await expect(hero).toContainText(/Peak memory\s*40\s*MB/); // 40960 KB
  await expect(page.getByText('Wrong Answer').first()).toBeVisible();

  await expect(page.getByRole('heading', { name: /^Code/ })).toBeVisible();
  await expect(page.locator('pre code').first()).toContainText('function twoSum(nums, target)');

  const failedVisible = page.locator('details[open]');
  await expect(failedVisible).toHaveCount(1);
  await expect(failedVisible).toContainText('nums =');
  await expect(failedVisible).toContainText('[0,0]');
  await expect(failedVisible.getByRole('note', { name: 'What this test checks' })).toBeVisible();

  // Hidden tests: pass/fail only; nothing else reaches the page.
  await expect(page.getByText('Hidden').first()).toBeVisible();
  const html = await page.content();
  expect(html).not.toContain('HIDDEN-EXPLANATION-MUST-NOT-LEAK');
  expect(html).not.toContain('HIDDEN-ERROR-MUST-NOT-LEAK');

  // Accepted: the percentile shows.
  await page.goto(`/submissions/${ids.ok}`);
  await expect(page.getByRole('progressbar', { name: 'Beats' })).toHaveAttribute('aria-valuetext', '87.3%');
  await expect(page.getByRole('region', { name: 'Result' })).toContainText('412');

  // Compile error: the compiler output replaces timings.
  await page.goto(`/submissions/${ids.ce}`);
  await expect(page.getByRole('heading', { name: 'Compiler output' })).toBeVisible();
  await expect(page.getByText("expected ';' before '}' token")).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No test results' })).toBeVisible();
});

test("someone else's submission is a 404, but staff can open it", async ({ page, browser }) => {
  await signIn(page, stranger, '/submissions');
  const res = await page.goto(`/submissions/${ids.wa}`);
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Submission not found' })).toBeVisible();
  expect(await page.content()).not.toContain('function twoSum(nums, target)');

  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': `10.8.${Math.floor(Math.random() * 250)}.9` } });
  const staffPage = await context.newPage();
  await signIn(staffPage, staff, '/submissions');
  await staffPage.goto(`/submissions/${ids.wa}`);
  await expect(staffPage.getByRole('heading', { name: 'Two Sum', level: 1 })).toBeVisible();
  await expect(staffPage.getByText(`@${owner.handle}`)).toBeVisible();
  await context.close();
});

test('a user with no submissions gets the empty state', async ({ page }) => {
  await signIn(page, empty, '/submissions');
  await expect(page.getByRole('heading', { name: 'No submissions yet' })).toBeVisible();
  await page.getByRole('link', { name: 'Browse problems' }).click();
  await expect(page).toHaveURL(/\/problems$/);
});

test('at 375 px the list and the detail fit without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page, owner, '/submissions');
  await expect(rows(page)).toHaveCount(20);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.goto(`/submissions/${ids.wa}`);
  await expect(page.getByRole('heading', { name: 'Two Sum', level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
