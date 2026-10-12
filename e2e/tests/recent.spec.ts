import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// Newest stored entry as `type:root/path`. Items are recorded in an effect once their listing
// confirms them, which can land after the page content shows, so tests wait on this before
// navigating away.
function newestRecent(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem('mdv-recent');
    const list = raw ? (JSON.parse(raw) as { root: string; path: string; type: string }[]) : [];
    return list[0] && `${list[0].type}:${list[0].root}/${list[0].path}`;
  });
}

// FR-2.6: recently opened files and folders, stored per browser.
test('recent files and folders are listed on the home page and can be cleared', async ({
  page,
}) => {
  const main = page.getByRole('main');
  const recent = main.getByRole('list', { name: 'Recent' });

  await page.goto('/');
  await expect(main.getByRole('heading', { name: 'Roots' })).toBeVisible();
  await expect(recent).toHaveCount(0);

  await page.goto('/browse/fixtures/docs');
  await expect.poll(() => newestRecent(page)).toBe('dir:fixtures/docs');
  await page.getByRole('list', { name: 'Entries' }).getByRole('link', { name: 'sub' }).click();
  await expect.poll(() => newestRecent(page)).toBe('dir:fixtures/docs/sub');
  await page.getByRole('list', { name: 'Entries' }).getByRole('link', { name: 'deep.md' }).click();
  await expect(page).toHaveURL(/\/view\/fixtures\/docs\/sub\/deep\.md$/);
  await expect(main.getByRole('heading').first()).toBeVisible();
  await expect.poll(() => newestRecent(page)).toBe('file:fixtures/docs/sub/deep.md');

  await page.goto('/');
  const links = recent.getByRole('link');
  await expect(links).toHaveCount(3);
  await expect(links.nth(0)).toHaveAttribute('href', '/view/fixtures/docs/sub/deep.md');
  await expect(links.nth(1)).toHaveAttribute('href', '/browse/fixtures/docs/sub');
  await expect(links.nth(2)).toHaveAttribute('href', '/browse/fixtures/docs');

  // Persists across reloads, and reopening an item moves it to the top.
  await page.reload();
  await links.nth(2).click();
  await expect(page).toHaveURL(/\/browse\/fixtures\/docs$/);
  // A folder is recorded once its listing has loaded.
  await expect(page.getByRole('list', { name: 'Entries' })).toBeVisible();
  await expect.poll(() => newestRecent(page)).toBe('dir:fixtures/docs');
  await page.goto('/');
  await expect(links.nth(0)).toHaveAttribute('href', '/browse/fixtures/docs');

  await main.getByRole('button', { name: 'Clear recent' }).click();
  await expect(recent).toHaveCount(0);
  await page.reload();
  await expect(main.getByRole('heading', { name: 'Roots' })).toBeVisible();
  await expect(recent).toHaveCount(0);
});
