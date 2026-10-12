import { expect, test } from './fixtures';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Long folders go in the writable `live` root (build/e2e/live, see playwright.config.ts).
const liveDir = path.resolve(import.meta.dirname, '../../build/e2e/live');
const COUNT = 2000;
const name = (i: number) => `f${String(i).padStart(4, '0')}.md`;

function bigDir(): string {
  const dir = `big-${randomUUID().slice(0, 8)}`;
  mkdirSync(path.join(liveDir, dir), { recursive: true });
  for (let i = 0; i < COUNT; i++) writeFileSync(path.join(liveDir, dir, name(i)), `# ${i}\n`);
  return dir;
}

test('a long folder renders only nearby rows and scrolls to the end', async ({ page }) => {
  const dir = bigDir();
  await page.goto(`/browse/live/${dir}`);
  const entries = page.getByRole('list', { name: 'Entries' });
  await expect(entries.getByRole('link', { name: name(0) })).toBeVisible();
  const rows = entries.getByRole('listitem');
  expect(await rows.count()).toBeLessThan(150);
  await expect(rows.first()).toHaveAttribute('aria-setsize', String(COUNT));

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const last = entries.getByRole('link', { name: name(COUNT - 1) });
  await expect(last).toBeInViewport();
  expect(await rows.count()).toBeLessThan(150);
  await last.click();
  await expect(page).toHaveURL(new RegExp(`/view/live/${dir}/${name(COUNT - 1)}$`));
  await expect(page.getByRole('heading', { name: String(COUNT - 1) })).toBeVisible();
});

test('the workspace tree pages a long folder and keeps the current file', async ({ page }) => {
  const dir = bigDir();
  await page.goto(`/view/live/${dir}/${name(1500)}?ws=${dir}`);
  await expect(page.getByRole('heading', { name: '1500' })).toBeVisible();
  const menu = page.getByRole('button', { name: 'Open menu' });
  if (await menu.isVisible()) await menu.click();
  const tree = page.locator('#sidebar');
  await expect(tree.getByRole('link', { name: name(1500) })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(tree.getByRole('link', { name: name(1501) })).toHaveCount(0);
  await tree.getByRole('button', { name: `Show more (${COUNT - 1501} left)` }).click();
  await expect(tree.getByRole('link', { name: name(1700) })).toBeVisible();
});
