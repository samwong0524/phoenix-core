import { test, expect } from '@playwright/test';

test('BottomSheet opens and closes correctly', async ({ page }) => {
  // Navigate to test page
  await page.goto('http://localhost:3100/test');
  await page.waitForLoadState('networkidle');

  // Verify the trigger button exists
  const triggerBtn = page.locator('button:has-text("打开 BottomSheet")');
  await expect(triggerBtn).toBeVisible();

  // Verify BottomSheet is NOT visible initially
  const sheet = page.locator('[role="dialog"][aria-modal="true"]');
  await expect(sheet).not.toBeVisible();

  // Click to open BottomSheet
  await triggerBtn.click();

  // Verify BottomSheet is now visible
  await expect(sheet).toBeVisible({ timeout: 3000 });
  await expect(sheet).toHaveAttribute('aria-label', '任务监控');

  // Verify title is shown
  const title = sheet.locator('h3');
  await expect(title).toHaveText('任务监控');

  // Verify task list items are rendered
  const taskItems = sheet.locator('> div:last-child > div > div');
  expect(await taskItems.count()).toBeGreaterThanOrEqual(5);

  // Verify task names
  await expect(sheet.locator('text=性能分析')).toBeVisible();
  await expect(sheet.locator('text=代码优化')).toBeVisible();
  await expect(sheet.locator('text=单元测试')).toBeVisible();

  // Verify progress bar exists for running task
  const progressBar = sheet.locator('div[style*="width: 65%"]');
  await expect(progressBar).toBeVisible();

  // Verify close button exists
  const closeBtn = sheet.locator('button[aria-label="关闭"]');
  await expect(closeBtn).toBeVisible();

  // Test 1: Close via close button
  await closeBtn.click();
  await expect(sheet).not.toBeVisible({ timeout: 3000 });

  // Re-open for next test
  await triggerBtn.click();
  await expect(sheet).toBeVisible({ timeout: 3000 });

  // Test 2: Close via Escape key
  await page.keyboard.press('Escape');
  await expect(sheet).not.toBeVisible({ timeout: 3000 });

  // Re-open for next test
  await triggerBtn.click();
  await expect(sheet).toBeVisible({ timeout: 3000 });

  // Test 3: Close via backdrop click
  // Click on the overlay (the area outside the sheet)
  const overlay = page.locator('[style*="position: fixed"][style*="inset: 0"]').first();
  await overlay.click({ position: { x: 100, y: 100 } });
  await expect(sheet).not.toBeVisible({ timeout: 3000 });

  console.log('✅ All BottomSheet tests passed!');
});
