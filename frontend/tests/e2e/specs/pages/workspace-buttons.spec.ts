import { test, expect } from '../../fixtures';
import { type Page, type ConsoleMessage } from '@playwright/test';
import { createApiErrorMonitor, createSentryIntercept, type SentryIntercept } from '../../utils';

/**
 * Touch Every Button — Workspace/Detail Page Edition
 *
 * For each major entity type:
 *   1. Navigate to the list page
 *   2. Click into the first real record to reach the workspace page
 *   3. Expand every collapsed section
 *   4. Click every non-destructive button in each section
 *   5. After EVERY click, assert no JS exceptions, error boundaries, or 5xx
 *
 * Prerequisites:
 *   - Test org must have at least one record per entity type
 *   - Auth state saved from setup project
 *
 * Run:
 *   npx playwright test workspace-buttons.spec.ts --project=chromium
 *
 * Run single entity:
 *   npx playwright test workspace-buttons.spec.ts -g "Objects"
 */

// Org id comes from the `orgId` fixture (resolved from /api/me) at test time,
// never the PLAYWRIGHT_TEST_ORG_ID slug. config.listPath holds a relative slug.
const collectionsBase = (orgId: string) => `/organizations/${orgId}/collections`;

// Console messages to ignore
const IGNORED_CONSOLE_PATTERNS: RegExp[] = [
  /Download the React DevTools/,
  /Warning: ReactDOM.render is no longer supported/,
  /Third-party cookie will be blocked/,
  /Failed to load resource.*favicon/,
  /\[vite\]/,
  /\[HMR\]/,
  /Manifest: Line:/,
];

const IGNORED_API_PATTERNS: RegExp[] = [
  /\/health/,
  /\/auth\/csrf/,
];

// Buttons to never click in workspace context
const SKIP_BUTTON_PATTERNS: RegExp[] = [
  /sign.?out/i,
  /log.?out/i,
  /delete/i,
  /remove/i,
  /archive/i,
  /deaccession/i,
  /submit/i, // type=submit handled separately but catch text too
  /disable/i,
  /deactivate/i,
  /revoke/i,
  /suspend/i,
];

/**
 * Each workspace config: list URL, how to find the first record link,
 * and the expected workspace URL pattern.
 */
interface WorkspaceConfig {
  name: string;
  listPath: string;
  /** Selector or strategy to find first record link on the list page */
  firstRecordSelector: string;
  /** URL pattern that indicates we've reached the workspace page */
  workspaceUrlPattern: RegExp;
}

