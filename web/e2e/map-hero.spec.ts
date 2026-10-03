import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

/**
 * The tier map's hero, the quiet page around it and the art on its rows
 * (components/Map/*, components/TopicArt): the page features ONE thing — the
 * learner's next up, picked by lib/server/featuredTopic.ts — as animated art
 * with its name, caption, "n/m solved" and the page's one primary button,
 * whose label and target follow where the learner is (start, continue,
 * unlock, take the gate, all done). Under it, only when there is one, a single
 * milestone line (lib/server/mapMilestone.ts: a gate only once 3 of its 4
 * problems are solved); while nothing is solved, a first-run card — "How it
 * works" — that a link in the header brings back; then the tiers — an open tier
 * in full, a closed one as ONE collapsed panel that opens (and opens for a link
 * into it) to its gate and topics — with the rows the learner opened kept
 * open. Topic rows show their art as a still poster — only the hero moves —
 * and load their scenes lazily, so the page itself carries just the hero's.
 *
 * Needs the seeded content in the app's database (DATABASE_URL, else
 * web/.env.local — export it for this process when pointing at a scratch
 * database). Creates its own learners and removes them — all but two: the
 * "ready" and "nudge" learners hold tokens, and the token ledger is
 * append-only (no DELETE, and its rows keep the user), so those learners are
 * kept between runs (e2e-map-ready@test.dev, e2e-map-nudge@test.dev) and
 * topped up instead of created again.
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

type Kind = 'fresh' | 'midway' | 'ready' | 'unlocked' | 'done' | 'gate' | 'one' | 'running' | 'stuck' | 'cooling' | 'nudge' | 'solving' | 'touched';
type Learner = { id: string; email: string; password: string };
const learners = {} as Record<Kind, Learner>;

const hero = (page: Page) => page.getByTestId('map-hero');
const card = (page: Page, slug: string) => page.getByTestId(`topic-${slug}`);
const tier = (page: Page, slug: string) => page.getByTestId(`tier-${slug}`);
const cardStage = (page: Page, slug: string) => card(page, slug).locator('[data-topic]');
const heroStage = (page: Page) => hero(page).locator('[data-topic]');
const milestone = (page: Page) => page.getByTestId('map-milestone');
const firstRun = (page: Page) => page.getByTestId('first-run');
const howItWorks = (page: Page) => page.getByTestId('how-it-works-toggle');
const tokenChip = (page: Page) => page.getByRole('link', { name: /tokens? — open the tier map$/ });
const TOPIC_SLUGS = ['arrays-hashing', 'two-pointers', 'stack', 'binary-search', 'sliding-window', 'recursion', 'sorting', 'graphs', 'dynamic-programming', 'heaps-greedy'];
/** Every picture on a topic row or in a closed tier's preview (not the hero's). */
const POSTERS = '[data-testid^="topic-"] [data-topic], [data-testid^="tier-"] [data-topic]';

/** Opens a topic row's disclosure (its problems, or what blocks it). */
async function openRow(page: Page, slug: string) {
  const d = card(page, slug).locator(':scope > details');
  if ((await d.getAttribute('open')) === null) await d.locator(':scope > summary').click();
  await expect(d).toHaveAttribute('open', '');
}

/** Opens every panel and row on the page at once (to look at all of it). */
async function openEverything(page: Page) {
  await page.evaluate(() => document.querySelectorAll('details').forEach((d) => ((d as HTMLDetailsElement).open = true)));
}

