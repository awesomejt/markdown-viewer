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
