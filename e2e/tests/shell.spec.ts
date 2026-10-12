import { expect, test } from './fixtures';

test.describe('narrow viewport', () => {
  test.use({ viewport: { width: 600, height: 800 } });

  test('menu button opens the drawer and Escape closes it', async ({ page }) => {
    await page.goto('/');
    const sidebar = page.getByRole('navigation', { name: 'Sidebar' });
    const menu = page.getByRole('button', { name: 'Open menu' });
    await expect(sidebar).toBeHidden();
    await menu.click();
    await expect(sidebar).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sidebar).toBeHidden();
  });
});

test.describe('wide viewport', () => {
  test.use({ viewport: { width: 1200, height: 800 } });

  test('sidebar is visible without the drawer', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'Sidebar' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeHidden();
  });
});

test.describe('theme', () => {
  test.use({ colorScheme: 'light' });

  test('toggle changes data-theme and survives a reload', async ({ page }) => {
    await page.goto('/');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'light');
    // Modes cycle system, light, dark: two clicks reach dark.
    const toggle = page.getByRole('button', { name: /^Theme:/ });
    await toggle.click();
    await toggle.click();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'dark');
  });
});
