/**
 * Accessibility + layout regression net across the product: for a
 * representative route per section, in both themes, no serious or critical
 * axe-core violations and exactly one <h1>; on phones (375 px), in both
 * themes, no horizontal page scroll on the pages that must work there (the
 * map — home, with every topic's problems — learn, profile, library,
 * submissions); the "phone gate" below extends that to every route.
 *
 * Then the floor, which the UX pass (round 2) set for the whole site:
 *   · "phone gate" — every route of the table, at 375 px in both themes: no
 *     page scroll, no serious axe violation, exactly one <h1>;
 *   · "type floor" — one test per route, so a failure names the page: no
 *     text a person can see is set smaller than 12 px (--fs-xs), in both
 *     themes at 1440 px and in dark at 375 px;
 *   · "form fields" — for the routes with forms, every field computes to at
 *     least 16 px at 375 px (iOS Safari zooms the page when a focused field is
 *     smaller);
 *   · "top bar" — on a phone every control of the bar is a 44 px target, the
 *     section menu says "Menu" on every page, and nothing overflows at 320 px.
 * FLOOR_ROUTES below is the route table (with who owns each page); a page is
 * added there, never skipped.
 *
 * axe-core is injected from cdnjs per page (not a dependency). A staff user
 * is created straight in the database (so /author and the hidden /library
 * are covered too) and removed afterwards.
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const AXE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js';

function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync(join(__dirname, '..', '.env.local'), 'utf8');
  return env.match(/^DATABASE_URL=(.*)$/m)![1].trim().replace(/^["']|["']$/g, '');
}

const prisma = new PrismaClient({ datasourceUrl: databaseUrl() });
const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const PASSWORD = `e2e-${run}-pw`;
let user: { id: string; email: string; handle: string } | null = null;

type Theme = 'dark' | 'light';
interface Finding {
  id: string;
  impact: string | null | undefined;
  help: string;
  targets: string[];
}

/** Credentials sign-in through Auth.js's own endpoints, on a fresh client address (logins are rate-limited per IP). */
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

/** The theme cookie the root layout reads, so SSR renders the theme under test. */
async function setTheme(page: Page, theme: Theme) {
  const base = test.info().project.use.baseURL ?? 'http://localhost:4001';
  await page.context().addCookies([{ name: 'cm-theme', value: theme, url: base }]);
}

/** Serious / critical axe violations on the current page. */
async function axeViolations(page: Page): Promise<Finding[]> {
  await page.addScriptTag({ url: AXE_URL });
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: { id: string; impact?: string | null; help: string; nodes: { target: string[] }[] }[] }> } }).axe;
    const result = await axe.run(document, { exclude: [['nextjs-portal']], resultTypes: ['violations'] });
    return result.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => ({ id: v.id, impact: v.impact, help: v.help, targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }));
  });
}

async function h1Count(page: Page): Promise<number> {
  return page.locator('h1').count();
}

/** Page-level horizontal overflow in px (0 = none). */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
}

async function open(page: Page, path: string) {
  const res = await page.goto(path, { waitUntil: 'load' });
  expect(res?.ok() || res?.status() === 404, `${path} → ${res?.status()}`).toBeTruthy();
  // Let client components mount (dynamic imports, portals) before auditing.
  await page.waitForLoadState('networkidle').catch(() => undefined);
}

// Not serial: the floor has one test per route precisely so that one page failing does not hide the others.

/** A live /reset link for the staff user (so the reset form, not the dead-link card, is what gets measured). */
const resetToken = randomBytes(32).toString('base64url');

test.beforeAll(async () => {
  const handle = `e2e_a11y_${run}`.slice(0, 24);
  const created = await prisma.user.create({
    data: { email: `e2e-a11y-${run}@codemare.test`, handle, name: 'A11y Check', role: 'staff', passwordHash: await bcrypt.hash(PASSWORD, 4) },
  });
  user = { id: created.id, email: created.email, handle: created.handle };
  await prisma.verificationToken.create({
    data: {
      identifier: `reset:${created.email}`,
      token: createHash('sha256').update(resetToken).digest('hex'),
      expires: new Date(Date.now() + 30 * 60_000),
    },
  });
});

test.afterAll(async () => {
  if (user) {
    await prisma.verificationToken.deleteMany({ where: { identifier: `reset:${user.email}` } });
    await prisma.user.deleteMany({ where: { id: user.id } });
  }
  await prisma.$disconnect();
});

