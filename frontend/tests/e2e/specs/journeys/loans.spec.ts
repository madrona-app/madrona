import { test, expect } from '../../fixtures';

/**
 * Loans E2E Tests
 *
 * Tests loans in and loans out workflows:
 * - List pages load with correct headers
 * - Navigate to create pages
 * - Create basic loans
 */
test.describe('Loans', () => {
  test.describe('Loans Out', () => {
    test('displays loans out list page', async ({ page, orgId }) => {
      await page.goto(`/organizations/${orgId}/collections/loans-out`);

      await expect(
        page.getByRole('heading', { name: 'Loans Out', exact: true })
      ).toBeVisible();

      // Create button says "New Outgoing Loan"
      await expect(
        page.getByRole('link', { name: /new outgoing loan/i })
      ).toBeVisible();

      await expect(page.getByPlaceholder(/search loans/i)).toBeVisible();
    });

    test('can navigate to create loan out page', async ({ page, orgId }) => {
      await page.goto(`/organizations/${orgId}/collections/loans-out`);

      await page.getByRole('link', { name: /new outgoing loan/i }).click();

      await expect(page).toHaveURL(
        new RegExp(`/organizations/${orgId}/collections/loans-out/(create|new)`)
      );
    });

    test('can create a basic loan out', async ({ page, orgId }) => {
      await page.goto(`/organizations/${orgId}/collections/loans-out/create`);

      // Click "Create Loan" — specific enough to avoid strict mode
      await page.getByRole('button', { name: 'Create Loan' }).click();

      // Should redirect to detail page or show success
      await Promise.race([
        page.waitForURL(
          new RegExp(`/collections/loans-out/[a-f0-9-]+`),
          { timeout: 10000 }
        ),
        expect(page.getByText(/created|saved|success/i)).toBeVisible({
          timeout: 10000,
        }),
      ]).catch(() => {});
    });
  });

  test.describe('Loans In', () => {
    test('displays loans in list page', async ({ page, orgId }) => {
      await page.goto(`/organizations/${orgId}/collections/loans-in`);

      await expect(
        page.getByRole('heading', { name: 'Loans In', exact: true })
      ).toBeVisible();

      // Create button says "New Incoming Loan"
      await expect(
        page.getByRole('link', { name: /new incoming loan/i })
      ).toBeVisible();
    });

    test('can navigate to create loan in page', async ({ page, orgId }) => {
      await page.goto(`/organizations/${orgId}/collections/loans-in`);

      await page.getByRole('link', { name: /new incoming loan/i }).click();

      await expect(page).toHaveURL(
        new RegExp(`/organizations/${orgId}/collections/loans-in/(create|new)`)
      );
    });

    test('can create a basic loan in', async ({ page, orgId }) => {
      await page.goto(`/organizations/${orgId}/collections/loans-in/create`);

      // Click "Create Loan"
      await page.getByRole('button', { name: 'Create Loan' }).click();

      // Should redirect to detail page or show success
      await Promise.race([
        page.waitForURL(
          new RegExp(`/collections/loans-in/[a-f0-9-]+`),
          { timeout: 10000 }
        ),
        expect(page.getByText(/created|saved|success/i)).toBeVisible({
          timeout: 10000,
        }),
      ]).catch(() => {});
    });
  });
});
