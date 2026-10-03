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

test('on a phone the auth forms are thumb-sized: 44 px fields and links, 16 px text, and the form ends in the first screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of ['/signin', '/signup', '/forgot']) {
    await page.goto(path, { waitUntil: 'networkidle' });
    // every field is a 44 px box with 16 px text (iOS zooms the page into anything smaller)
    for (const input of await page.locator('form input:not([type="hidden"])').all()) {
      const box = await input.boundingBox();
      expect(box!.height, `${path}: a field's height`).toBeGreaterThanOrEqual(44);
      expect(await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)), `${path}: a field's text`).toBeGreaterThanOrEqual(16);
    }
    // the primary action is 44 px tall and inside the first screen
    const primary = await page.locator('form button[type="submit"]').boundingBox();
    expect(primary!.height).toBeGreaterThanOrEqual(44);
    expect(primary!.y + primary!.height, `${path}: the primary action is in the first screen`).toBeLessThanOrEqual(812);
    // the links under the form are 44 px targets, too
    for (const link of await page.locator('main a[href]').all()) {
      expect((await link.boundingBox())!.height, `${path}: ${await link.textContent()}`).toBeGreaterThanOrEqual(44);
    }
  }

  // "Forgot password?" is its own row under the password field on a phone…
  await page.goto('/signin', { waitUntil: 'networkidle' });
  const password = await page.getByLabel('Password', { exact: true }).boundingBox();
  const forgot = await page.getByRole('link', { name: 'Forgot password?' }).boundingBox();
  expect(forgot!.y).toBeGreaterThan(password!.y + password!.height - 1);

  // …and beside the "Password" label on a desktop, where it does not take a row of its own
  await page.setViewportSize({ width: 1440, height: 900 });
  const desktopPassword = await page.getByLabel('Password', { exact: true }).boundingBox();
  const desktopForgot = await page.getByRole('link', { name: 'Forgot password?' }).boundingBox();
  expect(desktopForgot!.y + desktopForgot!.height).toBeLessThanOrEqual(desktopPassword!.y);
});

test('placeholder text is readable — 4.5 : 1 against its field, in both themes', async ({ page }) => {
  const base = test.info().project.use.baseURL ?? 'http://localhost:4001';
  for (const theme of ['dark', 'light'] as const) {
    await page.context().addCookies([{ name: 'cm-theme', value: theme, url: base }]);
    for (const path of ['/signin', '/signup']) {
      await page.goto(path, { waitUntil: 'networkidle' });
      const ratios = await page.evaluate(() => {
        const rgb = (c: string) => c.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? null;
        const lin = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        const lum = (c: number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
        return [...document.querySelectorAll<HTMLInputElement>('input[placeholder]')].flatMap((input) => {
          const fg = rgb(getComputedStyle(input, '::placeholder').color);
          // the field's own surface: the first ancestor that paints a background
          let bg: number[] | null = null;
          for (let n: HTMLElement | null = input; n && !bg; n = n.parentElement) {
            const c = getComputedStyle(n).backgroundColor;
            if (!/rgba\(0, 0, 0, 0\)|transparent/.test(c)) bg = rgb(c);
          }
          if (!fg || !bg) return [];
          const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
          return [{ placeholder: input.placeholder, ratio: Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100 }];
        });
      });
      expect(ratios.length, `${path} (${theme}): placeholders measured`).toBeGreaterThan(0);
      for (const r of ratios) expect(r.ratio, `${path} (${theme}): "${r.placeholder}"`).toBeGreaterThanOrEqual(4.5);
    }
  }
});
