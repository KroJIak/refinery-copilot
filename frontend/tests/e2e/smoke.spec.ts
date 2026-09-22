import { expect, test } from '@playwright/test';

test('six routes open offline without browser errors', async ({ page }) => {
  const errors: string[] = [];
  const apiRequests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url()); });
  await page.goto('/');
  await expect(page.locator('.mock-badge')).toHaveText('демо-режим');
  for (const label of ['Сценарии', 'Что если', 'Мнемосхема', 'Модели', 'Отчёты', 'Обзор']) {
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
  const temperature = page.getByLabel('Температура входа Р-202, точное значение');
  await temperature.fill('330');
  await expect(page.getByText('Есть нарушения ограничений')).toBeVisible({ timeout: 3_000 });
  await expect(page.getByText(/Сера:/)).toBeVisible();
});

test('what-if uses distinct data for distinct scenario snapshots', async ({ page }) => {
  await page.goto('/whatif');
  const sulfur = page.locator('.quality-item').filter({ hasText: 'Сера' }).locator('.quality-p50');
  await page.getByRole('button', { name: 'Норма', exact: true }).click();
  await expect(sulfur).toHaveText('8,2');
  await page.getByRole('button', { name: 'Сернистая нефть', exact: true }).click();
  await expect(sulfur).toHaveText('11,8');
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

test('mnemonic opens from a direct link and keeps sensor interactions accessible', async ({ page }) => {
  await page.goto('/mnemonic');
  await expect(page.getByRole('button', { name: /P8:/ })).toBeVisible();
  await page.getByRole('button', { name: /P8:/ }).click();
  await expect(page.getByRole('heading', { name: /P8/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Изменить в «Что если» →' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Увеличить схему' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сбросить масштаб' })).toBeVisible();
  await expect(page.getByText('Вписать', { exact: true })).toHaveCount(0);
  expect(await page.locator('.mnemonic-svg').evaluate((node) => getComputedStyle(node).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
});