test('signed-out pages: no serious axe violations, one h1, no overflow at 375 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme);
    for (const path of ['/signin', '/signup', '/forgot']) {
      await open(page, path);
      expect(await axeViolations(page), `${path} (${theme})`).toEqual([]);
      expect(await h1Count(page), `${path} h1`).toBe(1);
      expect(await horizontalOverflow(page), `${path} overflow`).toBe(0);
    }
  }
});

test('signed-in sections at desktop width: no serious axe violations and one h1, in both themes', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, user!.email);
  const routes = [
    '/map',
    '/problems/two-sum',
    '/ide',
    '/submissions',
    '/learn',
    '/learn/foundations',
    '/learn/foundations/hash-maps',
    `/u/${user!.handle}`,
    `/u/${user!.handle}/badges`,
    '/author',
    '/library',
    '/this-page-does-not-exist',
  ];
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme);
    for (const path of routes) {
      await open(page, path);
      expect(await axeViolations(page), `${path} (${theme})`).toEqual([]);
      expect(await h1Count(page), `${path} h1 (${theme})`).toBe(1);
    }
  }
});

test('phone width (375 px): no horizontal page scroll where phones are supported, in both themes', async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page, user!.email);
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme);
    for (const path of ['/map', '/learn', '/learn/foundations', `/u/${user!.handle}`, '/library', '/submissions']) {
      await open(page, path);
      expect(await horizontalOverflow(page), `${path} overflow at 375 px (${theme})`).toBe(0);
      expect(await axeViolations(page), `${path} at 375 px (${theme})`).toEqual([]);
    }
  }
});

/* ── The floor (UX pass, round 2) ──────────────────────────────────────────── */

const FLOOR_PX = 12; // --fs-xs: the smallest size anything is set in
const FIELD_PX = 16; // --fs-lg: what a form field computes to on a phone

interface FloorRoute {
  /** Test title. */
  name: string;
  path: (u: { handle: string }) => string;
  who: 'anon' | 'user';
  /** Whose page it is (the round-2 split) — a failure goes to that owner. */
  owner: 'kit' | 'map' | 'problem' | 'learn' | 'ide' | 'submissions' | 'profile' | 'badges' | 'author' | 'library';
  /** The page has form fields that are on screen by default (checked at 375 px). */
  forms?: boolean;
  /** Not served by a production build (/dev/*): the test skips itself when the page is not there. */
  devOnly?: boolean;
}

/**
 * Every route the floor applies to. Auth and the shell are the kit's; the rest
 * belong to the page owners and fail until their page is on the scale.
 */
const FLOOR_ROUTES: FloorRoute[] = [
  // the shared kit, the top bar, auth, the error pages
  { name: 'sign in', path: () => '/signin', who: 'anon', owner: 'kit', forms: true },
  { name: 'sign up', path: () => '/signup', who: 'anon', owner: 'kit', forms: true },
  { name: 'forgot password', path: () => '/forgot', who: 'anon', owner: 'kit', forms: true },
  { name: 'reset password (live link)', path: () => `/reset?token=${resetToken}`, who: 'anon', owner: 'kit', forms: true },
  { name: 'reset password (dead link)', path: () => '/reset?token=not-a-live-link', who: 'anon', owner: 'kit' },
  { name: 'not found', path: () => '/this-page-does-not-exist', who: 'user', owner: 'kit' },
  { name: 'design system sheet', path: () => '/dev/system', who: 'anon', owner: 'kit', forms: true, devOnly: true },
  // the pages
  { name: 'map', path: () => '/map', who: 'user', owner: 'map' },
  { name: 'problem', path: () => '/problems/two-sum', who: 'user', owner: 'problem' },
  { name: 'ide', path: () => '/ide', who: 'user', owner: 'ide', forms: true },
  { name: 'submissions', path: () => '/submissions', who: 'user', owner: 'submissions', forms: true },
  { name: 'learn', path: () => '/learn', who: 'user', owner: 'learn' },
  { name: 'learn track', path: () => '/learn/foundations', who: 'user', owner: 'learn' },
  { name: 'lesson', path: () => '/learn/foundations/hash-maps', who: 'user', owner: 'learn', forms: true },
  { name: 'profile', path: (u) => `/u/${u.handle}`, who: 'user', owner: 'profile' },
  { name: 'badges', path: (u) => `/u/${u.handle}/badges`, who: 'user', owner: 'badges' },
  { name: 'author', path: () => '/author', who: 'user', owner: 'author' },
  { name: 'library', path: () => '/library', who: 'user', owner: 'library' },
];

