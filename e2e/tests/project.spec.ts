import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// testdata/fixtures/projects/course.mdv.yaml: name "Course project", open course/intro.md,
// include course/, fontSize 22. The e2e preferences set fontSize 17.
const PROJECT = 'fixtures:projects/course.mdv.yaml';
const projectParam = (page: Page) => new URL(page.url()).searchParams.get('project');

test.use({ colorScheme: 'light' });

test('opening a project file lands on open with the param and applies its settings', async ({
  page,
}) => {
  await page.goto('/view/fixtures/projects/course.mdv.yaml');
  await expect(page.getByRole('heading', { name: 'Course intro' })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/view/fixtures/projects/course/intro.md');
  expect(projectParam(page)).toBe(PROJECT);
  await expect(page.locator('html')).toHaveCSS('--mdv-font-size', '22px');
  await expect(page.locator('.markdown-body')).toHaveCSS('font-size', '22px');
});

test('navigation within the root keeps the project; Home drops it and its settings', async ({
  page,
}) => {
  await page.goto('/view/fixtures/projects/course.mdv.yaml');
  await expect(page.getByRole('heading', { name: 'Course intro' })).toBeVisible();
  await page.locator('.markdown-body').getByRole('link', { name: 'the next part' }).click();
  await expect(page.getByRole('heading', { name: 'Course next' })).toBeVisible();
  expect(projectParam(page)).toBe(PROJECT);
  await expect(page.locator('html')).toHaveCSS('--mdv-font-size', '22px');

  await page.getByRole('link', { name: 'Markdown Viewer' }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(projectParam(page)).toBeNull();
  await expect(page.locator('html')).toHaveCSS('--mdv-font-size', '17px');
});

test('the project home lists the entries and carries the param', async ({ page }) => {
  await page.goto(`/view/fixtures/projects/course.mdv.yaml?project=${PROJECT}`);
  await expect(page.getByRole('heading', { name: 'Course project' })).toBeVisible();
  await page
    .getByRole('list', { name: 'Project entries' })
    .getByRole('link', { name: 'projects/course' })
    .click();
  await expect(page.getByRole('heading', { name: 'course', exact: true })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/browse/fixtures/projects/course');
  expect(projectParam(page)).toBe(PROJECT);
});

test('a missing project file shows an error with Close project', async ({ page }) => {
  await page.goto(`/view/fixtures/README.md?project=fixtures:projects/missing.mdv.yaml`);
  const close = page.getByRole('link', { name: 'Close project' });
  await expect(close).toBeVisible();
  await close.click();
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await expect(page).toHaveURL(/\/view\/fixtures\/README\.md$/);
  await expect(page.getByRole('link', { name: 'Close project' })).toHaveCount(0);
  await expect(page.locator('html')).toHaveCSS('--mdv-font-size', '17px');
});

test('Close project on a broken project opened from its folder shows the listing', async ({
  page,
}) => {
  await page.goto(
    '/view/fixtures/projects/missing.mdv.yaml?project=fixtures:projects/missing.mdv.yaml',
  );
  const close = page.getByRole('link', { name: 'Close project' });
  await expect(close).toBeVisible();
  await close.click();
  await expect(page).toHaveURL(/\/browse\/fixtures\/projects$/);
  await expect(page.getByRole('list', { name: 'Entries' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Close project' })).toHaveCount(0);
});
