/**
 * Authoring (artboard A1) end to end: role gate, the full write → verify on
 * the judge → publish flow, and ownership. Needs the app (PLAYWRIGHT_BASE_URL)
 * and the compile service it points at; users are created straight in the
 * app's database with the role each test needs, and removed afterwards.
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
  await prisma.question.deleteMany({ where: { authorId: { in: created } } });
  await prisma.user.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

test('authoring routes are a plain 404 below the author role', async ({ page }) => {
  const learner = await makeUser('learner', 'lrn');
  await signIn(page, learner.email);
  for (const path of ['/author', '/author/new', '/author/some-id/edit']) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(404);
    await expect(page).toHaveTitle('Not found · Codemare');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  }
});

test('an author writes a question, fills expected outputs from the reference and publishes it', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const author = await makeUser('author', 'aut');
  await signIn(page, author.email);
  await page.goto('/author/new');
  await expect(page.getByRole('heading', { name: 'Untitled question' })).toBeVisible();

  const publish = page.getByRole('button', { name: 'Publish', exact: true });
  await expect(publish).toBeDisabled();

  // Basics: the slug follows the title.
  const title = `E2E Sum Positives ${run}`;
  // Required fields: role queries use the accessible name, which leaves out the aria-hidden "*".
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
  const slug = `e2e-sum-positives-${run}`;
  await expect(page.getByRole('textbox', { name: 'Slug', exact: true })).toHaveValue(slug);
  await page.getByLabel('Add a topic').selectOption('arrays-hashing');
  await expect(page.getByRole('list', { name: 'Chosen topics' })).toContainText('Arrays & Hashing');

  // Statement + example.
  await page.getByRole('textbox', { name: 'Problem statement', exact: true }).fill('Return the sum of the **positive** numbers in `nums`.');
  await expect(page.getByRole('region', { name: 'Problem statement preview' }).locator('strong')).toHaveText('positive');
  await page.getByLabel('Input', { exact: true }).fill('nums = [1,-2,3]');
  await page.getByLabel('Output', { exact: true }).fill('4');

  // Signature: the default parameter is nums: int[] → int; stubs follow the function name.
  await page.getByRole('textbox', { name: 'Function name', exact: true }).fill('sumPositives');
  await expect(page.getByLabel('Python starter code')).toHaveValue(/def sumPositives\(nums\):/);

  // Tests: arguments only — the reference will provide the expected outputs.
  const args = page.getByLabel('Arguments');
  await expect(args).toHaveCount(4);
  const inputs = ['[[1,-2,3]]', '[[]]', '[[-5,-6]]', '[[10,20,-30]]'];
  for (const [i, value] of inputs.entries()) await args.nth(i).fill(value);

  await page.getByLabel('Python reference solution').fill('def sumPositives(nums):\n    return sum(x for x in nums if x > 0)\n');
  await page.getByRole('button', { name: 'Run reference against tests' }).click();
  await expect(page.getByRole('button', { name: 'Fill 4 expected outputs from actual' })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Fill 4 expected outputs from actual' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Fill 4' }).click();
  const expected = page.getByLabel('Expected');
  for (const [i, value] of ['4', '0', '0', '30'].entries()) await expect(expected.nth(i)).toHaveValue(value);

  // Hint ladder.
  for (const level of ['Nudge', 'Concept', 'Pseudocode', 'Key line', 'Solution']) {
    await page.getByLabel(`${level} hint`, { exact: true }).fill(`${level} hint for the e2e question.`);
  }

  const checklist = page.getByRole('list', { name: 'Publish checklist' });
  await expect(checklist.getByRole('img', { name: 'to do' })).toHaveCount(0);
  await expect(publish).toBeEnabled();

  // Save the draft first: the URL moves to the edit route without a reload.
  await page.getByRole('button', { name: /Save draft/ }).click();
  await expect(page).toHaveURL(/\/author\/[a-z0-9]+\/edit$/);
  await expect(page.getByLabel('Publish').getByText('Draft', { exact: true })).toBeVisible();

  await publish.click();
  await expect(page.getByLabel('Publish').getByText('Published', { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Unpublish' })).toBeVisible();

  const row = await prisma.question.findUniqueOrThrow({ where: { slug }, include: { hints: true, topics: true } });
  expect(row).toMatchObject({ status: 'published', authorId: author.id, functionName: 'sumPositives' });
  expect(row.hints).toHaveLength(5);
  expect((row.tests as { expected: unknown; hidden: boolean }[]).map((t) => [t.expected, t.hidden])).toEqual([
    [4, false],
    [0, true],
    [0, true],
    [30, true],
  ]);

  await page.goto('/author');
  const listed = page.getByRole('row', { name: new RegExp(title) });
  await expect(listed).toContainText('Published');
  await expect(listed).toContainText('4 · 3 hidden');
});

test('authors edit only their own questions; staff edit anyone’s', async ({ page }) => {
  const owner = await makeUser('author', 'own');
  const other = await makeUser('author', 'oth');
  const staff = await makeUser('staff', 'stf');
  const q = await prisma.question.create({
    data: {
      slug: `e2e-owned-${run}`,
      title: 'Owned draft',
      difficulty: 'Easy',
      statementMd: 'x',
      examples: [],
      constraints: [],
      functionName: 'f',
      signature: { params: [], returns: 'int' },
      starterCode: {},
      tests: [],
      referenceSolutions: {},
      status: 'draft',
      authorId: owner.id,
    },
  });

  await signIn(page, other.email);
  expect((await page.goto(`/author/${q.id}/edit`))?.status()).toBe(404);
  await page.goto('/author');
  await expect(page.getByText('Owned draft')).toHaveCount(0);

  await signIn(page, staff.email);
  expect((await page.goto(`/author/${q.id}/edit`))?.status()).toBe(200);
  await expect(page.getByText(`by @${owner.handle} (editing as staff)`)).toBeVisible();

  await signIn(page, owner.email);
  expect((await page.goto(`/author/${q.id}/edit`))?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Owned draft' })).toBeVisible();
});
