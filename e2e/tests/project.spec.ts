import type { Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
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
  await expect(page.locator('main').getByRole('heading', { name: 'Course project' })).toBeVisible();
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

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sidebar' });

/** Below 900 px (e.g. iPad portrait) the sidebar is a drawer: open it when the menu button shows. */
async function openSidebar(page: Page): Promise<void> {
  const menu = page.getByRole('button', { name: 'Open menu' });
  if (await menu.isVisible()) await expect(sidebar(page)).toBeHidden();
  if (!(await sidebar(page).isVisible())) await menu.click();
  await expect(sidebar(page)).toBeVisible();
}

/** The header (theme select) is not part of the drawer; close it before using main content. */
async function closeSidebar(page: Page): Promise<void> {
  if (await page.getByRole('button', { name: 'Close menu' }).isVisible()) {
    await page.keyboard.press('Escape');
    await expect(sidebar(page)).toBeHidden();
  }
}

test('the sidebar shows the project, lists entries and keeps the param on navigation', async ({
  page,
}) => {
  await page.goto('/view/fixtures/projects/course.mdv.yaml');
  await expect(page.getByRole('heading', { name: 'Course intro' })).toBeVisible();
  await openSidebar(page);
  const bar = sidebar(page);
  await expect(bar.getByRole('heading', { name: 'Project', exact: true })).toBeVisible();
  await expect(bar.getByRole('heading', { name: 'Course project' })).toBeVisible();
  await expect(bar.getByRole('link', { name: 'Source' })).toBeVisible();
  await expect(bar.getByRole('link', { name: 'Open', exact: true })).toBeVisible();
  // The include folder holds the current file, so it is open.
  const intro = bar.getByRole('link', { name: 'intro.md' });
  await expect(intro).toHaveAttribute('aria-current', 'page');
  await expect(bar.getByText('This file is not part of the project')).toHaveCount(0);

  await bar.getByRole('link', { name: 'next.md' }).click();
  await expect(page.getByRole('heading', { name: 'Course next' })).toBeVisible();
  expect(projectParam(page)).toBe(PROJECT);
  await openSidebar(page);
  await expect(sidebar(page).getByRole('link', { name: 'next.md' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('a file outside the project shows the note', async ({ page }) => {
  await page.goto(`/view/fixtures/README.md?project=${PROJECT}`);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await openSidebar(page);
  await expect(sidebar(page).getByText('This file is not part of the project')).toBeVisible();
});

test('an open file outside include is part of the project and broken entries are warned', async ({
  page,
}) => {
  await page.goto('/view/fixtures/projects/outside-open.mdv.yaml');
  await expect(page.getByRole('heading', { name: 'Outside the project' })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/view/fixtures/projects/plain.md');
  await openSidebar(page);
  const bar = sidebar(page);
  await expect(bar.getByRole('heading', { name: 'Outside open project' })).toBeVisible();
  await expect(bar.getByText('This file is not part of the project')).toHaveCount(0);
  const warnings = bar.locator('details.project-warnings');
  await expect(warnings).toHaveAttribute('open', '');
  await expect(warnings.getByLabel('1 warnings')).toBeVisible();
  await expect(
    bar.getByRole('list', { name: 'Project warnings' }).getByRole('listitem'),
  ).toHaveCount(1);
  await expect(bar.getByRole('list', { name: 'Project warnings' })).toContainText('nope');
  await closeSidebar(page);
});

test('theme choices are kept per project and do not cross the project boundary', async ({
  page,
}) => {
  const theme = page.getByRole('combobox', { name: 'Theme' });
  const html = page.locator('html');
  await page.goto('/view/fixtures/projects/course.mdv.yaml');
  await expect(page.getByRole('heading', { name: 'Course intro' })).toBeVisible();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await theme.selectOption('dark');
  await expect(html).toHaveAttribute('data-theme', 'dark');

  // Close project: the project's choice is gone with the project.
  await openSidebar(page);
  await sidebar(page).getByRole('link', { name: 'Close project' }).click();
  await expect(page).not.toHaveURL(/project=/);
  await expect(html).toHaveAttribute('data-theme', 'light');

  // A global choice does not apply inside the project; the project's own choice survives reload.
  await theme.selectOption('system');
  await page.goto('/view/fixtures/projects/course.mdv.yaml');
  await expect(page.getByRole('heading', { name: 'Course intro' })).toBeVisible();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');

  // Reset clears this project's choice only.
  await openSidebar(page);
  await sidebar(page).getByRole('button', { name: "Reset this device's choices" }).click();
  await closeSidebar(page);
  await expect(html).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => window.localStorage.getItem('mdv-project-device'))).toBeNull();
  expect(await page.evaluate(() => window.localStorage.getItem('mdv-theme'))).toBe('system');
});

// The `live` root is a writable, polled directory under build/e2e/live (see playwright.config.ts).
const liveDir = path.resolve(import.meta.dirname, '../../build/e2e/live');

test('a live edit of the project file updates the sidebar and settings', async ({ page }) => {
  const name = `t-${randomUUID().slice(0, 8)}`;
  const dir = path.join(liveDir, name);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'p.mdv.yaml');
  writeFileSync(path.join(dir, 'doc.md'), '# Live doc\n');
  writeFileSync(file, 'version: 1\nname: Live one\nopen: doc.md\nsettings:\n  fontSize: 20\n');

  await page.goto(`/view/live/${name}/p.mdv.yaml`);
  await expect(page.getByRole('heading', { name: 'Live doc' })).toBeVisible();
  await expect(page.locator('html')).toHaveCSS('--mdv-font-size', '20px');
  await openSidebar(page);
  await expect(sidebar(page).getByRole('heading', { name: 'Live one' })).toBeVisible();

  writeFileSync(file, 'version: 1\nname: Live two\nopen: doc.md\nsettings:\n  fontSize: 24\n');
  await expect(page.locator('html')).toHaveCSS('--mdv-font-size', '24px');
  await expect(sidebar(page).getByRole('heading', { name: 'Live two' })).toBeAttached();

  // A broken edit keeps the last good version and says so.
  writeFileSync(file, 'version: 1\nname: [unclosed\n');
  await expect(sidebar(page).getByRole('alert')).toContainText('showing the last valid version');
  await expect(page.locator('html')).toHaveCSS('--mdv-font-size', '24px');
});

// FR-7.6: recent projects, and `project` on recent items.
test('Recent projects lists an opened project on Home and reopens it', async ({ page }) => {
  const main = page.getByRole('main');
  await page.goto('/view/fixtures/projects/course.mdv.yaml');
  await expect(page.getByRole('heading', { name: 'Course intro' })).toBeVisible();
  await page.getByRole('link', { name: 'Markdown Viewer' }).click();
  await expect(page).toHaveURL(/\/$/);

  const list = main.getByRole('list', { name: 'Recent projects', exact: true });
  const link = list.getByRole('link', { name: /Course project/ });
  await expect(link).toHaveAttribute('href', '/view/fixtures/projects/course.mdv.yaml');
  await link.click();
  await expect(page.getByRole('heading', { name: 'Course intro' })).toBeVisible();
  expect(projectParam(page)).toBe(PROJECT);

  await page.getByRole('link', { name: 'Markdown Viewer' }).click();
  await main.getByRole('button', { name: 'Clear recent projects' }).click();
  await expect(list).toHaveCount(0);
});

test('a file opened in a project is recent with its project param', async ({ page }) => {
  const main = page.getByRole('main');
  await page.goto('/view/fixtures/projects/course.mdv.yaml');
  await expect(page.getByRole('heading', { name: 'Course intro' })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem('mdv-recent');
        const list = raw ? (JSON.parse(raw) as { path: string; project?: string }[]) : [];
        return list.find((r) => r.path === 'projects/course/intro.md')?.project;
      }),
    )
    .toBe(PROJECT);
  await page.getByRole('link', { name: 'Markdown Viewer' }).click();
  await expect(
    main.getByRole('list', { name: 'Recent', exact: true }).getByRole('link', {
      name: /intro\.md/,
    }),
  ).toHaveAttribute('href', `/view/fixtures/projects/course/intro.md?project=${PROJECT}`);
});

test('Projects only shows folders and project files', async ({ page }) => {
  await page.goto('/browse/fixtures/projects');
  const entries = page.getByRole('list', { name: 'Entries' });
  await expect(entries.getByRole('link', { name: 'plain.md' })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Projects only' }).check();
  await expect(entries.getByRole('link', { name: 'plain.md' })).toHaveCount(0);
  await expect(entries.getByRole('link', { name: 'course.mdv.yaml' })).toBeVisible();
  await expect(entries.getByRole('link', { name: 'course', exact: true })).toBeVisible();
});