/**
 * Visible text under `min` px, measured in the page. A piece of text counts when
 * its element is rendered (a box of at least 2 × 2 px, not display:none,
 * visibility:hidden or opacity:0) and its computed font-size is under `min`.
 * What is ignored, exactly — nothing else is:
 *   1. text inside an <svg> (the topic art, the icons);
 *   2. text made only of symbols (no letter, no digit) inside an aria-hidden
 *      element — a glyph used as an icon, such as "→", "·" or "✓". Letters and
 *      numbers inside aria-hidden elements DO count: initials, language marks
 *      and shortcut hints are read by sighted people;
 *   3. screen-reader-only text (`sr-only`, any clipped 1 px box);
 *   4. content of a closed <details> (other than its <summary>) and [hidden];
 *   5. <script>, <style>, <noscript>, <template> and the Next.js dev overlay.
 */
async function textUnderFloor(page: Page, min = FLOOR_PX): Promise<string[]> {
  return page.evaluate((floor) => {
    const found: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    const closed = (el: Element) => {
      for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
        if (n.tagName === 'DETAILS' && !(n as HTMLDetailsElement).open) {
          const summary = n.querySelector(':scope > summary');
          if (!(summary && summary.contains(el))) return true;
        }
        if (n.hasAttribute('hidden')) return true;
      }
      return false;
    };
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = (node.nodeValue ?? '').replace(/\s+/g, ' ').trim();
      const el = node.parentElement;
      if (!text || !el || seen.has(el)) continue;
      if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(el.tagName)) continue; // 5
      if (el.closest('svg') || el.closest('nextjs-portal')) continue; // 1, 5
      seen.add(el);
      const cs = getComputedStyle(el);
      const size = parseFloat(cs.fontSize);
      if (size >= floor - 0.001) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue; // 3 (a clipped 1 px box) and anything with no box
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      let opacity = 1;
      for (let n: Element | null = el; n; n = n.parentElement) opacity *= parseFloat(getComputedStyle(n).opacity || '1');
      if (opacity === 0) continue;
      if (closed(el)) continue; // 4
      if (el.closest('[aria-hidden="true"]') && !/[\p{L}\p{N}]/u.test(text)) continue; // 2
      const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : '';
      found.push(`${size}px ${el.tagName.toLowerCase()}${cls ? '.' + cls : ''} "${text.slice(0, 40)}"`);
    }
    return found;
  }, min);
}

