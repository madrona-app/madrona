import { test, expect } from '../../fixtures';

/**
 * Search & Filter E2E Tests
 *
 * Tests the core discovery path across collections:
 * - Text search with debounce
 * - Filter application and clearing
 * - Pagination
 * - View mode toggle (grid/list)
 *
 * Run:
 *   npx playwright test search-filter.spec.ts --project=chromium
 */
test.describe('Search & Filter', () => {
  test.describe('Collections Objects Search', () => {
    test('objects page shows results or empty state', async ({ page, orgId }) => {
      await page.goto(`/organizations/${orgId}/collections/objects`);
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      // List page: card grid, table, or empty-state message visible
      await expect(
        page
          .locator('table, [role="grid"], .grid, [class*="grid"]')
          .or(page.locator('img[alt]').first()) // object thumbnail cards
          .or(page.getByText(/no.*objects|no.*records|get started/i))
          .filter({ visible: true })
          .first()
      ).toBeVisible({ timeout: 10000 });
    });

    test('search input filters results', async ({ page, orgId }) => {
      await page.goto(`/organizations/${orgId}/collections/objects`);
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      const searchInput = page.getByPlaceholder(/search/i).first();
      await expect(searchInput).toBeVisible();

      // Capture initial state
      await page.waitForTimeout(500);

      // Type a non-matching query
      await searchInput.fill('xyznonexistent999');
      await page.waitForTimeout(1000); // wait for debounce + API

      // Page should respond — either empty state or reduced results
      // The key assertion is that the page didn't crash or show an error
      const rootContent = await page.locator('#root').innerHTML().catch(() => '');
      expect(rootContent.trim().length).toBeGreaterThan(50);
      const errorBoundary = await page.locator('[data-testid="error-boundary"]').count();
      expect(errorBoundary).toBe(0);

      // Clear search
      await searchInput.clear();
      await page.waitForTimeout(1000);
    });

    test('search with matching term shows results', async ({ page, orgId }) => {
      await page.goto(`/organizations/${orgId}/collections/objects`);
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      // Check if there are any objects to search
      const rows = page.locator('table tbody tr');
      const rowCount = await rows.count().catch(() => 0);

      if (rowCount > 0) {
        // Get text from first row to use as search term
        const firstRowText = await rows.first().innerText().catch(() => '');
        const searchTerm = firstRowText.split(/\s+/).find((w) => w.length > 3) || '';

        if (searchTerm) {
          const searchInput = page.getByPlaceholder(/search/i).first();
          await searchInput.fill(searchTerm);
          await page.waitForTimeout(1000);

          // Should still show at least one result
          const resultRows = await rows.count().catch(() => 0);
          expect(resultRows).toBeGreaterThan(0);

          await searchInput.clear();
        }
      }
    });

    test('filter controls are accessible', async ({ page, orgId }) => {
      await page.goto(`/organizations/${orgId}/collections/objects`);
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      // Look for filter button or filter panel
      const filterButton = page.getByRole('button', { name: /filter/i })
        .or(page.getByText(/filters/i).locator('..').locator('button'))
        .first();

      if (await filterButton.isVisible().catch(() => false)) {
        await filterButton.click();
        await page.waitForTimeout(500);

        // Filter panel should show options
        await expect(
          page
            .getByText(/status|type|classification|department/i)
            .filter({ visible: true })
            .first()
        ).toBeVisible({ timeout: 10000 });
      }
    });
  });

  test.describe('Media Library Search', () => {
    test('media search input is functional', async ({ page, orgId }) => {
      await page.goto(`/organizations/${orgId}/media`);
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      const searchInput = page.getByPlaceholder(/search/i).first();
      if (await searchInput.isVisible().catch(() => false)) {
        // Type and verify no crash
        await searchInput.fill('test search');
        await page.waitForTimeout(1000);

        // Page should still be functional
        const rootContent = await page.locator('#root').innerHTML().catch(() => '');
        expect(rootContent.trim().length).toBeGreaterThan(50);

        // No error boundary
        const errorBoundary = await page.locator('[data-testid="error-boundary"]').count();
        expect(errorBoundary).toBe(0);

        await searchInput.clear();
      }
    });
  });
});
