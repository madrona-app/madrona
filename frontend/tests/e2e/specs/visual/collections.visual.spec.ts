import { test, expect } from '@playwright/test';
import { VisualTestHelper, takePageScreenshot } from '../../utils';

/**
 * Visual regression tests for Collections.
 *
 * Run these tests with:
 *   npx playwright test --project=visual-chromium
 *
 * Update snapshots with:
 *   npx playwright test --project=visual-chromium --update-snapshots
 */

const TEST_ORG_ID = process.env.PLAYWRIGHT_TEST_ORG_ID || 'c62f6243-b50e-4f10-a6b3-80425de6c01d';

test.describe('Collections Visual Regression', () => {
  test.describe('Objects Page', () => {
    test('objects list page', async ({ page }) => {
      await page.goto(
        `/organizations/${TEST_ORG_ID}/collections/objects`
      );

      const visual = new VisualTestHelper(page, 'collections-objects');
      await visual.prepare();
      await visual.screenshot('list');
    });

    test('objects list with empty state', async ({ page }) => {
      // Navigate with filter that should return no results
      await page.goto(
        `/organizations/${TEST_ORG_ID}/collections/objects?q=NONEXISTENT_QUERY_12345`
      );

      const visual = new VisualTestHelper(page, 'collections-objects');
      await visual.prepare();
      await visual.screenshot('empty-state');
    });
  });

  test.describe('Configuration Pages', () => {
    test('collections config page', async ({ page }) => {
      await page.goto(
        `/organizations/${TEST_ORG_ID}/collections/config`
      );

      const visual = new VisualTestHelper(page, 'collections-config');
      await visual.prepare();
      await visual.screenshot('main');
    });

    test('locations config page', async ({ page }) => {
      await page.goto(
        `/organizations/${TEST_ORG_ID}/collections/config/locations`
      );

      const visual = new VisualTestHelper(page, 'collections-config');
      await visual.prepare();
      await visual.screenshot('locations');
    });
  });

  test.describe('Transaction Pages', () => {
    test('entries page', async ({ page }) => {
      await page.goto(
        `/organizations/${TEST_ORG_ID}/collections/entries`
      );

      const visual = new VisualTestHelper(page, 'collections-transactions');
      await visual.prepare();
      await visual.screenshot('entries');
    });

    test('acquisitions page', async ({ page }) => {
      await page.goto(
        `/organizations/${TEST_ORG_ID}/collections/acquisitions`
      );

      const visual = new VisualTestHelper(page, 'collections-transactions');
      await visual.prepare();
      await visual.screenshot('acquisitions');
    });

    test('loans in page', async ({ page }) => {
      await page.goto(
        `/organizations/${TEST_ORG_ID}/collections/loans-in`
      );

      const visual = new VisualTestHelper(page, 'collections-transactions');
      await visual.prepare();
      await visual.screenshot('loans-in');
    });

    test('loans out page', async ({ page }) => {
      await page.goto(
        `/organizations/${TEST_ORG_ID}/collections/loans-out`
      );

      const visual = new VisualTestHelper(page, 'collections-transactions');
      await visual.prepare();
      await visual.screenshot('loans-out');
    });
  });

  test.describe('Care & Risk Pages', () => {
    test('condition reports page', async ({ page }) => {
      await page.goto(
        `/organizations/${TEST_ORG_ID}/collections/condition-reports`
      );

      const visual = new VisualTestHelper(page, 'collections-care');
      await visual.prepare();
      await visual.screenshot('condition-reports');
    });

    test('conservation page', async ({ page }) => {
      await page.goto(
        `/organizations/${TEST_ORG_ID}/collections/conservation`
      );

      const visual = new VisualTestHelper(page, 'collections-care');
      await visual.prepare();
      await visual.screenshot('conservation');
    });
  });

  test.describe('Work Pages', () => {
    test('workspaces page', async ({ page }) => {
      await page.goto(
        `/organizations/${TEST_ORG_ID}/collections/work/workspaces`
      );

      const visual = new VisualTestHelper(page, 'collections-work');
      await visual.prepare();
      await visual.screenshot('workspaces');
    });
  });
});

test.describe('Common Components Visual', () => {
  test('sidebar navigation', async ({ page }) => {
    await page.goto(
      `/organizations/${TEST_ORG_ID}/collections/objects`
    );
    await page.waitForLoadState('networkidle');

    // Take screenshot of just the sidebar
    const sidebar = page.locator('nav, [data-testid="sidebar"]').first();
    if (await sidebar.isVisible()) {
      await expect(sidebar).toHaveScreenshot('sidebar-collections.png', {
        animations: 'disabled',
        maxDiffPixels: 100,
      });
    }
  });

  test('header with user menu', async ({ page }) => {
    await page.goto(
      `/organizations/${TEST_ORG_ID}/collections/objects`
    );
    await page.waitForLoadState('networkidle');

    // Take screenshot of header
    const header = page.locator('header').first();
    if (await header.isVisible()) {
      await expect(header).toHaveScreenshot('header.png', {
        animations: 'disabled',
        maxDiffPixels: 50,
        mask: [
          page.locator('[data-testid="avatar"]'),
          page.locator('.avatar'),
          page.locator('time'),
        ],
      });
    }
  });
});

test.describe('Responsive Visual Tests', () => {
  test('mobile viewport - objects list', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto(
      `/organizations/${TEST_ORG_ID}/collections/objects`
    );
    await page.waitForLoadState('networkidle');

    await takePageScreenshot(page, {
      name: 'collections-objects-mobile',
      fullPage: true,
    });
  });

  test('tablet viewport - objects list', async ({ page }) => {
    // Set tablet viewport
    await page.setViewportSize({ width: 768, height: 1024 });

    await page.goto(
      `/organizations/${TEST_ORG_ID}/collections/objects`
    );
    await page.waitForLoadState('networkidle');

    await takePageScreenshot(page, {
      name: 'collections-objects-tablet',
      fullPage: true,
    });
  });
});
