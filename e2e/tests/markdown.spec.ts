import { expect, test } from './fixtures';

const doc = (page: import('@playwright/test').Page) => page.locator('.markdown-body');

test('guide.md renders GFM, hides front matter and rewrites links', async ({ page }) => {
  await page.goto('/view/fixtures/docs/guide.md');
  const body = doc(page);
  await expect(body.getByRole('heading', { name: 'Guide', level: 1 })).toBeVisible();
  await expect(body.getByText('tags:')).toHaveCount(0);
  await expect(body.getByText('draft')).toHaveCount(0);
  await expect(body.getByRole('table')).toBeVisible();
  await expect(body.locator('[data-footnote-ref]')).toBeVisible();
  await expect(body.getByText('The footnote body.')).toBeVisible();

  const escapes = body.getByText('Escapes root');
  await expect(escapes).toHaveAttribute('title', /outside the root/);
  await expect(body.getByRole('link', { name: 'Escapes root' })).toHaveCount(0);

  const external = body.getByRole('link', { name: 'External' });
  await expect(external).toHaveAttribute('href', 'https://example.com/page');
  await expect(external).toHaveAttribute('target', '_blank');

  await body.getByRole('link', { name: 'Sibling' }).click();
  await expect(page).toHaveURL(/\/view\/fixtures\/docs\/other\.md$/);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
});

test('unsafe.md is sanitized', async ({ page }) => {
  await page.goto('/view/fixtures/docs/unsafe.md');
  const body = doc(page);
  await expect(body.getByRole('heading', { name: 'Unsafe' })).toBeVisible();
  await expect(body.locator('script, iframe')).toHaveCount(0);
  await expect(body.locator('[onerror]')).toHaveCount(0);
  await expect(body.locator('a[href^="javascript"]')).toHaveCount(0);
  await expect(body.locator('details summary')).toHaveText('Safe details');
});

test('a #fragment scrolls the heading into view on load and on click', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 400 });
  await page.goto('/view/fixtures/docs/guide.md#links');
  await expect(page.locator('#links')).toBeInViewport();

  await page.goto('/view/fixtures/docs/guide.md');
  await expect(page.locator('#table')).not.toBeInViewport();
  await page.evaluate(() => {
    location.hash = '#tasks';
  });
  await expect(page.locator('#tasks')).toBeInViewport();
});

test('code.md highlights known languages and leaves unknown ones plain', async ({ page }) => {
  await page.goto('/view/fixtures/docs/code.md');
  const body = doc(page);
  await expect(body.getByRole('heading', { name: 'Code', level: 1 })).toBeVisible();

  const ts = body.locator('pre.shiki:has(code.language-ts)');
  await expect(ts).toHaveCount(1);
  await expect(ts).toContainText('const answer: number = 42;');
  const colored = ts.locator('span[style*="color"]');
  expect(await colored.count()).toBeGreaterThan(2);
  await expect(body.locator('pre.shiki:has(code.language-go)')).toHaveCount(1);

  await expect(body.locator('pre:has(code.language-notalang)')).not.toHaveClass(/shiki/);
  await expect(body.locator('pre:has(code.language-notalang)')).toHaveText('just some text\n');
  await expect(body.locator('pre.shiki')).toHaveCount(2);
  await expect(body.getByText('bare block')).toBeVisible();
});

test('a relative image in a document loads', async ({ page }) => {
  await page.goto('/view/fixtures/docs/guide.md');
  const img = doc(page).getByRole('img', { name: 'Pixel' });
  await expect(img).toHaveAttribute('src', /\/api\/file\?.*images%2Fpixel\.png|images\/pixel\.png/);
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);
});

test('the copy button copies a highlighted block', async ({ page }) => {
  // Record writes instead of touching the real clipboard (permissions differ per browser).
  await page.addInitScript(() => {
    const w = window as unknown as { copied: string[] };
    w.copied = [];
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: (t: string) => (w.copied.push(t), Promise.resolve()) },
    });
  });
  await page.goto('/view/fixtures/docs/code.md');
  const body = doc(page);
  const block = body.locator('.code-block:has(code.language-ts)');
  await expect(block.locator('pre.shiki')).toHaveCount(1);
  await block.getByRole('button', { name: 'Copy' }).click();
  await expect(block.getByRole('button', { name: 'Copied' })).toBeVisible();
  const copied = await page.evaluate(() => (window as unknown as { copied: string[] }).copied);
  expect(copied).toEqual([
    'const answer: number = 42;\nexport function greet(name: string): string {\n  return `hello ${name}`;\n}',
  ]);
  await expect(body.getByRole('button', { name: /^Cop/ })).toHaveCount(4);
});

