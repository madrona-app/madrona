import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';
import {
  generateAuthenticatedRoutes,
  groupRoutesByProduct,
  PUBLIC_ROUTES,
  createApiErrorMonitor,
  createSentryIntercept,
  type TestRoute,
} from '../../utils';

/**
 * Touch Every Button — List/Nav Page Edition
 *
 * For every route derived from navigationConfig:
 *   1. Navigate to the page
 *   2. Discover all <button> elements
 *   3. Click each one (skip submit buttons, hidden, disabled)
 *   4. After EVERY click, assert:
 *      - No JS exceptions thrown
 *      - No React error boundary appeared
 *      - No 5xx API responses
 *   5. Dismiss any modal/dialog that opened, then continue
 *
 * Run:
 *   npx playwright test all-buttons.spec.ts --project=chromium
 *
 * Run single product:
 *   npx playwright test all-buttons.spec.ts -g "collections"
 */

const TEST_ORG_ID =
  process.env.PLAYWRIGHT_TEST_ORG_ID || 'c62f6243-b50e-4f10-a6b3-80425de6c01d';

// API patterns to ignore (known acceptable errors)
const IGNORED_API_PATTERNS: RegExp[] = [
  /\/health/,
  /\/auth\/csrf/,
];

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

// Buttons that are known to cause navigation away (don't click these)
const DANGEROUS_BUTTON_PATTERNS: RegExp[] = [
  /sign.?out/i,
  /log.?out/i,
  /delete.*permanently/i,
  /confirm.*delete/i,
  /remove.*all/i,
  /disable/i,
  /deactivate/i,
  /revoke/i,
  /suspend/i,
];

interface ButtonSnapshot {
  index: number;
  text: string;
  ariaLabel: string | null;
  title: string | null;
  type: string | null;
  role: string | null;
  isDisabled: boolean;
  isVisible: boolean;
  testId: string | null;
}

interface ClickIssue {
  button: string;
  type: 'js-exception' | 'error-boundary' | 'api-5xx' | 'console-error' | 'click-failed' | 'sentry-event';
  message: string;
}

interface PageReport {
  route: string;
  product: string;
  totalButtons: number;
  clickedButtons: number;
  skippedButtons: number;
  issues: ClickIssue[];
}

/**
 * Snapshot all buttons on the current page.
 */
async function snapshotButtons(page: Page): Promise<ButtonSnapshot[]> {
  return page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.map((btn, i) => ({
      index: i,
      text: (btn.textContent || '').trim().substring(0, 120),
      ariaLabel: btn.getAttribute('aria-label'),
      title: btn.getAttribute('title'),
      type: btn.getAttribute('type'),
      role: btn.getAttribute('role'),
      isDisabled: btn.disabled || btn.getAttribute('aria-disabled') === 'true',
      isVisible: btn.offsetParent !== null && btn.offsetWidth > 0 && btn.offsetHeight > 0,
      testId: btn.getAttribute('data-testid'),
    }));
  });
}

/**
 * Check if a button looks dangerous to click.
 */
function isDangerous(btn: ButtonSnapshot): boolean {
  const label = btn.text || btn.ariaLabel || btn.title || '';
  return DANGEROUS_BUTTON_PATTERNS.some((p) => p.test(label));
}

/**
 * Dismiss any open modal/dialog/slide-over.
 */
async function dismissOverlays(page: Page): Promise<void> {
  // Try role="dialog" first
  const dialog = page.getByRole('dialog');
  if (await dialog.isVisible().catch(() => false)) {
    // Look for close/cancel button inside the dialog
    const closeBtn = dialog.locator(
      'button:has-text("Cancel"), button:has-text("Close"), button[aria-label="Close"], button[aria-label="close"]'
    );
    if (await closeBtn.first().isVisible().catch(() => false)) {
      await closeBtn.first().click({ timeout: 1000 }).catch(() => {});
      await page.waitForTimeout(300);
    }
  }

  // Escape key as fallback
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // Second escape in case of nested overlays
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}

