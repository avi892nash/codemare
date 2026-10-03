import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * The product's required journey — sign-up → solve → submit → unlock — end
 * to end against a running app and compile service (the seeded content:
 * Foundations is free, Core Techniques opens through the Foundations Gate):
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:4205 npx playwright test e2e/loop.spec.ts
 *
 *  1. sign up a fresh learner through /signup — they land on the map
 *  2. solve three tier-0 questions in the editor (the first opened from
 *     the map's list), watching the navbar's token total rise with each
 *     accepted submit, and the map's list mark them solved
 *  3. /map: Binary Search (tier 1) is blocked by the Foundations Gate
 *  4. start the gate, solve three of its four problems in gate mode, finish
 *     → Core Techniques opens
 *  5. unlock Binary Search with the "Scan, then search" recipe → it opens,
 *     and its card lists its questions, which open in the editor
 */

const DATA = join(__dirname, '..', 'prisma', 'seed');

/** A seeded question's Python reference solution. */
function questionReference(slug: string): string {
  const q = JSON.parse(readFileSync(join(DATA, 'data', 'questions', `${slug}.json`), 'utf8')) as {
    reference_solutions: { python: string };
  };
  return q.reference_solutions.python;
}

async function signUp(page: Page): Promise<string> {
  const id = `loop_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await page.goto('/signup');
  await page.getByLabel('Username').fill(id);
  await page.getByLabel('Email').fill(`${id}@test.dev`);
  await page.getByLabel('Password', { exact: true }).fill(`pw-${id}-Secure1`);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL((url) => url.pathname !== '/signup', { timeout: 30_000 });
  return id;
}

async function waitForEditor(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="code-editor"][data-ready="true"]')).toBeVisible({ timeout: 60_000 });
  await page.waitForFunction(() => (window as unknown as { monaco?: { editor: { getEditors(): unknown[] } } }).monaco?.editor.getEditors().length);
}

/** Keyboard input into Monaco is unreliable across platforms: set the model through its API. */
async function setCode(page: Page, code: string): Promise<void> {
  await page.evaluate((c) => {
    const monaco = (window as unknown as { monaco: { editor: { getEditors(): { setValue(v: string): void }[] } } }).monaco;
    monaco.editor.getEditors()[0].setValue(c);
  }, code);
}

const tokenChip = (page: Page) => page.getByRole('link', { name: /tokens? — open the tier map$/ });
const verdict = (page: Page) => page.getByTestId('verdict-title');

async function solve(page: Page, path: string, code: string): Promise<void> {
  await page.goto(path);
  await waitForEditor(page);
  await page.selectOption('[data-testid="language-select"]', 'python');
  await setCode(page, code);
  await page.getByTestId('submit-button').click();
  await expect(verdict(page)).toHaveText('Accepted', { timeout: 60_000 });
}

test('sign-up → solve → submit → unlock', async ({ page }) => {
  test.setTimeout(10 * 60_000);

  await test.step('sign up a fresh learner, who lands on the map', async () => {
    await signUp(page);
    await expect(page).toHaveURL(/\/map$/);
    await expect(tokenChip(page)).toHaveText('0');
  });

  await test.step('solve tier-0 questions and watch the token total rise', async () => {
    const solves = [
      { slug: 'two-sum', reward: '+1 token · Arrays & Hashing' },
      { slug: 'valid-anagram', reward: '+1 token · Arrays & Hashing' },
      { slug: 'reverse-string', reward: '+1 token · Two Pointers' },
    ];
    // The first one opened the way a learner finds it: from its topic's list on the map.
    await page.getByRole('list', { name: 'Arrays & Hashing problems' }).getByRole('link', { name: 'Two Sum', exact: true }).click();
    await expect(page).toHaveURL(/\/problems\/two-sum$/);
    for (const [i, s] of solves.entries()) {
      await solve(page, `/problems/${s.slug}`, questionReference(s.slug));
      await expect(page.getByTestId('rewards')).toContainText(s.reward);
      await page.reload();
      await expect(tokenChip(page)).toHaveText(String(i + 1));
    }
  });

  let attemptUrl = '';
  await test.step('the map shows a tier-1 topic blocked by its gate', async () => {
    await tokenChip(page).click();
    await expect(page).toHaveURL(/\/map$/);
    await expect(page.getByTestId('map-tokens')).toHaveText('3');
    const arrays = page.getByRole('list', { name: 'Arrays & Hashing problems' });
    for (const title of ['Two Sum', 'Valid Anagram']) {
      await expect(arrays.getByRole('listitem').filter({ has: page.getByRole('link', { name: title, exact: true }) })).toContainText('Solved');
    }
    const topic = page.getByTestId('topic-binary-search');
    await expect(topic.getByTestId('topic-state')).toHaveText('Tier closed');
    await expect(topic.getByTestId('blocker')).toContainText('Core Techniques is closed');
    await expect(topic.getByTestId('blocker')).toContainText('Foundations Gate');
    // Its recipe is already covered — only the gate stands in the way.
    await expect(topic.getByTestId('recipe').first()).toContainText('Scan, then search');

    const gate = page.getByTestId('gate-core-techniques');
    await expect(gate.getByTestId('gate-state')).toHaveText('Open to you');
    await gate.getByTestId('start-gate').click();
    await page.getByTestId('confirm-start-gate').click();
    await page.waitForURL(/\/map\/gates\/[^/]+$/, { timeout: 30_000 });
    attemptUrl = page.url();
    await expect(page.getByTestId('attempt-countdown')).toHaveText(/^\d+:\d\d$/);
  });

  await test.step('pass the Foundations Gate in gate mode', async () => {
    for (const slug of ['contains-duplicate', 'valid-palindrome', 'valid-parentheses']) {
      await page.goto(attemptUrl);
      await page.getByRole('link', { name: new RegExp(`^Solve ${slug.replace(/-/g, ' ')}$`, 'i') }).click();
      await expect(page.getByTestId('gate-banner')).toBeVisible({ timeout: 30_000 });
      await waitForEditor(page);
      await page.selectOption('[data-testid="language-select"]', 'python');
      await setCode(page, questionReference(slug));
      await page.getByTestId('submit-button').click();
      await expect(verdict(page)).toHaveText('Accepted', { timeout: 60_000 });
      await expect(page.getByTestId('verdict-summary')).toContainText('This counts for the gate');
    }
    await page.goto(attemptUrl);
    await expect(page.getByTestId('gate-progress')).toContainText('3/4');
    await expect(page.getByTestId('gate-question-valid-parentheses')).toContainText('Solved');
    await page.getByTestId('finish-gate').click();
    await page.getByTestId('confirm-finish-gate').click();
    await expect(page.getByTestId('gate-result')).toContainText('Passed — Core Techniques is open', { timeout: 30_000 });
  });

  await test.step('unlock Binary Search with a recipe and see it open', async () => {
    await page.goto('/map');
    const topic = page.getByTestId('topic-binary-search');
    await expect(topic.getByTestId('topic-state')).toHaveText('Ready to unlock');
    await topic.getByTestId('unlock-button').click();
    const dialog = page.getByRole('alertdialog', { name: 'Unlock Binary Search?' });
    await expect(dialog.getByRole('radio', { name: /Scan, then search/ })).toBeChecked();
    const spend = dialog.getByTestId('unlock-spend');
    await expect(spend).toContainText('You’ll spend 3 tokens');
    await expect(spend).toContainText('Arrays & Hashing');
    await expect(spend).toContainText('Two Pointers');
    await dialog.getByTestId('confirm-unlock').click();
    await expect(page.getByText('Binary Search unlocked')).toBeVisible({ timeout: 30_000 });
    await expect(topic.getByTestId('topic-state')).toHaveText('Unlocked');
    await expect(topic).toContainText('Unlocked with “Scan, then search”');
    await expect(tokenChip(page)).toHaveText('0');

    // Its questions open with it: the card lists them now, and they open in the editor.
    await topic.getByRole('list', { name: 'Binary Search problems' }).getByRole('link', { name: 'Binary Search', exact: true }).click();
    await expect(page).toHaveURL(/\/problems\/binary-search$/);
    await waitForEditor(page);
    await expect(page.getByTestId('locked-question')).toHaveCount(0);
  });
});
