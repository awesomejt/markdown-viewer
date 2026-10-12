import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// The `live` root is a writable directory under build/e2e/live (see playwright.config.ts).
const liveDir = path.resolve(import.meta.dirname, '../../build/e2e/live');

/** A unique folder per test keeps `fullyParallel` safe. */
function newDir(): { name: string; abs: (f: string) => string } {
  const name = `t-${randomUUID().slice(0, 8)}`;
  const dir = path.join(liveDir, name);
  mkdirSync(dir, { recursive: true });
  return { name, abs: (f) => path.join(dir, f) };
}

function write(file: string, content: string): void {
  // Write-then-rename is not needed: the server coalesces and re-reads.
  writeFileSync(file, content);
}

function longDoc(title: string, intro = ''): string {
  const sections = Array.from(
    { length: 30 },
    (_, i) => `## Section ${i + 1}\n\n${'Lorem ipsum dolor sit amet. '.repeat(40)}\n`,
  );
  return `# ${title}\n\n${intro}\n${sections.join('\n')}`;
}

const markWindow = (page: Page) =>
  page.evaluate(() => ((window as never as Record<string, unknown>).__live = 1));
const windowMarked = (page: Page) =>
  page.evaluate(() => (window as never as Record<string, unknown>).__live === 1);

test('markdown view updates in place and keeps the heading position', async ({ page }) => {
  const d = newDir();
  write(d.abs('doc.md'), longDoc('Version one'));
  await page.goto(`/view/live/${d.name}/doc.md`);
  await expect(page.getByRole('heading', { name: 'Version one', level: 1 })).toBeVisible();
  await markWindow(page);

  const heading = page.locator('h2', { hasText: 'Section 20' });
  await heading.scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const h = [...document.querySelectorAll('h2')].find((e) => e.textContent === 'Section 20')!;
    window.scrollBy(0, h.getBoundingClientRect().top - 60);
  });
  const before = await heading.evaluate((e) => e.getBoundingClientRect().top);

  // New content above the anchor shifts everything down; the anchor heading must stay put.
  write(
    d.abs('doc.md'),
    longDoc('Version two', 'Extra paragraph. '.repeat(300) + '\n\n' + 'More. '.repeat(500)),
  );
  await expect(page.getByRole('heading', { name: 'Version two', level: 1 })).toBeAttached();
  await expect
    .poll(async () =>
      Math.abs((await heading.evaluate((e) => e.getBoundingClientRect().top)) - before),
    )
    .toBeLessThan(5);
  expect(await windowMarked(page)).toBe(true);
});

test('folder view shows created and drops deleted files', async ({ page }) => {
  const d = newDir();
  write(d.abs('first.md'), '# first\n');
  await page.goto(`/browse/live/${d.name}`);
  const entries = page.getByRole('list', { name: 'Entries' });
  await expect(entries.getByRole('link', { name: 'first.md' })).toBeVisible();

  write(d.abs('second.md'), '# second\n');
  await expect(entries.getByRole('link', { name: 'second.md' })).toBeVisible();

  rmSync(d.abs('first.md'));
  await expect(entries.getByRole('link', { name: 'first.md' })).toHaveCount(0);
  await expect(entries.getByRole('link', { name: 'second.md' })).toBeVisible();
});

test('a deleted then recreated file recovers', async ({ page }) => {
  const d = newDir();
  write(d.abs('x.md'), '# Alpha\n');
  await page.goto(`/view/live/${d.name}/x.md`);
  await expect(page.getByRole('heading', { name: 'Alpha' })).toBeVisible();
  await markWindow(page);

  rmSync(d.abs('x.md'));
  await expect(page.getByText('Not found')).toBeVisible();

  write(d.abs('x.md'), '# Beta\n');
  await expect(page.getByRole('heading', { name: 'Beta' })).toBeVisible();
  expect(await windowMarked(page)).toBe(true);
});

test('three live tabs keep working under the HTTP/1.1 connection limit', async ({ browser }) => {
  const context = await browser.newContext();
  const d = newDir();
  write(d.abs('a.md'), '# Tab one\n');
  write(d.abs('b.md'), '# Tab two\n');
  const pages = await Promise.all([context.newPage(), context.newPage(), context.newPage()]);
  await pages[0]!.goto(`/view/live/${d.name}/a.md`);
  await pages[1]!.goto(`/view/live/${d.name}/a.md`);
  await pages[2]!.goto(`/browse/live/${d.name}`);
  for (const p of pages.slice(0, 2)) {
    await expect(p.getByRole('heading', { name: 'Tab one' })).toBeVisible();
  }
  await expect(
    pages[2]!.getByRole('list', { name: 'Entries' }).getByRole('link', { name: 'b.md' }),
  ).toBeVisible();

  // Plain API fetches from a tab still succeed promptly with three SSE streams held open.
  const started = Date.now();
  const results = await pages[0]!.evaluate(async (dir) => {
    const rs = await Promise.all([
      fetch(`/api/list?root=live&path=${dir}`),
      fetch(`/api/file?root=live&path=${dir}/b.md`),
      fetch(`/api/list?root=fixtures&path=`),
    ]);
    return rs.map((r) => r.status);
  }, d.name);
  expect(results).toEqual([200, 200, 200]);
  expect(Date.now() - started).toBeLessThan(3000);

  write(d.abs('a.md'), '# Edited everywhere\n');
  for (const p of pages.slice(0, 2)) {
    await expect(p.getByRole('heading', { name: 'Edited everywhere' })).toBeVisible();
  }
  write(d.abs('c.md'), '# new\n');
  await expect(
    pages[2]!.getByRole('list', { name: 'Entries' }).getByRole('link', { name: 'c.md' }),
  ).toBeVisible();
  await context.close();
});

test('an image view reloads when the file changes', async ({ page }) => {
  const d = newDir();
  const svg = (w: number) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="10"><rect width="${w}" height="10" fill="teal"/></svg>`;
  write(d.abs('pic.svg'), svg(10));
  await page.goto(`/view/live/${d.name}/pic.svg`);
  const img = page.getByRole('img', { name: 'pic.svg' });
  await expect.poll(() => img.evaluate((e: HTMLImageElement) => e.naturalWidth)).toBe(10);
  await markWindow(page);

  write(d.abs('pic.svg'), svg(40));
  await expect.poll(() => img.evaluate((e: HTMLImageElement) => e.naturalWidth)).toBe(40);
  expect(await windowMarked(page)).toBe(true);
});
