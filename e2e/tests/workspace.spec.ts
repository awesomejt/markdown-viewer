import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sidebar' });

/** Below 900 px (e.g. iPad portrait) the sidebar is a drawer: open it when the menu button shows. */
async function openTree(page: Page): Promise<void> {
  const menu = page.getByRole('button', { name: 'Open menu' });
  // After a navigation the drawer closes itself; wait for that so we do not race it.
  if (await menu.isVisible()) await expect(sidebar(page)).toBeHidden();
  if (!(await sidebar(page).isVisible())) {
    await menu.click();
  }
  await expect(sidebar(page)).toBeVisible();
}

test('workspace tree navigates and keeps ws', async ({ page }) => {
  await page.goto('/browse/fixtures/docs?ws=docs');
  const tree = sidebar(page);
  await openTree(page);
  await expect(tree.getByRole('link', { name: 'guide.md' })).toBeVisible();
  await expect(tree.getByRole('link', { name: 'sub' })).toBeVisible();

  await tree.getByRole('button', { name: 'Expand sub' }).click();
  await tree.getByRole('link', { name: 'deep.md' }).click();
  await expect(page).toHaveURL(/\/view\/fixtures\/docs\/sub\/deep\.md\?ws=docs$/);
  await openTree(page);
  await expect(tree.getByRole('link', { name: 'deep.md' })).toHaveAttribute('aria-current', 'page');

  await tree.getByRole('link', { name: 'guide.md' }).click();
  await expect(page).toHaveURL(/\/view\/fixtures\/docs\/guide\.md\?ws=docs$/);
  // Ancestors stay expanded and the current file is highlighted after a reload.
  await page.reload();
  await openTree(page);
  await expect(sidebar(page).getByRole('link', { name: 'guide.md' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('workspace tree follows the Markdown-only toggle', async ({ page }) => {
  await page.goto('/browse/fixtures/text?ws=text');
  await openTree(page);
  const row = sidebar(page).getByRole('link', { name: 'notes.txt' });
  await expect(row).toBeVisible();

  // In drawer mode (iPad) the open drawer covers the toolbar, so close it before toggling.
  const setMdOnly = async (on: boolean) => {
    if (await page.getByRole('button', { name: 'Close menu' }).isVisible()) {
      await page.keyboard.press('Escape');
      await expect(sidebar(page)).toBeHidden();
    }
    await page.getByRole('checkbox', { name: 'Markdown/diagrams only' }).setChecked(on);
    await openTree(page);
  };
  await setMdOnly(true);
  await expect(row).toBeHidden();
  await setMdOnly(false);
  await expect(row).toBeVisible();
});

test('a link outside the workspace drops ws', async ({ page }) => {
  await page.goto('/view/fixtures/docs/guide.md?ws=docs');
  await page.getByRole('link', { name: 'Parent README' }).click();
  await expect(page).toHaveURL(/\/view\/fixtures\/README\.md$/);
  await openTree(page);
  await expect(sidebar(page).getByRole('heading', { name: 'Roots' })).toBeVisible();
});

test('browse entries outside the workspace drop ws', async ({ page }) => {
  await page.goto('/browse/fixtures?ws=docs');
  const list = page.getByRole('list', { name: 'Entries' });
  await expect(list.getByRole('link', { name: 'README.md' })).toHaveAttribute(
    'href',
    '/view/fixtures/README.md',
  );
  await expect(list.getByRole('link', { name: 'docs' })).toHaveAttribute(
    'href',
    '/browse/fixtures/docs?ws=docs',
  );
});

test('tree works in the mobile drawer', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 800 });
  await page.goto('/browse/fixtures/docs?ws=docs');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await sidebar(page).getByRole('link', { name: 'guide.md' }).click();
  await expect(page).toHaveURL(/\/view\/fixtures\/docs\/guide\.md\?ws=docs$/);
  // A closed drawer is `visibility: hidden`, so role locators no longer match it: use the id.
  const drawer = page.locator('#sidebar');
  await expect(drawer).not.toHaveClass(/is-open/);
  await expect(drawer).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open menu' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});

test('image, text and other file views', async ({ page }) => {
  await page.goto('/view/fixtures/images/pixel.png');
  const img = page.getByRole('img', { name: 'pixel.png' });
  await expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);

  await page.goto('/view/fixtures/text/notes.txt');
  await expect(page.locator('pre.text-file')).toContainText('Plain text notes.');

  await page.goto('/view/fixtures/other/blob.bin');
  const link = page.getByRole('link', { name: /Download blob\.bin/ });
  await expect(link).toHaveAttribute('href', '/api/file?root=fixtures&path=other%2Fblob.bin');
});

test('code files are highlighted by extension; plain text stays plain', async ({ page }) => {
  await page.goto('/view/fixtures/text/sample.go');
  const go = page.locator('.file-view pre.shiki code.language-go');
  await expect(go).toContainText('func Hello() string');
  await expect(go.locator('span[style*="color"]').first()).toBeVisible();

  await page.goto('/view/fixtures/text/config.yaml');
  await expect(page.locator('.file-view pre.shiki code.language-yaml')).toHaveCount(1);

  await page.goto('/view/fixtures/text/notes.txt');
  await expect(page.locator('pre.text-file')).toContainText('Plain text notes.');
  await expect(page.locator('.file-view .shiki')).toHaveCount(0);
});

test('large text file asks before loading', async ({ page }) => {
  await page.goto('/view/fixtures/generated/large.txt');
  await expect(page.getByText(/^File is 6\.\d MB$/)).toBeVisible();
  await page.getByRole('button', { name: 'Load anyway' }).click();
  await expect(page.locator('pre.text-file')).toContainText('# Large fixture');
});

test('a file opened outside a workspace lists its sibling files', async ({ page }) => {
  await page.goto('/view/fixtures/docs/guide.md');
  await openTree(page);
  const folder = sidebar(page).getByRole('region', { name: 'In this folder' });
  await expect(folder.getByRole('link', { name: 'guide.md' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(folder.getByRole('link', { name: 'sub' })).toBeHidden();
  await folder.getByRole('link', { name: 'code.md' }).click();
  await expect(page).toHaveURL(/\/view\/fixtures\/docs\/code\.md$/);
});