const WORKSPACES: WorkspaceConfig[] = [
  {
    name: 'Objects',
    listPath: 'objects',
    firstRecordSelector: 'table tbody tr a, [data-testid="object-row"] a, table tbody tr:first-child td:first-child a',
    workspaceUrlPattern: /\/collections\/objects\/[a-f0-9-]+/,
  },
  {
    name: 'Loans In',
    listPath: 'loans-in',
    firstRecordSelector: 'table tbody tr a, table tbody tr:first-child td:first-child a',
    workspaceUrlPattern: /\/collections\/loans-in\/[a-f0-9-]+/,
  },
  {
    name: 'Loans Out',
    listPath: 'loans-out',
    firstRecordSelector: 'table tbody tr a, table tbody tr:first-child td:first-child a',
    workspaceUrlPattern: /\/collections\/loans-out\/[a-f0-9-]+/,
  },
  {
    name: 'Entries',
    listPath: 'entries',
    firstRecordSelector: 'table tbody tr a, table tbody tr:first-child td:first-child a',
    workspaceUrlPattern: /\/collections\/entries\/[a-f0-9-]+/,
  },
  {
    name: 'Acquisitions',
    listPath: 'acquisitions',
    firstRecordSelector: 'table tbody tr a, table tbody tr:first-child td:first-child a',
    workspaceUrlPattern: /\/collections\/acquisitions\/[a-f0-9-]+/,
  },
  {
    name: 'Conservation',
    listPath: 'conservation',
    firstRecordSelector: 'table tbody tr a, table tbody tr:first-child td:first-child a',
    workspaceUrlPattern: /\/collections\/conservation\/[a-f0-9-]+/,
  },
  {
    name: 'Exits',
    listPath: 'exits',
    firstRecordSelector: 'table tbody tr a, table tbody tr:first-child td:first-child a',
    workspaceUrlPattern: /\/collections\/exits\/[a-f0-9-]+/,
  },
  {
    name: 'Deaccessions',
    listPath: 'deaccessions',
    firstRecordSelector: 'table tbody tr a, table tbody tr:first-child td:first-child a',
    workspaceUrlPattern: /\/collections\/deaccessions\/[a-f0-9-]+/,
  },
  {
    name: 'Condition Reports',
    listPath: 'condition-reports',
    firstRecordSelector: 'table tbody tr a, table tbody tr:first-child td:first-child a',
    workspaceUrlPattern: /\/collections\/condition-reports\/[a-f0-9-]+/,
  },
  {
    name: 'Valuations',
    listPath: 'valuations',
    firstRecordSelector: 'table tbody tr a, table tbody tr:first-child td:first-child a',
    workspaceUrlPattern: /\/collections\/valuations\/[a-f0-9-]+/,
  },
  {
    name: 'Insurance',
    listPath: 'insurance',
    firstRecordSelector: 'table tbody tr a, table tbody tr:first-child td:first-child a',
    workspaceUrlPattern: /\/collections\/insurance\/policies\/[a-f0-9-]+/,
  },
  {
    name: 'Incidents',
    listPath: 'incidents',
    firstRecordSelector: 'table tbody tr a, table tbody tr:first-child td:first-child a',
    workspaceUrlPattern: /\/collections\/incidents\/[a-f0-9-]+/,
  },
  {
    name: 'Use Requests',
    listPath: 'use-requests',
    firstRecordSelector: 'table tbody tr a, table tbody tr:first-child td:first-child a',
    workspaceUrlPattern: /\/collections\/use-requests\/[a-f0-9-]+/,
  },
  {
    name: 'Events',
    listPath: 'events',
    firstRecordSelector: 'table tbody tr a, table tbody tr:first-child td:first-child a',
    workspaceUrlPattern: /\/collections\/events\/[a-f0-9-]+/,
  },
  {
    name: 'Constituents',
    listPath: 'constituents',
    firstRecordSelector: 'table tbody tr a, table tbody tr:first-child td:first-child a',
    workspaceUrlPattern: /\/collections\/constituents\/[a-f0-9-]+/,
  },
  {
    name: 'Exhibitions',
    listPath: 'exhibitions',
    firstRecordSelector: 'table tbody tr a, table tbody tr:first-child td:first-child a',
    workspaceUrlPattern: /\/collections\/exhibitions\/[a-f0-9-]+/,
  },
  {
    name: 'Emergency Plans',
    listPath: 'emergency-plans',
    firstRecordSelector: 'table tbody tr a, table tbody tr:first-child td:first-child a',
    workspaceUrlPattern: /\/collections\/emergency-plans\/[a-f0-9-]+/,
  },
  {
    name: 'Reviews',
    listPath: 'reviews',
    firstRecordSelector: 'table tbody tr a, table tbody tr:first-child td:first-child a',
    workspaceUrlPattern: /\/collections\/reviews\/[a-f0-9-]+/,
  },
  {
    name: 'Audits',
    listPath: 'audits',
    firstRecordSelector: 'table tbody tr a, table tbody tr:first-child td:first-child a',
    workspaceUrlPattern: /\/collections\/audits\/[a-f0-9-]+/,
  },
];

interface ClickIssue {
  section: string;
  button: string;
  type: 'js-exception' | 'error-boundary' | 'api-5xx' | 'console-error' | 'click-failed' | 'sentry-event';
  message: string;
}

/**
 * Check for React error boundary.
 */
async function hasErrorBoundary(page: Page): Promise<boolean> {
  const boundary = page
    .locator('[data-testid="error-boundary"], .error-boundary')
    .first();
  if (await boundary.isVisible().catch(() => false)) return true;

  const bodyText = await page.locator('body').innerText().catch(() => '');
  return (
    /something went wrong/i.test(bodyText) &&
    /error/i.test(bodyText) &&
    bodyText.length < 500
  );
}

/**
 * Dismiss overlays (dialogs, slide-overs, dropdowns).
 */
async function dismissOverlays(page: Page): Promise<void> {
  // Try dialog close buttons
  const dialog = page.getByRole('dialog');
  if (await dialog.isVisible().catch(() => false)) {
    const closeBtn = dialog.locator(
      'button:has-text("Cancel"), button:has-text("Close"), button[aria-label="Close"]'
    );
    if (await closeBtn.first().isVisible().catch(() => false)) {
      await closeBtn.first().click({ timeout: 1000 }).catch(() => {});
      await page.waitForTimeout(300);
    }
  }

  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}

/**
 * Expand all collapsed workspace sections.
 * Workspace sections typically have clickable headers that toggle expand/collapse.
 */
