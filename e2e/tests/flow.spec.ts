import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sidebar' });

test('browse, open as workspace, follow a relative link and an anchor', async ({ page }) => {
  await page.goto('/browse/fixtures/docs');
  await page.getByRole('button', { name: 'Open as workspace' }).click();
  await expect(page).toHaveURL(/\/browse\/fixtures\/docs\?ws=docs$/);

  await page.getByRole('list', { name: 'Entries' }).getByRole('link', { name: 'guide.md' }).click();
  await expect(page).toHaveURL(/\/view\/fixtures\/docs\/guide\.md\?ws=docs$/);

  // A relative link inside the workspace keeps ws.
  const body = page.locator('.markdown-body');
  await body.getByRole('link', { name: 'Sibling' }).click();
  await expect(page).toHaveURL(/\/view\/fixtures\/docs\/other\.md\?ws=docs$/);

  // A relative link with an anchor lands on the heading.
  await page.goto('/view/fixtures/docs/guide.md?ws=docs');
  await body.getByRole('link', { name: 'Deep section' }).click();
  await expect(page).toHaveURL(/\/view\/fixtures\/docs\/sub\/deep\.md\?ws=docs#section-two$/);
  await expect(page.locator('#section-two')).toBeInViewport();

  // The workspace tree is still available (a drawer on narrow viewports).
  const menu = page.getByRole('button', { name: 'Open menu' });
  if (await menu.isVisible()) await menu.click();
  await expect(sidebar(page).getByRole('link', { name: 'deep.md' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('script in markdown is never executed', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  await page.addInitScript(() => {
    window.alert = () => {
      (window as never as Record<string, unknown>).__alerted = true;
    };
  });
  await page.goto('/view/fixtures/docs/unsafe.md');
  await expect(
    page.locator('.markdown-body').getByRole('heading', { name: 'Unsafe' }),
  ).toBeVisible();
  await page.waitForTimeout(500);
  expect(dialogs).toEqual([]);
  expect(
    await page.evaluate(() => (window as never as Record<string, unknown>).__alerted),
  ).toBeUndefined();
});

test('traversal URLs are rejected', async ({ request }) => {
  // Control: the same URL shape serves a file inside the root, so the rejections below come from the path guard.
  expect((await request.get('/api/file?root=fixtures&path=docs/guide.md')).status()).toBe(200);
  for (const url of [
    '/api/file?root=fixtures&path=../../etc/passwd',
    '/api/file?root=fixtures&path=..%2F..%2Fetc%2Fpasswd',
    '/api/list?root=fixtures&path=../..',
    '/api/file?root=fixtures&path=%2Fetc%2Fpasswd',
  ]) {
    const res = await request.get(url, { maxRedirects: 0 });
    expect([400, 403, 404], url).toContain(res.status());
  }
});

test('browser back and forward walk root, folder, file and link', async ({ page }) => {
  const body = page.locator('.markdown-body');
  await page.goto('/');
  await page.getByRole('link', { name: 'fixtures' }).first().click();
  await expect(page).toHaveURL(/\/browse\/fixtures$/);
  const entries = page.getByRole('list', { name: 'Entries' });
  await entries.getByRole('link', { name: 'docs' }).click();
  await expect(page).toHaveURL(/\/browse\/fixtures\/docs$/);
  await entries.getByRole('link', { name: 'guide.md' }).click();
  await expect(page).toHaveURL(/\/view\/fixtures\/docs\/guide\.md$/);
  await body.getByRole('link', { name: 'Sibling' }).click();
  await expect(page).toHaveURL(/\/view\/fixtures\/docs\/other\.md$/);
  await expect(body.getByRole('heading', { level: 1 })).not.toHaveText('Guide');

  await page.goBack();
  await expect(page).toHaveURL(/\/view\/fixtures\/docs\/guide\.md$/);
  await expect(body.getByRole('heading', { name: 'Guide', level: 1 })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/browse\/fixtures\/docs$/);
  await expect(entries.getByRole('link', { name: 'guide.md' })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/browse\/fixtures$/);
  await expect(entries.getByRole('link', { name: 'docs' })).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(/\/browse\/fixtures\/docs$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/view\/fixtures\/docs\/guide\.md$/);
  await expect(body.getByRole('heading', { name: 'Guide', level: 1 })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/\/view\/fixtures\/docs\/other\.md$/);
  await expect(body.getByRole('heading', { name: 'Guide', level: 1 })).toHaveCount(0);
});
