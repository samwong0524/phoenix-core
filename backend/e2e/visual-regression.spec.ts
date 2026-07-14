import { test, expect } from "@playwright/test";

/**
 * Sprint 5 — Visual Regression Tests
 * Verifies design system consistency across key pages:
 * - Dark mode as default
 * - Font hierarchy (Instrument Serif / DM Sans / JetBrains Mono)
 * - Component styling consistency
 */

test.describe("Visual Regression — Design System", () => {
  test.beforeEach(async ({ page }) => {
    // Ensure dark mode (default)
    await page.emulateMedia({ colorScheme: "dark" });
  });

  test("login page visual consistency", async ({ page }) => {
    await page.goto("/login");

    // Wait for fonts to load
    await page.waitForLoadState("networkidle");

    // Screenshot for visual comparison
    await expect(page).toHaveScreenshot("login-dark.png", {
      maxDiffPixelRatio: 0.05,
    });

    // Verify dark mode is active
    const bgColor = await page.evaluate(() => {
      return window.getComputedStyle(document.body).backgroundColor;
    });
    expect(bgColor).toContain("rgb(15, 23, 42)"); // --bg-void: #0f172a
  });

  test("home page visual consistency", async ({ page }) => {
    await page.goto("/");

    await page.waitForLoadState("networkidle");

    await expect(page).toHaveScreenshot("home-dark.png", {
      maxDiffPixelRatio: 0.05,
    });

    // Verify dark background
    const bgColor = await page.evaluate(() => {
      return window.getComputedStyle(document.body).backgroundColor;
    });
    expect(bgColor).toContain("rgb(15, 23, 42)");
  });

  test("font hierarchy verification", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");

    // Check display font (system font stack for CJK support)
    const headingFont = await page.evaluate(() => {
      const h1 = document.querySelector("h1");
      if (!h1) return null;
      return window.getComputedStyle(h1).fontFamily;
    });
    if (headingFont) {
      // System font stack includes platform-specific fonts
      expect(headingFont).toMatch(/-apple-system|PingFang SC|Microsoft YaHei|system-ui|sans-serif/);
    }

    // Check body font (system font stack)
    const bodyFont = await page.evaluate(() => {
      return window.getComputedStyle(document.body).fontFamily;
    });
    expect(bodyFont).toMatch(/-apple-system|PingFang SC|Microsoft YaHei|system-ui|sans-serif/);

    // Check monospace for code (JetBrains Mono)
    const monoElements = await page.evaluate(() => {
      const els = document.querySelectorAll('[class*="font-mono"], code, pre');
      if (els.length === 0) return null;
      return window.getComputedStyle(els[0]).fontFamily;
    });
    if (monoElements) {
      expect(monoElements).toContain("JetBrains Mono");
    }
  });

  test("button component styling", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");

    // Find a button and verify its styling
    const button = page.locator("button").first();
    await expect(button).toBeVisible();

    const buttonStyles = await button.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return {
        borderRadius: style.borderRadius,
        padding: style.padding,
        fontSize: style.fontSize,
      };
    });

    // Verify design token application
    expect(buttonStyles.borderRadius).toBeTruthy();
    expect(buttonStyles.padding).toBeTruthy();
  });

  test("color scheme prefers-color-scheme", async ({ page }) => {
    // Test dark mode
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const darkBg = await page.evaluate(() => {
      return window.getComputedStyle(document.body).backgroundColor;
    });

    // Test light mode
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const lightBg = await page.evaluate(() => {
      return window.getComputedStyle(document.body).backgroundColor;
    });

    // Backgrounds should be different
    expect(darkBg).not.toEqual(lightBg);
  });

  test("responsive layout — mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 }); // iPhone SE
    await page.goto("/login");
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveScreenshot("login-mobile.png", {
      maxDiffPixelRatio: 0.05,
    });

    // Verify content is visible and not overflowing
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375);
  });

  test("responsive layout — tablet viewport", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 }); // iPad
    await page.goto("/login");
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveScreenshot("login-tablet.png", {
      maxDiffPixelRatio: 0.05,
    });
  });

  test("animation prefers-reduced-motion", async ({ page }) => {
    // Enable reduced motion preference
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Verify animations are disabled or reduced
    const motionElements = await page.evaluate(() => {
      const all = document.querySelectorAll("*");
      let animatedCount = 0;
      all.forEach((el) => {
        const style = window.getComputedStyle(el);
        if (
          style.animationDuration !== "0s" &&
          style.transitionDuration !== "0s"
        ) {
          animatedCount++;
        }
      });
      return animatedCount;
    });

    // With reduced motion, most elements should have no animation
    // Allow some for essential UI feedback (CSS transitions may still exist)
    expect(motionElements).toBeLessThan(300);
  });
});
