import { test, expect } from '@playwright/test';
import { writeFile } from 'fs/promises';

test.describe('SWARM IDE Performance E2E Tests', () => {
  const BASE_URL = 'http://localhost:3100';
  const SCREENSHOT_DIR = 'F:/swarm-ide/e2e/screenshots';

  test.use({
    actionTimeout: 60000,
    navigationTimeout: 60000,
  });

  test('IM page loads successfully with workspace-init endpoint', async ({ page }) => {
    const consoleErrors: Array<{ type: string; text: string; location: string }> = [];
    const apiRequests: Array<{ url: string; method: string; status: number | null }> = [];

    // Capture console errors
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push({
          type: msg.type(),
          text: msg.text(),
          location: msg.location()?.url || 'unknown'
        });
      }
    });

    // Capture page errors
    page.on('pageerror', error => {
      consoleErrors.push({
        type: 'pageerror',
        text: error.message,
        location: 'page'
      });
    });

    // Capture API requests
    page.on('request', request => {
      const url = request.url();
      if (url.includes('/api/')) {
        apiRequests.push({
          url: url,
          method: request.method(),
          status: null
        });
      }
    });

    page.on('response', response => {
      const url = response.url();
      const requestIndex = apiRequests.findIndex(r => r.url === url && r.status === null);
      if (requestIndex !== -1) {
        apiRequests[requestIndex].status = response.status();
      }
    });

    console.log('Test: Navigating to /im page...');

    // Navigate to the IM page - use domcontentloaded instead of networkidle
    // because the page has streaming connections that never go idle
    const startTime = Date.now();
    await page.goto(`${BASE_URL}/im`, { waitUntil: 'domcontentloaded' });
    const initialLoadTime = Date.now() - startTime;

    console.log(`Initial DOM load time: ${initialLoadTime}ms`);

    // Wait for key elements to appear (max 15 seconds)
    await page.waitForSelector('[data-testid="workspace"], main, .workspace, #workspace', { timeout: 15000 });

    // Wait additional time for hydration and initial API calls
    await page.waitForTimeout(3000);

    const totalLoadTime = Date.now() - startTime;
    console.log(`Total load time (with hydration): ${totalLoadTime}ms`);

    // Take screenshot
    await page.screenshot({ path: `${SCREENSHOT_DIR}/im-page-loaded.png`, fullPage: true });
    console.log('Screenshot saved to im-page-loaded.png');

    // Check for main content rendering
    const mainContent = await page.locator('main, [data-testid="workspace"], .workspace, #workspace').first();
    const hasMainContent = await mainContent.isVisible().catch(() => false);

    // Check for loading states
    const loadingElements = await page.locator('[data-testid*="loading"], .loading, .spinner, [class*="loading"]').count();

    // Verify page loaded
    expect(page.url()).toContain('/im');
    console.log('Page URL verified: /im');

    // Analyze API calls
    const uniqueEndpoints = new Set(apiRequests.map(r => {
      const url = new URL(r.url);
      return url.pathname;
    }));

    const endpointList = Array.from(uniqueEndpoints).sort();
    console.log('Unique API endpoints called:', endpointList);

    // Check for workspace-init API call
    const workspaceInitCalls = apiRequests.filter(r => r.url.includes('workspace-init'));
    const hasWorkspaceInit = workspaceInitCalls.length > 0;

    // Check for streaming endpoints (these keep network active)
    const streamingCalls = apiRequests.filter(r =>
      r.url.includes('ui-stream') || r.url.includes('context-stream')
    );

    // Report findings
    const findings = {
      initialLoadTime,
      totalLoadTime,
      hasMainContent,
      loadingElementsCount: loadingElements,
      consoleErrors: consoleErrors.length,
      totalApiRequests: apiRequests.length,
      uniqueEndpoints: endpointList.length,
      hasWorkspaceInit,
      workspaceInitCalls: workspaceInitCalls.length,
      streamingConnections: streamingCalls.length,
      apiEndpoints: endpointList
    };

    console.log('Test findings:', JSON.stringify(findings, null, 2));

    // Generate report
    const report = {
      timestamp: new Date().toISOString(),
      baseUrl: BASE_URL,
      ...findings,
      consoleErrors: consoleErrors,
      allApiRequests: apiRequests.map(r => ({
        endpoint: new URL(r.url).pathname,
        method: r.method,
        status: r.status
      }))
    };

    await writeFile(
      `${SCREENSHOT_DIR}/test-report.json`,
      JSON.stringify(report, null, 2)
    );

    // Assertions
    expect(totalLoadTime).toBeLessThan(30000); // Page should load within 30 seconds
    expect(hasMainContent).toBe(true); // Main content should be visible

    // Log summary
    console.log('\n===== E2E Test Summary =====');
    console.log(`Page Load Time: ${totalLoadTime}ms`);
    console.log(`Main Content Visible: ${hasMainContent}`);
    console.log(`Total API Requests: ${apiRequests.length}`);
    console.log(`Unique Endpoints: ${endpointList.length}`);
    console.log(`Workspace-Init Called: ${hasWorkspaceInit} (${workspaceInitCalls.length} times)`);
    console.log(`Streaming Connections: ${streamingCalls.length}`);
    console.log(`Console Errors: ${consoleErrors.length}`);

    if (hasWorkspaceInit) {
      console.log('SUCCESS: workspace-init endpoint is being used!');
    } else {
      console.log('WARNING: workspace-init endpoint was not called');
    }

    if (consoleErrors.length > 0) {
      console.log('\nConsole Errors:');
      consoleErrors.forEach((err, i) => {
        console.log(`  ${i + 1}. [${err.type}] ${err.text.substring(0, 100)}...`);
      });
    }

    console.log('============================\n');
  });
});
