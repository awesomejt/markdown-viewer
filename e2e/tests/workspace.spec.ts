import { expect, test, type Page } from '@playwright/test';

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sidebar' });

test('workspace tree navigates and keeps ws', async ({ page }) => {
  await page.goto('/browse/fixtures/docs?ws=docs');
  const tree = sidebar(page);
  await expect(tree.getByRole('link', { name: 'guide.md' })).toBeVisible();
  await expect(tree.getByRole('link', { name: 'sub' })).toBeVisible();

  await tree.getByRole('button', { name: 'Expand sub' }).click();
  await tree.getByRole('link', { name: 'deep.md' }).click();
  await expect(page).toHaveURL(/\/view\/fixtures\/docs\/sub\/deep\.md\?ws=docs$/);
  await expect(tree.getByRole('link', { name: 'deep.md' })).toHaveAttribute('aria-current', 'page');

  await tree.getByRole('link', { name: 'guide.md' }).click();
  await expect(page).toHaveURL(/\/view\/fixtures\/docs\/guide\.md\?ws=docs$/);
  // Ancestors stay expanded and the current file is highlighted after a reload.
  await page.reload();
  await expect(sidebar(page).getByRole('link', { name: 'guide.md' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('a link outside the workspace drops ws', async ({ page }) => {
  await page.goto('/view/fixtures/docs/guide.md?ws=docs');
  await page.getByRole('link', { name: 'Parent README' }).click();
  await expect(page).toHaveURL(/\/view\/fixtures\/README\.md$/);
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
  await expect(sidebar(page)).not.toHaveClass(/is-open/);
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

test('large text file asks before loading', async ({ page }) => {
  await page.goto('/view/fixtures/generated/large.txt');
  await expect(page.getByText(/^File is 6\.\d MB$/)).toBeVisible();
  await page.getByRole('button', { name: 'Load anyway' }).click();
  await expect(page.locator('pre.text-file')).toContainText('# Large fixture');
});
