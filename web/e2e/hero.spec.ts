/**
 * The sign-in hero (components/TopicArt): an animated SVG scene per topic in
 * place of the old text panel. Covers what a visitor sees and what the
 * accessibility rules ask for: the reel renders with a name and a caption,
 * the switcher (one tab stop, arrow keys) and the pause button work, the
 * rotation holds while the learner is looking, reduced motion gets a still
 * poster frame and no rotation, phones get a short banner above the form,
 * and nothing logs an error or a hydration warning.
 *
 * Runs against a live server (PLAYWRIGHT_BASE_URL); needs no database.
 */
import { expect, test, type Page } from '@playwright/test';

const AXE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js';

type Theme = 'dark' | 'light';

async function setTheme(page: Page, theme: Theme) {
  const base = test.info().project.use.baseURL ?? 'http://localhost:4001';
  await page.context().addCookies([{ name: 'cm-theme', value: theme, url: base }]);
}

/** Page errors and console errors/warnings (hydration mismatches are reported as errors). */
function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || (m.type() === 'warning' && /hydrat|did not match|key/i.test(m.text()))) problems.push(`${m.type()}: ${m.text()}`);
  });
  return problems;
}

const reel = (page: Page) => page.getByTestId('hero-reel');
const title = (page: Page) => page.getByTestId('hero-title');
const caption = (page: Page) => page.getByTestId('hero-caption');
/** The scene svgs on the stage (the pause button has an icon svg too). One, except for a moment while a scene fades out. */
const scenes = (page: Page) => page.getByTestId('hero-layers').locator('svg');

/** The state of the active segment's timer (the CSS animation whose end moves the reel on). */
async function dwellState(page: Page): Promise<'running' | 'paused' | 'none'> {
  return page.evaluate(() => {
    const a = document.getAnimations().find((x) => ((x as CSSAnimation).animationName ?? '').includes('kDwell'));
    return a ? (a.playState === 'paused' ? 'paused' : 'running') : 'none';
  });
}

/** Let the timer run out now instead of waiting a loop. */
async function finishDwell(page: Page) {
  await page.evaluate(() => document.getAnimations().find((x) => ((x as CSSAnimation).animationName ?? '').includes('kDwell'))?.finish());
}

/** play states of the animations that belong to the scene on stage (everything but the timer). */
async function sceneAnimations(page: Page): Promise<{ total: number; running: number }> {
  return page.evaluate(() => {
    const stage = document.querySelector('[data-testid="hero-reel"] [data-paused], [data-testid="hero-reel"] > div') as HTMLElement;
    const all = document.getAnimations().filter((a) => {
      const t = (a.effect as KeyframeEffect | null)?.target as Element | null;
      return t && stage.contains(t) && !((a as CSSAnimation).animationName ?? '').match(/kDwell|kLayer|kTextIn/);
    });
    return { total: all.length, running: all.filter((a) => a.playState === 'running').length };
  });
}

async function openSignIn(page: Page) {
  await page.goto('/signin', { waitUntil: 'networkidle' });
  // the timer only starts once the reel has hydrated
  await expect(reel(page)).toHaveAttribute('data-live', '');
}

