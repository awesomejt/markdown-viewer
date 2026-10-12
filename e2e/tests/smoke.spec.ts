import { expect, test } from './fixtures';

test('root list loads and a root can be browsed', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Roots', level: 1 })).toBeVisible();
  const roots = page.getByRole('list', { name: 'Available roots' });
  await roots.getByRole('link', { name: 'fixtures' }).click();
  await expect(page).toHaveURL(/\/browse\/fixtures$/);
  const entries = page.getByRole('list', { name: 'Entries' });
  await expect(entries.getByRole('link', { name: 'README.md' })).toBeVisible();
});

test('traversal URLs are not served', async ({ request }) => {
  const res = await request.get('/api/file?root=fixtures&path=../../etc/passwd');
  expect([400, 403, 404]).toContain(res.status());
});
