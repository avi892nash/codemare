import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

/**
 * Catalog (/problems, artboards 01 + 08b): pagination, per-user status, locks,
 * URL-driven filters, the navbar jump box, the empty state, and 375 px.
 * Needs the seeded content (published questions incl. two-sum, valid-anagram,
 * valid-palindrome, binary-search) in the dev server's database.
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
let user: { id: string; email: string; password: string };
let published = 0;
let easy = 0;

const rows = (page: Page) => page.locator('ol[aria-label="Problems"] > li');
const row = (page: Page, slug: string) => page.locator(`a[data-slug="${slug}"]`);

async function signIn(page: Page, next = '/problems') {
  await page.goto(`/signin?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((url) => url.pathname === next);
}

test.beforeAll(async () => {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const password = `pw-${id}-secret`;
  const created = await prisma.user.create({
    data: {
      email: `e2e-catalog-${id}@test.dev`,
      handle: `e2e_cat_${id}`.slice(0, 24),
      name: 'Catalog E2E',
      passwordHash: await bcrypt.hash(password, 4),
    },
  });
  user = { id: created.id, email: created.email, password };
  const q = (slug: string) => prisma.question.findUniqueOrThrow({ where: { slug }, select: { id: true } });
  const [twoSum, anagram] = await Promise.all([q('two-sum'), q('valid-anagram')]);
  const base = { userId: user.id, language: 'python' as const, code: 'pass', totalTests: 1 };
  await prisma.submission.createMany({
    data: [
      { ...base, kind: 'submit', questionId: twoSum.id, status: 'OK', totalPassed: 1, runtimeUs: 400n },
      { ...base, kind: 'submit', questionId: anagram.id, status: 'WA', totalPassed: 0, runtimeUs: 300n },
    ],
  });
  published = await prisma.question.count({ where: { status: 'published' } });
  easy = await prisma.question.count({ where: { status: 'published', difficulty: 'Easy' } });
});

test.beforeEach(async ({ context, page }) => {
  const octet = () => Math.floor(Math.random() * 250) + 1;
  await context.setExtraHTTPHeaders({ 'x-forwarded-for': `10.${octet()}.${octet()}.${octet()}` });
  await signIn(page);
});

test.afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: user.id } });
  await prisma.$disconnect();
});

test('lists published problems 20 per page with status, locks and acceptance', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Problems', level: 1 })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'problems' })).toContainText(`${published} problems`);
  await expect(rows(page)).toHaveCount(Math.min(20, published));

  // Per-user progress, announced as text (not just an icon).
  await expect(row(page, 'two-sum')).toContainText('Solved');
  await expect(row(page, 'valid-anagram')).toContainText('Attempted');
  await expect(row(page, 'two-sum')).toHaveAttribute('href', '/problems/two-sum');
  await expect(row(page, 'two-sum').locator('.mono').last()).toContainText('%');

  // Tier-1 questions are locked for a new account and open the map instead.
  await page.goto('/problems?q=binary%20search');
  await expect(row(page, 'binary-search')).toHaveAttribute('href', '/map');
  await expect(row(page, 'binary-search')).toContainText('locked');

  // Page 2 holds the rest.
  test.skip(published <= 20, 'needs more than one page of problems');
  await page.goto('/problems');
  await page.getByRole('navigation', { name: 'Pagination' }).getByRole('link', { name: 'Next' }).click();
  await expect(page).toHaveURL(/\/problems\?page=2$/);
  await expect(rows(page)).toHaveCount(published - 20);
  await expect(page.getByRole('link', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page');
});

test('difficulty chips and search filter through the URL, and Clear filters resets', async ({ page }) => {
  const easyChip = page.getByRole('group', { name: 'Difficulty' }).getByRole('button', { name: /^Easy/ });
  await easyChip.click();
  await expect(page).toHaveURL(/\/problems\?difficulty=Easy$/);
  await expect(easyChip).toHaveAttribute('aria-pressed', 'true');
  await expect(rows(page)).toHaveCount(Math.min(20, easy));
  const pills = rows(page).getByText(/^(Easy|Medium|Hard)$/);
  await expect(pills.first()).toHaveText('Easy');
  expect(new Set(await pills.allTextContents())).toEqual(new Set(['Easy']));

  await page.getByRole('textbox', { name: 'Search problems by title or tag' }).fill('palindrome');
  await expect(page).toHaveURL(/\/problems\?q=palindrome&difficulty=Easy$/);
  await expect(rows(page)).toHaveCount(1);
  await expect(row(page, 'valid-palindrome')).toBeVisible();

  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page).toHaveURL(/\/problems$/);
  await expect(page.getByRole('textbox', { name: 'Search problems by title or tag' })).toHaveValue('');
  await expect(rows(page)).toHaveCount(Math.min(20, published));
});

test('status, tag and company selects combine, with removable chips', async ({ page }) => {
  await page.getByRole('combobox', { name: 'Status' }).selectOption('solved');
  await expect(page).toHaveURL(/\/problems\?status=solved$/);
  await expect(rows(page)).toHaveCount(1);
  await expect(row(page, 'two-sum')).toBeVisible();

  await page.getByRole('combobox', { name: 'Status' }).selectOption('');
  await expect(page).toHaveURL(/\/problems$/);
  await page.getByRole('combobox', { name: 'Add a tag filter' }).selectOption('hash-table');
  await expect(page).toHaveURL(/\/problems\?tag=hash-table$/);
  await page.getByRole('combobox', { name: 'Add a company filter' }).selectOption('Amazon');
  await expect(page).toHaveURL(/\/problems\?tag=hash-table&company=Amazon$/);
  await expect(row(page, 'two-sum')).toBeVisible();

  await page.getByRole('button', { name: 'Remove tag filter hash-table' }).click();
  await expect(page).toHaveURL(/\/problems\?company=Amazon$/);
  await expect(page.getByRole('button', { name: 'Remove company filter Amazon' })).toBeVisible();
});

test('the navbar jump box searches the catalog', async ({ page }) => {
  const jump = page.getByRole('textbox', { name: 'Jump to problem' });
  await jump.fill('two sum');
  await jump.press('Enter');
  await expect(page).toHaveURL(/\/problems\?q=two(%20|\+)sum$/);
  await expect(page.getByRole('textbox', { name: 'Search problems by title or tag' })).toHaveValue('two sum');
  await expect(row(page, 'two-sum')).toBeVisible();
});

test('nothing matching shows the empty state with a way out', async ({ page }) => {
  await page.goto('/problems?q=zzzz-no-such-problem&difficulty=Hard');
  await expect(page.getByRole('heading', { name: 'No problems match these filters' })).toBeVisible();
  await expect(rows(page)).toHaveCount(0);
  await page.getByRole('link', { name: 'Clear filters' }).click();
  await expect(page).toHaveURL(/\/problems$/);
  await expect(rows(page)).toHaveCount(Math.min(20, published));
});

test('at 375 px the facets fold behind a Filters toggle and nothing scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/problems');
  const status = page.getByRole('combobox', { name: 'Status' });
  await expect(status).toBeHidden();
  const toggle = page.getByRole('button', { name: 'Filters' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(status).toBeVisible();

  await page.getByRole('group', { name: 'Difficulty' }).getByRole('button', { name: /^Medium/ }).click();
  await expect(page).toHaveURL(/\/problems\?difficulty=Medium$/);
  await expect(page.getByRole('button', { name: /Filters 1 active/ })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