async function signIn(page: Page, kind: Kind) {
  const l = learners[kind];
  // a test that visits the map as several learners in turn starts each from a signed-out browser (the theme cookie stays): leave the
  // page first, or its own background requests could write the previous learner's session cookie back over the new one
  if (page.url() !== 'about:blank') await page.goto('about:blank');
  await page.context().clearCookies({ name: /^(__Secure-)?authjs\./ });
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

/** Play states of the CSS animations inside the elements matching `selector` (the stage itself counts: its dot grid drifts). */
async function animationsIn(page: Page, selector: string): Promise<{ total: number; running: number; paused: number }> {
  return page.evaluate((sel) => {
    const roots = [...document.querySelectorAll(sel)];
    if (roots.length === 0) return { total: -1, running: 0, paused: 0 };
    // CSS animations only: the lazily loaded scene's fade-in is a transition, which getAnimations() lists too
    const all = document.getAnimations().filter((a) => {
      const t = (a.effect as KeyframeEffect | null)?.target as Element | null;
      return a instanceof CSSAnimation && t && roots.some((r) => r.contains(t));
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

/** The font sizes of the text on the page (inside <main>: the top bar belongs to the layout), with a sample of each. Text in a closed panel is not on screen and is left out. */
async function fontSizes(page: Page): Promise<{ size: number; sample: string }[]> {
  return page.evaluate(() => {
    const root = document.querySelector('main')!;
    const seen = new Map<number, string>();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.nodeValue?.trim();
      const el = n.parentElement;
      if (!text || !el || el.closest('.sr-only, svg')) continue;
      let closed = false;
      for (let e: Element | null = el; e && e !== root; e = e.parentElement) {
        const p = e.parentElement;
        if (p instanceof HTMLDetailsElement && !p.open && e.tagName !== 'SUMMARY') closed = true;
      }
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (closed || cs.display === 'none' || cs.visibility === 'hidden' || r.width < 1 || r.height < 1) continue;
      const size = parseFloat(cs.fontSize);
      if (!seen.has(size)) seen.set(size, text.slice(0, 30));
    }
    return [...seen.entries()].map(([size, sample]) => ({ size, sample })).sort((a, b) => a.size - b.size);
  });
}

test.describe.configure({ mode: 'serial' });

const READY_EMAIL = 'e2e-map-ready@test.dev';
const NUDGE_EMAIL = 'e2e-map-nudge@test.dev';
let gateId = '';
/** Published problems, and those of tier 0 that open for everyone (what "ready" and "stuck" have solved). */
let problemsTotal = 0;
let tier0Total = 0;

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
  const [midway, unlocked, done, gate, one, running, stuck, cooling, touched] = await Promise.all([
    mk('midway'), mk('unlocked'), mk('done'), mk('gate'), mk('one'), mk('running'), mk('stuck'), mk('cooling'), mk('touched'), mk('fresh'), mk('solving'),
  ]);
  // the two learners that are kept: they hold tokens (see the header), so each is found again by its email
  const keep = async (kind: 'ready' | 'nudge', email: string, handle: string, name: string) => {
    const password = `e2e-map-${kind}-pw`;
    const user = (await prisma.user.findUnique({ where: { email } })) ?? (await prisma.user.create({ data: { email, handle, name, passwordHash: await bcrypt.hash(password, 4) } }));
    learners[kind] = { id: user.id, email, password };
    return user.id;
  };
  const ready = await keep('ready', READY_EMAIL, 'e2e_map_ready', 'Map Ready E2E');
  const nudge = await keep('nudge', NUDGE_EMAIL, 'e2e_map_nudge', 'Map Nudge E2E');

  const questions = await prisma.question.findMany({
    where: { status: 'published' },
    select: { id: true, slug: true, topics: { select: { topic: { select: { slug: true, tier: { select: { ord: true } } } } } } },
  });
  const byTier0 = questions.filter((q) => q.topics.length > 0 && q.topics.every((t) => t.topic.tier.ord === 0));
  problemsTotal = questions.length;
  tier0Total = byTier0.length;
  const idOf = (slug: string) => questions.find((q) => q.slug === slug)!.id;
  const topic = (slug: string) => prisma.topic.findUniqueOrThrow({ where: { slug }, select: { id: true, tierId: true } });
  const sub = (userId: string, questionId: string, status: 'OK' | 'WA') =>
    ({ userId, kind: 'submit' as const, language: 'python' as const, code: 'pass', totalTests: 1, questionId, status, totalPassed: status === 'OK' ? 1 : 0, runtimeUs: 400n });
  const grant = (userId: string, topicId: string, amount: number, key: string) =>
    prisma.tokenLedger.create({ data: { userId, topicId, amount, sourceDifficulty: 'Easy', reason: 'admin', refType: 'admin', refId: `e2e-map-${key}-${topicId}` } });
  const theGate = await prisma.gate.findFirstOrThrow({ where: { tier: { slug: 'core-techniques' } }, select: { id: true } });
  gateId = theGate.id;

  // midway: Two Sum solved, Valid Anagram tried and failed
  await prisma.submission.createMany({ data: [sub(midway, idOf('two-sum'), 'OK'), sub(midway, idOf('valid-anagram'), 'WA')] });

  // gate: three of the Foundations Gate's four problems solved — the gate is open to them, and they are ready for it
  await prisma.submission.createMany({ data: ['contains-duplicate', 'valid-palindrome', 'valid-parentheses'].map((slug) => sub(gate, idOf(slug), 'OK')) });

  // one: a single problem of the gate solved — nothing is said about the gate yet
  await prisma.submission.createMany({ data: [sub(one, idOf('contains-duplicate'), 'OK')] });

  // touched: Two Sum solved, then a run of Reverse String (Two Pointers) — the last problem touched is in another topic than the hero's
  await prisma.submission.create({ data: { ...sub(touched, idOf('two-sum'), 'OK'), createdAt: new Date(Date.now() - 60_000) } });
  await prisma.submission.create({ data: { ...sub(touched, idOf('reverse-string'), 'WA'), kind: 'run' as const, createdAt: new Date(Date.now() - 30_000) } });

  // running: the same, and a gate attempt under way (it has its own banner, so no milestone)
  await prisma.submission.createMany({ data: [sub(running, idOf('contains-duplicate'), 'OK')] });
  await prisma.gateAttempt.create({ data: { userId: running, gateId: theGate.id, deadlineAt: new Date(Date.now() + 40 * 60_000) } });

  // stuck: every problem open in tier 0 solved, no tokens, the gate not taken: nothing left to start, and the gate is the way on
  await prisma.submission.createMany({ data: byTier0.map((q) => sub(stuck, q.id, 'OK')) });

  // cooling: the same, and the gate was tried and missed a while ago — it cools down, so it is not on offer; every recipe is short
  await prisma.submission.createMany({ data: byTier0.map((q) => sub(cooling, q.id, 'OK')) });
  const started = new Date(Date.now() - 50 * 60_000);
  await prisma.gateAttempt.create({
    data: { userId: cooling, gateId: theGate.id, startedAt: started, deadlineAt: new Date(started.getTime() + 45 * 60_000), finishedAt: new Date(started.getTime() + 45 * 60_000), passed: false, passedCount: 1, nextEligibleAt: new Date(Date.now() + 11 * 3600_000) },
  });

  // ready / nudge: tier 1 is open (the gate passed), tokens for one recipe of Binary Search, and the tier-0 problems solved — all of them
  // for "ready" (the hero offers the unlock), all but Product of Array Except Self for "nudge" (the hero still has a problem to start, so the
  // ready topic gets the milestone line)
  const bs = await topic('binary-search');
  const keepSolved = async (userId: string, key: string, skip: string[]) => {
    await prisma.unlock.upsert({ where: { userId_kind_refId: { userId, kind: 'tier', refId: bs.tierId } }, create: { userId, kind: 'tier', refId: bs.tierId }, update: {} });
    const solvedBefore = new Set((await prisma.submission.findMany({ where: { userId, status: 'OK' }, select: { questionId: true } })).map((r) => r.questionId));
    await prisma.submission.createMany({ data: byTier0.filter((q) => !skip.includes(q.slug) && !solvedBefore.has(q.id)).map((q) => sub(userId, q.id, 'OK')) });
    if ((await prisma.tokenLedger.count({ where: { userId } })) === 0) {
      await grant(userId, (await topic('arrays-hashing')).id, 2, key);
      await grant(userId, (await topic('two-pointers')).id, 1, key);
    }
  };
  await keepSolved(ready, 'ready', []);
  await keepSolved(nudge, 'nudge', ['product-of-array-except-self']);

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
  const ids = Object.entries(learners).filter(([kind]) => kind !== 'ready' && kind !== 'nudge').map(([, l]) => l.id);
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
    await openRow(page, 'arrays-hashing');
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

  test('with everything open solved and a recipe affordable, the button unlocks the topic and lands on its row', async ({ page }) => {
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

  test('once the learner has unlocked a topic the hero still follows the curriculum, and the new row is just a row', async ({ page }) => {
    await openMap(page, 'unlocked');
    await expect(hero(page)).toHaveAttribute('data-reason', 'continue');
    await expect(hero(page)).toHaveAttribute('data-topic', 'arrays-hashing');
    await expect(tokenChip(page)).toHaveText('0');
    // an unlocked topic says nothing about being unlocked — its row shows its progress
    await expect(card(page, 'binary-search')).toHaveAttribute('data-state', 'unlocked');
    await expect(card(page, 'binary-search').getByTestId('topic-state')).toHaveCount(0);
    await expect(card(page, 'binary-search').getByTestId('topic-problems')).toHaveText(/^0\/\d+ solved$/);
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

  test('with nothing left to solve and the gate within reach, the hero offers the gate — “Take the Foundations Gate” — and the button lands on its card', async ({ page }) => {
    await openMap(page, 'stuck');
    await expect(hero(page)).toHaveAttribute('data-reason', 'gate');
    await expect(hero(page)).toContainText('Ready for the gate');
    await expect(page.getByTestId('map-hero-title')).toHaveText('Foundations Gate');
    // what a gate is, in the hero's own words — and the art is the first topic it opens
    await expect(hero(page)).toContainText('A timed set of 4 problems: solve 3 in 45 minutes to open Core Techniques.');
    await expect(hero(page)).toHaveAttribute('data-topic', 'binary-search');
    await expect(hero(page).getByTestId('map-hero-progress')).toHaveCount(0);
    await expect(page.getByTestId('map-hero-cta')).toHaveText('Take the Foundations Gate');
    await expect(page.getByTestId('map-hero-cta')).toHaveAttribute('href', `#gate-${gateId}`);
    await expect(hero(page).getByRole('link')).toHaveCount(1); // one clear action

    // the card is in a closed panel: the button opens it and lands on it. Starting is still the learner's own click.
    await expect(tier(page, 'core-techniques')).not.toHaveAttribute('open', '');
    await page.getByTestId('map-hero-cta').click();
    await expect(page).toHaveURL(new RegExp(`#gate-${gateId}$`));
    await expect(tier(page, 'core-techniques')).toHaveAttribute('open', '');
    await expect(page.getByTestId('gate-core-techniques')).toBeInViewport();
    await expect(page.getByTestId('start-gate')).toBeVisible();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });

  test('a gate that is cooling down is not on offer: the hero is the topic closest to unlocking, and the gate’s card says when to retry', async ({ page }) => {
    await openMap(page, 'cooling');
    await expect(hero(page)).toHaveAttribute('data-reason', 'missing');
    await expect(page.getByTestId('map-hero-cta')).toHaveText('See what’s missing');
    await expect(milestone(page)).toHaveCount(0);
    await tier(page, 'core-techniques').locator(':scope > summary').click();
    await expect(page.getByTestId('gate-core-techniques')).toHaveAttribute('data-state', 'cooldown');
    await expect(page.getByTestId('gate-core-techniques')).toContainText('Retry in');
  });

  test('the header is the shared page header — a 26 px h1, one quiet line of progress, a link to “How it works” — and the token total is in the top bar, once', async ({ page }) => {
    await openMap(page, 'ready');
    await expect(page.getByTestId('map-progress')).toHaveText(`${tier0Total}/${problemsTotal} problems solved · 3/10 topics unlocked · 2/3 tiers open`);
    await expect(page.getByRole('list', { name: 'Your progress' })).toHaveCount(0); // the three chips are gone
    await expect(page.getByTestId('map-tokens')).toHaveCount(0); // so is the second token total
    await expect(tokenChip(page)).toHaveText('3');
    await expect(page.getByRole('main').getByText(/\btokens?\b/i).filter({ hasText: /^\d+ tokens?$/ })).toHaveCount(0); // none repeated as a headline number
    const size = await page.getByRole('heading', { level: 1 }).evaluate((h) => parseFloat(getComputedStyle(h).fontSize));
    expect(size).toBe(26);
    const line = await page.getByTestId('map-progress').evaluate((el) => ({ size: parseFloat(getComputedStyle(el).fontSize), height: el.getBoundingClientRect().height }));
    expect(line.size).toBeGreaterThanOrEqual(12);
    expect(line.height).toBeLessThan(24);
    // the line is under the title, and the link is on it
    const [title, progress, link] = [await page.locator('h1').boundingBox(), await page.getByTestId('map-progress').boundingBox(), await howItWorks(page).boundingBox()];
    expect(progress!.y).toBeGreaterThanOrEqual(title!.y + title!.height - 1);
    expect(Math.abs(link!.y - progress!.y)).toBeLessThan(24);
  });

  test('a token count reads "1 token", not "1 tokens"', async ({ page }) => {
    await openMap(page, 'ready');
    // Two Pointers holds exactly one token; Arrays & Hashing two
    await expect(card(page, 'two-pointers').getByTestId('topic-problems')).toContainText(/ · 1 token$/);
    await expect(card(page, 'arrays-hashing').getByTestId('topic-problems')).toContainText(/ · 2 tokens$/);
    expect(await page.getByRole('main').innerText()).not.toMatch(/\b1 tokens\b/);
  });
});

test.describe('the milestone line', () => {
  test('a fresh learner has none: nothing is said that the hero does not', async ({ page }) => {
    await openMap(page, 'fresh');
    await expect(milestone(page)).toHaveCount(0);
  });

  test('one problem of the gate solved is no news yet: the gate is not mentioned before 3 of its 4 problems are', async ({ page }) => {
    await openMap(page, 'one');
    await expect(milestone(page)).toHaveCount(0);
    await expect(hero(page)).toHaveAttribute('data-reason', /^(start|continue)$/);
    await expect(page.getByTestId('map-hero')).not.toContainText('Gate');
    // it is where it always was — its tier's line, and the panel under it
    await expect(tier(page, 'core-techniques')).toContainText('Opens after the Foundations Gate — a timed set of 4 problems');
  });

  test('3 of the gate’s 4 problems solved get one plain line under the hero, with the count, and its link opens the gate', async ({ page }) => {
    await openMap(page, 'gate');
    const line = milestone(page);
    await expect(line).toHaveAttribute('data-kind', 'gate');
    await expect(line).toContainText('You can take the Foundations Gate now — 3 of its 4 problems solved');
    await expect(line.getByRole('link', { name: 'Take the gate' })).toHaveAttribute('href', `#gate-${gateId}`);

    // one line, under the hero — never a second hero — and the hero is untouched: its button is still a problem
    const [lineBox, heroBox] = [await line.boundingBox(), await hero(page).boundingBox()];
    expect(lineBox!.y).toBeGreaterThanOrEqual(heroBox!.y + heroBox!.height);
    expect(lineBox!.height).toBeLessThan(64);
    await expect(hero(page)).toHaveAttribute('data-reason', /^(start|continue)$/);
    await expect(hero(page).getByRole('link')).toHaveCount(1);

    // the tier it opens is a closed panel; the link opens it and shows the gate
    await expect(tier(page, 'core-techniques')).not.toHaveAttribute('open', '');
    await line.getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`#gate-${gateId}$`));
    await expect(tier(page, 'core-techniques')).toHaveAttribute('open', '');
    await expect(page.getByTestId('gate-core-techniques')).toBeInViewport();
    await expect(page.getByTestId('start-gate')).toBeVisible();
  });

  test('a topic that is ready to unlock is named under a hero that is about a problem', async ({ page }) => {
    await openMap(page, 'nudge');
    await expect(hero(page)).toHaveAttribute('data-reason', 'start');
    await expect(page.getByTestId('map-hero-cta')).toHaveText('Start: Product of Array Except Self');
    const line = milestone(page);
    await expect(line).toHaveAttribute('data-kind', 'unlock');
    await expect(line).toContainText('Binary Search is ready to unlock');
    await line.getByRole('link', { name: 'Unlock Binary Search' }).click();
    await expect(page).toHaveURL(/\/map#topic-binary-search$/);
    await expect(card(page, 'binary-search')).toBeInViewport();
    await expect(card(page, 'binary-search').getByTestId('unlock-button')).toBeVisible();
  });

  test('it says nothing when the hero already says it, or when an attempt is running (it has its banner)', async ({ page }) => {
    await openMap(page, 'ready'); // the hero is "Ready to unlock · Binary Search"
    await expect(hero(page)).toHaveAttribute('data-reason', 'unlock');
    await expect(milestone(page)).toHaveCount(0);

    await openMap(page, 'running');
    await expect(page.getByTestId('running-attempt')).toBeVisible();
    await expect(milestone(page)).toHaveCount(0);
  });

  test('when the hero already offers the gate, the line under it does not say it again', async ({ page }) => {
    await openMap(page, 'stuck');
    await expect(hero(page)).toHaveAttribute('data-reason', 'gate');
    await expect(milestone(page)).toHaveCount(0);
  });

  test('a learner who has done it all gets none', async ({ page }) => {
    await openMap(page, 'done');
    await expect(milestone(page)).toHaveCount(0);
  });
});

test.describe('the first-run card', () => {
  test('a learner with nothing solved sees three short steps — rendered by the server — and “Got it” puts them away for good', async ({ page }) => {
    await openMap(page, 'fresh');
    const card1 = firstRun(page);
    await expect(card1).toBeVisible();
    await expect(card1.getByRole('listitem')).toHaveCount(3);
    await expect(card1.getByRole('listitem').nth(0)).toContainText('Solve problems');
    await expect(card1.getByRole('listitem').nth(1)).toContainText('Earn tokens — 1, 2 or 3 for Easy, Medium, Hard');
    await expect(card1.getByRole('listitem').nth(2)).toContainText('Spend them to unlock topics and open tiers');
    // above the tiers, under the hero
    const [cardBox, heroBox, tierBox] = [await card1.boundingBox(), await hero(page).boundingBox(), await tier(page, 'foundations').boundingBox()];
    expect(cardBox!.y).toBeGreaterThanOrEqual(heroBox!.y + heroBox!.height);
    expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(tierBox!.y);
    // the server sends it: no flash of a card that arrives (and shifts the page) after the page is up
    expect(await (await page.request.get('/map')).text()).toContain('data-testid="first-run"');

    await card1.getByRole('button', { name: 'Got it' }).click();
    await expect(card1).toHaveCount(0);
    await expect(page.getByTestId('map-hero-cta')).toBeFocused(); // focus does not fall to the page when the button leaves

    // remembered — after a reload, and in the very HTML the server sends next
    await page.reload();
    await expect(hero(page)).toBeVisible();
    await expect(firstRun(page)).toHaveCount(0);
    expect(await (await page.request.get('/map')).text()).not.toContain('data-testid="first-run"');
  });

  test('a learner who has solved a problem does not see it', async ({ page }) => {
    await openMap(page, 'midway');
    await expect(firstRun(page)).toHaveCount(0);
    expect(await (await page.request.get('/map')).text()).not.toContain('data-testid="first-run"');
  });

  test('it is gone with the first solve, whether or not it was dismissed', async ({ page }) => {
    await openMap(page, 'solving');
    await expect(firstRun(page)).toBeVisible();
    const q = await prisma.question.findUniqueOrThrow({ where: { slug: 'two-sum' }, select: { id: true } });
    await prisma.submission.create({ data: { userId: learners.solving.id, kind: 'submit', language: 'python', code: 'pass', totalTests: 1, questionId: q.id, status: 'OK', totalPassed: 1, runtimeUs: 400n } });
    await page.reload();
    await expect(hero(page)).toBeVisible();
    await expect(firstRun(page)).toHaveCount(0);
  });

  test('a learner who dismissed it on another visit is not shown it again (the cookie, set before the page loads)', async ({ page }) => {
    await signIn(page, 'fresh');
    const base = test.info().project.use.baseURL ?? 'http://localhost:4001';
    await page.context().addCookies([{ name: 'cm-first-run', value: 'hide', url: base }]);
    await page.goto('/map', { waitUntil: 'load' });
    await expect(hero(page)).toBeVisible();
    await expect(firstRun(page)).toHaveCount(0);
  });

  test('“How it works” — a link at the end of the line of progress — brings the card back after it was dismissed; a second press, or “Got it”, puts it away', async ({ page }) => {
    await signIn(page, 'fresh');
    const base = test.info().project.use.baseURL ?? 'http://localhost:4001';
    await page.context().addCookies([{ name: 'cm-first-run', value: 'hide', url: base }]);
    await page.goto('/map', { waitUntil: 'load' });
    await expect(hero(page)).toBeVisible();
    await expect(firstRun(page)).toHaveCount(0);

    const link = howItWorks(page);
    await expect(link).toHaveAttribute('aria-expanded', 'false');
    await link.click();
    await expect(firstRun(page)).toBeVisible();
    await expect(link).toHaveAttribute('aria-expanded', 'true');
    await expect(firstRun(page)).toBeFocused(); // named to a screen reader
    await expect(firstRun(page).getByRole('listitem')).toHaveCount(3);
    // in the page, in its place under the hero: no round trip, no new URL
    const [cardBox, heroBox] = [await firstRun(page).boundingBox(), await hero(page).boundingBox()];
    expect(cardBox!.y).toBeGreaterThanOrEqual(heroBox!.y + heroBox!.height);
    expect(new URL(page.url()).search).toBe('');

    await link.click(); // a second press closes it
    await expect(firstRun(page)).toHaveCount(0);
    await expect(link).toHaveAttribute('aria-expanded', 'false');

    await link.click();
    await firstRun(page).getByRole('button', { name: 'Got it' }).click();
    await expect(firstRun(page)).toHaveCount(0);
    await expect(link).toBeFocused(); // focus goes back to what brought the card
  });

  test('after the first solve the server no longer sends the card, but the link is there and brings it back', async ({ page }) => {
    await openMap(page, 'midway');
    expect(await (await page.request.get('/map')).text()).not.toContain('data-testid="first-run"');
    await expect(firstRun(page)).toHaveCount(0);
    await howItWorks(page).click();
    await expect(firstRun(page)).toBeVisible();
    await expect(firstRun(page)).toContainText('Earn tokens — 1, 2 or 3 for Easy, Medium, Hard');
    await firstRun(page).getByRole('button', { name: 'Got it' }).click();
    await expect(firstRun(page)).toHaveCount(0);
  });

  test('on a first run the card is open and the link says so; pressing it closes the card (it stays for the next visit until “Got it”)', async ({ page }) => {
    await openMap(page, 'fresh');
    await expect(howItWorks(page)).toHaveAttribute('aria-expanded', 'true');
    await howItWorks(page).click();
    await expect(firstRun(page)).toHaveCount(0);
    await page.reload();
    await expect(firstRun(page)).toBeVisible();
  });
});

test.describe('closed tiers', () => {
  test('each is one collapsed panel: its name, why it is closed, and its topics as a quiet row of names — and nothing else', async ({ page }) => {
    await openMap(page, 'fresh');
    for (const [slug, title, reason, names] of [
      ['core-techniques', 'Core Techniques', 'Opens after the Foundations Gate — a timed set of 4 problems', ['Binary Search', 'Sliding Window', 'Recursion & Backtracking', 'Sorting']],
      ['graphs-optimization', 'Graphs & Optimization', 'Opens after the Core Techniques Gate — a timed set of 4 problems', ['Graphs', 'Dynamic Programming', 'Heaps & Greedy']],
    ] as const) {
      const panel = tier(page, slug);
      expect(await panel.evaluate((el) => el.tagName)).toBe('DETAILS');
      await expect(panel).not.toHaveAttribute('open', '');
      await expect(panel.getByRole('heading', { level: 2 })).toContainText(title);
      await expect(panel.getByTestId('tier-state')).toHaveText('Locked');
      await expect(panel).toContainText(reason);
      for (const name of names) await expect(panel.locator(':scope > summary').getByText(name, { exact: true })).toBeVisible();
      // collapsed: no gate, no topic rows, no rules text
      await expect(page.getByTestId(`gate-${slug}`)).toBeHidden();
      await expect(card(page, TOPIC_SLUGS[names[0] === 'Binary Search' ? 3 : 7])).toBeHidden();
    }
    // the rules are said once, where they belong — not on every topic
    await expect(page.getByText('What’s blocking you')).toHaveCount(0);
    await expect(page.getByText(/unlock the topic to open them/)).toHaveCount(0);
  });

  test('a click, Enter or Space on the summary opens it; the panel then holds the gate in one line and compact topics', async ({ page }) => {
    await openMap(page, 'fresh');
    const panel = tier(page, 'core-techniques');
    const summary = panel.locator(':scope > summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(panel).toHaveAttribute('open', '');
    await page.keyboard.press('Space');
    await expect(panel).not.toHaveAttribute('open', '');
    await summary.click();
    await expect(panel).toHaveAttribute('open', '');

    // the gate: one line and one button, its problems not repeated as chips
    const gate = page.getByTestId('gate-core-techniques');
    await expect(gate).toBeVisible();
    await expect(gate).toHaveAttribute('data-state', 'eligible');
    await expect(gate).toContainText('Foundations Gate');
    await expect(gate).toContainText('Solve 3 of 4 in 45 min');
    await expect(gate.getByRole('button')).toHaveCount(1);
    await expect(gate.getByTestId('start-gate')).toBeVisible();
    await expect(gate).not.toContainText('Contains Duplicate');
    expect((await gate.boundingBox())!.height).toBeLessThan(64);
    // …they are in the confirmation, with the cooldown
    await gate.getByTestId('start-gate').click();
    const dialog = page.getByRole('alertdialog', { name: 'Start the Foundations Gate?' });
    await expect(dialog).toContainText('Contains Duplicate');
    await expect(dialog).toContainText('cools down for 12 hours');
    await dialog.getByRole('button', { name: 'Not yet' }).click();
    await expect(dialog).toBeHidden();

    // compact topics: a poster, a name, a line about it and how many problems — no rules, no recipes, no state label on each
    for (const slug of ['binary-search', 'sliding-window', 'recursion', 'sorting']) {
      const c = card(page, slug);
      await expect(c).toBeVisible();
      await expect(c).toHaveAttribute('data-state', 'tier_closed');
      await expect(c.getByTestId('topic-problems')).toHaveText(/^\d+ problems$/);
      await expect(c.getByTestId('topic-state')).toHaveCount(0);
      await expect(c.locator('details')).toHaveCount(0);
      await expect(c.getByTestId('recipe')).toHaveCount(0);
    }
    await expect(panel.getByText('What’s blocking you')).toHaveCount(0);
  });

  test('a link to anything inside a closed panel opens it, on load and on a click: a topic, a tier, a gate', async ({ page }) => {
    await openMap(page, 'fresh');
    await page.goto('/map#topic-sorting', { waitUntil: 'load' });
    await expect(tier(page, 'core-techniques')).toHaveAttribute('open', '');
    await expect(card(page, 'sorting')).toBeInViewport();

    await page.goto('/map#tier-graphs-optimization', { waitUntil: 'load' });
    await expect(tier(page, 'graphs-optimization')).toHaveAttribute('open', '');
    await expect(tier(page, 'graphs-optimization')).toBeInViewport();

    await page.goto(`/map#gate-${gateId}`, { waitUntil: 'load' });
    await expect(tier(page, 'core-techniques')).toHaveAttribute('open', '');
    await expect(page.getByTestId('gate-core-techniques')).toBeInViewport();

    // an in-page link: "Also needs Sorting" on a composite problem, in a row that has to be opened first
    await page.goto('/map', { waitUntil: 'load' });
    await openRow(page, 'two-pointers');
    await expect(tier(page, 'core-techniques')).not.toHaveAttribute('open', '');
    await card(page, 'two-pointers').locator('li[data-slug="three-sum"]').getByRole('link', { name: 'Sorting' }).click();
    await expect(page).toHaveURL(/#topic-sorting$/);
    await expect(tier(page, 'core-techniques')).toHaveAttribute('open', '');
    await expect(card(page, 'sorting')).toBeInViewport();

    // the old link to a topic's problems lands on its row, with the problems showing
    await page.goto('/problems?topic=two-pointers', { waitUntil: 'load' });
    await expect(page).toHaveURL(/\/map#topic-two-pointers$/);
    await expect(card(page, 'two-pointers')).toBeInViewport();
    await expect(card(page, 'two-pointers').getByRole('list', { name: 'Two Pointers problems' })).toBeVisible();
  });

  test('the hero’s “See what’s missing” opens the panel that holds the topic, and lands on it', async ({ page }) => {
    await openMap(page, 'cooling');
    const cta = page.getByTestId('map-hero-cta');
    await expect(cta).toHaveText('See what’s missing');
    const slug = (await cta.getAttribute('href'))!.replace('#topic-', '');
    await expect(card(page, slug)).toBeHidden();
    await cta.click();
    await expect(card(page, slug).locator('xpath=ancestor::details[1]')).toHaveAttribute('open', '');
    await expect(card(page, slug)).toBeInViewport();
  });

  test('an open tier is shown in full, and a topic short of tokens says so in a line and keeps its detail one click away', async ({ page }) => {
    await openMap(page, 'ready');
    const t = tier(page, 'core-techniques');
    expect(await t.evaluate((el) => el.tagName)).toBe('SECTION'); // not collapsible: it is open
    await expect(t.getByTestId('tier-state')).toHaveText('Open');
    for (const slug of ['binary-search', 'sliding-window', 'recursion', 'sorting']) await expect(card(page, slug)).toBeVisible();
    // ready to unlock: the label and the button, nothing else
    const ready = card(page, 'binary-search');
    await expect(ready.getByTestId('topic-state')).toHaveText('Ready to unlock');
    await expect(ready.getByTestId('unlock-button')).toBeVisible();
    // short of tokens: one line; what blocks it and its recipes are in the row, closed
    const short = card(page, 'sliding-window');
    await expect(short.getByTestId('topic-state')).toHaveText('Locked');
    await expect(short.getByTestId('topic-problems')).toHaveText('Needs 1 more token');
    await expect(short.getByTestId('blocker')).toBeHidden();
    await openRow(page, 'sliding-window');
    // the word "recipe" is defined where it first appears in an expanded row
    await expect(short.getByTestId('blocker')).toContainText('A recipe is one set of tokens that opens a topic.');
    await expect(short.getByTestId('blocker')).toContainText('Cheapest recipe');
    await expect(short.getByTestId('recipe').first()).toBeVisible();
  });

  test('the whole status vocabulary is three labels — Open · Ready to unlock · Locked — and the old noise is gone', async ({ page }) => {
    await openMap(page, 'ready');
    const labels = await page.locator('[data-testid="tier-state"], [data-testid="topic-state"]').allTextContents();
    expect(new Set(labels.map((l) => l.trim()))).toEqual(new Set(['Open', 'Ready to unlock', 'Locked']));
    await openEverything(page);
    const text = await page.getByRole('main').innerText();
    expect(text).not.toMatch(/\bFree\b|Always open|Tier closed|Needs tokens|Not yet|Open to you|Cooling down|In progress/);
    // no filled traffic-light difficulty pills: the rows say Easy, Medium, Hard as quiet text
    const pills = await page.getByRole('main').locator('ol[aria-label$="problems"] li').first().locator('xpath=.//span[contains(@style,"border-radius")]').count();
    expect(pills).toBe(0);
  });
});

test.describe('open rows', () => {
  const details = (page: Page, slug: string) => card(page, slug).locator(':scope > details');

  test('the topic of the problem touched last is open when the page opens, beside the hero’s own — the server says so, in its HTML', async ({ page }) => {
    await openMap(page, 'touched');
    // Valid Anagram is next, so the hero is about Arrays & Hashing; the last thing touched was a run of Reverse String, in Two Pointers
    await expect(hero(page)).toHaveAttribute('data-topic', 'arrays-hashing');
    await expect(details(page, 'arrays-hashing')).toHaveAttribute('open', '');
    await expect(details(page, 'two-pointers')).toHaveAttribute('open', '');
    await expect(details(page, 'stack')).not.toHaveAttribute('open', '');
    await expect(card(page, 'two-pointers').locator('li[data-slug="reverse-string"]')).toContainText('Attempted');

    const html = await (await page.request.get('/map')).text();
    const opensWith = (slug: string) => new RegExp(`id="topic-${slug}"[^>]*>\\s*<details[^>]*\\sopen=""`).test(html);
    expect(opensWith('two-pointers'), 'two-pointers is open in the server’s HTML').toBe(true);
    expect(opensWith('arrays-hashing')).toBe(true);
    expect(opensWith('stack')).toBe(false);
  });

  test('a learner who has touched nothing has every row closed', async ({ page }) => {
    await openMap(page, 'fresh');
    await expect(page.locator('article[data-card] > details[open]')).toHaveCount(0);
  });

  test('a row (and a closed tier’s panel) the learner opened stays open when they come back — after a problem, with the browser’s Back button', async ({ page }) => {
    await openMap(page, 'midway');
    await expect(details(page, 'stack')).not.toHaveAttribute('open', '');
    await openRow(page, 'stack');
    await tier(page, 'core-techniques').locator(':scope > summary').click();
    await expect(tier(page, 'core-techniques')).toHaveAttribute('open', '');

    await card(page, 'stack').getByRole('list', { name: 'Stack problems' }).getByRole('link').first().click();
    await expect(page).toHaveURL(/\/problems\//);
    await page.goBack();
    await expect(hero(page)).toBeVisible();
    await expect(details(page, 'stack')).toHaveAttribute('open', '');
    await expect(tier(page, 'core-techniques')).toHaveAttribute('open', '');
    // what they did not open is as the server left it
    await expect(details(page, 'two-pointers')).not.toHaveAttribute('open', '');
    await expect(tier(page, 'graphs-optimization')).not.toHaveAttribute('open', '');
    await expect(details(page, 'arrays-hashing')).toHaveAttribute('open', ''); // the hero's topic
  });

  test('a row they closed again is not opened for them, and a link to a card is not remembered as a click', async ({ page }) => {
    await openMap(page, 'midway');
    await openRow(page, 'stack');
    await details(page, 'stack').locator(':scope > summary').click(); // closed again
    await expect(details(page, 'stack')).not.toHaveAttribute('open', '');
    // a hash link opens a closed panel to show a card: that is the link's doing, not something the learner chose to keep open
    await page.goto('/map#topic-sorting', { waitUntil: 'load' });
    await expect(tier(page, 'core-techniques')).toHaveAttribute('open', '');
    await page.goto('/map', { waitUntil: 'load' });
    await expect(tier(page, 'core-techniques')).not.toHaveAttribute('open', '');

    await card(page, 'two-pointers').locator(':scope > details > summary').click();
    await card(page, 'two-pointers').getByRole('list', { name: 'Two Pointers problems' }).getByRole('link').first().click();
    await expect(page).toHaveURL(/\/problems\//);
    await page.goBack();
    await expect(hero(page)).toBeVisible();
    await expect(details(page, 'two-pointers')).toHaveAttribute('open', '');
    await expect(details(page, 'stack')).not.toHaveAttribute('open', '');
  });

  test('it is the session’s: a new tab starts from what the server opens', async ({ page, context }) => {
    await openMap(page, 'midway');
    await openRow(page, 'stack');
    const other = await context.newPage();
    await other.goto('/map', { waitUntil: 'load' });
    await expect(other.getByTestId('map-hero')).toBeVisible();
    await expect(other.getByTestId('topic-stack').locator(':scope > details')).not.toHaveAttribute('open', '');
    await other.close();
  });

  test('without storage the map works as it did: no error, rows open and close', async ({ page }) => {
    const logged: string[] = [];
    page.on('pageerror', (e) => logged.push(String(e).slice(0, 200)));
    page.on('console', (m) => {
      if (m.type() === 'error') logged.push(m.text().slice(0, 200));
    });
    await page.addInitScript(() => {
      for (const name of ['sessionStorage', 'localStorage'] as const) {
        Object.defineProperty(window, name, {
          get() {
            throw new DOMException('blocked', 'SecurityError');
          },
        });
      }
    });
    await openMap(page, 'midway');
    await openRow(page, 'stack');
    await details(page, 'stack').locator(':scope > summary').click();
    await expect(details(page, 'stack')).not.toHaveAttribute('open', '');
    expect(logged).toEqual([]);
  });
});

test.describe('the art: the hero moves, the rows are posters', () => {
  test('the hero draws the featured topic’s scene and loops; the art is decoration', async ({ page }) => {
    await openMap(page, 'midway');
    const stage = heroStage(page);
    await expect(stage).toHaveAttribute('data-topic', 'arrays-hashing');
    await expect(stage).toHaveAttribute('aria-hidden', 'true');
    await expect(stage).not.toHaveAttribute('data-motion', 'off');
    expect(await stage.locator('svg rect, svg circle, svg path').count()).toBeGreaterThan(20);
    await expect.poll(async () => (await animationsIn(page, '[data-testid="map-hero"] [data-topic]')).running).toBeGreaterThan(10);
  });

  test('every topic’s picture on the page is a still poster — in an open tier, a closed one and its preview — and nothing in them runs', async ({ page }) => {
    await openMap(page, 'unlocked');
    for (const slug of TOPIC_SLUGS) {
      for (const stage of await cardStage(page, slug).all()) await expect(stage, `${slug}: a row's poster`).toHaveAttribute('data-motion', 'off');
    }
    const previews = page.locator('[data-testid^="tier-"] > summary [data-topic]');
    expect(await previews.count()).toBe(3); // tier 2 is closed: its three topics
    for (const stage of await previews.all()) await expect(stage).toHaveAttribute('data-motion', 'off');
    // scroll through the page so every poster that can load has: still, none of them runs; the hero's loop does
    await expect(cardStage(page, 'arrays-hashing').locator('svg')).toHaveCount(1);
    await scrollMap(page, 100000);
    await expect(previews.last().locator('svg')).toHaveCount(1);
    await scrollMap(page, 0);
    expect(await animationsIn(page, POSTERS), 'no poster runs an animation').toMatchObject({ running: 0, total: 0 });
    await expect.poll(async () => (await animationsIn(page, '[data-testid="map-hero"] [data-topic]')).running).toBeGreaterThan(10);
  });

  test('the page carries only the hero’s scene: the posters are empty stages that load as they come near', async ({ page }) => {
    await openMap(page, 'unlocked');
    const html = await (await page.request.get('/map')).text();
    expect(html.match(/viewBox="0 0 320 180"/g)?.length, 'scene svgs in the page itself').toBe(1);
    // a poster slot for each of the ten topics' rows, and one for each topic in the preview of a closed tier (tier 2: three)
    expect(html.match(/data-lazy=""/g)?.length, 'lazy slots').toBe(13);

    const asked: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/topic-art/')) asked.push(new URL(r.url()).pathname.split('/').pop()!);
    });
    await page.reload({ waitUntil: 'load' });
    await expect(cardStage(page, 'arrays-hashing').locator('svg')).toHaveCount(1); // in view: loaded
    // nothing below the fold is fetched until it is near
    expect(asked, 'fetched before any scrolling').not.toContain('heaps-greedy');
    expect(asked).toContain('arrays-hashing');
    const preview = tier(page, 'graphs-optimization').locator(':scope > summary [data-topic="heaps-greedy"]');
    await scrollMap(page, 100000);
    await expect(preview.locator('svg')).toHaveCount(1);
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

  test('a locked topic’s poster is dimmed, the picture adds no name of its own, and the state is read from the label next to it', async ({ page }) => {
    await openMap(page, 'ready');
    for (const [slug, state, dimmed] of [
      ['binary-search', 'unlockable', false],
      ['sliding-window', 'needs_tokens', true],
      ['arrays-hashing', 'unlocked', false],
    ] as const) {
      const c = card(page, slug);
      await expect(c).toHaveAttribute('data-state', state);
      const thumb = c.locator('div[aria-hidden="true"][data-state]');
      await expect(thumb).toHaveAttribute('data-state', state);
      expect(await thumb.locator('[data-topic]').evaluate((el) => getComputedStyle(el).opacity !== '1'), `${slug}: dimmed`).toBe(dimmed);
      await expect(thumb.locator(':scope > span'), `${slug}: no glyph on the picture`).toHaveCount(0);
      await expect(c.getByRole('heading', { level: 3 })).toBeVisible();
    }
    expect(await card(page, 'binary-search').getByRole('img').count()).toBe(0);
  });

  test('with reduced motion the hero is a still too', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openMap(page, 'unlocked');
    await scrollMap(page, 0);
    expect((await animationsIn(page, '[data-testid="map-hero"] [data-topic]')).running).toBe(0);
    expect((await animationsIn(page, POSTERS)).running).toBe(0);
  });
});

test.describe('the type scale', () => {
  for (const kind of ['fresh', 'ready'] as const) {
    test(`nothing on the page is set below 12 px or in capitals, and it uses at most eight sizes, everything open (${kind})`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await openMap(page, kind);
      for (const width of [1440, 375]) {
        await page.setViewportSize({ width, height: 812 });
        await page.waitForTimeout(150);
        await openEverything(page);
        const sizes = await fontSizes(page);
        expect(Math.min(...sizes.map((s) => s.size)), `${kind} at ${width}: ${JSON.stringify(sizes)}`).toBeGreaterThanOrEqual(12);
        expect(sizes.length, `${kind} at ${width}: ${JSON.stringify(sizes)}`).toBeLessThanOrEqual(8);
        const upper = await page.getByRole('main').evaluate((main) => [...main.querySelectorAll('*')].filter((e) => getComputedStyle(e).textTransform === 'uppercase').length);
        expect(upper, `${kind} at ${width}: text in capitals`).toBe(0);
      }
    });
  }
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
    // the progress line wraps between its parts, into two lines at most, and the hero's button is still in the first screen
    expect((await page.getByTestId('map-progress').boundingBox())!.height).toBeLessThan(56);
  });

  test('a fresh learner’s first screen is the hero and its button, the three steps stack, and rows, panels and problems are tap-sized', async ({ page }) => {
    await openMap(page, 'fresh');
    // first screen: the hero (with its button) is complete, and the steps start under it
    expect((await page.getByTestId('map-hero-cta').boundingBox())!.y).toBeLessThan(812);
    const steps = await firstRun(page).getByRole('listitem').evaluateAll((els) => els.map((e) => ({ top: Math.round(e.getBoundingClientRect().top), left: Math.round(e.getBoundingClientRect().left) })));
    expect(steps.map((s) => s.top)).toEqual([...steps.map((s) => s.top)].sort((a, b) => a - b));
    expect(new Set(steps.map((s) => s.top)).size, 'the steps stack: one per line').toBe(3);
    expect(new Set(steps.map((s) => s.left)).size).toBe(1);
    // a row: the picture, then the name, and what it says about it under the name
    const title = await card(page, 'arrays-hashing').getByRole('heading', { level: 3 }).boundingBox();
    const meta = await card(page, 'arrays-hashing').getByTestId('topic-problems').boundingBox();
    expect(meta!.y).toBeGreaterThanOrEqual(title!.y + title!.height - 1);
    for (const slug of ['arrays-hashing', 'two-pointers', 'stack']) {
      expect((await card(page, slug).locator(':scope > details > summary').boundingBox())!.height, `${slug}: the row`).toBeGreaterThanOrEqual(44);
    }
    expect((await tier(page, 'core-techniques').locator(':scope > summary').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // a closed tier's preview is just the names on a phone: two short lines, no ragged stack of posters (and what a gate is, in one line that wraps to two)
    await expect(tier(page, 'core-techniques').locator(':scope > summary [data-topic]').first()).toBeHidden();
    expect((await tier(page, 'core-techniques').boundingBox())!.height).toBeLessThan(190);
    // problems are tap-sized
    await openRow(page, 'two-pointers');
    for (const row of await card(page, 'two-pointers').locator('ol > li:not([data-locked])').all()) expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

  test('with every panel and row open, nothing scrolls sideways', async ({ page }) => {
    for (const kind of ['fresh', 'ready'] as const) {
      await openMap(page, kind);
      await openEverything(page);
      await page.waitForTimeout(200);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), kind).toBeLessThanOrEqual(0);
      expect(await page.evaluate(() => document.querySelector('main')!.scrollWidth - document.querySelector('main')!.clientWidth), `${kind}: main`).toBeLessThanOrEqual(0);
    }
  });
});

test.describe('console', () => {
  test('the map logs no errors or warnings, no hydration mismatch, in any state (production build)', async ({ page }) => {
    const logged: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') logged.push(`${m.type()}: ${m.text().slice(0, 200)}`);
    });
    page.on('pageerror', (e) => logged.push(`pageerror: ${String(e).slice(0, 200)}`));
    for (const kind of ['fresh', 'gate', 'stuck', 'ready', 'unlocked', 'running', 'touched'] as const) {
      await openMap(page, kind);
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await openEverything(page);
    }
    await page.goto('/map#topic-sorting', { waitUntil: 'load' });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    expect(logged).toEqual([]);
  });
});

test.describe('accessibility', () => {
  for (const theme of ['dark', 'light'] as const) {
    test(`the map in each of its states has no serious axe violations, collapsed and with everything open (${theme})`, async ({ page }) => {
      test.setTimeout(150_000);
      await page.setViewportSize({ width: 1440, height: 900 });
      await setTheme(page, theme);
      for (const kind of ['fresh', 'gate', 'stuck', 'ready', 'running', 'done'] as const) {
        await openMap(page, kind);
        await page.waitForLoadState('networkidle').catch(() => undefined);
        expect(await axeViolations(page), `${kind} (${theme})`).toEqual([]);
        await openEverything(page);
        expect(await axeViolations(page), `${kind}, everything open (${theme})`).toEqual([]);
        await expect(page.locator('h1')).toHaveCount(1);
      }
    });
  }

  test('on a phone too: collapsed and with everything open, in both themes', async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 375, height: 812 });
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(page, theme);
      for (const kind of ['fresh', 'gate', 'ready'] as const) {
        await openMap(page, kind);
        await page.waitForLoadState('networkidle').catch(() => undefined);
        expect(await axeViolations(page), `${kind} at 375 px (${theme})`).toEqual([]);
        await openEverything(page);
        expect(await axeViolations(page), `${kind} at 375 px, everything open (${theme})`).toEqual([]);
      }
    }
  });

  test('keyboard: the hero’s button comes first, a hash button moves to the row, the summaries are tab stops and Enter opens them', async ({ page }) => {
    await openMap(page, 'ready');
    await page.getByTestId('map-hero-cta').focus();
    await expect(page.getByTestId('map-hero-cta')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#topic-binary-search$/);
    await expect(card(page, 'binary-search')).toBeInViewport();

    const row = card(page, 'sliding-window').locator(':scope > details > summary');
    await row.focus();
    await expect(row).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(card(page, 'sliding-window').locator(':scope > details')).toHaveAttribute('open', '');
    await expect(card(page, 'sliding-window').getByTestId('blocker')).toBeVisible();
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