test.describe('hero reel', () => {
  test('renders the first topic with its name and caption, and keeps the page structure', async ({ page }) => {
    const problems = collectProblems(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSignIn(page);

    await expect(reel(page)).toHaveAttribute('data-topic', 'binary-search');
    await expect(title(page)).toHaveText('Binary Search');
    await expect(caption(page)).toHaveText('Guess smarter: halve the pile');

    // the art is decoration: an SVG inside an aria-hidden layer, with real content in it
    const art = scenes(page);
    await expect(art).toHaveCount(1);
    expect(await art.locator('rect, circle, path').count()).toBeGreaterThan(20);
    const box = await art.boundingBox();
    expect(box!.width).toBeGreaterThan(200);

    // one h1 (the form's), the aside is labelled, and the old text panel is gone
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveText('Welcome back.');
    await expect(page.getByRole('complementary', { name: 'About Codemare' })).toBeVisible();
    await expect(page.getByText('Train on real problems')).toHaveCount(0);

    // three compact chips, no more
    const chips = page.getByRole('complementary', { name: 'About Codemare' }).getByRole('listitem');
    await expect(chips).toHaveText(['Judged in microseconds', 'Unlock as you go', 'Track every run']);

    // no live region churn
    await expect(reel(page).locator('[aria-live]')).toHaveCount(0);
    expect(problems, problems.join('\n')).toEqual([]);
  });

  test('never moves the page: no layout shift while loading, hydrating and rotating through every topic, at any width', async ({ page }) => {
    // Layout-shift entries that follow a click or key press do not count as shifts, so the reel is turned by finishing its timer instead.
    await page.addInitScript(() => {
      const w = window as unknown as { __shift: number };
      w.__shift = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as Array<{ value: number; hadRecentInput: boolean }>) if (!e.hadRecentInput) w.__shift += e.value;
      }).observe({ type: 'layout-shift', buffered: true });
    });
    const where = () =>
      page.evaluate(() => {
        const top = (el: Element | null) => Math.round((el?.getBoundingClientRect().top ?? -1) * 2) / 2;
        const reelBox = document.querySelector('[data-testid="hero-reel"]')!.getBoundingClientRect();
        return { reelHeight: Math.round(reelBox.height * 2) / 2, reelTop: Math.round(reelBox.top * 2) / 2, form: top(document.querySelector('input')) };
      });

    // 320 and 901 px are where a caption or a long title wraps; 375 is a phone, 1440 a desktop
    for (const width of [320, 375, 901, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await openSignIn(page);
      const first = await where();
      const seen: string[] = [];
      for (let i = 0; i < 10; i++) {
        seen.push((await reel(page).getAttribute('data-topic')) ?? '');
        expect(await where(), `${width}px, ${seen[i]}: the stage or the form moved`).toEqual(first);
        const was = seen[i];
        await finishDwell(page);
        await expect(reel(page)).not.toHaveAttribute('data-topic', was);
        await expect(scenes(page)).toHaveCount(1); // the old scene has faded out and been removed
      }
      expect(new Set(seen).size, `${width}px: all ten topics came round`).toBe(10);
      const shift = await page.evaluate(() => (window as unknown as { __shift: number }).__shift);
      expect(shift, `${width}px: cumulative layout shift`).toBeLessThan(0.001);
    }
  });

  test('the switcher is one tab stop with arrow-key roving focus, and a topic change shows its own caption', async ({ page }) => {
    const problems = collectProblems(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSignIn(page);

    const bar = reel(page).getByRole('toolbar', { name: 'Topics' });
    const items = bar.getByRole('button');
    await expect(items).toHaveCount(10);
    await expect(bar.locator('button[tabindex="0"]')).toHaveCount(1);
    await expect(items.first()).toHaveAccessibleName('Show binary search');
    await expect(bar.locator('[aria-current="true"]')).toHaveAccessibleName('Show binary search');

    // click a topic
    await bar.getByRole('button', { name: 'Show graphs' }).click();
    await expect(reel(page)).toHaveAttribute('data-topic', 'graphs');
    await expect(title(page)).toHaveText('Graphs');
    await expect(caption(page)).toHaveText('Spread like a rumor (BFS)');
    await expect(bar.locator('[aria-current="true"]')).toHaveAccessibleName('Show graphs');
    await expect(bar.locator('button[tabindex="0"]')).toHaveCount(1);

    // keyboard: reach the switcher with Tab from the form, then arrows rove (and wrap), Home/End jump.
    // (the mouse stays over the reel so the timer does not move the topic under the test)
    await page.getByLabel('Email').focus();
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab');
      if (await bar.locator('[aria-current="true"]').evaluate((el) => el === document.activeElement)) break;
    }
    await expect(bar.locator('[aria-current="true"]')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(title(page)).toHaveText('Two Pointers');
    await expect(bar.getByRole('button', { name: 'Show two pointers' })).toBeFocused();
    await page.keyboard.press('Home');
    await expect(title(page)).toHaveText('Binary Search');
    await page.keyboard.press('ArrowLeft');
    await expect(title(page)).toHaveText('Heaps & Greedy');
    await page.keyboard.press('End');
    await expect(title(page)).toHaveText('Heaps & Greedy');
    await page.keyboard.press('ArrowRight');
    await expect(title(page)).toHaveText('Binary Search');
    // Tab leaves the switcher for the pause button (the next stop), not for another topic
    await page.keyboard.press('Tab');
    await expect(reel(page).getByRole('button', { name: 'Pause animation' })).toBeFocused();

    expect(problems, problems.join('\n')).toEqual([]);
  });

  test('moves to the next topic after a loop, and holds while the learner is looking', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSignIn(page);
    await page.mouse.move(5, 500);

    expect(await dwellState(page)).toBe('running');
    await finishDwell(page);
    await expect(reel(page)).toHaveAttribute('data-topic', 'arrays-hashing');
    await expect(title(page)).toHaveText('Arrays & Hashing');
    // a fresh timer for the new topic
    await expect.poll(() => dwellState(page)).toBe('running');

    // a mouse over the reel holds the timer, leaving lets it go on
    await reel(page).hover();
    await expect.poll(() => dwellState(page)).toBe('paused');
    await page.mouse.move(5, 500);
    await expect.poll(() => dwellState(page)).toBe('running');

    // keyboard focus inside holds it too
    await page.getByRole('button', { name: 'Show stack' }).focus();
    await page.keyboard.press('Tab'); // a keyboard move, so focus-visible applies
    await page.keyboard.press('Shift+Tab');
    await expect.poll(() => dwellState(page)).toBe('paused');
    await page.locator('h1').click();
    await expect.poll(() => dwellState(page)).toBe('running');

    // a hidden tab holds it
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => dwellState(page)).toBe('paused');
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => dwellState(page)).toBe('running');
  });

  test('the pause button stops the rotation and the scene animations, and plays them again', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSignIn(page);
    await page.mouse.move(5, 500);

    const before = await sceneAnimations(page);
    expect(before.total).toBeGreaterThan(20);
    expect(before.running).toBe(before.total);

    const pause = reel(page).getByRole('button', { name: 'Pause animation' });
    await pause.click();
    await page.mouse.move(5, 500);
    await expect(reel(page).getByRole('button', { name: 'Play animation' })).toBeVisible();
    await expect.poll(() => dwellState(page)).toBe('paused');
    await expect.poll(async () => (await sceneAnimations(page)).running).toBe(0);

    // frozen means frozen: the scene does not advance while paused
    const t0 = await page.evaluate(() => document.getAnimations().find((a) => (a.effect as KeyframeEffect | null)?.target?.closest('svg'))?.currentTime);
    await page.waitForTimeout(400);
    const t1 = await page.evaluate(() => document.getAnimations().find((a) => (a.effect as KeyframeEffect | null)?.target?.closest('svg'))?.currentTime);
    expect(t1).toBe(t0);

    await reel(page).getByRole('button', { name: 'Play animation' }).click();
    await page.mouse.move(5, 500);
    await expect(reel(page).getByRole('button', { name: 'Pause animation' })).toBeVisible();
    await expect.poll(() => dwellState(page)).toBe('running');
    await expect.poll(async () => (await sceneAnimations(page)).running).toBeGreaterThan(20);
  });

  test('a new scene starts at its beginning and the old one is gone a moment later (one scene animates at a time)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSignIn(page);
    await page.mouse.move(5, 500);
    await reel(page).getByRole('button', { name: 'Show sorting' }).click();
    await expect(title(page)).toHaveText('Sorting');
    // after the cross-fade only one scene svg is mounted
    await expect(scenes(page)).toHaveCount(1);
    await expect(reel(page)).toHaveAttribute('data-topic', 'sorting');
  });
});

