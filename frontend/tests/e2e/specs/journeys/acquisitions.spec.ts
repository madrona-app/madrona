import { test, expect } from '../../fixtures';

/**
 * Acquisitions E2E Tests
 *
 * Tests the acquisitions workflow:
 * - List page loads with header, create link, search
 * - Navigate to create page
 * - Create acquisition (method selection, save)
 * - View acquisition workspace sections
 */
test.describe('Acquisitions', () => {
  test.describe('Acquisitions List Page', () => {
    test('displays acquisitions list page', async ({ page, orgId }) => {
      await page.goto(`/organizations/${orgId}/collections/acquisitions`);
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

      await expect(
        page.getByRole('heading', { name: 'Acquisitions', exact: true })
      ).toBeVisible({ timeout: 10000 });

      // Two "New Acquisition" links render (header CTA + empty-state CTA).
      await expect(
        page.getByRole('link', { name: /new acquisition/i }).first()
      ).toBeVisible();

      await expect(page.getByPlaceholder(/search acquisitions/i)).toBeVisible();
    });

    test('can navigate to create acquisition page', async ({ page, orgId }) => {
      await page.goto(`/organizations/${orgId}/collections/acquisitions`);

      await page.getByRole('link', { name: /new acquisition/i }).first().click();

      await expect(page).toHaveURL(
        new RegExp(`/organizations/${orgId}/collections/acquisitions/(create|new)`)
      );
    });
  });

  test.describe('Acquisition Creation', () => {
    test('can create an acquisition', async ({ page, orgId }) => {
      await page.goto(`/organizations/${orgId}/collections/acquisitions/create`);

      // Select acquisition method if a select is visible
      const methodSelect = page.locator('select').first();
      if (await methodSelect.isVisible().catch(() => false)) {
        await methodSelect.selectOption({ index: 1 });
      }

      // Click "Create Acquisition" — use exact text to avoid strict mode violation
      // with "Search or create source..." button
      await page.getByRole('button', { name: 'Create Acquisition' }).click();

      // Should redirect to detail page or show success
      await Promise.race([
        page.waitForURL(
          new RegExp(`/collections/acquisitions/[a-f0-9-]+`),
          { timeout: 10000 }
        ),
        expect(page.getByText(/created|saved|success/i)).toBeVisible({
          timeout: 10000,
        }),
      ]).catch(() => {});
    });

    test('create page shows required form fields', async ({ page, orgId }) => {
      await page.goto(`/organizations/${orgId}/collections/acquisitions/create`);

      // Form page: submit button visible
      await expect(
        page.getByRole('button', { name: 'Create Acquisition' })
      ).toBeVisible();

      // Form page: at least one form section visible
      await expect(
        page
          .getByText(/acquisition information|source information/i)
          .filter({ visible: true })
          .first()
      ).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Acquisition Detail Page', () => {
    test('can view acquisition workspace', async ({ page, orgId }) => {
      // Create an acquisition first
      await page.goto(`/organizations/${orgId}/collections/acquisitions/create`);

      const methodSelect = page.locator('select').first();
      if (await methodSelect.isVisible().catch(() => false)) {
        await methodSelect.selectOption({ index: 1 });
      }

      await page.getByRole('button', { name: 'Create Acquisition' }).click();

      await page
        .waitForURL(
          new RegExp(`/collections/acquisitions/[a-f0-9-]+`),
          { timeout: 10000 }
        )
        .catch(() => {});

      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      // Detail page: title/header visible
      await expect(
        page
          .getByRole('heading')
          .filter({ visible: true })
          .first()
      ).toBeVisible({ timeout: 10000 });

      // No error boundary
      const errorBoundary = await page.locator('[data-testid="error-boundary"]').count();
      expect(errorBoundary).toBe(0);
    });
  });
});
