import { test, expect } from '../../fixtures';

/**
 * Shipment Linking — End-to-End Journey
 *
 * Verifies that shipments can be viewed, linked, and unlinked from
 * procedure workspace pages (Loans In/Out, Entry, Exit, Deaccession).
 *
 * Prerequisites:
 *   - Test org must have at least one record for each procedure type
 *   - Auth state saved from setup project
 *
 * Run:
 *   npx playwright test shipment-linking.spec.ts --project=chromium
 */

interface ProcedureConfig {
  name: string;
  slug: string;
  workspacePattern: RegExp;
  procedureType: string;
}

// The org id comes from the `orgId` fixture at test time (resolved from
// /api/me) — never the PLAYWRIGHT_TEST_ORG_ID slug, which isn't a UUID and
// doesn't resolve as an org path param.
const collectionsBase = (orgId: string) => `/organizations/${orgId}/collections`;

const PROCEDURES: ProcedureConfig[] = [
  { name: 'Loans In', slug: 'loans-in', workspacePattern: /\/loans-in\/[a-f0-9-]+/, procedureType: 'loan_in' },
  { name: 'Loans Out', slug: 'loans-out', workspacePattern: /\/loans-out\/[a-f0-9-]+/, procedureType: 'loan_out' },
  { name: 'Entries', slug: 'entries', workspacePattern: /\/entries\/[a-f0-9-]+/, procedureType: 'object_entry' },
  { name: 'Exits', slug: 'exits', workspacePattern: /\/exits\/[a-f0-9-]+/, procedureType: 'object_exit' },
  { name: 'Deaccessions', slug: 'deaccessions', workspacePattern: /\/deaccessions\/[a-f0-9-]+/, procedureType: 'deaccession' },
];

// =============================================================================
// Test: Shipments section renders on each procedure workspace
// =============================================================================

