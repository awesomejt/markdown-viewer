import { expect, test } from './fixtures';

test('a document shows its word count and read time above the body', async ({ page }) => {
  await page.goto('/view/fixtures/docs/readtime.md');
  const line = page.locator('.read-time');
  // 320 body words at the default 160 wpm; heading, code, comment and front matter are excluded.
  await expect(line).toHaveText('320 words · about 2 min');
  await expect(line).toHaveAttribute('title', '2 min 0 s at 160 wpm');
  await expect(page.locator('.markdown-body .read-time')).toHaveCount(0);
});
