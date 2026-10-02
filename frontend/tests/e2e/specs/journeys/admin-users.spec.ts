import { test, expect } from '../../fixtures';

/**
 * Admin Users E2E Tests
 *
 * Tests organization user administration:
 * - Users list page with invite button
 * - User information display
 * - Invite user modal (custom modal, not role="dialog")
 * - Roles list page
 * - Audit logs page
 */
test.describe('Admin Users', () => {
  test.describe('Users List Page', () => {
    test('displays users list page with header and invite button', async ({ page, orgId }) => {
      await page.goto(`/organizations/${orgId}/admin/users`);
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

      await expect(
        page.getByRole('heading', { name: /users/i })
      ).toBeVisible({ timeout: 10000 });

      await expect(
        page.getByRole('button', { name: /invite user/i })
      ).toBeVisible();
    });

    test('shows user information in list', async ({ page, orgId }) => {
      await page.goto(`/organizations/${orgId}/admin/users`);
      await page.waitForLoadState('networkidle');

      // Should show at least one user row with email
      const hasEmailColumn = await page.getByText(/@/).first().isVisible().catch(() => false);
      const hasRoleColumn = await page
        .getByText(/admin|viewer|editor|organization/i)
        .first()
        .isVisible()
        .catch(() => false);

      expect(hasEmailColumn || hasRoleColumn).toBeTruthy();
    });
  });

  test.describe('User Invitation', () => {
    test('can open invite user modal', async ({ page, orgId }) => {
      await page.goto(`/organizations/${orgId}/admin/users`);

      await page.getByRole('button', { name: /invite user/i }).click();

      // Modal opens — it's a custom overlay, not role="dialog"
      // Look for "Invite User" heading inside the modal
      await expect(
        page.getByRole('heading', { name: /invite user/i })
      ).toBeVisible({ timeout: 5000 });

      // Check for email input (labeled "Email Address")
      await expect(
        page.getByLabel(/email address/i)
      ).toBeVisible();
    });

    test('can close invite modal', async ({ page, orgId }) => {
      await page.goto(`/organizations/${orgId}/admin/users`);

      await page.getByRole('button', { name: /invite user/i }).click();

      // Wait for modal heading
      await expect(
        page.getByRole('heading', { name: /invite user/i })
      ).toBeVisible({ timeout: 5000 });

      // Close via X button (aria-label="Close invite modal")
      await page.getByLabel(/close invite modal/i).click();

      // Modal heading should disappear
      await expect(
        page.getByRole('heading', { name: /invite user/i })
      ).not.toBeVisible({ timeout: 5000 });
    });
  });
});

test.describe('Admin Roles', () => {
  test('displays roles list page', async ({ page, orgId }) => {
    await page.goto(`/organizations/${orgId}/admin/roles`);

    await expect(
      page.getByRole('heading', { name: /role management/i })
    ).toBeVisible();
  });

  test('shows predefined roles', async ({ page, orgId }) => {
    await page.goto(`/organizations/${orgId}/admin/roles`);
    await page.waitForLoadState('networkidle');

    const commonRoles = [/admin/i, /viewer/i, /editor/i];
    let foundRole = false;
    for (const role of commonRoles) {
      if (await page.getByText(role).first().isVisible({ timeout: 2000 }).catch(() => false)) {
        foundRole = true;
        break;
      }
    }
    expect(foundRole).toBeTruthy();
  });
});

test.describe('Admin Audit Logs', () => {
  test('displays audit logs page', async ({ page, orgId }) => {
    await page.goto(`/organizations/${orgId}/admin/entity-audit`);

    await expect(page.getByRole('heading', { name: /audit|change history|logs/i })).toBeVisible();

    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Page should have rendered content (table rows, entries, or empty state)
    const rootContent = await page.locator('#root').innerHTML().catch(() => '');
    expect(rootContent.trim().length).toBeGreaterThan(100);

    // No error boundary
    const errorBoundary = await page.locator('[data-testid="error-boundary"]').count();
    expect(errorBoundary).toBe(0);
  });
});
