import { expect, test } from './fixtures';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Writable `live` root (see playwright.config.ts).
const liveDir = path.resolve(import.meta.dirname, '../../build/e2e/live');

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

test('a diagram toggles to its source and back', async ({ page }) => {
  await page.goto('/view/fixtures/diagrams/inline.md');
  const fig = figures(page, 'mermaid').first();
  await expect(fig).toHaveAttribute('data-state', 'ready');
  const toggle = fig.getByRole('button', { name: 'Source' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(fig.locator('img')).toHaveCount(0);
  await expect(fig.locator('.diagram-source code')).toContainText('-->');
  await toggle.click();
  await expect(fig.locator('img')).toHaveAttribute('src', /^blob:/);
  await expect(fig.locator('.diagram-source')).toHaveCount(0);
});

test('full-screen viewer pans, zooms and pinches', async ({ page }) => {
  await page.goto('/view/fixtures/diagrams/arch.d2');
  const fig = figures(page, 'd2');
  await expect(fig).toHaveAttribute('data-state', 'ready');
  const open = fig.getByRole('button', { name: 'Full screen' });
  await open.click();

  const dialog = page.getByRole('dialog', { name: 'D2 diagram, full screen' });
  await expect(dialog).toBeVisible();
  const img = dialog.locator('img');
  expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  // The viewer covers the whole viewport.
  const box = await dialog.boundingBox();
  const vp = page.viewportSize();
  expect(box?.width).toBeCloseTo(vp?.width ?? 0, 0);
  expect(box?.height).toBeCloseTo(vp?.height ?? 0, 0);

  await dialog.getByRole('button', { name: 'Zoom in' }).click();
  await expect(dialog.getByText('125%')).toBeVisible();
  await dialog.getByRole('button', { name: 'Fit' }).click();
  await expect(dialog.getByText('100%')).toBeVisible();

  // Synthetic pointer and wheel events behave the same on desktop and iPad projects.
  const viewport = dialog.locator('.diagram-viewport');
  await viewport.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const fire = (type: string, id: number, x: number, y: number) =>
      el.dispatchEvent(
        new PointerEvent(type, {
          pointerId: id,
          pointerType: 'touch',
          clientX: x,
          clientY: y,
          bubbles: true,
          isPrimary: id === 1,
        }),
      );
    // One finger pans by (40, 20).
    fire('pointerdown', 1, cx, cy);
    fire('pointermove', 1, cx + 40, cy + 20);
    fire('pointerup', 1, cx + 40, cy + 20);
  });
  await expect(img).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 40, 20)');

  await viewport.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const fire = (type: string, id: number, x: number) =>
      el.dispatchEvent(
        new PointerEvent(type, {
          pointerId: id,
          pointerType: 'touch',
          clientX: x,
          clientY: cy,
          bubbles: true,
        }),
      );
    // Two fingers 100 px apart spread to 200 px around the center: scale doubles.
    fire('pointerdown', 1, cx - 50);
    fire('pointerdown', 2, cx + 50);
    fire('pointermove', 1, cx - 100);
    fire('pointermove', 2, cx + 100);
    fire('pointerup', 1, cx - 100);
    fire('pointerup', 2, cx + 100);
  });
  await expect(dialog.getByText(/^(199|200|201)%$/)).toBeVisible();

  const prevented = await viewport.evaluate((el) => {
    const e = new WheelEvent('wheel', { deltaY: 100, cancelable: true, bubbles: true });
    el.dispatchEvent(e);
    return e.defaultPrevented;
  });
  expect(prevented).toBe(true);
  await expect(dialog.getByText(/^(199|200|201)%$/)).toHaveCount(0);

  // The page behind does not scroll while the viewer is open.
  await expect(page.locator('html')).toHaveCSS('overflow', 'hidden');

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(open).toBeFocused();
  await expect(page.locator('html')).not.toHaveCSS('overflow', 'hidden');
});

test('a D2 diagram re-renders with the ELK layout', async ({ page }) => {
  await page.goto('/view/fixtures/diagrams/arch.d2');
  const fig = figures(page, 'd2');
  await expect(fig).toHaveAttribute('data-state', 'ready');
  const before = await fig.locator('img').getAttribute('src');
  const elk = page.waitForRequest(
    (r) => r.url().includes('/api/render/d2') && (r.postData() ?? '').includes('"layout":"elk"'),
  );
  await fig.getByRole('combobox', { name: 'Layout' }).selectOption('elk');
  const res = await (await elk).response();
  expect(res?.status()).toBe(200);
  await expect(fig.locator('img')).not.toHaveAttribute('src', before ?? '');
  await expect(fig).toHaveAttribute('aria-busy', 'false');
  expect(
    await fig.locator('img').evaluate((el: HTMLImageElement) => el.naturalWidth),
  ).toBeGreaterThan(0);
});

test('full screen opens with Close focused', async ({ page }) => {
  await page.goto('/view/fixtures/diagrams/flow.mmd');
  const fig = figures(page, 'mermaid');
  await expect(fig).toHaveAttribute('data-state', 'ready');
  await fig.getByRole('button', { name: 'Full screen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Mermaid diagram, full screen' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
});

test('a fixed diagram does not reopen the full-screen viewer after a live-reload error', async ({
  page,
}) => {
  const name = `t-${randomUUID().slice(0, 8)}`;
  const dir = path.join(liveDir, name);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'd.mmd');
  const good = 'graph TD\n  A --> B\n';
  writeFileSync(file, good);
  await page.goto(`/view/live/${name}/d.mmd`);
  const fig = figures(page, 'mermaid');
  await expect(fig).toHaveAttribute('data-state', 'ready');
  await fig.getByRole('button', { name: 'Full screen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Mermaid diagram, full screen' });
  await expect(dialog).toBeVisible();

  writeFileSync(file, 'graph TD\n  A --> --> ((\n');
  await expect(fig).toHaveAttribute('data-state', 'error');
  await expect(dialog).toHaveCount(0);

  writeFileSync(file, good);
  await expect(fig).toHaveAttribute('data-state', 'ready');
  await expect(fig.locator('img')).toHaveAttribute('src', /^blob:/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