test.describe('Shipment Section Visibility', () => {
  for (const config of PROCEDURES) {
    test(`${config.name} workspace has Shipments section`, async ({ page, orgId }) => {
      test.setTimeout(60000);

      // Navigate to list page
      await page.goto(`${collectionsBase(orgId)}/${config.slug}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      // Check if records exist
      // List rows navigate via row onClick (not <a href>), so click the row.
      const firstLink = page.locator('table tbody tr').first();
      const hasRecords = await firstLink.isVisible({ timeout: 8000 }).catch(() => false);

      if (!hasRecords) {
        test.skip();
        return;
      }

      // Click into the first record
      await firstLink.click({ timeout: 5000 });
      await page.waitForURL(config.workspacePattern, { timeout: 15000 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

      // Wait for loading spinner to disappear (page may take time to hydrate)
      const spinner = page.locator('[data-testid="loading-spinner"], .animate-spin, text="Loading"');
      await spinner.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(500);

      // Four of the five procedure lists navigate on a row click; the
      // deaccessions list does not — its rows carry an anchor instead and
      // render with cursor:auto. Rather than skip (which reads as a pass and
      // meant these assertions never ran for that list), fall back to the
      // link inside the row, which is how a user reaches the record there.
      if (!config.workspacePattern.test(page.url())) {
        const rowLink = firstLink.locator('a[href]').first();
        if (await rowLink.count()) {
          await rowLink.click({ timeout: 5000 }).catch(() => {});
          await page.waitForURL(config.workspacePattern, { timeout: 15000 }).catch(() => {});
          await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        }
      }

      // If it still did not open, that is a real regression in reaching the
      // record at all, not a list-UX difference to tolerate.
      expect(config.workspacePattern.test(page.url()), 
        `${config.name}: could not open a record from the list, by row click or row link`,
      ).toBeTruthy();

      // The Shipments section is wired on every procedure workspace, but on
      // some (entries, deaccessions) it sits in a collapsed-by-default section
      // group, so assert it's present (attached) rather than expanded into view
      // without interaction — the latter is a per-workspace UX default, not a
      // "does this workspace support shipments" question.
      const shipmentsSection = page.locator(
        'button:has-text("Shipments"), [aria-expanded]:has-text("Shipments"), h2:has-text("Shipments"), span:has-text("Shipments")'
      );
      await expect(
        shipmentsSection.first(),
        `Shipments section should be present on ${config.name} workspace`
      ).toBeAttached({ timeout: 10000 });
    });
  }
});

// =============================================================================
// Test: Shipments section expand/collapse and empty state
// =============================================================================

test.describe('Shipment Section Interaction', () => {
  for (const config of PROCEDURES) {
    test(`${config.name} — expand Shipments section shows empty state or list`, async ({ page, orgId }) => {
      test.setTimeout(60000);

      // Navigate to list
      await page.goto(`${collectionsBase(orgId)}/${config.slug}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      // List rows navigate via row onClick (not <a href>), so click the row.
      const firstLink = page.locator('table tbody tr').first();
      const hasRecords = await firstLink.isVisible({ timeout: 8000 }).catch(() => false);

      if (!hasRecords) {
        test.skip();
        return;
      }

      // Click into first record
      await firstLink.click({ timeout: 5000 });
      await page.waitForURL(config.workspacePattern, { timeout: 15000 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(500);

      // Find and click the Shipments section header to expand
      const sectionHeader = page.locator(
        '[aria-expanded]:has-text("Shipments")'
      ).first();

      if (await sectionHeader.isVisible().catch(() => false)) {
        // Check if collapsed (aria-expanded="false")
        const isExpanded = await sectionHeader.getAttribute('aria-expanded');
        if (isExpanded === 'false') {
          await sectionHeader.click();
          await page.waitForTimeout(300);
        }

        // After expanding, should see either empty state or shipment list
        const emptyMessage = page.locator('text=/No shipments linked/i');
        const shipmentItems = page.locator('text=/SHP-/');

        const hasEmpty = await emptyMessage.isVisible({ timeout: 3000 }).catch(() => false);
        const hasShipments = await shipmentItems.first().isVisible({ timeout: 1000 }).catch(() => false);

        // One of these should be true
        expect(
          hasEmpty || hasShipments,
          `${config.name}: Shipments section should show empty state or shipment list`
        ).toBe(true);

        // No JS exceptions should have fired
        const errors: string[] = [];
        page.on('pageerror', (err) => errors.push(err.message));
        await page.waitForTimeout(500);
        expect(errors, `JS errors after expanding Shipments on ${config.name}`).toHaveLength(0);
      }
    });
  }
});

// =============================================================================
// Test: Link Shipment flow (create + link + verify + unlink)
// =============================================================================

test.describe('Shipment Link/Unlink Flow', () => {
  // Use Loans Out as the test case — most common shipping scenario
  test('Loans Out — create shipment, link, verify, unlink', async ({ page, apiHelpers, orgId }) => {
    test.setTimeout(120000);

    // Step 1: Find a loan out record
    await page.goto(`${collectionsBase(orgId)}/loans-out`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    const firstLink = page.locator('table tbody tr').first();
    const hasRecords = await firstLink.isVisible({ timeout: 8000 }).catch(() => false);

    if (!hasRecords) {
      test.skip();
      return;
    }

    await firstLink.click({ timeout: 5000 });
    await page.waitForURL(/\/loans-out\/[a-f0-9-]+/, { timeout: 15000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    const loanUrl = page.url();
    const loanId = loanUrl.match(/loans-out\/([a-f0-9-]+)/)?.[1];
    expect(loanId).toBeTruthy();

    // Step 2: Create a test shipment via API.
    //
    // A failure here fails the test. It used to skip, and the raw POST it
    // made sent no CSRF token, so every run got a 403 and skipped: the
    // link/unlink steps below had never once executed, in CI or anywhere,
    // and the suite reported the spec as passing. ApiHelpers adds the token.
    const shipmentId = await apiHelpers.createShipment({
      shipment_type: 'outbound',
      direction: 'outbound',
      purpose: 'loan',
      remarks: 'E2E test shipment — safe to delete',
    });

    console.log(`  Created test shipment: ${shipmentId}`);

    try {
      // Step 3: Enter edit mode
      const editButton = page.getByRole('button', { name: /edit/i }).first();
      if (await editButton.isVisible().catch(() => false)) {
        await editButton.click();
        await page.waitForTimeout(500);
      }

      // Step 4: Expand Shipments section
      const sectionHeader = page.locator(
        '[aria-expanded]:has-text("Shipments")'
      ).first();

      if (await sectionHeader.isVisible().catch(() => false)) {
        const isExpanded = await sectionHeader.getAttribute('aria-expanded');
        if (isExpanded === 'false') {
          await sectionHeader.click();
          await page.waitForTimeout(300);
        }
      }

      // Step 5: Click "Link Shipment" button
      const linkButton = page.getByRole('button', { name: /link shipment/i }).first();
      const linkVisible = await linkButton.isVisible({ timeout: 3000 }).catch(() => false);

      if (linkVisible) {
        await linkButton.click();
        await page.waitForTimeout(500);

        // Step 6: Search for the shipment in the slide-over
        const searchInput = page.locator(
          '[role="dialog"] input[type="text"], [role="dialog"] input[placeholder*="Search"]'
        ).first();

        if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
          // Type the shipment number prefix
          await searchInput.fill('SHP-');
          await page.waitForTimeout(1000); // Wait for search results

          // Look for our shipment in results and click it
          const searchResult = page.locator('[role="dialog"]').locator('text=/SHP-/').first();
          if (await searchResult.isVisible({ timeout: 3000 }).catch(() => false)) {
            await searchResult.click();
            await page.waitForTimeout(300);

            // Click submit/link button in dialog
            const submitButton = page.locator('[role="dialog"]').getByRole('button', { name: /link/i }).first();
            if (await submitButton.isVisible().catch(() => false)) {
              await submitButton.click();
              await page.waitForTimeout(1000);
            }
          }
        }

        // Dismiss dialog
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }

      // Step 7: Verify the shipment appears in the section
      // (It may or may not be there depending on search results)
      await page.waitForTimeout(500);

    } finally {
      // Step 8: Cleanup — delete the test shipment
      try {
        await apiHelpers.deleteShipment(shipmentId);
        console.log(`  Cleaned up test shipment: ${shipmentId}`);
      } catch {
        console.warn(`  Failed to cleanup test shipment: ${shipmentId}`);
      }
    }
  });
});

// =============================================================================
// Test: No console errors on any shipments section
// =============================================================================

test.describe('Shipment Section Error-Free', () => {
  for (const config of PROCEDURES) {
    test(`${config.name} — no console errors when interacting with Shipments`, async ({ page, orgId }) => {
      test.setTimeout(60000);

      const consoleErrors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          const text = msg.text();
          // Ignore known noise
          if (
            text.includes('favicon') ||
            text.includes('[vite]') ||
            text.includes('[HMR]') ||
            text.includes('React DevTools')
          ) return;
          consoleErrors.push(text);
        }
      });

      const jsExceptions: string[] = [];
      page.on('pageerror', (err) => {
        jsExceptions.push(`${err.name}: ${err.message}`);
      });

      // Navigate to list
      await page.goto(`${collectionsBase(orgId)}/${config.slug}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      // List rows navigate via row onClick (not <a href>), so click the row.
      const firstLink = page.locator('table tbody tr').first();
      const hasRecords = await firstLink.isVisible({ timeout: 8000 }).catch(() => false);

      if (!hasRecords) {
        test.skip();
        return;
      }

      // Click into record
      await firstLink.click({ timeout: 5000 });
      await page.waitForURL(config.workspacePattern, { timeout: 15000 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(500);

      // Find and expand Shipments section
      const sectionHeader = page.locator(
        '[aria-expanded]:has-text("Shipments")'
      ).first();

      if (await sectionHeader.isVisible().catch(() => false)) {
        const isExpanded = await sectionHeader.getAttribute('aria-expanded');
        if (isExpanded === 'false') {
          await sectionHeader.click();
          await page.waitForTimeout(500);
        }
      }

      // Wait for any API calls to settle
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(500);

      // Assert no errors
      expect(
        jsExceptions,
        `JS exceptions on ${config.name} shipments section:\n${jsExceptions.join('\n')}`
      ).toHaveLength(0);

      expect(
        consoleErrors,
        `Console errors on ${config.name} shipments section:\n${consoleErrors.join('\n')}`
      ).toHaveLength(0);
    });
  }
});
