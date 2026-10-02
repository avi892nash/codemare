import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

/**
 * The tier map's hero and the art on its cards (components/Map/MapHero.tsx,
 * TopicThumb.tsx, components/TopicArt): the page features ONE topic — the
 * learner's next up, picked by lib/server/featuredTopic.ts — as animated art
 * with its name, caption, "n/m solved" and the page's one primary button,
 * whose label and target follow where the learner is (start, continue,
 * unlock, all done). Cards show their topic's art as a thumbnail that
 * animates only for an unlocked topic, only while it is on screen, and is a
 * dimmed still poster otherwise; the scenes load lazily, so the page itself
 * carries just the hero's.
 *
 * Needs the seeded content in the app's database (DATABASE_URL, else
 * web/.env.local — export it for this process when pointing at a scratch
 * database). Creates its own learners and removes them — all but one: the
 * "ready" learner holds tokens, and the token ledger is append-only (no
 * DELETE, and its rows keep the user), so that learner is kept between runs
 * (e2e-map-ready@test.dev) and topped up instead of created again.
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

const AXE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js';
const prisma = new PrismaClient({ datasourceUrl: envValue('DATABASE_URL') });

type Kind = 'fresh' | 'midway' | 'ready' | 'unlocked' | 'done';
type Learner = { id: string; email: string; password: string };
const learners = {} as Record<Kind, Learner>;

const hero = (page: Page) => page.getByTestId('map-hero');
const card = (page: Page, slug: string) => page.getByTestId(`topic-${slug}`);
const cardStage = (page: Page, slug: string) => card(page, slug).locator('[data-topic]');
const heroStage = (page: Page) => hero(page).locator('[data-topic]');

async function signIn(page: Page, kind: Kind) {
  const l = learners[kind];
  const ip = `10.${[0, 0, 0].map(() => Math.floor(Math.random() * 250) + 1).join('.')}`;
  const { csrfToken } = await (await page.request.get('/api/auth/csrf')).json();
  await page.request.post('/api/auth/callback/credentials', {
    form: { email: l.email, password: l.password, csrfToken, callbackUrl: '/' },
    headers: { 'x-forwarded-for': ip },
    maxRedirects: 0,
  });
  const session = await (await page.request.get('/api/auth/session')).json();
  expect(session?.user?.email).toBe(l.email);
}

async function openMap(page: Page, kind: Kind) {
  await signIn(page, kind);
  await page.goto('/map', { waitUntil: 'load' });
  await expect(hero(page)).toBeVisible();
}

async function setTheme(page: Page, theme: 'dark' | 'light') {
  const base = test.info().project.use.baseURL ?? 'http://localhost:4001';
  await page.context().addCookies([{ name: 'cm-theme', value: theme, url: base }]);
}

/** Play states of the CSS animations inside the first element matching `selector` (the stage itself counts: its dot grid drifts). */
async function animationsIn(page: Page, selector: string): Promise<{ total: number; running: number; paused: number }> {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return { total: -1, running: 0, paused: 0 };
    // CSS animations only: the lazily loaded scene's fade-in is a transition, which getAnimations() lists too
    const all = document.getAnimations().filter((a) => {
      const t = (a.effect as KeyframeEffect | null)?.target as Element | null;
      return a instanceof CSSAnimation && t && root.contains(t);
    });
    return { total: all.length, running: all.filter((a) => a.playState === 'running').length, paused: all.filter((a) => a.playState === 'paused').length };
  }, selector);
}

/** Scroll the map's own scroller (the page's <main>) to a vertical position. */
async function scrollMap(page: Page, y: number) {
  await page.evaluate((top) => document.querySelector('main')!.scrollTo(0, top), y);
}

async function axeViolations(page: Page) {
  await page.addScriptTag({ url: AXE_URL });
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: { id: string; impact?: string | null; help: string; nodes: { target: string[] }[] }[] }> } }).axe;
    const result = await axe.run(document, { exclude: [['nextjs-portal']], resultTypes: ['violations'] });
    return result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => ({ id: v.id, help: v.help, targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }));
  });
}

test.describe.configure({ mode: 'serial' });

const READY_EMAIL = 'e2e-map-ready@test.dev';

