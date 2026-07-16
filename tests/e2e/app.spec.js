import { test, expect } from '@playwright/test';

async function login(page) {
  await page.goto('/');
  await page.getByPlaceholder('Email').fill('admin@example.com');
  await page.getByPlaceholder('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Shortener')).toBeVisible();
}

test('login and create short link with copy button', async ({ page }) => {
  await login(page);
  await page.getByPlaceholder('https://example.com/long-url').fill('https://example.com/test-url');
  await page.getByRole('button', { name: 'Shorten', exact: true }).click();
  await expect(page.locator('a[href*="/s/"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy' }).first()).toBeVisible();
});

test('url checker shows risk badge', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Checker', exact: true }).click();
  await page.getByPlaceholder('https://suspicious.example/path').fill('https://example.com');
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.getByText(/clean-ish|low|medium|high/).first()).toBeVisible({ timeout: 15000 });
});

test('master url list creates shareable link', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'URL List', exact: true }).click();
  await page.getByPlaceholder('List title (optional)').fill('Test list');
  await page.locator('textarea').fill('https://one.com\nhttps://two.com\nhttps://three.com');
  await page.getByRole('button', { name: 'Create list link' }).click();
  // Wait for either the link or an error message
  await expect(page.locator('a[href*="/m/"], .text-danger')).toBeVisible({ timeout: 10000 });
  // Should have created the link, not an error
  await expect(page.locator('a[href*="/m/"]')).toBeVisible();
});
