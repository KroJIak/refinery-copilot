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

test('quality-risk run shows all five agents and a recommendation', async ({ page }) => {
  await page.goto('/?kind=quality_risk');
  await expect(page.getByRole('button', { name: 'Получить рекомендацию' })).toBeEnabled();
  await page.getByRole('button', { name: 'Получить рекомендацию' }).click();
  for (const agent of ['Данные', 'Качество', 'Надёжность', 'Варианты', 'Итог']) {
    await expect(page.locator('.agent-pipeline--mini').getByText(agent, { exact: true })).toBeVisible();
  }
  await expect(page.locator('.agent-pipeline--mini .agent-node--done')).toHaveCount(5, { timeout: 9_000 });
  await page.locator('.recommendation-compact').click();
  await expect(page.getByText('Повышение температуры входа Р-202')).toBeVisible();
});

test('unsafe what-if remains calculable and reports a violation', async ({ page }) => {
  await page.goto('/whatif');
  await page.getByRole('button', { name: 'Сернистая нефть' }).click();
  await expect(page.getByLabel('Керосин, точное значение')).toHaveValue('8');
  await page.getByRole('button', { name: 'Сравнить пресеты' }).click();
  await expect(page.getByLabel('Миниатюра Парето')).toBeVisible();
  const temperature = page.getByLabel('Температура входа Р-202, точное значение');
  await temperature.fill('330');
  await expect(page.getByText('Нарушает ограничений:')).toBeVisible({ timeout: 3_000 });
  await expect(page.getByText(/sulfur_max:/)).toBeVisible();
});

test('stale LIMS leads to a safe refusal with its stated reason', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Устаревший ЛИМС/ }).click();
  await expect(page.getByRole('button', { name: 'Получить рекомендацию' })).toBeEnabled();
  await page.getByRole('button', { name: 'Получить рекомендацию' }).click();
  await expect(page.locator('.recommendation-compact')).toContainText('Надёжной рекомендации нет', { timeout: 9_000 });
  await page.locator('.recommendation-compact').click();
  await expect(page.getByRole('heading', { name: 'Надёжной рекомендации нет' })).toBeVisible();
  await expect(page.getByText('Устаревший лабораторный анализ')).toBeVisible();
});