async function expandAllSections(page: Page): Promise<number> {
  // Look for section headers that can be expanded
  // Common patterns: button with aria-expanded="false", collapsible section headers
  const collapsedHeaders = page.locator(
    'button[aria-expanded="false"], [data-testid*="section-header"][aria-expanded="false"]'
  );
  const count = await collapsedHeaders.count();

  for (let i = 0; i < count; i++) {
    const header = collapsedHeaders.nth(i);
    if (await header.isVisible().catch(() => false)) {
      await header.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(300);
    }
  }

  return count;
}

/**
 * Get all clickable buttons in the workspace page (excluding nav/sidebar).
 */
async function getWorkspaceButtons(page: Page): Promise<Array<{
  index: number;
  text: string;
  ariaLabel: string | null;
  type: string | null;
  isDisabled: boolean;
  isVisible: boolean;
  section: string;
}>> {
  return page.evaluate(() => {
    // Target the main content area, excluding sidebar nav
    const mainContent = document.querySelector('main, [role="main"], .workspace-content')
      || document.querySelector('[class*="workspace"]')
      || document.body;

    const buttons = Array.from(mainContent.querySelectorAll('button'));

    return buttons.map((btn, i) => {
      // Try to determine which section the button belongs to
      const section = btn.closest('[data-testid*="section"], [id*="section"], section')
        ?.getAttribute('data-testid')
        || btn.closest('[data-testid*="section"], [id*="section"], section')
          ?.getAttribute('id')
        || 'unknown';

      return {
        index: i,
        text: (btn.textContent || '').trim().substring(0, 120),
        ariaLabel: btn.getAttribute('aria-label'),
        type: btn.getAttribute('type'),
        isDisabled: btn.disabled || btn.getAttribute('aria-disabled') === 'true',
        isVisible: btn.offsetParent !== null && btn.offsetWidth > 0 && btn.offsetHeight > 0,
        section,
      };
    });
  });
}

/**
 * Test all buttons on a workspace page.
 */
