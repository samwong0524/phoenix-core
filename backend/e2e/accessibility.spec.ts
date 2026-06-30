import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Accessibility', () => {
  
  const pages = [
    { name: 'Login', path: '/登录' },
    { name: 'IM', path: '/对话' },
    { name: 'Skills', path: '/配置/技能' },
    { name: 'Workflow', path: '/编排/工作流' },
    { name: 'Models', path: '/运维/模型' },
  ];

  for (const { name, path } of pages) {
    test(`${name} page has no critical WCAG violations`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      
      // Filter to critical and serious violations only
      const criticalViolations = results.violations.filter(
        v => v.impact === 'critical' || v.impact === 'serious'
      );
      
      expect(criticalViolations).toEqual([]);
    });
  }
});
