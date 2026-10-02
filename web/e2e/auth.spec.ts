import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

/**
 * Auth flows (07a/b/c): the login wall, sign-up, sign-in, forgot and reset.
 * Runs against a live dev server (PLAYWRIGHT_BASE_URL) and its database
 * (DATABASE_URL, else web/.env.local), creating and removing its own users.
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
const userIds: string[] = [];
const emails: string[] = [];
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

async function createUser(tag: string) {
  const id = uid();
  const email = `e2e-${tag}-${id}@test.dev`;
  const password = `pw-${id}-secret`;
  const user = await prisma.user.create({
    data: { email, handle: `e2e_${tag}_${id}`.slice(0, 24), name: tag, passwordHash: await bcrypt.hash(password, 4) },
  });
  userIds.push(user.id);
  emails.push(email);
  return { ...user, password };
}

async function signIn(page: Page, email: string, password: string) {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

// A fresh client address per test: the auth rate limits are per IP.
test.beforeEach(async ({ context }) => {
  const octet = () => Math.floor(Math.random() * 250) + 1;
  await context.setExtraHTTPHeaders({ 'x-forwarded-for': `10.${octet()}.${octet()}.${octet()}` });
});

test.afterAll(async () => {
  await prisma.verificationToken.deleteMany({ where: { identifier: { in: emails.map((e) => `reset:${e}`) } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

test('the wall sends signed-out visitors to /signin and keeps where they were going', async ({ page }) => {
  await page.goto('/submissions?status=WA');
  await expect(page).toHaveURL(/\/signin\?next=%2Fsubmissions%3Fstatus%3DWA$/);
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();

  await page.goto('/');
  await expect(page).toHaveURL(/\/signin$/);
  await page.goto('/auth?next=%2Fsubmissions');
  await expect(page).toHaveURL(/\/signin\?next=%2Fsubmissions$/);

  // APIs answer 401 instead of redirecting a fetch to an HTML page.
  const api = await page.request.get('/api/run', { maxRedirects: 0 });
  expect(api.status()).toBe(401);

  // OAuth buttons appear only for providers the server has configured.
  const github = page.getByRole('button', { name: 'Continue with GitHub' });
  if (envValue('AUTH_GITHUB_ID') && envValue('AUTH_GITHUB_SECRET')) await expect(github).toBeVisible();
  else await expect(github).toHaveCount(0);
});

test('sign up with a username, land on the map, then get bounced off the auth pages', async ({ page }) => {
  const id = uid();
  const email = `e2e-signup-${id}@test.dev`;
  emails.push(email);

  await page.goto('/signup');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Choose a username')).toBeVisible();
  await expect(page.getByLabel('Username')).toBeFocused();

  await page.getByLabel('Username').fill(`E2E_Ada_${id}`.slice(0, 24));
  const handle = `e2e_ada_${id}`.slice(0, 24);
  await expect(page.getByText(`Your public handle: @${handle}`)).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: 'Create account' }).click();

  await page.waitForURL('**/map');
  await expect(page.getByRole('heading', { name: 'Tier map', level: 1 })).toBeVisible();
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  userIds.push(user.id);
  expect(user.handle).toBe(handle);

  // Signed in: the auth pages send you on (to a safe `next`, else home — the map).
  await page.goto('/signin?next=%2Fsubmissions');
  await expect(page).toHaveURL(/\/submissions$/);
  await page.goto('/signup');
  await expect(page).toHaveURL(/\/map$/);
  await page.goto('/signin?next=%2F%2Fevil.example');
  await expect(page).toHaveURL(/\/map$/);
});

test('sign-up reports a taken email and a taken username on their fields', async ({ page }) => {
  const existing = await createUser('taken');
  await page.goto('/signup');
  await page.getByLabel('Username').fill(`fresh_${uid()}`.slice(0, 24));
  await page.getByLabel('Email').fill(existing.email);
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('An account with that email already exists')).toBeVisible();
  await expect(page.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true');

  await page.getByLabel('Username').fill(existing.handle.toUpperCase());
  await page.getByLabel('Email').fill(`e2e-other-${uid()}@test.dev`);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('That username is taken')).toBeVisible();
  await expect(page).toHaveURL(/\/signup$/);
});