test.beforeAll(async () => {
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const mk = async (kind: Kind) => {
    const password = `pw-${kind}-${run}-secret`;
    const u = await prisma.user.create({
      data: { email: `e2e-mh-${kind}-${run}@test.dev`, handle: `e2e_mh_${kind}_${run}`.slice(0, 24), name: 'Map Hero E2E', passwordHash: await bcrypt.hash(password, 4) },
    });
    learners[kind] = { id: u.id, email: u.email, password };
    return u.id;
  };
  const [midway, unlocked, done] = await Promise.all([mk('midway'), mk('unlocked'), mk('done'), mk('fresh')]);
  // the one learner that is kept: it holds tokens (see the header), so it is found again by its email
  const readyPassword = 'e2e-map-ready-pw';
  const readyUser =
    (await prisma.user.findUnique({ where: { email: READY_EMAIL } })) ??
    (await prisma.user.create({ data: { email: READY_EMAIL, handle: 'e2e_map_ready', name: 'Map Ready E2E', passwordHash: await bcrypt.hash(readyPassword, 4) } }));
  learners.ready = { id: readyUser.id, email: READY_EMAIL, password: readyPassword };
  const ready = readyUser.id;

  const questions = await prisma.question.findMany({
    where: { status: 'published' },
    select: { id: true, slug: true, topics: { select: { topic: { select: { slug: true, tier: { select: { ord: true } } } } } } },
  });
  const byTier0 = questions.filter((q) => q.topics.length > 0 && q.topics.every((t) => t.topic.tier.ord === 0));
  const idOf = (slug: string) => questions.find((q) => q.slug === slug)!.id;
  const topic = (slug: string) => prisma.topic.findUniqueOrThrow({ where: { slug }, select: { id: true, tierId: true } });
  const sub = (userId: string, questionId: string, status: 'OK' | 'WA') =>
    ({ userId, kind: 'submit' as const, language: 'python' as const, code: 'pass', totalTests: 1, questionId, status, totalPassed: status === 'OK' ? 1 : 0, runtimeUs: 400n });
  const grant = (userId: string, topicId: string, amount: number) =>
    prisma.tokenLedger.create({ data: { userId, topicId, amount, sourceDifficulty: 'Easy', reason: 'admin', refType: 'admin', refId: `e2e-map-ready-${topicId}` } });

  // midway: Two Sum solved, Valid Anagram tried and failed
  await prisma.submission.createMany({ data: [sub(midway, idOf('two-sum'), 'OK'), sub(midway, idOf('valid-anagram'), 'WA')] });

  // ready: every problem open in tier 0 solved, the Foundations gate passed (tier 1 open) and tokens for one recipe of Binary Search
  const bs = await topic('binary-search');
  await prisma.unlock.upsert({ where: { userId_kind_refId: { userId: ready, kind: 'tier', refId: bs.tierId } }, create: { userId: ready, kind: 'tier', refId: bs.tierId }, update: {} });
  const solvedBefore = new Set((await prisma.submission.findMany({ where: { userId: ready, status: 'OK' }, select: { questionId: true } })).map((r) => r.questionId));
  await prisma.submission.createMany({ data: byTier0.filter((q) => !solvedBefore.has(q.id)).map((q) => sub(ready, q.id, 'OK')) });
  if ((await prisma.tokenLedger.count({ where: { userId: ready } })) === 0) {
    await grant(ready, (await topic('arrays-hashing')).id, 2);
    await grant(ready, (await topic('two-pointers')).id, 1);
  }

  // unlocked: tier 1 open and Binary Search unlocked, one tier-0 problem solved and one tried
  const recipe = await prisma.unlockRecipe.findFirstOrThrow({ where: { topicId: bs.id }, orderBy: { ord: 'asc' } });
  await prisma.unlock.create({ data: { userId: unlocked, kind: 'tier', refId: bs.tierId } });
  await prisma.unlock.create({ data: { userId: unlocked, kind: 'topic', refId: bs.id, viaRecipeId: recipe.id } });
  await prisma.submission.createMany({ data: [sub(unlocked, idOf('two-sum'), 'OK'), sub(unlocked, idOf('valid-anagram'), 'WA')] });

  // done: every tier and topic open, every published problem solved
  const tiers = await prisma.tier.findMany({ where: { ord: { gt: 0 } }, select: { id: true } });
  const topics = await prisma.topic.findMany({ where: { tier: { ord: { gt: 0 } } }, select: { id: true } });
  await prisma.unlock.createMany({ data: tiers.map((t) => ({ userId: done, kind: 'tier' as const, refId: t.id })) });
  await prisma.unlock.createMany({ data: topics.map((t) => ({ userId: done, kind: 'topic' as const, refId: t.id })) });
  await prisma.submission.createMany({ data: questions.map((q) => sub(done, q.id, 'OK')) });
});

