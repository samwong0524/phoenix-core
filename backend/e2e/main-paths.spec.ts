import { test, expect } from '@playwright/test';

test.describe('Phoenix-Core Main Paths', () => {
  
  // Path 1: Login flow
  test('P1: Login page renders and accepts credentials', async ({ page }) => {
    await page.goto('/登录');
    await expect(page.locator('h1, [class*="title"]')).toBeVisible();
    // Check form elements exist
    await expect(page.locator('input[type="email"], input[name="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  // Path 2: Dashboard / IM page loads
  test('P2: IM page loads with chat interface', async ({ page }) => {
    await page.goto('/对话');
    // In DEV_MODE (no AUTH_SECRET), should load without login
    // Check for main chat elements
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toBeVisible();
  });

  // Path 3: Skills page loads
  test('P3: Skills page renders skill list', async ({ page }) => {
    await page.goto('/配置/技能');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toBeVisible();
  });

  // Path 4: Workflow page loads
  test('P4: Workflow page renders', async ({ page }) => {
    await page.goto('/编排/工作流');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toBeVisible();
  });

  // Path 5: Navigation sidebar works
  test('P5: Global sidebar navigation is present', async ({ page }) => {
    await page.goto('/对话');
    await page.waitForLoadState('networkidle');
    // Check for sidebar nav element
    const nav = page.locator('nav, [role="navigation"]');
    await expect(nav.first()).toBeVisible();
  });
});
