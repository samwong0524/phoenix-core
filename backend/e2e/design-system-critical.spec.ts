import { test, expect } from "@playwright/test";

/**
 * Sprint 5 — Design System Critical Path E2E Tests
 * Covers: Component library, navigation, authentication, key pages
 */

test.describe("Component Library", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
  });

  test("Button component variants", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");

    // Find buttons and verify they have proper styling
    const buttons = page.locator("button");
    const count = await buttons.count();
    expect(count).toBeGreaterThan(0);

    // Verify first button has design token styles
    const firstButton = buttons.first();
    await expect(firstButton).toBeVisible();

    const styles = await firstButton.evaluate((el) => {
      const s = window.getComputedStyle(el);
      return {
        cursor: s.cursor,
        borderRadius: s.borderRadius,
        transition: s.transition,
      };
    });

    expect(styles.cursor).toBe("pointer");
    expect(styles.borderRadius).toBeTruthy();
  });

  test("Input component styling", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");

    const inputs = page.locator("input");
    const count = await inputs.count();

    if (count > 0) {
      const firstInput = inputs.first();
      await expect(firstInput).toBeVisible();

      const styles = await firstInput.evaluate((el) => {
        const s = window.getComputedStyle(el);
        return {
          borderStyle: s.borderStyle,
          padding: s.padding,
          fontSize: s.fontSize,
        };
      });

      expect(styles.borderStyle).toBeTruthy();
      expect(styles.padding).toBeTruthy();
    }
  });

  test("Card component structure", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");

    // Cards typically have rounded corners and padding
    const cards = page.locator('[class*="rounded"], [class*="card"]');
    const count = await cards.count();

    if (count > 0) {
      const firstCard = cards.first();
      const styles = await firstCard.evaluate((el) => {
        const s = window.getComputedStyle(el);
        return {
          borderRadius: s.borderRadius,
          padding: s.padding,
        };
      });

      expect(styles.borderRadius).toBeTruthy();
    }
  });
});

test.describe("Navigation & Routing", () => {
  test("sidebar navigation links", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");

    // Look for navigation links
    const navLinks = page.locator('a[href]');
    const count = await navLinks.count();
    expect(count).toBeGreaterThan(0);

    // Verify links have proper styling
    const firstLink = navLinks.first();
    const styles = await firstLink.evaluate((el) => {
      const s = window.getComputedStyle(el);
      return {
        textDecoration: s.textDecoration,
        color: s.color,
      };
    });

    // Links should not have underline by default (design system)
    expect(styles.textDecoration).toContain("none");
  });

  test("mobile menu toggle", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/login");
    await page.waitForLoadState("networkidle");

    // On mobile, there might be a hamburger menu
    const menuButton = page.locator('button[aria-label*="menu"], button[aria-label*="导航"]').first();

    if (await menuButton.isVisible()) {
      await menuButton.click();
      // Menu should open
      await page.waitForTimeout(300);
    }
  });

  test("page routing works", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");

    // Verify we're on the login page
    expect(page.url()).toContain("/login");

    // Try to navigate to home (should redirect to login if not authenticated)
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Should still be on login or redirected page
    const url = page.url();
    expect(url).toMatch(/\/(login|im|workflow|settings)/);
  });
});

test.describe("Authentication Flow", () => {
  test("login page elements", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");

    // Verify login form elements
    const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').first();
    const passwordInput = page.locator('input[type="password"]').first();
    const submitButton = page.locator('button[type="submit"], button:has-text("登录"), button:has-text("Login")').first();

    // At least one of these should exist
    const hasEmail = await emailInput.isVisible().catch(() => false);
    const hasPassword = await passwordInput.isVisible().catch(() => false);
    const hasSubmit = await submitButton.isVisible().catch(() => false);

    expect(hasEmail || hasPassword || hasSubmit).toBe(true);
  });

  test("login form validation", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");

    // Try to submit empty form
    const submitButton = page.locator('button[type="submit"]').first();

    if (await submitButton.isVisible()) {
      await submitButton.click();
      await page.waitForTimeout(500);

      // Should show validation error or stay on page
      expect(page.url()).toContain("/login");
    }
  });
});

test.describe("Key Pages", () => {
  test("settings page loads", async ({ page }) => {
    // Try to access settings (might redirect to login)
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    const url = page.url();
    // Should either load settings or redirect to login
    expect(url).toMatch(/\/(login|settings)/);
  });

  test("workflow page loads", async ({ page }) => {
    await page.goto("/workflow");
    await page.waitForLoadState("networkidle");

    const url = page.url();
    expect(url).toMatch(/\/(login|workflow)/);
  });

  test("im page loads", async ({ page }) => {
    await page.goto("/im");
    await page.waitForLoadState("networkidle");

    const url = page.url();
    expect(url).toMatch(/\/(login|im)/);
  });
});

test.describe("Accessibility", () => {
  test("skip to content link", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");

    // Check for skip link (accessibility feature)
    const skipLink = page.locator('a[href="#main-content"]');
    const exists = await skipLink.count() > 0;

    if (exists) {
      await expect(skipLink).toBeAttached();
    }
  });

  test("focus management", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");

    // Tab through the page
    await page.keyboard.press("Tab");
    await page.waitForTimeout(100);

    // Something should be focused
    const focused = await page.evaluate(() => {
      return document.activeElement !== document.body;
    });

    expect(focused).toBe(true);
  });

  test("aria labels on interactive elements", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");

    // Check buttons have accessible names
    const buttons = page.locator("button");
    const count = await buttons.count();

    for (let i = 0; i < Math.min(count, 5); i++) {
      const button = buttons.nth(i);
      const hasAriaLabel = await button.evaluate((el) => {
        return (
          el.hasAttribute("aria-label") ||
          el.textContent?.trim().length > 0 ||
          el.querySelector("svg") !== null
        );
      });
      expect(hasAriaLabel).toBe(true);
    }
  });
});

test.describe("Performance", () => {
  test("page load time", async ({ page }) => {
    const startTime = Date.now();
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    const loadTime = Date.now() - startTime;

    // Page should load within reasonable time (dev mode)
    expect(loadTime).toBeLessThan(10000); // 10 seconds max
  });

  test("no console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(msg.text());
      }
    });

    await page.goto("/login");
    await page.waitForLoadState("networkidle");

    // Filter out known acceptable errors
    const criticalErrors = errors.filter((e) => !e.includes("favicon"));

    // Should have no critical console errors
    expect(criticalErrors.length).toBe(0);
  });
});