test.afterAll(async () => {
  const ids = Object.entries(learners).filter(([kind]) => kind !== 'ready').map(([, l]) => l.id);
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

test.describe('the hero features the learner’s next topic', () => {
  test('a fresh learner starts the first problem of the first topic, and the button opens it', async ({ page }) => {
    await openMap(page, 'fresh');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tier map');
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(hero(page)).toHaveAttribute('data-reason', 'start');
    await expect(hero(page)).toHaveAttribute('data-topic', 'arrays-hashing');
    await expect(page.getByTestId('map-hero-title')).toHaveText('Arrays & Hashing');
    await expect(hero(page)).toContainText('Skip the search — jump to the bucket');
    await expect(hero(page).getByTestId('map-hero-progress')).toContainText(/^0\/\d+ solved$/);

    // the button is the first problem of that topic's list, in curriculum order
    const first = card(page, 'arrays-hashing').getByRole('list', { name: 'Arrays & Hashing problems' }).getByRole('link').first();
    const firstTitle = (await first.innerText()).split('\n')[0].trim();
    const cta = page.getByTestId('map-hero-cta');
    await expect(cta).toHaveText(`Start: ${firstTitle}`);
    await expect(cta).toHaveAttribute('href', (await first.getAttribute('href'))!);
    await cta.click();
    await expect(page).toHaveURL(/\/problems\/[a-z0-9-]+$/);
    await expect(page.getByTestId('problem-statement')).toBeVisible();
  });

  test('a learner who tried a problem is sent back to it, with their progress on the bar', async ({ page }) => {
    await openMap(page, 'midway');
    await expect(hero(page)).toHaveAttribute('data-reason', 'continue');
    await expect(hero(page)).toHaveAttribute('data-topic', 'arrays-hashing');
    await expect(page.getByTestId('map-hero-cta')).toHaveText('Continue: Valid Anagram');
    await expect(page.getByTestId('map-hero-cta')).toHaveAttribute('href', '/problems/valid-anagram');
    await expect(hero(page).getByTestId('map-hero-progress')).toContainText(/^1\/\d+ solved$/);
    await expect(hero(page).getByRole('link')).toHaveCount(1); // one clear action
  });

  test('with everything open solved and a recipe affordable, the button unlocks the topic and lands on its card', async ({ page }) => {
    await openMap(page, 'ready');
    await expect(hero(page)).toHaveAttribute('data-reason', 'unlock');
    await expect(hero(page)).toHaveAttribute('data-topic', 'binary-search');
    await expect(page.getByTestId('map-hero-title')).toHaveText('Binary Search');
    await expect(page.getByTestId('map-hero-cta')).toHaveText('Unlock Binary Search');
    await expect(card(page, 'binary-search').getByTestId('topic-state')).toHaveText('Ready to unlock');
    await page.getByTestId('map-hero-cta').click();
    await expect(page).toHaveURL(/\/map#topic-binary-search$/);
    await expect(card(page, 'binary-search')).toBeInViewport();
    await expect(card(page, 'binary-search').getByTestId('unlock-button')).toBeVisible();
  });

  test('once the learner has unlocked a topic the hero still follows the curriculum, and the new card plays', async ({ page }) => {
    await openMap(page, 'unlocked');
    await expect(hero(page)).toHaveAttribute('data-reason', 'continue');
    await expect(hero(page)).toHaveAttribute('data-topic', 'arrays-hashing');
    await expect(page.getByTestId('map-tokens')).toHaveText('0');
    await expect(card(page, 'binary-search').getByTestId('topic-state')).toHaveText('Unlocked');
  });

  test('when every topic is open and every problem solved it congratulates, on the last topic’s art', async ({ page }) => {
    await openMap(page, 'done');
    await expect(hero(page)).toHaveAttribute('data-reason', 'done');
    await expect(hero(page)).toHaveAttribute('data-topic', 'heaps-greedy');
    await expect(page.getByTestId('map-hero-title')).toHaveText('Every topic cleared');
    await expect(hero(page).getByTestId('map-hero-progress')).toHaveCount(0);
    await expect(page.getByTestId('map-hero-cta')).toHaveText('See your submissions');
    await page.getByTestId('map-hero-cta').click();
    await expect(page).toHaveURL(/\/submissions$/);
  });

  test('the totals are compact chips, one h1 stays small, and the totals keep their test id', async ({ page }) => {
    await openMap(page, 'ready');
    const chips = page.getByRole('list', { name: 'Your progress' }).getByRole('listitem');
    await expect(chips).toHaveCount(3);
    await expect(chips.nth(0)).toHaveText('3 tokens');
    await expect(chips.nth(1)).toHaveText(/^\d+\/10 topics unlocked$/);
    await expect(chips.nth(2)).toHaveText('2/3 tiers open');
    await expect(page.getByTestId('map-tokens')).toHaveText('3');
    const size = await page.getByRole('heading', { level: 1 }).evaluate((h) => parseFloat(getComputedStyle(h).fontSize));
    expect(size).toBeLessThanOrEqual(13);
    const chipHeight = await chips.first().evaluate((el) => el.getBoundingClientRect().height);
    expect(chipHeight).toBeLessThan(34);
  });
});

test.describe('the hero art and the card thumbnails', () => {
  test('the hero draws the featured topic’s scene and loops; the art is decoration', async ({ page }) => {
    await openMap(page, 'midway');
    const stage = heroStage(page);
    await expect(stage).toHaveAttribute('data-topic', 'arrays-hashing');
    await expect(stage).toHaveAttribute('aria-hidden', 'true');
    await expect(stage).not.toHaveAttribute('data-motion', 'off');
    expect(await stage.locator('svg rect, svg circle, svg path').count()).toBeGreaterThan(20);
    await expect.poll(async () => (await animationsIn(page, '[data-testid="map-hero"] [data-topic]')).running).toBeGreaterThan(10);
  });

  test('the page carries only the hero’s scene: the thumbnails are empty stages that load as they come near', async ({ page }) => {
    await openMap(page, 'unlocked');
    const html = await (await page.request.get('/map')).text();
    expect(html.match(/viewBox="0 0 320 180"/g)?.length, 'scene svgs in the page itself').toBe(1);
    expect(html.match(/data-lazy=""/g)?.length, 'lazy slots (one per topic card)').toBe(10);

    const asked: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/topic-art/')) asked.push(new URL(r.url()).pathname.split('/').pop()!);
    });
    await page.reload({ waitUntil: 'load' });
    await expect(cardStage(page, 'arrays-hashing').locator('svg')).toHaveCount(1); // in view: loaded
    // nothing below the fold is fetched until it is near
    expect(asked, 'fetched before any scrolling').not.toContain('heaps-greedy');
    expect(asked).toContain('arrays-hashing');
    await scrollMap(page, 100000);
    await expect(cardStage(page, 'heaps-greedy').locator('svg')).toHaveCount(1);
    await scrollMap(page, 0);
    await page.waitForTimeout(300);
    expect(asked.filter((a) => a === 'arrays-hashing'), 'each scene is fetched once').toHaveLength(1);

    // a route handler's response is not compressed by the server, so the handler does it: a scene is a fraction of its size on the wire
    const sizes = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .filter((e) => e.name.includes('/api/topic-art/'))
        .map((e) => ({ wire: (e as PerformanceResourceTiming).encodedBodySize, size: (e as PerformanceResourceTiming).decodedBodySize })),
    );
    expect(sizes.length).toBeGreaterThan(3);
    for (const { wire, size } of sizes) {
      expect(size).toBeGreaterThan(2000);
      expect(wire).toBeGreaterThan(0);
      expect(wire).toBeLessThan(size / 3);
    }
  });

  test('an unlocked card plays while it is on screen and pauses when it is far off; a locked one is a still poster', async ({ page }) => {
    await openMap(page, 'unlocked');
    const playing = '[data-testid="topic-binary-search"] [data-topic]';
    const locked = '[data-testid="topic-sliding-window"] [data-topic]';
    await card(page, 'binary-search').scrollIntoViewIfNeeded();
    await expect(cardStage(page, 'binary-search').locator('svg')).toHaveCount(1);
    await expect(cardStage(page, 'binary-search')).not.toHaveAttribute('data-motion', 'off');
    await expect.poll(async () => (await animationsIn(page, playing)).running, { message: 'the unlocked card in view runs its loop' }).toBeGreaterThan(10);

    await card(page, 'sliding-window').scrollIntoViewIfNeeded();
    await expect(cardStage(page, 'sliding-window').locator('svg')).toHaveCount(1);
    await expect(cardStage(page, 'sliding-window')).toHaveAttribute('data-motion', 'off');
    expect(await animationsIn(page, locked), 'a locked card is a poster: nothing runs').toMatchObject({ running: 0, total: 0 });
    await expect(card(page, 'sliding-window').getByTestId('topic-state')).toHaveText('Needs tokens');

    // far from the viewport the unlocked card holds its loop; back in view it plays on
    await scrollMap(page, 0);
    await expect.poll(async () => (await animationsIn(page, playing)).running, { message: 'held once far off screen' }).toBe(0);
    expect((await animationsIn(page, playing)).paused).toBeGreaterThan(10);
    await card(page, 'binary-search').scrollIntoViewIfNeeded();
    await expect.poll(async () => (await animationsIn(page, playing)).running).toBeGreaterThan(10);
  });

  test('the state still reads on a poster: a lock, an open lock when it is ready, and the status pill for the name', async ({ page }) => {
    await openMap(page, 'ready');
    for (const [slug, state, glyph] of [
      ['binary-search', 'unlockable', true],
      ['sliding-window', 'needs_tokens', true],
      ['graphs', 'tier_closed', true],
      ['arrays-hashing', 'unlocked', false],
    ] as const) {
      const c = card(page, slug);
      await expect(c).toHaveAttribute('data-state', state);
      const thumb = c.locator('div[aria-hidden="true"][data-state]');
      await expect(thumb).toHaveAttribute('data-state', state);
      await expect(thumb.locator(':scope > span'), `${slug}: the glyph`).toHaveCount(glyph ? 1 : 0);
      await expect(c.getByRole('heading', { level: 3 })).toBeVisible();
      await expect(c.getByTestId('topic-state')).toBeVisible();
    }
    // the picture adds no name of its own: the heading and the pill are what a screen reader gets
    expect(await card(page, 'binary-search').getByRole('img').count()).toBe(0);
  });

  test('with reduced motion the hero and the cards are stills', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openMap(page, 'unlocked');
    await card(page, 'binary-search').scrollIntoViewIfNeeded();
    await expect(cardStage(page, 'binary-search').locator('svg')).toHaveCount(1);
    await scrollMap(page, 0);
    expect((await animationsIn(page, '[data-testid="map-hero"] [data-topic]')).running).toBe(0);
    expect((await animationsIn(page, '[data-testid="topic-binary-search"] [data-topic]')).running).toBe(0);
  });
});