/** Form fields on screen that compute to under `min` px (Monaco's own hidden input is the editor's, not a form field). */
async function fieldsUnder(page: Page, min = FIELD_PX): Promise<string[]> {
  return page.evaluate((floor) => {
    const found: string[] = [];
    const fields = document.querySelectorAll('input, select, textarea');
    for (const el of Array.from(fields)) {
      if (el instanceof HTMLInputElement && ['hidden', 'checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'file', 'image'].includes(el.type)) continue;
      if (el.closest('.monaco-editor')) continue;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width < 2 || r.height < 2 || cs.display === 'none' || cs.visibility === 'hidden') continue;
      const size = parseFloat(cs.fontSize);
      if (size < floor - 0.001) {
        const name = el.getAttribute('aria-label') || el.getAttribute('name') || el.id || el.getAttribute('placeholder') || '';
        found.push(`${size}px ${el.tagName.toLowerCase()} ${JSON.stringify(name.slice(0, 30))}`);
      }
    }
    return found;
  }, min);
}

/** Open a route for the floor; a dev-only page that is not served (404, or walled off) skips the test. */
async function openFloorRoute(page: Page, route: FloorRoute, path: string) {
  if (route.devOnly) {
    const res = await page.goto(path, { waitUntil: 'load' });
    const there = res?.status() === 200 && new URL(page.url()).pathname === path.split('?')[0];
    test.skip(!there, `${path} is development-only (a production build does not serve it)`);
    await page.waitForLoadState('networkidle').catch(() => undefined);
    return;
  }
  await open(page, path);
}

test.describe('phone gate: every route at 375 px, in both themes', () => {
  for (const route of FLOOR_ROUTES) {
    test(`${route.name} (${route.owner})`, async ({ page }) => {
      test.setTimeout(150_000);
      if (route.who === 'user') await signIn(page, user!.email);
      const path = route.path({ handle: user!.handle });
      await page.setViewportSize({ width: 375, height: 812 });
      for (const theme of ['dark', 'light'] as const) {
        await setTheme(page, theme);
        await openFloorRoute(page, route, path);
        expect(await horizontalOverflow(page), `${path} overflow at 375 px (${theme})`).toBe(0);
        expect(await axeViolations(page), `${path} at 375 px (${theme})`).toEqual([]);
        expect(await h1Count(page), `${path} h1 (${theme})`).toBe(1);
      }
    });
  }
});

test.describe('type floor: no visible text under 12 px', () => {
  for (const route of FLOOR_ROUTES) {
    test(`${route.name} (${route.owner})`, async ({ page }) => {
      test.setTimeout(150_000);
      if (route.who === 'user') await signIn(page, user!.email);
      const path = route.path({ handle: user!.handle });
      for (const [width, height, theme] of [[1440, 900, 'dark'], [1440, 900, 'light'], [375, 812, 'dark']] as const) {
        await page.setViewportSize({ width, height });
        await setTheme(page, theme);
        await openFloorRoute(page, route, path);
        expect(await textUnderFloor(page), `${path} at ${width} px (${theme}): text under ${FLOOR_PX} px`).toEqual([]);
      }
    });
  }
});

test.describe('form fields are 16 px on a phone (375 px)', () => {
  for (const route of FLOOR_ROUTES.filter((r) => r.forms)) {
    test(`${route.name} (${route.owner})`, async ({ page }) => {
      test.setTimeout(90_000);
      if (route.who === 'user') await signIn(page, user!.email);
      const path = route.path({ handle: user!.handle });
      await page.setViewportSize({ width: 375, height: 812 });
      await setTheme(page, 'dark');
      await openFloorRoute(page, route, path);
      expect(await fieldsUnder(page), `${path} at 375 px: fields under ${FIELD_PX} px`).toEqual([]);
      // and on a desktop the same fields stay on the scale (13–14 px), not blown up to 16
      await page.setViewportSize({ width: 1440, height: 900 });
      const sizes = await page.evaluate(() =>
        Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]), select, textarea'))
          .filter((el) => !el.closest('.monaco-editor') && el.getBoundingClientRect().width > 2)
          .map((el) => parseFloat(getComputedStyle(el).fontSize)),
      );
      const scale = new Set([12, 13, 14]);
      expect(sizes.filter((n) => !scale.has(n)), `${path} at 1440 px: field sizes off the scale`).toEqual([]);
    });
  }
});

/** The design-system sheet is where the shared primitives are documented (development only). */
test('the design system sheet shows PageHeader and DifficultyText in both themes', async ({ page }) => {
  const res = await page.goto('/dev/system');
  test.skip(res?.status() !== 200 || new URL(page.url()).pathname !== '/dev/system', '/dev/system is development-only (a production build does not serve it)');
  for (const theme of ['dark', 'light']) {
    const section = page.locator(`#${theme}-page`);
    await section.scrollIntoViewIfNeeded();
    // the header with actions, without them, and the title alone (samples are sub-headings, the sheet keeps its one h1)
    await expect(section.getByRole('heading', { name: 'Submissions', level: 4 })).toBeVisible();
    await expect(section.getByRole('button', { name: 'New run' })).toBeVisible();
    await expect(section.getByRole('heading', { name: 'Your badges', level: 4 })).toBeVisible();
    await expect(section.getByRole('heading', { name: 'Tier map', level: 4 })).toBeVisible();
    // difficulty as quiet text with a dot, for the three levels
    for (const level of ['Easy', 'Medium', 'Hard']) await expect(section.locator(`[data-level="${level}"]`)).toHaveText(level);
    // the height ladder is shown too
    await expect(page.locator(`#${theme}-heights`)).toBeVisible();
  }
  await expect(page.locator('h1')).toHaveCount(1);
});