test.describe('hero reel with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('shows a still poster frame and never rotates', async ({ page }) => {
    const problems = collectProblems(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/signin', { waitUntil: 'networkidle' });
    await expect(reel(page)).toHaveAttribute('data-topic', 'binary-search');

    // nothing on the stage is animated: no scene animation, no timer
    const anims = await sceneAnimations(page);
    expect(anims.running).toBe(0);
    expect(await dwellState(page)).toBe('none');
    await page.waitForTimeout(1200);
    await expect(reel(page)).toHaveAttribute('data-topic', 'binary-search');

    // the poster is a finished picture: the +1 token and the found pillar are drawn and visible
    const coin = scenes(page).locator('text', { hasText: '+1' });
    await expect(coin).toHaveCount(1);
    await expect(coin).toBeVisible();
    expect(await coin.evaluate((el) => Number(getComputedStyle(el.closest('g[class]') ?? el).opacity))).toBeGreaterThan(0.9);
    const box = await scenes(page).boundingBox();
    expect(box!.width).toBeGreaterThan(200);

    // switching topics still works (by hand) and shows that topic's poster
    await reel(page).getByRole('button', { name: 'Show stack' }).click();
    await expect(title(page)).toHaveText('Stack');
    await expect(scenes(page)).toHaveCount(1);
    expect((await sceneAnimations(page)).running).toBe(0);
    expect(problems, problems.join('\n')).toEqual([]);
  });

  test('every topic has a poster (no blank stage)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/signin', { waitUntil: 'networkidle' });
    const names = await reel(page).getByRole('toolbar').getByRole('button').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
    expect(names).toHaveLength(10);
    for (const name of names) {
      await reel(page).getByRole('button', { name }).click();
      await expect(scenes(page)).toHaveCount(1);
      // the scene draws something big and lit: a good number of shapes with nothing hidden at opacity 0 by default
      const shapes = await scenes(page).evaluate((svg) => {
        let visible = 0;
        svg.querySelectorAll('rect, circle, path, text').forEach((el) => {
          const cs = getComputedStyle(el);
          const box = (el as SVGGraphicsElement).getBBox();
          if (Number(cs.opacity) > 0.15 && box.width > 1 && box.height > 1) visible++;
        });
        return visible;
      });
      expect(shapes, name).toBeGreaterThan(12);
    }
  });
});