test('front matter is shown in a collapsed panel', async ({ page }) => {
  await page.goto('/view/fixtures/docs/guide.md');
  const panel = page.locator('details.front-matter');
  await expect(panel.locator('summary')).toHaveText('Front matter');
  await expect(panel.getByText('draft: false')).toBeHidden();
  await panel.locator('summary').click();
  await expect(panel.getByText('draft: false')).toBeVisible();
  await expect(panel.locator('code')).toContainText('title: Guide');

  await page.goto('/view/fixtures/docs/code.md');
  await expect(doc(page).getByRole('heading', { name: 'Code', level: 1 })).toBeVisible();
  await expect(page.locator('details.front-matter')).toHaveCount(0);
});

test('table of contents jumps to headings and remembers its state', async ({ page }) => {
  await page.goto('/view/fixtures/docs/guide.md');
  const toc = page.locator('details.toc');
  const nav = toc.getByRole('navigation', { name: 'Table of contents' });
  await expect(toc.locator('summary')).toHaveText('Contents');
  await expect(nav).toBeHidden();
  await toc.locator('summary').click();
  await expect(nav.getByRole('link')).toHaveText([
    'Guide',
    'Repeated',
    'Repeated',
    'Repeated',
    'Level Four',
    'Level Five',
    'Level Six',
    'Links',
    'Table',
    'Tasks',
    'Inline',
  ]);
  await expect(nav.getByRole('link').nth(2)).toHaveAttribute('href', '#repeated-1');

  await nav.getByRole('link', { name: 'Table', exact: true }).click();
  await expect(page).toHaveURL(/\/view\/fixtures\/docs\/guide\.md#table$/);
  await expect(doc(page).getByRole('heading', { name: 'Table', level: 2 })).toBeInViewport();

  await page.reload();
  await expect(page.locator('details.toc nav')).toBeVisible();
});

test('table of contents sits beside the document on wide screens', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/view/fixtures/docs/guide.md');
  const nav = page.getByRole('navigation', { name: 'Table of contents' });
  await expect(nav).toBeVisible();
  const tocBox = (await page.locator('details.toc').boundingBox())!;
  const bodyBox = (await doc(page).boundingBox())!;
  expect(tocBox.x).toBeGreaterThanOrEqual(bodyBox.x + bodyBox.width);

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(nav).toBeInViewport();
});

test('math.md renders KaTeX offline and GitHub alerts', async ({ page }) => {
  await page.goto('/view/fixtures/docs/math.md');
  const body = doc(page);
  await expect(body.locator('.katex-display')).toHaveCount(2);
  // Two inline formulas (heading, paragraph) plus the two display blocks; the error stays inline.
  await expect(body.locator('annotation[encoding="application/x-tex"]')).toHaveCount(4);
  await expect(body.locator('.katex-error')).toHaveCount(1);
  await expect(body.locator('h1')).toHaveId('math-emc2');
  await expect(page.locator('.toc a').first()).toHaveText('Math E=mc^2');

  // KaTeX fonts are bundled and load from the app (the offline guard fails any remote request).
  const faces = await page.evaluate(async () =>
    (await document.fonts.load('16px KaTeX_Main')).map((f) => f.status),
  );
  expect(faces).toContain('loaded');

  const note = body.locator('div.markdown-alert-note');
  await expect(note).toHaveCount(1);
  await expect(note.locator('.markdown-alert-title')).toHaveText('Note');
  await expect(note).toContainText('Useful information.');
  await expect(body.locator('div.markdown-alert-warning .markdown-alert-title')).toHaveText(
    'Warning',
  );
  await expect(body.locator('blockquote')).toHaveText('[!NOTE] not an alert');
});
