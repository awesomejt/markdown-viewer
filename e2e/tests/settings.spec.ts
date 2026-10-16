import type { Locator } from '@playwright/test';
import { expect, test } from './fixtures';

// The e2e server runs with testdata/e2e-preferences.yaml: fontSize 17 and one unknown key.
test.describe('preferences', () => {
  test.use({ colorScheme: 'light' });

  test('apply the configured font size to the document content', async ({ page }) => {
    await page.goto('/view/fixtures/README.md');
    await expect(page.locator('html')).toHaveCSS('--mdv-font-size', '17px');
    await expect(page.locator('.markdown-body')).toHaveCSS('font-size', '17px');
    await expect(page.locator('html')).toHaveAttribute('data-style', 'github');
    // The shell does not scale.
    await expect(page.locator('.app-title')).toHaveCSS('font-size', '16px');
  });

  test('show a warning banner that stays dismissed for the session', async ({ page }) => {
    await page.goto('/');
    const banner = page.locator('.prefs-banner');
    await expect(banner).toContainText('1 preference warning');
    await banner.getByText('1 preference warning').click();
    await expect(banner).toContainText('bogus');
    await banner.getByRole('button', { name: 'Dismiss preferences notice' }).click();
    await expect(banner).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('combobox', { name: 'Theme' })).toBeVisible();
    await expect(page.locator('.prefs-banner')).toHaveCount(0);
  });
});

// Browsers round computed sizes differently (20.4063px, 18.6875px), so compare with a tolerance.
async function expectFontSize(el: Locator, px: number) {
  await expect
    .poll(async () => parseFloat(await el.evaluate((n) => getComputedStyle(n).fontSize)))
    .toBeCloseTo(px, 1);
}

test.describe('text scale', () => {
  test.use({ colorScheme: 'light' });

  test('A+ scales the content only, persists and resets', async ({ page }) => {
    await page.goto('/view/fixtures/README.md');
    const body = page.locator('.markdown-body');
    await expect(body).toHaveCSS('font-size', '17px');
    await page.getByRole('button', { name: 'Larger text' }).click();
    await page.getByRole('button', { name: 'Larger text' }).click();
    const reset = page.getByRole('button', { name: 'Reset text size (120%)' });
    await expect(reset).toHaveText('120%');
    await expectFontSize(body, 20.4);
    await expect(page.locator('.app-title')).toHaveCSS('font-size', '16px');
    await page.reload();
    await expect(page.getByRole('button', { name: 'Reset text size (120%)' })).toBeVisible();
    await expectFontSize(body, 20.4);
    await page.getByRole('button', { name: 'Reset text size (120%)' }).click();
    await expect(page.getByRole('button', { name: 'Reset text size (100%)' })).toBeVisible();
    await expect(body).toHaveCSS('font-size', '17px');
  });

  test('Ctrl+= Ctrl+- and Ctrl+0 change the size', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'ipad', 'touch device: the buttons are the path');
    await page.goto('/view/fixtures/README.md');
    const body = page.locator('.markdown-body');
    await expect(body).toHaveCSS('font-size', '17px');
    await page.keyboard.press('Control+=');
    await expect(page.getByRole('button', { name: 'Reset text size (110%)' })).toBeVisible();
    await expectFontSize(body, 18.7);
    await page.keyboard.press('Control+-');
    await page.keyboard.press('Control+-');
    await expect(page.getByRole('button', { name: 'Reset text size (90%)' })).toBeVisible();
    await page.keyboard.press('Control+0');
    await expect(page.getByRole('button', { name: 'Reset text size (100%)' })).toBeVisible();
    await expect(body).toHaveCSS('font-size', '17px');
  });

  test('the header fits a 320 px phone without horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/view/fixtures/README.md');
    await expect(page.getByRole('button', { name: 'Larger text' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Theme' })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
