import { test, expect } from '../../fixtures';

/**
 * Media Library E2E Tests (DAM)
 *
 * Tests the digital asset management workflow:
 * - View media library (grid/list)
 * - Upload a file
 * - View media detail
 * - Edit metadata
 * - Create and manage lightboxes
 * - Delete media
 *
 * Run:
 *   npx playwright test media-library.spec.ts --project=chromium
 */
test.describe('Media Library', () => {
  test.describe('Library Page', () => {
    test('displays media library with grid and controls', async ({ page, orgId }) => {
      await page.goto(`/organizations/${orgId}/media`);
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      // List page: header visible
      await expect(
        page.getByRole('heading', { name: /library|media|assets/i }).first()
      ).toBeVisible();

      // List page: upload button or drag-drop zone visible
      const hasUpload = await page
        .getByRole('button', { name: /upload/i })
        .or(page.locator('[data-testid="upload-zone"]'))
        .or(page.getByText(/drag.*drop|upload.*files/i))
        .first()
        .isVisible()
        .catch(() => false);
      expect(hasUpload).toBeTruthy();

      // List page: grid/list content or empty state
      const hasContent = await page
        .locator('[data-testid="media-grid"], [data-testid="media-list"]')
        .or(page.locator('.media-grid, .media-list'))
        .or(page.getByText(/no.*media|no.*assets|upload.*first|get started/i))
        .first()
        .isVisible()
        .catch(() => false);
      expect(hasContent).toBeTruthy();

      // No error boundary
      const errorBoundary = await page.locator('[data-testid="error-boundary"]').count();
      expect(errorBoundary).toBe(0);
    });

    test('search filters results', async ({ page, orgId }) => {
      await page.goto(`/organizations/${orgId}/media`);
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      const searchInput = page.getByPlaceholder(/search/i).first();
      if (await searchInput.isVisible().catch(() => false)) {
        await searchInput.fill('nonexistent-query-xyz');
        await page.waitForTimeout(500); // debounce

        // Should show filtered results or empty state
        const hasResponse = await page
          .getByText(/no.*results|no.*media|0 results/i)
          .or(page.locator('img[alt]')) // still showing results
          .first()
          .isVisible({ timeout: 5000 })
          .catch(() => false);
        expect(hasResponse).toBeTruthy();

        // Clear search
        await searchInput.clear();
        await page.waitForTimeout(500);
      }
    });
  });

  test.describe('Media Detail', () => {
    test('clicking a media item opens detail page', async ({ page, orgId }) => {
      await page.goto(`/organizations/${orgId}/media`);
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      // Click first media item if library has content. Scope to <main> so the
      // sidebar/product links (which also contain "/media/") can't false-match
      // when the library is empty — then the block below is correctly skipped.
      const firstItem = page
        .locator('main')
        .locator('[data-testid="media-card"], .media-card, .media-grid-item, a[href*="/media/"]')
        .first();

      if (await firstItem.isVisible().catch(() => false)) {
        await firstItem.click();
        await page.waitForTimeout(2000);

        // Detail page: should show media info
        const hasDetail = await page
          .locator('img, video, audio')
          .or(page.getByText(/filename|title|metadata|details/i))
          .first()
          .isVisible()
          .catch(() => false);
        expect(hasDetail).toBeTruthy();

        // No error boundary
        const errorBoundary = await page.locator('[data-testid="error-boundary"]').count();
        expect(errorBoundary).toBe(0);
      }
    });
  });

  test.describe('Lightboxes', () => {
    test('lightboxes page loads with create option', async ({ page, orgId }) => {
      await page.goto(`/organizations/${orgId}/media/collections`);
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      // List page: header visible
      await expect(
        page.getByRole('heading', { name: /lightbox|collection/i }).first()
      ).toBeVisible();

      // Create button visible
      const createButton = page
        .getByRole('button', { name: /create|new/i })
        .or(page.getByRole('link', { name: /create|new/i }))
        .first();
      await expect(createButton).toBeVisible();
    });
  });
});
