import { expect, test, type Page } from '@playwright/test';

/**
 * The /ide playground end to end:
 * PLAYWRIGHT_BASE_URL=http://localhost:4201 npx playwright test e2e/ide.spec.ts
 */

/** Sign up a throwaway user through the UI. The only place that knows the auth page's path. */
async function signUp(page: Page): Promise<void> {
  const AUTH_PATH = '/auth';
  const id = `e2e_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await page.goto(AUTH_PATH);
  await page.getByText('Create an account').click();
  await page.locator('input[type="email"]').fill(`${id}@test.dev`);
  await page.locator('input[autocomplete="new-password"]').fill(`pw-${id}-Secure1`);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith(AUTH_PATH), { timeout: 30_000 });
}

async function setCode(page: Page, code: string): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { monaco?: { editor: { getEditors(): unknown[] } } }).monaco?.editor.getEditors().length);
  await page.evaluate((c) => {
    const monaco = (window as unknown as { monaco: { editor: { getEditors(): { setValue(v: string): void }[] } } }).monaco;
    monaco.editor.getEditors()[0].setValue(c);
  }, code);
}

test('runs stdin cases, reports runtime per case and diffs a mismatch', async ({ page }) => {
  await signUp(page);
  await page.goto('/ide');
  await expect(page.locator('[data-testid="code-editor"][data-ready="true"]')).toBeVisible({ timeout: 60_000 });

  // The Python starter sums two numbers; the default cases expect 5 and 3.
  await page.getByTestId('ide-run').click();
  const first = page.getByTestId('ide-case-0');
  await expect(first).toContainText('5', { timeout: 30_000 });
  await expect(first).toContainText(/\d+(\.\d+)?\s*(µs|ms|s)/);
  await expect(page.getByTestId('ide-output')).toContainText('2 of 2 expected outputs matched');

  // Expect the wrong thing in case 2: a line diff shows both.
  await page.getByRole('button', { name: /^Case 2/ }).click();
  await page.getByTestId('ide-expected-1').fill('4');
  await page.getByTestId('ide-run').click();
  await expect(page.getByTestId('ide-output')).toContainText('1 of 2 expected outputs matched', { timeout: 30_000 });
  const diff = page.getByTestId('ide-case-1').getByLabel('Expected output versus your output');
  await expect(diff).toContainText('4');
  await expect(diff).toContainText('3');

  // Another language, same flow.
  await page.selectOption('[data-testid="language-select"]', 'go');
  await setCode(page, 'package main\n\nimport "fmt"\n\nfunc main() {\n\tvar a, b int\n\tfmt.Scan(&a, &b)\n\tfmt.Println(a * b)\n}\n');
  await page.getByTestId('ide-run').click();
  await expect(page.getByTestId('ide-case-0')).toContainText('6', { timeout: 60_000 });
});