/**
 * Check for React error boundary on the page.
 */
async function hasErrorBoundary(page: Page): Promise<boolean> {
  const boundary = page
    .locator('[data-testid="error-boundary"], .error-boundary')
    .first();
  if (await boundary.isVisible().catch(() => false)) return true;

  // Check for short "something went wrong" pages
  const bodyText = await page.locator('body').innerText().catch(() => '');
  if (
    /something went wrong/i.test(bodyText) &&
    /error/i.test(bodyText) &&
    bodyText.length < 500
  ) {
    return true;
  }

  return false;
}

/**
 * Test every button on a single page.
 */
async function testPageButtons(
  page: Page,
  route: TestRoute
): Promise<PageReport> {
  const report: PageReport = {
    route: route.path,
    product: route.product,
    totalButtons: 0,
    clickedButtons: 0,
    skippedButtons: 0,
    issues: [],
  };

  // --- Error collectors ---
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

  // Install Sentry intercept to catch handled errors (e.g., Zod validation)
  const sentry = await createSentryIntercept(page);

  // --- Navigate ---
  try {
    await page.goto(route.path, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(500);
  } catch (err) {
    report.issues.push({
      button: '(navigation)',
      type: 'click-failed',
      message: err instanceof Error ? err.message : 'Navigation failed',
    });
    page.removeListener('pageerror', onError);
    page.removeListener('console', onConsole);
    return report;
  }

  // Check for load-time errors
  if (await hasErrorBoundary(page)) {
    report.issues.push({
      button: '(page load)',
      type: 'error-boundary',
      message: 'Error boundary visible on initial load',
    });
  }

  // Check for 5xx during page load (before any button clicks)
  const loadApiErrors = apiMonitor.getErrors().filter((e) => e.status >= 500);
  if (loadApiErrors.length > 0) {
    report.issues.push({
      button: '(page load)',
      type: 'api-5xx',
      message: loadApiErrors
        .map((e) => `${e.method} ${new URL(e.url).pathname} => ${e.status}`)
        .join('; ')
        .substring(0, 300),
    });
  }

  // Check for Sentry events fired during page load (e.g., Zod schema mismatches)
  const loadSentryEvents = await sentry.drain();
  if (loadSentryEvents.length > 0) {
    report.issues.push({
      button: '(page load)',
      type: 'sentry-event',
      message: loadSentryEvents
        .map((e) => `[${e.type}] ${e.message}`)
        .join('; ')
        .substring(0, 300),
    });
  }

  // Reset monitors for button-click phase
  apiMonitor.clear();

  // Wait for loading spinners
  const spinner = page.locator('[data-testid="loading-spinner"], .animate-spin');
  await spinner.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});

  // --- Snapshot buttons ---
  const buttons = await snapshotButtons(page);
  report.totalButtons = buttons.length;

  // --- Click each button ---
  for (const btn of buttons) {
    // Reset per-click error state
    jsExceptions.length = 0;
    consoleErrors.length = 0;
    apiMonitor.clear();

    const buttonLabel =
      btn.text.substring(0, 60) || btn.ariaLabel || btn.title || btn.testId || `button[${btn.index}]`;

    // Skip conditions
    if (!btn.isVisible) {
      report.skippedButtons++;
      continue;
    }
    if (btn.isDisabled) {
      report.skippedButtons++;
      continue;
    }
    if (btn.type === 'submit') {
      report.skippedButtons++;
      continue;
    }
    if (isDangerous(btn)) {
      report.skippedButtons++;
      continue;
    }

    // Re-locate the button (DOM may have shifted)
    const allButtons = page.locator('button');
    const count = await allButtons.count();
    if (btn.index >= count) {
      report.skippedButtons++;
      continue;
    }

    const locator = allButtons.nth(btn.index);
    if (!(await locator.isVisible().catch(() => false))) {
      report.skippedButtons++;
      continue;
    }

    // isVisible() only checks for a non-empty box plus visibility/display, so
    // it returns true for controls inside a collapsed animated panel — the
    // filter drawer on the collections list keeps its three dropdowns laid
    // out behind the results grid while closed. Clicking those timed out and
    // was reported as a page defect on a page behaving correctly.
    //
    // checkVisibility() accounts for opacity and content-visibility on the
    // whole ancestor chain, which is the question actually being asked: can a
    // user reach this control right now. A button that is genuinely reachable
    // but covered by something the page put there still fails the click below,
    // which is the check this sweep exists for.
    const reachable = await locator
      .evaluate((el) =>
        el.checkVisibility({
          checkOpacity: true,
          checkVisibilityCSS: true,
          contentVisibilityAuto: true,
        }),
      )
      .catch(() => true);
    if (!reachable) {
      report.skippedButtons++;
      continue;
    }

    // Click — NO force:true so real overlay issues are caught
    try {
      await locator.click({ timeout: 3000 });
      report.clickedButtons++;
    } catch (clickErr) {
      report.issues.push({
        button: buttonLabel,
        type: 'click-failed',
        message: clickErr instanceof Error ? clickErr.message.substring(0, 200) : 'Click failed',
      });
      report.skippedButtons++;
      continue;
    }

    // Let any triggered activity settle
    await page.waitForTimeout(500);

    // --- Post-click assertions ---

    // JS exception?
    if (jsExceptions.length > 0) {
      report.issues.push({
        button: buttonLabel,
        type: 'js-exception',
        message: jsExceptions.join('; ').substring(0, 300),
      });
    }

    // Error boundary?
    if (await hasErrorBoundary(page)) {
      report.issues.push({
        button: buttonLabel,
        type: 'error-boundary',
        message: 'Error boundary appeared after click',
      });
      // Try to recover by re-navigating
      await page.goto(route.path, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      continue;
    }

    // 5xx API errors?
    const apiErrors = apiMonitor.getErrors().filter((e) => e.status >= 500);
    if (apiErrors.length > 0) {
      report.issues.push({
        button: buttonLabel,
        type: 'api-5xx',
        message: apiErrors
          .map((e) => `${e.method} ${new URL(e.url).pathname} => ${e.status}`)
          .join('; ')
          .substring(0, 300),
      });
    }

    // Sentry events (caught errors reported to Sentry — e.g., Zod validation)
    const sentryEvents = await sentry.drain();
    if (sentryEvents.length > 0) {
      report.issues.push({
        button: buttonLabel,
        type: 'sentry-event',
        message: sentryEvents
          .map((e) => `[${e.type}] ${e.message}`)
          .join('; ')
          .substring(0, 300),
      });
    }

    // Console errors (warnings, not hard fails)
    if (consoleErrors.length > 0) {
      report.issues.push({
        button: buttonLabel,
        type: 'console-error',
        message: consoleErrors[0].substring(0, 200),
      });
    }

    // Dismiss overlays before next button
    await dismissOverlays(page);

    // If navigation happened, go back
    const currentUrl = page.url();
    const routeBase = route.path.split('?')[0];
    if (!currentUrl.includes(routeBase)) {
      try {
        await page.goto(route.path, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(300);
      } catch {
        // If we can't get back, bail on remaining buttons
        break;
      }
    }
  }

  // Cleanup listeners
  page.removeListener('pageerror', onError);
  page.removeListener('console', onConsole);

  return report;
}

/**
 * Format a report for console output.
 */
function logReport(report: PageReport): void {
  const status = report.issues.length === 0 ? 'PASS' : 'FAIL';
  console.log(
    `  [${status}] ${report.route} — ${report.clickedButtons}/${report.totalButtons} clicked, ${report.issues.length} issues`
  );
  for (const issue of report.issues) {
    console.log(`    [${issue.type}] "${issue.button}" — ${issue.message}`);
  }
}

// =============================================================================
// TESTS — grouped by product for parallel execution
// =============================================================================

const ALL_ROUTES = generateAuthenticatedRoutes(TEST_ORG_ID);
const BY_PRODUCT = groupRoutesByProduct(ALL_ROUTES);

for (const [product, routes] of Object.entries(BY_PRODUCT)) {
  test.describe(`Buttons: ${product}`, () => {
    for (const route of routes) {
      test(`${route.name} — ${route.path}`, async ({ page }) => {
        test.setTimeout(90000); // 90s per page (some have many buttons)

        const report = await testPageButtons(page, route);
        logReport(report);

        // Hard failures: JS exceptions, error boundaries, or Sentry events
        const critical = report.issues.filter(
          (i) => i.type === 'js-exception' || i.type === 'error-boundary' || i.type === 'sentry-event'
        );
        expect(
          critical,
          `Critical button issues on ${route.path}:\n${critical.map((i) => `  [${i.type}] "${i.button}" — ${i.message}`).join('\n')}`
        ).toHaveLength(0);

        // Hard failure: any 5xx API error triggered by a button click
        const serverErrors = report.issues.filter((i) => i.type === 'api-5xx');
        expect(
          serverErrors,
          `Server errors triggered by buttons on ${route.path}:\n${serverErrors.map((i) => `  "${i.button}" — ${i.message}`).join('\n')}`
        ).toHaveLength(0);
      });
    }
  });
}

// Public pages — these don't use auth state and may have login forms
// that cause redirects, so we only check for page-load errors, not button clicks
test.describe('Buttons: public', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route.name} — ${route.path}`, async ({ page }) => {
      test.setTimeout(30000);

      // For public/auth pages, just verify the page loads without crashing
      // Don't click buttons — form submits cause redirect loops without valid creds
      await page.goto(route.path, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

      // Check for error boundary on load
      const hasBoundary = await hasErrorBoundary(page);
      expect(hasBoundary, `Error boundary on ${route.path}`).toBe(false);

      // Check for blank page
      const rootContent = await page.locator('#root').innerHTML().catch(() => '');
      expect(rootContent.trim().length, `Blank page at ${route.path}`).toBeGreaterThan(20);
    });
  }
});

// =============================================================================
// FULL AUDIT — manual run for comprehensive report
// =============================================================================

test.describe('Buttons: Full Audit', () => {
  test.skip(
    'generate complete button audit',
    async ({ page }) => {
      test.setTimeout(600000); // 10 min

      const reports: PageReport[] = [];

      for (const route of ALL_ROUTES) {
        const report = await testPageButtons(page, route);
        reports.push(report);
        logReport(report);
      }

      // Summary
      const totalButtons = reports.reduce((s, r) => s + r.totalButtons, 0);
      const totalClicked = reports.reduce((s, r) => s + r.clickedButtons, 0);
      const pagesWithIssues = reports.filter((r) => r.issues.length > 0);
      const criticalIssues = reports.flatMap((r) =>
        r.issues.filter((i) => i.type === 'js-exception' || i.type === 'error-boundary' || i.type === 'api-5xx')
      );

      console.log('\n' + '='.repeat(70));
      console.log('  BUTTON AUDIT REPORT');
      console.log('='.repeat(70));
      console.log(`  Pages:          ${reports.length}`);
      console.log(`  Total buttons:  ${totalButtons}`);
      console.log(`  Clicked:        ${totalClicked}`);
      console.log(`  Pages w/ issues: ${pagesWithIssues.length}`);
      console.log(`  Critical issues: ${criticalIssues.length}`);
      console.log('='.repeat(70));

      if (criticalIssues.length > 0) {
        console.log('\n  CRITICAL ISSUES:');
        for (const issue of criticalIssues) {
          console.log(`    [${issue.type}] "${issue.button}" — ${issue.message}`);
        }
      }

      expect(criticalIssues.length, `${criticalIssues.length} critical issues found`).toBe(0);
    }
  );
});
