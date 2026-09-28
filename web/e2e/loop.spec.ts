import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * The product's required journey — sign-up → solve → submit → unlock — plus
 * the learning loop behind it, end to end against a running app and compile
 * service (the seeded content: Foundations is free, Core Techniques opens
 * through the Foundations Gate):
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:4205 npx playwright test e2e/loop.spec.ts
 *
 *  1. sign up a fresh learner through /signup
 *  2. solve three tier-0 questions in the editor, watching the navbar's
 *     token total rise with each accepted submit
 *  3. /map: Binary Search (tier 1) is blocked by the Foundations Gate
 *  4. start the gate, solve three of its four problems in gate mode, finish
 *     → Core Techniques opens
 *  5. unlock Binary Search with the "Scan, then search" recipe → it opens
 *     (and its questions with it)
 *  6. /queue: predict a snippet, then build prefixSums → it's in /me/library
 */

const DATA = join(__dirname, '..', 'prisma', 'seed');

/** A seeded question's Python reference solution. */
function questionReference(slug: string): string {
  const q = JSON.parse(readFileSync(join(DATA, 'data', 'questions', `${slug}.json`), 'utf8')) as {
    reference_solutions: { python: string };
  };
  return q.reference_solutions.python;
}

/** A seeded component's Python reference build. */
function componentReference(slug: string): string {
  const refs = JSON.parse(readFileSync(join(DATA, 'verify', 'component_refs.json'), 'utf8')) as Record<string, { python: string }>;
  return refs[slug].python;
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

const tokenChip = (page: Page) => page.getByRole('link', { name: /tokens — open the tier map$/ });
const verdict = (page: Page) => page.getByTestId('verdict-title');

async function solve(page: Page, path: string, code: string): Promise<void> {
  await page.goto(path);
  await waitForEditor(page);
  await page.selectOption('[data-testid="language-select"]', 'python');
  await setCode(page, code);
  await page.getByTestId('submit-button').click();
  await expect(verdict(page)).toHaveText('Accepted', { timeout: 60_000 });
}

test('sign-up → solve → submit → unlock, then predict → build into My Library', async ({ page }) => {
  test.setTimeout(10 * 60_000);

  await test.step('sign up a fresh learner', async () => {
    await signUp(page);
    await page.goto('/problems');
    await expect(tokenChip(page)).toHaveText('0');
  });

  await test.step('solve tier-0 questions and watch the token total rise', async () => {
    const solves = [
      { slug: 'two-sum', reward: '+1 Arrays & Hashing' },
      { slug: 'valid-anagram', reward: '+1 Arrays & Hashing' },
      { slug: 'reverse-string', reward: '+1 Two Pointers' },
    ];
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
      await expect(page.getByText('Accepted — counts for the gate')).toBeVisible();
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

    // Its questions open with it.
    await page.goto('/problems/binary-search');
    await waitForEditor(page);
    await expect(page.getByTestId('locked-question')).toHaveCount(0);
  });

  await test.step('predict, then build a component — it lands in My Library', async () => {
    await page.goto('/queue');
    const predict = page.getByTestId('predict-step');
    await expect(predict).toContainText('Read a prefix array');
    const answer = predict.getByTestId('choice-0');
    await expect(answer).toContainText('3');
    await answer.click();
    await predict.getByTestId('predict-submit').click();
    await expect(page.getByTestId('predict-result')).toContainText('Correct');
    // The list advances around the answered step, which stays on screen (and in the URL).
    await expect(page.getByTestId('queue-steps-done')).toHaveText(/^1\s*\/\s*\d+$/);
    await expect(page).toHaveURL(/\/queue\?step=/);
    await expect(predict).toContainText('Read a prefix array');

    await page.getByTestId('predict-continue').click();
    await expect(page.getByTestId('queue-bar')).toContainText('Prefix Sums', { timeout: 30_000 });
    await waitForEditor(page);
    await setCode(page, componentReference('prefix-sums'));
    await page.getByTestId('run-button').click();
    await expect(verdict(page)).toHaveText('Build passed', { timeout: 60_000 });
    await expect(page.getByTestId('build-passed')).toBeVisible();
    // The queue advanced: Range Sum (which calls prefixSums) is next, and the build paid a token.
    await expect(page.getByTestId('build-next')).toContainText('Spot the off-by-one', { timeout: 30_000 });
    await expect(tokenChip(page)).toHaveText('1');

    await page.goto('/me/library');
    const card = page.getByTestId('component-prefix-sums');
    await expect(card).toContainText('Prefix Sums');
    await expect(card).toContainText('def prefixSums(nums):');
    await expect(card.getByTestId('dep-graph')).toContainText('Range Sum');
    await expect(page.getByTestId('library-built')).toHaveText(/^1\s*\/\s*\d+$/);
  });
});