async function testWorkspaceButtons(
  page: Page,
  workspaceUrl: string,
  config: WorkspaceConfig,
  sentry: SentryIntercept,
): Promise<{ issues: ClickIssue[]; totalButtons: number; clickedButtons: number }> {
  const issues: ClickIssue[] = [];
  let totalButtons = 0;
  let clickedButtons = 0;

  const jsExceptions: string[] = [];
  const consoleErrors: string[] = [];

  const onError = (err: Error) => {
    jsExceptions.push(`${err.name}: ${err.message}`);
  };
  const onConsole = (msg: ConsoleMessage) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (IGNORED_CONSOLE_PATTERNS.some((p) => p.test(text))) return;
    consoleErrors.push(text);
  };

  page.on('pageerror', onError);
  page.on('console', onConsole);

  const apiMonitor = createApiErrorMonitor(page);
  apiMonitor.ignoreUrls(...IGNORED_API_PATTERNS);

  // Check for page-load errors (5xx, Sentry events) before button testing
  const loadApiErrors = apiMonitor.getErrors().filter((e) => e.status >= 500);
  if (loadApiErrors.length > 0) {
    issues.push({
      section: 'page-load',
      button: '(page load)',
      type: 'api-5xx',
      message: loadApiErrors
        .map((e) => `${e.method} ${new URL(e.url).pathname} => ${e.status}`)
        .join('; ')
        .substring(0, 300),
    });
  }
  const loadSentryEvents = await sentry.drain();
  if (loadSentryEvents.length > 0) {
    issues.push({
      section: 'page-load',
      button: '(page load)',
      type: 'sentry-event',
      message: loadSentryEvents
        .map((e) => `[${e.type}] ${e.message}`)
        .join('; ')
        .substring(0, 300),
    });
  }
  apiMonitor.clear();

  // Expand all sections first
  const expanded = await expandAllSections(page);
  console.log(`    Expanded ${expanded} collapsed sections`);

  // Wait for any lazy-loaded content
  await page.waitForTimeout(500);

  // Snapshot buttons
  const buttons = await getWorkspaceButtons(page);
  totalButtons = buttons.length;
  console.log(`    Found ${totalButtons} buttons in workspace`);

  for (const btn of buttons) {
    // Reset per-click collectors
    jsExceptions.length = 0;
    consoleErrors.length = 0;
    apiMonitor.clear();

    const buttonLabel =
      btn.text.substring(0, 60) || btn.ariaLabel || `button[${btn.index}]`;

    // Skip conditions
    if (!btn.isVisible || btn.isDisabled || btn.type === 'submit') {
      continue;
    }
    if (SKIP_BUTTON_PATTERNS.some((p) => p.test(buttonLabel))) {
      continue;
    }

    // Re-locate via main content area
    const mainContent = page.locator('main, [role="main"], .workspace-content').first();
    const mainExists = await mainContent.isVisible().catch(() => false);
    const container = mainExists ? mainContent : page;
    const allBtns = container.locator('button');
    const count = await allBtns.count();

    if (btn.index >= count) continue;

    const locator = allBtns.nth(btn.index);
    if (!(await locator.isVisible().catch(() => false))) continue;

    // Click
    try {
      await locator.click({ timeout: 3000 });
      clickedButtons++;
    } catch (clickErr) {
      issues.push({
        section: btn.section,
        button: buttonLabel,
        type: 'click-failed',
        message: clickErr instanceof Error ? clickErr.message.substring(0, 200) : 'Click failed',
      });
      continue;
    }

    await page.waitForTimeout(500);

    // Post-click checks
    if (jsExceptions.length > 0) {
      issues.push({
        section: btn.section,
        button: buttonLabel,
        type: 'js-exception',
        message: jsExceptions.join('; ').substring(0, 300),
      });
    }

    if (await hasErrorBoundary(page)) {
      issues.push({
        section: btn.section,
        button: buttonLabel,
        type: 'error-boundary',
        message: 'Error boundary appeared after click',
      });
      // Recover
      await page.goto(workspaceUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      await expandAllSections(page);
      continue;
    }

    const apiErrors = apiMonitor.getErrors().filter((e) => e.status >= 500);
    if (apiErrors.length > 0) {
      issues.push({
        section: btn.section,
        button: buttonLabel,
        type: 'api-5xx',
        message: apiErrors
          .map((e) => `${e.method} ${new URL(e.url).pathname} => ${e.status}`)
          .join('; ')
          .substring(0, 300),
      });
    }

    // Sentry events (caught errors reported to Sentry)
    const sentryEvents = await sentry.drain();
    if (sentryEvents.length > 0) {
      issues.push({
        section: btn.section,
        button: buttonLabel,
        type: 'sentry-event',
        message: sentryEvents
          .map((e) => `[${e.type}] ${e.message}`)
          .join('; ')
          .substring(0, 300),
      });
    }

    if (consoleErrors.length > 0) {
      issues.push({
        section: btn.section,
        button: buttonLabel,
        type: 'console-error',
        message: consoleErrors[0].substring(0, 200),
      });
    }

    // Dismiss overlays
    await dismissOverlays(page);

    // If we navigated away, go back
    if (!page.url().match(config.workspaceUrlPattern)) {
      try {
        await page.goto(workspaceUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
        await expandAllSections(page);
        await page.waitForTimeout(300);
      } catch {
        break;
      }
    }
  }

  page.removeListener('pageerror', onError);
  page.removeListener('console', onConsole);

  return { issues, totalButtons, clickedButtons };
}

// =============================================================================
// TESTS — one per workspace entity type
// =============================================================================

test.describe('Workspace Buttons', () => {
  for (const config of WORKSPACES) {
    test(`${config.name} — expand all sections, click every button`, async ({ page, orgId }) => {
      test.setTimeout(120000); // 2 min per workspace

      // Install Sentry intercept before any navigation
      const sentry = await createSentryIntercept(page);

      // Step 1: Navigate to list page
      console.log(`  Navigating to ${config.name} list: ${config.listPath}`);
      await page.goto(`${collectionsBase(orgId)}/${config.listPath}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      // Wait for table to load
      const table = page.locator('table tbody tr, [data-testid="list-row"]');
      const hasRecords = await table.first().isVisible({ timeout: 10000 }).catch(() => false);

      if (!hasRecords) {
        console.log(`    No records found for ${config.name} — skipping workspace test`);
        test.skip();
        return;
      }

      // Step 2: Click into the first record
      const firstLink = page.locator(config.firstRecordSelector).first();
      const linkVisible = await firstLink.isVisible().catch(() => false);

      if (!linkVisible) {
        // Fallback: click the first table row directly
        const firstRow = page.locator('table tbody tr').first();
        await firstRow.click({ timeout: 5000 });
      } else {
        await firstLink.click({ timeout: 5000 });
      }

      // Capture JS exceptions during page load (catches render-time crashes)
      const loadErrors: string[] = [];
      const onLoadError = (err: Error) => {
        loadErrors.push(`${err.name}: ${err.message}`);
      };
      page.on('pageerror', onLoadError);

      // Wait for workspace page to load
      await page.waitForURL(config.workspaceUrlPattern, { timeout: 15000 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(500);

      const workspaceUrl = page.url();
      console.log(`    Reached workspace: ${workspaceUrl}`);

      // Verify we're on a workspace page (not still on list)
      expect(page.url()).toMatch(config.workspaceUrlPattern);

      // Check for render-time crashes (e.g., null access before data loads)
      const errorBoundaryVisible = await hasErrorBoundary(page);
      expect(
        errorBoundaryVisible,
        `Error boundary on initial load of ${config.name} workspace`
      ).toBe(false);

      expect(
        loadErrors,
        `JS exceptions during initial render of ${config.name}:\n${loadErrors.join('\n')}`
      ).toHaveLength(0);

      page.removeListener('pageerror', onLoadError);

      // Wait for loading spinners
      const spinner = page.locator('[data-testid="loading-spinner"], .animate-spin');
      await spinner.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});

      // Step 3: Test all buttons
      const result = await testWorkspaceButtons(page, workspaceUrl, config, sentry);

      console.log(
        `    ${config.name}: ${result.clickedButtons}/${result.totalButtons} clicked, ${result.issues.length} issues`
      );

      for (const issue of result.issues) {
        console.log(
          `    [${issue.type}] section="${issue.section}" button="${issue.button}" — ${issue.message}`
        );
      }

      // Assert: no critical issues (includes Sentry-reported errors)
      const critical = result.issues.filter(
        (i) => i.type === 'js-exception' || i.type === 'error-boundary' || i.type === 'sentry-event'
      );
      expect(
        critical,
        `Critical issues in ${config.name} workspace:\n${critical.map((i) => `  [${i.type}] "${i.button}" — ${i.message}`).join('\n')}`
      ).toHaveLength(0);

      const serverErrors = result.issues.filter((i) => i.type === 'api-5xx');
      expect(
        serverErrors,
        `Server errors in ${config.name} workspace:\n${serverErrors.map((i) => `  "${i.button}" — ${i.message}`).join('\n')}`
      ).toHaveLength(0);
    });
  }
});

// =============================================================================
// FULL WORKSPACE AUDIT — manual run
// =============================================================================

test.describe('Workspace Buttons: Full Audit', () => {
  test.skip(
    'audit all workspace pages',
    async ({ page, orgId }) => {
      test.setTimeout(600000); // 10 min

      const sentry = await createSentryIntercept(page);

      const results: Array<{
        name: string;
        issues: ClickIssue[];
        totalButtons: number;
        clickedButtons: number;
        skipped: boolean;
      }> = [];

      for (const config of WORKSPACES) {
        console.log(`\n  Testing ${config.name}...`);

        try {
          await page.goto(`${collectionsBase(orgId)}/${config.listPath}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

          const table = page.locator('table tbody tr');
          const hasRecords = await table.first().isVisible({ timeout: 8000 }).catch(() => false);

          if (!hasRecords) {
            results.push({ name: config.name, issues: [], totalButtons: 0, clickedButtons: 0, skipped: true });
            continue;
          }

          const firstLink = page.locator(config.firstRecordSelector).first();
          if (await firstLink.isVisible().catch(() => false)) {
            await firstLink.click({ timeout: 5000 });
          } else {
            await page.locator('table tbody tr').first().click({ timeout: 5000 });
          }

          await page.waitForURL(config.workspaceUrlPattern, { timeout: 15000 }).catch(() => {});
          await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

          const workspaceUrl = page.url();
          const result = await testWorkspaceButtons(page, workspaceUrl, config, sentry);

          results.push({ name: config.name, ...result, skipped: false });
        } catch (err) {
          results.push({
            name: config.name,
            issues: [{
              section: 'navigation',
              button: '(setup)',
              type: 'click-failed',
              message: err instanceof Error ? err.message.substring(0, 200) : 'Unknown error',
            }],
            totalButtons: 0,
            clickedButtons: 0,
            skipped: false,
          });
        }
      }

      // Print report
      console.log('\n' + '='.repeat(70));
      console.log('  WORKSPACE BUTTON AUDIT');
      console.log('='.repeat(70));

      for (const r of results) {
        const status = r.skipped ? 'SKIP' : r.issues.length === 0 ? 'PASS' : 'FAIL';
        console.log(`  [${status}] ${r.name} — ${r.clickedButtons}/${r.totalButtons} buttons, ${r.issues.length} issues`);
        for (const issue of r.issues) {
          console.log(`    [${issue.type}] "${issue.button}" — ${issue.message}`);
        }
      }

      const allCritical = results.flatMap((r) =>
        r.issues.filter((i) => i.type === 'js-exception' || i.type === 'error-boundary' || i.type === 'api-5xx')
      );
      console.log(`\n  Critical issues: ${allCritical.length}`);
      console.log('='.repeat(70));

      expect(allCritical.length, `${allCritical.length} critical workspace issues`).toBe(0);
    }
  );
});