test('sign in: a wrong password is refused, then `next` is honoured; sign out returns to /signin', async ({ page }) => {
  const u = await createUser('signin');
  await page.goto('/signin?next=%2Fsubmissions');
  await signIn(page, u.email, 'not-the-password');
  await expect(page.getByRole('form', { name: 'Sign in' }).getByRole('alert')).toContainText('Invalid email or password.');

  await signIn(page, u.email, u.password);
  await page.waitForURL('**/submissions');
  await expect(page.getByRole('heading', { name: 'Submissions', level: 1 })).toBeVisible();

  await page.getByRole('button', { name: /Account menu/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.waitForURL(/\/signin/);
  await page.goto('/submissions');
  await expect(page).toHaveURL(/\/signin\?next=%2Fsubmissions$/);
});

test('forgot password answers the same for known and unknown emails', async ({ page }) => {
  const u = await createUser('forgot');
  const nobody = `e2e-nobody-${uid()}@test.dev`;
  emails.push(nobody);

  for (const email of [u.email, nobody]) {
    await page.goto('/signin');
    await page.getByRole('link', { name: 'Forgot password?' }).click();
    await expect(page).toHaveURL(/\/forgot$/);
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('heading', { name: 'Check your inbox.' })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
  }

  // Only the real account gets a token (issued just after the response).
  await expect
    .poll(() => prisma.verificationToken.count({ where: { identifier: `reset:${u.email}` } }), { timeout: 10_000 })
    .toBe(1);
  expect(await prisma.verificationToken.count({ where: { identifier: `reset:${nobody}` } })).toBe(0);
  const row = await prisma.verificationToken.findFirstOrThrow({ where: { identifier: `reset:${u.email}` } });
  expect(row.token).toMatch(/^[0-9a-f]{64}$/); // a SHA-256, never the raw token
});

test('a reset link sets a new password, signs you in, and works only once', async ({ page, browser }) => {
  const u = await createUser('reset');
  const raw = randomBytes(32).toString('base64url');
  await prisma.verificationToken.create({
    data: { identifier: `reset:${u.email}`, token: sha256(raw), expires: new Date(Date.now() + 30 * 60_000) },
  });

  await page.goto(`/reset?token=${raw}`);
  await expect(page.getByRole('heading', { name: 'Choose a new password.' })).toBeVisible();
  await expect(page.getByText(u.email)).toBeVisible();

  const save = page.getByRole('button', { name: 'Save password and sign in' });
  await page.getByLabel('New password', { exact: true }).fill('short');
  await save.click();
  await expect(page.getByText('Password must be at least 8 characters')).toBeVisible();

  await page.getByLabel('New password', { exact: true }).fill('a much better password');
  await page.getByLabel('Confirm new password', { exact: true }).fill('a much better passwrod');
  await save.click();
  await expect(page.getByText(/passwords don.t match/)).toBeVisible();

  await page.getByLabel('Confirm new password', { exact: true }).fill('a much better password');
  await save.click();
  await page.waitForURL('**/map');

  const fresh = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
  expect(await bcrypt.compare('a much better password', fresh.passwordHash!)).toBe(true);
  expect(await bcrypt.compare(u.password, fresh.passwordHash!)).toBe(false);

  // The link is spent (checked signed out: signed-in visitors never see /reset).
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': `10.9.${Math.floor(Math.random() * 250)}.7` } });
  const other = await context.newPage();
  await other.goto(`/reset?token=${raw}`);
  await expect(other.getByRole('heading', { name: 'This link isn’t valid.' })).toBeVisible();

  const expired = randomBytes(32).toString('base64url');
  await prisma.verificationToken.create({
    data: { identifier: `reset:${u.email}`, token: sha256(expired), expires: new Date(Date.now() - 60_000) },
  });
  await other.goto(`/reset?token=${expired}`);
  await expect(other.getByRole('heading', { name: 'This link has expired.' })).toBeVisible();
  await other.getByRole('link', { name: 'Send a new link' }).click();
  await expect(other).toHaveURL(/\/forgot$/);
  await context.close();
});
