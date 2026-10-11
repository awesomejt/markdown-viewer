import { expect, test } from '@playwright/test';

const doc = (page: import('@playwright/test').Page) => page.locator('.markdown-body');

test('guide.md renders GFM, hides front matter and rewrites links', async ({ page }) => {
  await page.goto('/view/fixtures/docs/guide.md');
  const body = doc(page);
  await expect(body.getByRole('heading', { name: 'Guide', level: 1 })).toBeVisible();
  await expect(body.getByText('tags:')).toHaveCount(0);
  await expect(body.getByText('draft')).toHaveCount(0);
  await expect(body.getByRole('table')).toBeVisible();
  await expect(body.locator('[data-footnote-ref]')).toBeVisible();
  await expect(body.getByText('The footnote body.')).toBeVisible();

  const escapes = body.getByText('Escapes root');
  await expect(escapes).toHaveAttribute('title', /outside the root/);
  await expect(body.getByRole('link', { name: 'Escapes root' })).toHaveCount(0);

  const external = body.getByRole('link', { name: 'External' });
  await expect(external).toHaveAttribute('href', 'https://example.com/page');
  await expect(external).toHaveAttribute('target', '_blank');

  await body.getByRole('link', { name: 'Sibling' }).click();
  await expect(page).toHaveURL(/\/view\/fixtures\/docs\/other\.md$/);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
});

test('unsafe.md is sanitized', async ({ page }) => {
  await page.goto('/view/fixtures/docs/unsafe.md');
  const body = doc(page);
  await expect(body.getByRole('heading', { name: 'Unsafe' })).toBeVisible();
  await expect(body.locator('script, iframe')).toHaveCount(0);
  await expect(body.locator('[onerror]')).toHaveCount(0);
  await expect(body.locator('a[href^="javascript"]')).toHaveCount(0);
  await expect(body.locator('details summary')).toHaveText('Safe details');
});

test('a #fragment scrolls the heading into view on load and on click', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 400 });
  await page.goto('/view/fixtures/docs/guide.md#links');
  await expect(page.locator('#links')).toBeInViewport();

  await page.goto('/view/fixtures/docs/guide.md');
  await expect(page.locator('#table')).not.toBeInViewport();
  await page.evaluate(() => {
    location.hash = '#tasks';
  });
  await expect(page.locator('#tasks')).toBeInViewport();
});
