import { expect, test } from './fixtures';

const figures = (page: import('@playwright/test').Page, kind: string) =>
  page.locator(`figure.diagram[data-diagram="${kind}"]`);

test('inline.md renders valid diagrams and shows errors for invalid ones', async ({ page }) => {
  await page.goto('/view/fixtures/diagrams/inline.md');
  const mermaid = figures(page, 'mermaid');
  const d2 = figures(page, 'd2');
  await expect(mermaid).toHaveCount(2);
  await expect(d2).toHaveCount(2);

  for (const fig of [mermaid.first(), d2.first()]) {
    await expect(fig).toHaveAttribute('data-state', 'ready');
    const img = fig.locator('img');
    await expect(img).toHaveAttribute('src', /^blob:/);
    expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  }

  await expect(mermaid.nth(1)).toHaveAttribute('data-state', 'error');
  await expect(mermaid.nth(1).locator('.diagram-error')).toContainText('A --> --> ((');
  await expect(d2.nth(1)).toHaveAttribute('data-state', 'error');
  await expect(d2.nth(1).locator('.diagram-error')).toContainText('a -> {');

  await expect(page.getByText('Valid Mermaid:', { exact: true })).toBeVisible();
  await expect(page.getByText('Invalid D2:', { exact: true })).toBeVisible();
});

test('Mermaid temp-id cleanup keeps headings with look-alike slugs', async ({ page }) => {
  await page.goto('/view/fixtures/diagrams/inline.md');
  const mermaid = figures(page, 'mermaid');
  await expect(mermaid.first()).toHaveAttribute('data-state', 'ready');
  await expect(mermaid.nth(1)).toHaveAttribute('data-state', 'error');
  for (const id of ['mdv-mermaid-1', 'dmdv-mermaid-2', 'mdvmermaid-1', 'dmdvmermaid-2']) {
    await expect(page.locator(`h3[id="${id}"]`)).toHaveCount(1);
  }
});

test('standalone diagram files render full page', async ({ page }) => {
  for (const [file, kind] of [
    ['flow.mmd', 'mermaid'],
    ['flow.mermaid', 'mermaid'],
    ['arch.d2', 'd2'],
  ] as const) {
    await page.goto(`/view/fixtures/diagrams/${file}`);
    await expect(page.getByRole('heading', { name: file })).toBeVisible();
    const fig = figures(page, kind);
    await expect(fig).toHaveAttribute('data-state', 'ready');
    expect(
      await fig.locator('img').evaluate((el: HTMLImageElement) => el.naturalWidth),
    ).toBeGreaterThan(0);
  }
});

test('broken.d2 shows an error with its source', async ({ page }) => {
  await page.goto('/view/fixtures/diagrams/broken.d2');
  const fig = figures(page, 'd2');
  await expect(fig).toHaveAttribute('data-state', 'error');
  await expect(fig.locator('.diagram-error')).toContainText('a -> {');
});

test.describe('theme', () => {
  test.use({ colorScheme: 'light' });

  test('toggling the theme re-requests D2 with dark', async ({ page }) => {
    await page.goto('/view/fixtures/diagrams/arch.d2');
    await expect(figures(page, 'd2')).toHaveAttribute('data-state', 'ready');
    const toggle = page.getByRole('button', { name: /^Theme:/ });
    const dark = page.waitForRequest(
      (r) => r.url().includes('/api/render/d2') && (r.postData() ?? '').includes('"dark"'),
    );
    await toggle.click();
    await toggle.click();
    await dark;
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(figures(page, 'd2')).toHaveAttribute('data-state', 'ready');
  });
});

test('a Markdown page with Mermaid and D2 makes no non-local requests', async ({
  page,
  remoteRequests,
}) => {
  await page.goto('/view/fixtures/diagrams/inline.md');
  await expect(figures(page, 'mermaid').first()).toHaveAttribute('data-state', 'ready');
  await expect(figures(page, 'd2').first()).toHaveAttribute('data-state', 'ready');
  await page.waitForLoadState('networkidle');
  expect(remoteRequests).toEqual([]);
});

test('oversized standalone diagram asks before loading', async ({ page }) => {
  await page.goto('/view/fixtures/generated/large.d2');
  await expect(page.getByText(/^File is 6\.\d MB$/)).toBeVisible();
  await page.getByRole('button', { name: 'Load anyway' }).click();
  await expect(page.getByRole('heading', { name: 'large.d2' })).toBeVisible();
  // The server caps D2 render requests at 256 KiB, so the forced source is shown as an
  // error figure; the point here is that the diagram page replaced the size notice.
  await expect(figures(page, 'd2')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load anyway' })).toHaveCount(0);
});
