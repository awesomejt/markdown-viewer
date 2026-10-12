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

test.describe('home screen', () => {
  test.use({ colorScheme: 'light' });

  test('manifest, icons and Apple meta tags are served', async ({ page, request }) => {
    await page.goto('/');
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    const res = await request.get(href ?? '');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/manifest+json');
    const manifest = (await res.json()) as {
      name: string;
      start_url: string;
      display: string;
      icons: { src: string; sizes: string; purpose: string }[];
    };
    expect(manifest).toMatchObject({
      name: 'Markdown Viewer',
      start_url: '/',
      display: 'standalone',
    });
    expect(manifest.icons.map((i) => `${i.sizes} ${i.purpose}`)).toEqual([
      '192x192 any',
      '512x512 any',
      '512x512 maskable',
    ]);

    const touch = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
    for (const src of [touch, ...manifest.icons.map((i) => i.src)]) {
      const icon = await request.get(src ?? '');
      expect(icon.status(), src ?? '').toBe(200);
      expect(icon.headers()['content-type']).toBe('image/png');
    }
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute(
      'content',
      'Markdown',
    );
  });

  test('theme-color follows the app theme and matches the header', async ({ page }) => {
    await page.goto('/');
    const header = page.locator('header.header');
    const metas = page.locator('meta[name="theme-color"]');
    const check = async () => {
      // Computed colors are rgb(); compare against the meta hex.
      const bg = await header.evaluate((el) => getComputedStyle(el).backgroundColor);
      const hexes = await metas.evaluateAll((els) =>
        els.map((m) => (m as HTMLMetaElement).content),
      );
      expect(hexes).toHaveLength(2);
      for (const hex of hexes) {
        const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
        expect(bg).toBe(`rgb(${r}, ${g}, ${b})`);
      }
    };
    await check();
    const toggle = page.getByRole('button', { name: /^Theme:/ });
    await toggle.click();
    await toggle.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await check();
  });
});