test.describe('top bar', () => {
  test('on a phone every control is a 44 px target, the section menu says "Menu" everywhere, and nothing overflows at 320 px', async ({ page }) => {
    test.setTimeout(150_000);
    await signIn(page, user!.email);
    const probe = () =>
      page.evaluate(() => {
        const bar = document.querySelector('header')!;
        const controls = Array.from(bar.querySelectorAll('a[href], button'))
          .map((el) => ({ name: (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim(), r: el.getBoundingClientRect() }))
          .filter((c) => c.r.bottom > 0 && c.r.width > 0) // the skip link waits above the screen until it is focused
          .map((c) => ({ name: c.name, w: Math.round(c.r.width * 10) / 10, h: Math.round(c.r.height * 10) / 10 }));
        return {
          controls,
          overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth,
          barOverflow: bar.scrollWidth - bar.clientWidth,
        };
      });
    for (const width of [375, 320]) {
      await page.setViewportSize({ width, height: 812 });
      for (const path of ['/map', '/problems/two-sum', `/u/${user!.handle}`, '/learn']) {
        await open(page, path);
        const where = `${path} at ${width} px`;
        const bar = await probe();
        const names = bar.controls.map((c) => c.name);
        // the five controls of the bar: logo, section menu, token count, theme toggle, account
        expect(names, where).toEqual(
          expect.arrayContaining(['Codemare home', 'Menu', expect.stringMatching(/tokens?/), expect.stringMatching(/theme/), expect.stringMatching(/Account menu/)]),
        );
        const small = bar.controls.filter((c) => Math.min(c.w, c.h) < 44).map((c) => `${c.name} ${c.w}×${c.h}`);
        expect(small, `${where}: controls under 44 px`).toEqual([]);
        expect(bar.overflow, `${where}: page overflow`).toBe(0);
        expect(bar.barOverflow, `${where}: bar overflow`).toBeLessThanOrEqual(0);
        // one label, one accessible name, on every page — never the current section's name
        await expect(page.getByRole('button', { name: 'Menu', exact: true })).toHaveText('Menu');
      }
      // the widest token text still fits (the chip shortens above 9,999: "12.4k", "123k", "1.2M")
      await page.evaluate(() => {
        const chip = document.querySelector('header a[aria-label*="token"] span');
        const text = Array.from(chip?.childNodes ?? []).filter((n) => n.nodeType === 3).pop();
        if (text) text.nodeValue = '123k';
      });
      const worst = await probe();
      expect(worst.overflow, `${width} px with "123k" tokens: page overflow`).toBe(0);
      expect(worst.barOverflow, `${width} px with "123k" tokens: bar overflow`).toBeLessThanOrEqual(0);
    }

    // the open menu: every row is a 44 px target and marks the current section
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page, '/learn');
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    const rows = await page.getByRole('menuitem').evaluateAll((els) =>
      els.map((e) => ({ name: (e.textContent ?? '').trim(), h: e.getBoundingClientRect().height, current: e.getAttribute('aria-current') })),
    );
    expect(rows.map((r) => r.name)).toEqual(['Learn', 'Map', 'IDE', 'Submissions']);
    expect(rows.filter((r) => r.h < 44).map((r) => `${r.name} ${r.h}`)).toEqual([]);
    expect(rows.find((r) => r.current === 'page')?.name).toBe('Learn');

    // on a desktop the sections are tabs and there is no Menu button
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, '/learn');
    await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link')).toHaveCount(4);
    await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeHidden();
  });

  test('signed out on a phone: the sign-in button and the theme toggle are 44 px targets, the wordmark shows once, and nothing overflows at 320 px', async ({ page }) => {
    for (const width of [375, 320]) {
      await page.setViewportSize({ width, height: 812 });
      await open(page, '/signup');
      // the top bar carries the logo and its wordmark at every width; the form does not draw them a second time
      await expect(page.locator('header').getByText('codemare', { exact: true })).toBeVisible();
      await expect(page.locator('main').getByText('codemare', { exact: true })).toHaveCount(0);
      const bar = await page.evaluate(() => {
        const header = document.querySelector('header')!;
        const controls = Array.from(header.querySelectorAll('a[href], button'))
          .map((el) => ({ name: (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim(), r: el.getBoundingClientRect() }))
          .filter((c) => c.r.bottom > 0 && c.r.width > 0) // the skip link waits above the screen until it is focused
          .map((c) => ({ name: c.name, w: Math.round(c.r.width * 10) / 10, h: Math.round(c.r.height * 10) / 10 }));
        return { controls, overflow: header.scrollWidth - header.clientWidth };
      });
      expect(bar.controls.map((c) => c.name), `${width} px`).toEqual(['Codemare home', expect.stringMatching(/theme/), 'Sign in']);
      expect(bar.controls.filter((c) => Math.min(c.w, c.h) < 44).map((c) => `${c.name} ${c.w}×${c.h}`), `${width} px: controls under 44 px`).toEqual([]);
      expect(bar.overflow, `${width} px`).toBeLessThanOrEqual(0);
    }
  });
});
