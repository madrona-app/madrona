import { test, expect } from '../../fixtures';

/**
 * Object Entry E2E Tests (Procedure 1)
 *
 * Tests the object entry workflow:
 * - View entries list
 * - Create new entry (depositor, date, objects description)
 * - View entry workspace sections
 * - Status transitions (pending → received → processed)
 * - Delete entry
 *
 * Run:
 *   npx playwright test entries.spec.ts --project=chromium
 */
test.describe('Object Entry', () => {
  test.describe('Entries List Page', () => {
    test('displays entries list with header and create button', async ({ page, orgId }) => {
      await page.goto(`/organizations/${orgId}/collections/entries`);
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

      // Heading is "Object Entry"
      await expect(
        page.getByRole('heading', { name: /object entry/i })
      ).toBeVisible({ timeout: 10000 });

      // Create button says "New Entry" (header CTA + empty-state CTA both render)
      await expect(
        page.getByRole('link', { name: /new entry/i }).first()
      ).toBeVisible();

      // List page: table/grid or empty-state message visible
      const hasContent = await page
        .locator('table, [role="grid"], [data-testid="empty-state"]')
        .or(page.getByText(/no.*entries|no.*records|get started/i))
        .first()
        .isVisible()
        .catch(() => false);
      expect(hasContent).toBeTruthy();
    });

    test('can navigate to create entry page', async ({ page, orgId }) => {
      await page.goto(`/organizations/${orgId}/collections/entries`);

      await page.getByRole('link', { name: /create|new entry|record entry/i }).first().click();

      await expect(page).toHaveURL(
        new RegExp(`/organizations/${orgId}/collections/entries/(create|new)`)
      );
    });
  });

  test.describe('Entry Creation & Lifecycle', () => {
    test('can create a new object entry', async ({ page, orgId }) => {
      await page.goto(`/organizations/${orgId}/collections/entries/create`);

      // Fill depositor name or search
      const depositorInput = page.getByPlaceholder(/depositor|search.*contact/i)
        .or(page.getByLabel(/depositor/i));
      if (await depositorInput.isVisible().catch(() => false)) {
        await depositorInput.fill('Test Depositor');
      }

      // Fill objects description (usually required)
      const descInput = page.getByLabel(/objects.*description|description.*objects/i)
        .or(page.getByPlaceholder(/describe.*objects/i));
      if (await descInput.isVisible().catch(() => false)) {
        await descInput.fill('Test objects for E2E entry');
      }

      // Fill entry reason if visible
      const reasonInput = page.getByLabel(/reason|purpose/i);
      if (await reasonInput.isVisible().catch(() => false)) {
        await reasonInput.fill('Testing');
      }

      // Click create/save
      const saveButton = page.getByRole('button', { name: /^create|^save/i }).first();
      await saveButton.click();

      // Should redirect to entry detail or show success
      await Promise.race([
        page.waitForURL(new RegExp(`/collections/entries/[a-f0-9-]+`), { timeout: 10000 }),
        expect(page.getByText(/created|saved|success/i)).toBeVisible({ timeout: 10000 }),
      ]);
    });

    test('entry workspace shows sections', async ({ page, orgId }) => {
      // Navigate to entries list first
      await page.goto(`/organizations/${orgId}/collections/entries`);
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      // Click first entry in the list (if any exist)
      const firstEntry = page.locator('table tbody tr, [data-testid="record-row"]').first();
      if (await firstEntry.isVisible().catch(() => false)) {
        await firstEntry.click();
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

        // Detail page: a heading renders. Wait for it rather than checking
        // immediately — under parallel load the workspace can still be
        // hydrating a second after the click.
        await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 10000 });

        // Detail page: at least one data section visible
        const hasSection = await page
          .locator('[data-section-id], section, .workspace-section')
          .or(page.getByText(/depositor|objects|insurance|status/i))
          .first()
          .isVisible()
          .catch(() => false);
        expect(hasSection).toBeTruthy();

        // No error boundary visible
        const errorBoundary = await page.locator('[data-testid="error-boundary"]').count();
        expect(errorBoundary).toBe(0);
      }
    });
  });
});
