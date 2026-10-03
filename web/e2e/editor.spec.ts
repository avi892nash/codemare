import { expect, test, type Page } from '@playwright/test';

/**
 * The solving flow end to end against a running app + compile service:
 * PLAYWRIGHT_BASE_URL=http://localhost:4201 npx playwright test e2e/editor.spec.ts
 */

/** Sign up a throwaway user through the UI. The only place that knows the auth page's path. */
async function signUp(page: Page): Promise<void> {
  const id = `e2e_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await page.goto('/signup');
  await page.getByLabel('Username').fill(id);
  await page.getByLabel('Email').fill(`${id}@test.dev`);
  await page.getByLabel('Password', { exact: true }).fill(`pw-${id}-Secure1`);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL((url) => url.pathname !== '/signup', { timeout: 30_000 });
}

async function openProblem(page: Page, slug: string, language?: string): Promise<void> {
  await page.goto(`/problems/${slug}`);
  await expect(page.locator('[data-testid="code-editor"][data-ready="true"]')).toBeVisible({ timeout: 60_000 });
  if (language) await page.selectOption('[data-testid="language-select"]', language);
}

/** Keyboard input into Monaco is unreliable across platforms: set the model through its API. */
async function setCode(page: Page, code: string): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { monaco?: { editor: { getEditors(): unknown[] } } }).monaco?.editor.getEditors().length);
  await page.evaluate((c) => {
    const monaco = (window as unknown as { monaco: { editor: { getEditors(): { setValue(v: string): void }[] } } }).monaco;
    monaco.editor.getEditors()[0].setValue(c);
  }, code);
}

const verdict = (page: Page) => page.getByTestId('verdict-title');

const TWO_SUM = {
  python: `def twoSum(nums, target):
    seen = {}
    for i, n in enumerate(nums):
        if target - n in seen:
            return [seen[target - n], i]
        seen[n] = i
`,
  wrongPython: `def twoSum(nums, target):
    return [0, 1]
`,
  go: `func twoSum(nums []int, target int) []int {
\tseen := map[int]int{}
\tfor i, n := range nums {
\t\tif j, ok := seen[target-n]; ok {
\t\t\treturn []int{j, i}
\t\t}
\t\tseen[n] = i
\t}
\treturn nil
}
`,
  cpp: `#include <vector>
#include <unordered_map>
using namespace std;

vector<int> twoSum(vector<int>& nums, int target) {
    unordered_map<int, int> seen;
    for (int i = 0; i < (int)nums.size(); i++) {
        auto it = seen.find(target - nums[i]);
        if (it != seen.end()) return {it->second, i};
        seen[nums[i]] = i;
    }
    return {};
}
`,
  cppBroken: `#include <vector>
using namespace std;

vector<int> twoSum(vector<int>& nums, int target) {
    return {}
}
`,
};

test.describe.configure({ mode: 'serial' });

let cookies: Awaited<ReturnType<import('@playwright/test').BrowserContext['cookies']>> = [];

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  await signUp(await context.newPage());
  cookies = await context.cookies();
  await context.close();
});

test.beforeEach(async ({ context }) => {
  await context.addCookies(cookies);
});

test('runs the samples, then submits and gets Accepted with its reward (and no percentile from a handful of solvers)', async ({ page }) => {
  await openProblem(page, 'two-sum', 'python');
  await expect(page.getByTestId('problem-title')).toHaveText('Two Sum');
  await setCode(page, TWO_SUM.python);

  await page.getByTestId('run-button').click();
  await expect(verdict(page)).toHaveText('All tests passed');
  const metrics = page.getByTestId('verdict-metrics');
  await expect(metrics).toContainText('Runtime');
  await expect(metrics).toContainText(/\d+(\.\d+)?\s*(µs|ms|s)/);
  await expect(page.getByTestId('test-breakdown').locator('li')).toHaveCount(3);

  await page.getByTestId('submit-button').click();
  await expect(verdict(page)).toHaveText('Accepted', { timeout: 30_000 });
  // "Faster than N% of other learners" needs 30 accepted solutions to compare against (results.spec.ts covers it shown).
  await expect(page.getByTestId('percentile')).toHaveCount(0);
  // A fresh account's first solve pays the question's topic.
  await expect(page.getByTestId('rewards')).toContainText('+1 token');
  await expect(page.getByTestId('rewards')).toContainText('Arrays & Hashing');
  // Hidden tests show pass/fail only.
  await expect(page.getByTestId('test-row-8')).toContainText('Hidden');
  await expect(page.getByTestId('solved-pill')).toBeVisible();
});

test('a wrong answer names the failing test and shows its explain_on_fail note', async ({ page }) => {
  await openProblem(page, 'two-sum', 'python');
  await setCode(page, TWO_SUM.wrongPython);
  await page.getByTestId('submit-button').click();
  await expect(verdict(page)).toHaveText('Wrong answer', { timeout: 30_000 });
  // The first failing visible test leads, open: input, expected, your output and the author's note.
  const failing = page.getByTestId('first-failure');
  await expect(failing).toContainText('Test 2 failed');
  await expect(failing).toContainText('Expected');
  await expect(failing).toContainText('Your output');
  await expect(failing).toContainText('What this test checks');
  await expect(failing).toContainText('paired with itself');
  // …and the list of every test stays below it.
  await expect(page.getByTestId('test-row-1')).toBeVisible();
});

test('runs in Go and C++, and links a compile error to its line', async ({ page }) => {
  await openProblem(page, 'two-sum', 'go');
  await setCode(page, TWO_SUM.go);
  await page.getByTestId('run-button').click();
  await expect(verdict(page)).toHaveText('All tests passed', { timeout: 60_000 });
  await expect(page.getByTestId('results-hero')).toContainText('Go');

  await page.selectOption('[data-testid="language-select"]', 'cpp');
  await setCode(page, TWO_SUM.cpp);
  await page.getByTestId('run-button').click();
  await expect(verdict(page)).toHaveText('All tests passed', { timeout: 60_000 });
  await expect(page.getByTestId('verdict-metrics')).toContainText('Compile');

  await setCode(page, TWO_SUM.cppBroken);
  await page.getByTestId('run-button').click();
  await expect(verdict(page)).toHaveText('Compilation error', { timeout: 60_000 });
  await expect(page.getByRole('button', { name: /solution\.cpp:5:\d+/ })).toBeVisible();
});

test('keeps a locked question behind the map and redirects the old /p route', async ({ page }) => {
  await page.goto('/problems/coin-change');
  await expect(page.getByTestId('locked-question')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the map' })).toHaveAttribute('href', '/map');

  await page.goto('/p/two-sum');
  await expect(page).toHaveURL(/\/problems\/two-sum$/);
});
