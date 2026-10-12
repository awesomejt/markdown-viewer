import { expect, test } from './fixtures';
import { randomUUID } from 'node:crypto';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// The `live` root is a writable directory under build/e2e/live (see playwright.config.ts).
const liveDir = path.resolve(import.meta.dirname, '../../build/e2e/live');

const entries = (page: import('@playwright/test').Page) =>
  page.getByRole('list', { name: 'Entries' });

test('browse into a nested folder and back up via breadcrumbs', async ({ page }) => {
  await page.goto('/browse/fixtures');
  await entries(page).getByRole('link', { name: 'docs' }).click();
  await expect(page).toHaveURL(/\/browse\/fixtures\/docs$/);
  await entries(page).getByRole('link', { name: 'sub' }).click();
  await expect(page).toHaveURL(/\/browse\/fixtures\/docs\/sub$/);
  await expect(entries(page).getByRole('link', { name: 'deep.md' })).toBeVisible();

  const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
  await expect(crumbs.getByText('sub')).toHaveAttribute('aria-current', 'page');
  await crumbs.getByRole('link', { name: 'docs' }).click();
  await expect(page).toHaveURL(/\/browse\/fixtures\/docs$/);
  await crumbs.getByRole('link', { name: 'fixtures' }).click();
  await expect(page).toHaveURL(/\/browse\/fixtures$/);
  await crumbs.getByRole('link', { name: 'Roots' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('filter narrows the list and dot-folders are hidden', async ({ page }) => {
  await page.goto('/browse/fixtures');
  const list = entries(page);
  await expect(list.getByRole('link', { name: 'README.md' })).toBeVisible();
  await expect(list.getByRole('link', { name: '.hidden' })).toHaveCount(0);
  await expect(list.getByRole('link', { name: '.dotfile.md' })).toHaveCount(0);

  await page.getByRole('searchbox', { name: 'Filter by name' }).fill('spaces');
  await expect(list.getByRole('link')).toHaveCount(1);
  await expect(list.getByRole('link', { name: 'name with spaces.md' })).toBeVisible();
});

test('markdown-only toggle hides non-markdown files', async ({ page }) => {
  await page.goto('/browse/fixtures/text');
  const list = entries(page);
  await expect(list.getByRole('link', { name: 'notes.txt' })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Markdown/diagrams only' }).check();
  await expect(list.getByRole('link', { name: 'notes.txt' })).toHaveCount(0);

  await page.goto('/browse/fixtures/diagrams');
  await expect(entries(page).getByRole('link', { name: 'flow.mmd' })).toBeVisible();
});

test('open as workspace lands on the README with ws set', async ({ page }) => {
  await page.goto('/browse/fixtures');
  await page.getByRole('button', { name: 'Open as workspace' }).click();
  await expect(page).toHaveURL(/\/view\/fixtures\/README\.md\?ws=$/);
});

test('open as workspace on a folder without README stays in browse', async ({ page }) => {
  await page.goto('/browse/fixtures/docs');
  await page.getByRole('button', { name: 'Open as workspace' }).click();
  await expect(page).toHaveURL(/\/browse\/fixtures\/docs\?ws=docs$/);
  await expect(page.getByText('Workspace:')).toBeVisible();
  await page.getByRole('link', { name: 'Exit workspace' }).click();
  await expect(page).toHaveURL(/\/browse\/fixtures\/docs$/);
});

test('sort control orders by date and persists across reload', async ({ page }) => {
  const name = `sort-${randomUUID().slice(0, 8)}`;
  const dir = path.join(liveDir, name);
  mkdirSync(dir, { recursive: true });
  // Name order a, b, c; date order (newest first) b, c, a.
  const times: Record<string, string> = {
    'a.md': '2024-01-01T00:00:00Z',
    'b.md': '2024-03-01T00:00:00Z',
    'c.md': '2024-02-01T00:00:00Z',
  };
  for (const [file, iso] of Object.entries(times)) {
    writeFileSync(path.join(dir, file), `# ${file}\n`);
    utimesSync(path.join(dir, file), new Date(iso), new Date(iso));
  }

  await page.goto(`/browse/live/${name}`);
  const links = entries(page).getByRole('link');
  await expect(links).toHaveText(['a.md', 'b.md', 'c.md']);
  await page.getByRole('combobox', { name: 'Sort by' }).selectOption('date');
  await expect(links).toHaveText(['b.md', 'c.md', 'a.md']);

  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Sort by' })).toHaveValue('date');
  await expect(links).toHaveText(['b.md', 'c.md', 'a.md']);
});
