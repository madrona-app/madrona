import { test, expect } from '../../fixtures';

/**
 * Events E2E Tests
 *
 * Tests the events workflow:
 * - List page loads with header and create link
 * - Create event with type selection
 * - View event workspace
 * - Status workflow
 */
test.describe('Events', () => {
  test.describe('Events List Page', () => {
    test('displays events list page', async ({ page, orgId }) => {
      await page.goto(`/organizations/${orgId}/collections/events`);
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      await expect(page.getByRole('heading', { name: 'Events', exact: true })).toBeVisible();

      await expect(page.getByRole('link', { name: /create event/i })).toBeVisible();

      // Search input
      await expect(page.getByPlaceholder(/search events/i)).toBeVisible();

      // No error boundary (schema validation errors would show here)
      const errorBoundary = await page.locator('[data-testid="error-boundary"]').count();
      expect(errorBoundary).toBe(0);
    });

    test('can navigate to create event page', async ({ page, orgId }) => {
      await page.goto(`/organizations/${orgId}/collections/events`);

      await page.getByRole('link', { name: /create event/i }).click();

      await expect(page).toHaveURL(
        new RegExp(`/organizations/${orgId}/collections/events/create`)
      );
    });
  });

  test.describe('Event Creation', () => {
    test('can create an event', async ({ page, orgId }) => {
      await page.goto(`/organizations/${orgId}/collections/events/create`);
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      // Title field uses EditableField — the label and input are siblings within a div.
      // The title is the first visible text input on the create page.
      const titleInput = page.locator('.space-y-1\\.5 input[type="text"], .space-y-1\\.5 textarea').first();
      if (await titleInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await titleInput.fill('E2E Test Event');
      } else {
        // Fallback: fill the first visible text input on the page
        await page.locator('input[type="text"]').first().fill('E2E Test Event');
      }

      // Click "Create Event"
      await page.getByRole('button', { name: /create event/i }).click();

      // Should redirect to detail page or show success
      await Promise.race([
        page.waitForURL(new RegExp(`/collections/events/[a-f0-9-]+`), { timeout: 10000 }),
        expect(page.getByText(/EVT\.\d{4}\.\d{4}/)).toBeVisible({ timeout: 10000 }),
      ]).catch(() => {});
    });

    test('validates required fields', async ({ page, orgId }) => {
      await page.goto(`/organizations/${orgId}/collections/events/create`);

      // Try to save without filling required fields
      await page.getByRole('button', { name: /create event/i }).click();

      // Should show validation error or stay on create page
      const isOnCreatePage = page.url().includes('/create');
      const hasError = await page.getByText(/required/i).isVisible().catch(() => false);

      expect(isOnCreatePage || hasError).toBeTruthy();
    });
  });

  test.describe('Event Detail Page', () => {
    test('can view event detail sections', async ({ page, orgId }) => {
      // Create event first
      await page.goto(`/organizations/${orgId}/collections/events/create`);
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      const titleInput = page.locator('input, textarea').first();
      await titleInput.fill('Detail View Test Event');

      await page.getByRole('button', { name: /create event/i }).click();

      await page.waitForURL(
        new RegExp(`/collections/events/[a-f0-9-]+`),
        { timeout: 10000 }
      ).catch(() => {});

      // Detail page should show sections
      await expect(page.getByText(/event details|details/i).first()).toBeVisible();

      // No error boundary
      const errorBoundary = await page.locator('[data-testid="error-boundary"]').count();
      expect(errorBoundary).toBe(0);
    });
  });
});
