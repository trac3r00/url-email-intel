import { test, expect } from '@playwright/test';

async function login(page) {
  await page.goto('/');
  await page.getByPlaceholder('password').fill('password123');
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page.getByText('Phishing surface, one console.')).toBeVisible();
}

test('operator can use core URL and email workflows without UI errors', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  await login(page);

  await page.getByRole('button', { name: 'URL Shortener' }).click();
  await page.getByPlaceholder('https://example.com/payroll-login').fill('https://example.com/login');
  const slug = `demo-${Date.now()}`;
  await page.getByPlaceholder('custom slug (optional)').fill(slug);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText(`/s/${slug}`)).toBeVisible();

  await page.getByRole('button', { name: 'URL Checker' }).click();
  await page.getByPlaceholder('https://suspicious.example/path').fill('https://example.com');
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.getByText(/Risk score/)).toBeVisible();

  await page.getByRole('button', { name: 'Email/Sender Analyzer' }).click();
  await page.setInputFiles('input[type="file"]', {
    name: 'sample.eml',
    mimeType: 'message/rfc822',
    buffer: Buffer.from('From: Sender <sender@example.com>\nTo: Analyst <a@example.net>\nSubject: Test\nAuthentication-Results: mx.example.net; spf=pass dkim=pass dmarc=pass\n\nVisit https://example.com/login')
  });
  await page.getByRole('button', { name: 'Analyze', exact: true }).click();
  await expect(page.getByText('Embedded URLs')).toBeVisible();
  await expect(page.getByText('sender@example.com')).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

test('forms show API errors instead of crashing', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'URL Checker' }).click();
  await page.getByPlaceholder('https://suspicious.example/path').fill('http://127.0.0.1:1');
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.getByText(/Private\/localhost targets are blocked|Private network target blocked/)).toBeVisible();
});
