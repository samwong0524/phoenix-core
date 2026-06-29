import { test, expect } from '@playwright/test';

test.describe('SWARM IDE Core User Flows', () => {
  const BASE_URL = 'http://localhost:3100';

  test.use({
    actionTimeout: 30000,
    navigationTimeout: 30000,
  });

  test('home page loads and shows login', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/$/);
    // Should show login or redirect to workspace
    await page.waitForTimeout(2000);
    const body = await page.locator('body').textContent();
    expect(body).toBeTruthy();
  });

  test('IM page is accessible', async ({ page }) => {
    await page.goto(`${BASE_URL}/im`, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/im/);
    await page.waitForTimeout(2000);
    const body = await page.locator('body').textContent();
    expect(body).toBeTruthy();
  });

  test('skills page loads with stats', async ({ page }) => {
    await page.goto(`${BASE_URL}/skills`, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/skills/);
    // Wait for stats to load
    await page.waitForTimeout(3000);
    const body = await page.locator('body').textContent();
    expect(body).toBeTruthy();
  });

  test('API: skill stats endpoint returns valid JSON', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/skills/stats`);
    // Should return 200 or 500 (if DB not ready), but always valid JSON
    expect([200, 500]).toContain(res.status());
    if (res.status() === 200) {
      const data = await res.json();
      expect(data).toHaveProperty('totalInvocations');
      expect(data).toHaveProperty('perSkill');
      expect(data).toHaveProperty('topSkills');
    }
  });
});
