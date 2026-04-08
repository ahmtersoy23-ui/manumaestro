import { test, expect } from '@playwright/test';

test('anasayfa yuklenebiliyor', async ({ page }) => {
  const res = await page.goto('/');
  expect(res?.status()).toBeLessThan(400);
});

test('login sayfasi gorunuyor', async ({ page }) => {
  await page.goto('/');
  // Auth olmadan dashboard'a girince login'e yonlendirilmeli
  await expect(page).toHaveURL(/login|auth/i, { timeout: 10_000 });
});
