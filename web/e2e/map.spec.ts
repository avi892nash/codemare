import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

/**
 * The tier map as home and as the way to find problems (decision 39): `/`
 * and the old problem list lead to it, an unlocked topic lists its problems
 * with this learner's progress and links to the editor, a locked topic only
 * counts them, and a composite that still needs a locked topic says so
 * instead of linking. Needs the seeded content in the app's database;
 * creates its own learner (tier-0 topics are free) and removes it.
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
/** Published questions per topic slug, composites included. */
const held: Record<string, number> = {};

async function signIn(page: Page, next = '/map') {
  await page.goto(`/signin?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((url) => url.pathname === next);
}

const topic = (page: Page, slug: string) => page.getByTestId(`topic-${slug}`);

test.beforeAll(async () => {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const password = `pw-${id}-secret`;
  const created = await prisma.user.create({
    data: {
      email: `e2e-map-${id}@test.dev`,
      handle: `e2e_map_${id}`.slice(0, 24),
      name: 'Map E2E',
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
  const rows = await prisma.questionTopic.findMany({
    where: { question: { status: 'published' } },
    select: { topic: { select: { slug: true } } },
  });
  for (const r of rows) held[r.topic.slug] = (held[r.topic.slug] ?? 0) + 1;
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

test('the map is home: `/`, the logo and the old problem list all lead to it', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/map$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Earn tokens, unlock topics, open tiers');
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(nav.getByRole('link', { name: 'Map' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('link', { name: 'Codemare home' })).toHaveAttribute('href', '/map');
  await expect(page.getByRole('textbox', { name: 'Jump to problem' })).toHaveCount(0);

  // The removed list's URL — bare, or an old bookmark with its filters — opens the map.
  await page.goto('/problems');
  await expect(page).toHaveURL(/\/map$/);
  await page.goto('/problems?q=graph&difficulty=Easy&page=2');
  await expect(page).toHaveURL(/\/map$/);
  // The map's old link to a topic's problems lands on that topic's card.
  await page.goto('/problems?topic=two-pointers');
  await expect(page).toHaveURL(/\/map#topic-two-pointers$/);
  await expect(topic(page, 'two-pointers')).toBeInViewport();

  // The editor's own route is untouched.
  const res = await page.goto('/problems/two-sum');
  expect(res?.status()).toBe(200);
  await expect(page.getByTestId('problem-statement')).toBeVisible();
});

test('an unlocked topic lists its problems with progress, each linking to the editor', async ({ page }) => {
  const card = topic(page, 'arrays-hashing');
  const list = card.getByRole('list', { name: 'Arrays & Hashing problems' });
  await expect(list.getByRole('listitem')).toHaveCount(held['arrays-hashing']);
  await expect(card.getByTestId('topic-problems')).toContainText(`1/${held['arrays-hashing']} solved`);

  // The link's name is the title; the status is read beside it, as text.
  const row = (title: string) => list.getByRole('listitem').filter({ has: page.getByRole('link', { name: title, exact: true }) });
  await expect(list.getByRole('link', { name: 'Two Sum', exact: true })).toHaveAttribute('href', '/problems/two-sum');
  await expect(row('Two Sum')).toContainText('Solved');
  await expect(row('Valid Anagram')).toContainText('Attempted');
  await expect(row('Valid Anagram')).toContainText('Easy');
  await expect(row('Contains Duplicate')).toContainText('Not started');

  // A row opens the editor.
  await list.getByRole('link', { name: 'Product of Array Except Self' }).click();
  await expect(page).toHaveURL(/\/problems\/product-of-array-except-self$/);
  await expect(page.getByTestId('problem-statement')).toBeVisible();
});

test('a composite that still needs a locked topic says so instead of linking', async ({ page }) => {
  // Three Sum is Two Pointers (free) and Sorting (tier 1, locked for a new learner).
  const card = topic(page, 'two-pointers');
  const list = card.getByRole('list', { name: 'Two Pointers problems' });
  await expect(list.getByRole('listitem')).toHaveCount(held['two-pointers']);
  const row = list.locator('li[data-slug="three-sum"]');
  await expect(row).toContainText('Locked');
  await expect(row.getByRole('link', { name: 'Three Sum' })).toHaveCount(0);
  await expect(row.getByRole('link', { name: 'Sorting' })).toHaveAttribute('href', '#topic-sorting');
});

test('a locked topic counts its problems without linking them', async ({ page }) => {
  const card = topic(page, 'binary-search');
  await expect(card.getByTestId('topic-state')).toHaveText('Tier closed');
  const problems = card.getByTestId('topic-problems');
  await expect(problems).toHaveText(`${held['binary-search']} problems — unlock the topic to open them.`);
  await expect(card.getByRole('list', { name: 'Binary Search problems' })).toHaveCount(0);
  await expect(card.locator('a[href^="/problems/"]')).toHaveCount(0);
});

test('at 375 px the problem lists fit without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/map');
  await expect(page.getByRole('list', { name: 'Stack problems' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