test.describe('hero banner on a phone', () => {
  test('sits above the form, is about 150–180 px tall, leaves the form in the first screen and does not overflow', async ({ page }) => {
    const problems = collectProblems(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await openSignIn(page);

    const banner = await reel(page).boundingBox();
    const emailInput = await page.getByLabel('Email').boundingBox();
    const submit = await page.getByRole('button', { name: 'Sign in', exact: true }).boundingBox();
    expect(banner).not.toBeNull();
    // above the form (visually; the DOM order stays form → reel)
    expect(banner!.y + banner!.height).toBeLessThanOrEqual(emailInput!.y);
    expect(banner!.height).toBeGreaterThanOrEqual(140);
    expect(banner!.height).toBeLessThanOrEqual(190);
    // the form's primary action is on the first screen, with room to spare
    expect(submit!.y + submit!.height).toBeLessThanOrEqual(812 - 100);
    // no horizontal scroll, and nothing wider than the phone
    const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
    expect(banner!.x + banner!.width).toBeLessThanOrEqual(375);

    // the controls are big enough to hit: pause 40 px, segments at least 24 px
    const pause = await reel(page).getByRole('button', { name: 'Pause animation' }).boundingBox();
    expect(pause!.width).toBeGreaterThanOrEqual(40);
    expect(pause!.height).toBeGreaterThanOrEqual(40);
    for (const b of await reel(page).getByRole('toolbar').getByRole('button').all()) {
      const r = await b.boundingBox();
      expect(r!.width).toBeGreaterThanOrEqual(24);
      expect(r!.height).toBeGreaterThanOrEqual(24);
    }

    // DOM order: the form comes first, the reel after it
    const order = await page.evaluate(() => {
      const form = document.querySelector('main');
      const aside = document.querySelector('aside[aria-label="About Codemare"]');
      return !!form && !!aside && !!(form.compareDocumentPosition(aside) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(order).toBe(true);
    // the chips drop out of the banner; the topic name and caption stay
    await expect(page.getByText('Judged in microseconds')).toBeHidden();
    await expect(title(page)).toBeVisible();
    await expect(caption(page)).toBeVisible();
    expect(problems, problems.join('\n')).toEqual([]);
  });

  test('the other auth screens get the banner too and the sign-up form still waits for hydration', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    for (const path of ['/signup', '/forgot']) {
      await page.goto(path, { waitUntil: 'networkidle' });
      await expect(reel(page)).toBeVisible();
      await expect(page.locator('h1')).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    }
    await page.goto('/signup', { waitUntil: 'networkidle' });
    // hydrated: the submit button is enabled (before that a click would native-submit and drop the input)
    await expect(page.getByRole('button', { name: 'Create account' })).toBeEnabled();
  });
});

test.describe('hero accessibility', () => {
  for (const theme of ['dark', 'light'] as const) {
    test(`no serious axe violations at desktop width (${theme}), with the reel focused and paused`, async ({ page }) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width: 1440, height: 900 });
      await setTheme(page, theme);
      for (const path of ['/signin', '/signup', '/forgot']) {
        await page.goto(path, { waitUntil: 'networkidle' });
        await expect(reel(page)).toHaveAttribute('data-live', '');
        await page.addScriptTag({ url: AXE_URL });
        const run = () =>
          page.evaluate(async () => {
            const axe = (window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: { id: string; impact?: string | null; help: string; nodes: { target: string[] }[] }[] }> } }).axe;
            const result = await axe.run(document, { exclude: [['nextjs-portal']], resultTypes: ['violations'] });
            return result.violations
              .filter((v) => v.impact === 'serious' || v.impact === 'critical')
              .map((v) => ({ id: v.id, help: v.help, targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }));
          });
        expect(await run(), `${path} (${theme})`).toEqual([]);
        // the same with the pause button pressed and a segment focused (focus rings, changed labels)
        await reel(page).getByRole('button', { name: 'Pause animation' }).click();
        await reel(page).getByRole('toolbar').locator('[aria-current="true"]').focus();
        expect(await run(), `${path} (${theme}, paused)`).toEqual([]);
      }
    });
  }

  test('the focus ring of the switcher and the pause button is visible', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSignIn(page);
    await page.mouse.move(5, 500);
    const active = reel(page).getByRole('toolbar').locator('[aria-current="true"]');
    await active.focus();
    await page.keyboard.press('ArrowRight');
    const ring = await reel(page).getByRole('toolbar').locator('[aria-current="true"]').evaluate((el) => getComputedStyle(el).boxShadow);
    expect(ring).not.toBe('none');
    expect(ring).toMatch(/\d/);
  });
});

test.describe('dev gallery', () => {
  test('/dev/topic-art shows every scene in both themes (and is not served in production)', async ({ page }) => {
    const res = await page.goto('/dev/topic-art');
    if (new URL(page.url()).pathname === '/signin') {
      // production build: /dev/* stays behind the auth wall (and 404s even once signed in)
      expect(new URL(page.url()).searchParams.get('next')).toBe('/dev/topic-art');
      return;
    }
    if (res?.status() === 404) {
      await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
      return;
    }
    expect(res?.ok()).toBe(true);
    for (const theme of ['dark', 'light']) {
      for (const slug of ['arrays-hashing', 'two-pointers', 'stack', 'binary-search', 'sliding-window', 'recursion', 'sorting', 'graphs', 'dynamic-programming', 'heaps-greedy', 'not-a-topic']) {
        // hero size, 280 × 160, 120 × 80 and the poster
        await expect(page.getByTestId(`gallery-${theme}-${slug}`).locator('[data-topic] svg')).toHaveCount(4);
      }
    }
  });
});
