import { expect, test } from '@playwright/test';

test('six routes open offline without browser errors', async ({ page }) => {
  const errors: string[] = [];
  const apiRequests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url()); });
  await page.goto('/');
  await expect(page.locator('.mock-badge')).toHaveText('mock');
  for (const label of ['Сценарии', 'What-if', 'Мнемосхема', 'Модели', 'Отчёты', 'Обзор']) {
    await page.getByRole('navigation').getByRole('link', { name: label, exact: true }).click();
    await expect(page.locator('#main-content')).not.toBeEmpty();
    await page.waitForTimeout(350);
  }
  expect(errors).toEqual([]);
  expect(apiRequests).toEqual([]);
});

test('shell stays usable on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.mock-badge')).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: 'Модели', exact: true }).click();
  await expect(page.locator('#main-content')).not.toBeEmpty();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
});
