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
  // Loans Out, the most common shipping scenario. Every step asserts. This
  // test used to wrap each step in an isVisible() guard with no expect() and
  // pass whether or not linking worked; its dialog selectors looked for
  // [role="dialog"], which SlideOver does not set, so the guarded steps never
  // even ran. It also borrowed whatever loan out happened to exist, which the
  // E2E seed does not create. It now makes what it needs.
  test('Loans Out — create shipment, link, verify, unlink', async ({ page, apiHelpers, orgId }) => {
    test.setTimeout(120000);

    const loanId = await apiHelpers.getOrCreateLoanOut();
    const shipment = await apiHelpers.createShipment({
      shipment_type: 'outbound',
      direction: 'outbound',
      purpose: 'loan',
      remarks: 'E2E test shipment — safe to delete',
    });

    try {
      // Edit mode has its own URL, and the Shipments section only offers
      // Link and Unlink in edit mode.
      await page.goto(`${collectionsBase(orgId)}/loans-out/${loanId}/edit`, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });
      const section = page.locator('#section-shipments');
      await expect(section).toBeVisible({ timeout: 15000 });
      const header = section.locator('[aria-expanded]').first();
      if ((await header.getAttribute('aria-expanded')) === 'false') {
        await header.click();
      }

      // Link: search for this test's own shipment, not the first SHP- result.
      // An empty section offers Link Shipment twice (header and empty state);
      // both open the same slide-over.
      await section.getByRole('button', { name: 'Link Shipment' }).first().click();
      // SlideOver has no dialog role yet, so anchor on its focus panel.
      const panel = page
        .locator('[tabindex="-1"]')
        .filter({ has: page.getByRole('heading', { name: 'Link Shipment' }) });
      await expect(panel).toBeVisible();
      await panel.getByPlaceholder('Search by shipment number...').fill(shipment.shipment_number);
      await panel.getByRole('button', { name: shipment.shipment_number }).click();
      await panel.getByRole('button', { name: 'Link Shipment' }).click();
      await expect(panel).toBeHidden();

      // Linked: shown in the section, and recorded on the server.
      await expect(section.getByText(shipment.shipment_number)).toBeVisible();
      expect(await apiHelpers.shipmentsReferencing('loan_out', loanId)).toContain(
        shipment.shipment_id
      );

      // Unlink, from this shipment's own row.
      const row = section
        .locator('div')
        .filter({ hasText: shipment.shipment_number })
        .filter({ has: page.getByRole('button', { name: 'Unlink' }) })
        .last();
      await row.getByRole('button', { name: 'Unlink' }).click();

      // Unlinked: gone from the section and from the server.
      await expect(section.getByText(shipment.shipment_number)).toHaveCount(0);
      expect(await apiHelpers.shipmentsReferencing('loan_out', loanId)).not.toContain(
        shipment.shipment_id
      );
    } finally {
      await apiHelpers.deleteShipment(shipment.shipment_id).catch(() => {
        console.warn(`  Failed to clean up test shipment ${shipment.shipment_id}`);
      });
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