test.describe('the scenes’ route', () => {
  test('serves each scene as an immutable svg and nothing else, to signed-in learners only', async ({ page, playwright, baseURL }) => {
    await signIn(page, 'fresh');
    const ok = await page.request.get('/api/topic-art/stack?v=abc');
    expect(ok.status()).toBe(200);
    expect(ok.headers()['content-type']).toContain('text/plain');
    expect(ok.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(ok.headers()['vary']).toContain('Accept-Encoding');
    expect(await ok.text()).toMatch(/^<svg class='[^']+' viewBox='0 0 320 180'/);
    expect((await page.request.get('/api/topic-art/fallback')).status()).toBe(200);
    expect((await page.request.get('/api/topic-art/not-a-topic')).status()).toBe(404);

    const anonymous = await playwright.request.newContext({ baseURL });
    expect((await anonymous.get('/api/topic-art/stack')).status()).toBe(401);
    await anonymous.dispose();
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test('the art stacks above the text, the button is full width and at least 44 px tall, and nothing scrolls sideways', async ({ page }) => {
    await openMap(page, 'midway');
    const art = await hero(page).locator('[data-topic]').boundingBox();
    const heading = await page.getByTestId('map-hero-title').boundingBox();
    const cta = await page.getByTestId('map-hero-cta').boundingBox();
    const banner = await hero(page).boundingBox();
    expect(art!.y + art!.height, 'the art ends before the title starts').toBeLessThanOrEqual(heading!.y);
    expect(cta!.height).toBeGreaterThanOrEqual(44);
    expect(cta!.width).toBeGreaterThan(banner!.width - 40);
    expect(cta!.y + cta!.height, 'the button is in the first screen').toBeLessThanOrEqual(812);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

    const chips = await page.getByRole('list', { name: 'Your progress' }).getByRole('listitem').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(chips).size, 'the three chips share one line').toBe(1);
  });
});

test.describe('accessibility', () => {
  for (const theme of ['dark', 'light'] as const) {
    test(`the hero in each of its states has no serious axe violations (${theme})`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width: 1440, height: 900 });
      await setTheme(page, theme);
      for (const kind of ['fresh', 'ready', 'done'] as const) {
        await openMap(page, kind);
        await page.waitForLoadState('networkidle').catch(() => undefined);
        expect(await axeViolations(page), `${kind} (${theme})`).toEqual([]);
        await expect(page.locator('h1')).toHaveCount(1);
      }
    });
  }

  test('keyboard: the button is the first thing the hero offers, and a hash button moves focus to the card', async ({ page }) => {
    await openMap(page, 'ready');
    await page.getByTestId('map-hero-cta').focus();
    await expect(page.getByTestId('map-hero-cta')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#topic-binary-search$/);
    await expect(card(page, 'binary-search')).toBeInViewport();
  });
});
