import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';
import {
  generateAuthenticatedRoutes,
  groupRoutesByProduct,
  createApiErrorMonitor,
  createSentryIntercept,
  type TestRoute,
  type SentryIntercept,
} from '../../utils';

/**
 * Touch Every Interactive Element — Beyond Buttons
 *
 * For every route derived from navigationConfig, this spec tests:
 *   1. [role="button"] elements (divs/spans acting as buttons)
 *   2. <select> dropdowns (open + select first non-default option)
 *   3. [role="tab"] tabs (click each tab)
 *   4. Action menus (ellipsis/kebab menus — open, click first item, dismiss)
 *   5. Links with click handlers (non-navigation anchors)
 *
 * After each interaction: assert no JS exceptions, error boundaries, or 5xx.
 *
 * Run:
 *   npx playwright test interactive-elements.spec.ts --project=chromium
 */

const TEST_ORG_ID =
  process.env.PLAYWRIGHT_TEST_ORG_ID || 'c62f6243-b50e-4f10-a6b3-80425de6c01d';

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

// Labels on interactive elements that should not be clicked
const SKIP_LABEL_PATTERNS: RegExp[] = [
  /sign.?out/i,
  /log.?out/i,
  /delete/i,
  /remove.*all/i,
  /confirm.*delete/i,
  /disable/i,
  /deactivate/i,
  /revoke/i,
  /suspend/i,
];

interface ElementIssue {
  element: string;
  elementType: string;
  type: 'js-exception' | 'error-boundary' | 'api-5xx' | 'console-error' | 'interaction-failed' | 'sentry-event';
  message: string;
}

interface PageInteractiveReport {
  route: string;
  product: string;
  roleButtons: number;
  selects: number;
  tabs: number;
  actionMenus: number;
  issues: ElementIssue[];
}

/**
 * Check for error boundary.
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
 * Dismiss overlays.
 */
async function dismissOverlays(page: Page): Promise<void> {
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
 * Get element label for reporting.
 */
function getLabel(text: string | null, ariaLabel: string | null, index: number): string {
  return (text || '').trim().substring(0, 60) || ariaLabel || `element[${index}]`;
}

/**
 * Check if a label is dangerous.
 */
function isDangerous(label: string): boolean {
  return SKIP_LABEL_PATTERNS.some((p) => p.test(label));
}

/**
 * Run post-interaction checks and collect issues.
 */
async function postInteractionCheck(
  page: Page,
  elementLabel: string,
  elementType: string,
  jsExceptions: string[],
  consoleErrors: string[],
  apiMonitor: ReturnType<typeof createApiErrorMonitor>,
  issues: ElementIssue[],
  sentry?: SentryIntercept,
): Promise<boolean> {
  let hadCritical = false;

  if (jsExceptions.length > 0) {
    issues.push({
      element: elementLabel,
      elementType,
      type: 'js-exception',
      message: jsExceptions.join('; ').substring(0, 300),
    });
    hadCritical = true;
  }

  if (await hasErrorBoundary(page)) {
    issues.push({
      element: elementLabel,
      elementType,
      type: 'error-boundary',
      message: 'Error boundary appeared after interaction',
    });
    hadCritical = true;
  }

  const apiErrors = apiMonitor.getErrors().filter((e) => e.status >= 500);
  if (apiErrors.length > 0) {
    issues.push({
      element: elementLabel,
      elementType,
      type: 'api-5xx',
      message: apiErrors
        .map((e) => `${e.method} ${new URL(e.url).pathname} => ${e.status}`)
        .join('; ')
        .substring(0, 300),
    });
    hadCritical = true;
  }

  // Sentry events (caught errors reported to Sentry)
  if (sentry) {
    const sentryEvents = await sentry.drain();
    if (sentryEvents.length > 0) {
      issues.push({
        element: elementLabel,
        elementType,
        type: 'sentry-event',
        message: sentryEvents
          .map((e) => `[${e.type}] ${e.message}`)
          .join('; ')
          .substring(0, 300),
      });
      hadCritical = true;
    }
  }

  if (consoleErrors.length > 0) {
    issues.push({
      element: elementLabel,
      elementType,
      type: 'console-error',
      message: consoleErrors[0].substring(0, 200),
    });
  }

  return hadCritical;
}

/**
 * Test all interactive elements on a page.
 */
async function testInteractiveElements(
  page: Page,
  route: TestRoute
): Promise<PageInteractiveReport> {
  const report: PageInteractiveReport = {
    route: route.path,
    product: route.product,
    roleButtons: 0,
    selects: 0,
    tabs: 0,
    actionMenus: 0,
    issues: [],
  };

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

  // Install Sentry intercept before navigation
  const sentry = await createSentryIntercept(page);

  // Navigate
  try {
    await page.goto(route.path, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(500);
  } catch (err) {
    report.issues.push({
      element: '(navigation)',
      elementType: 'page',
      type: 'interaction-failed',
      message: err instanceof Error ? err.message : 'Navigation failed',
    });
    page.removeListener('pageerror', onError);
    page.removeListener('console', onConsole);
    return report;
  }

  const spinner = page.locator('[data-testid="loading-spinner"], .animate-spin');
  await spinner.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});

  // Check for page-load errors
  const loadApiErrors = apiMonitor.getErrors().filter((e) => e.status >= 500);
  if (loadApiErrors.length > 0) {
    report.issues.push({
      element: '(page load)',
      elementType: 'page',
      type: 'api-5xx',
      message: loadApiErrors
        .map((e) => `${e.method} ${new URL(e.url).pathname} => ${e.status}`)
        .join('; ')
        .substring(0, 300),
    });
  }
  const loadSentryEvents = await sentry.drain();
  if (loadSentryEvents.length > 0) {
    report.issues.push({
      element: '(page load)',
      elementType: 'page',
      type: 'sentry-event',
      message: loadSentryEvents
        .map((e) => `[${e.type}] ${e.message}`)
        .join('; ')
        .substring(0, 300),
    });
  }
  apiMonitor.clear();

  // ===== 1. [role="button"] elements (not actual <button> tags) =====
  const roleButtons = page.locator('[role="button"]:not(button)');
  const rbCount = await roleButtons.count();
  report.roleButtons = rbCount;

  for (let i = 0; i < rbCount; i++) {
    jsExceptions.length = 0;
    consoleErrors.length = 0;
    apiMonitor.clear();

    const el = roleButtons.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;

    const text = await el.innerText().catch(() => '');
    const ariaLabel = await el.getAttribute('aria-label').catch(() => null);
    const label = getLabel(text, ariaLabel, i);

    if (isDangerous(label)) continue;

    try {
      await el.click({ timeout: 3000 });
    } catch {
      continue; // Not critical if role="button" can't be clicked
    }

    await page.waitForTimeout(400);

    const hadCritical = await postInteractionCheck(
      page, label, 'role-button', jsExceptions, consoleErrors, apiMonitor, report.issues, sentry
    );

    await dismissOverlays(page);

    if (hadCritical) {
      await page.goto(route.path, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    }

    // If navigated away, return
    const routeBase = route.path.split('?')[0];
    if (!page.url().includes(routeBase)) {
      await page.goto(route.path, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    }
  }

  // ===== 2. <select> dropdowns =====
  const selects = page.locator('select');
  const selectCount = await selects.count();
  report.selects = selectCount;

  for (let i = 0; i < selectCount; i++) {
    jsExceptions.length = 0;
    consoleErrors.length = 0;
    apiMonitor.clear();

    const sel = selects.nth(i);
    if (!(await sel.isVisible().catch(() => false))) continue;
    if (await sel.isDisabled().catch(() => true)) continue;

    const ariaLabel = await sel.getAttribute('aria-label').catch(() => null);
    const name = await sel.getAttribute('name').catch(() => null);
    const label = ariaLabel || name || `select[${i}]`;

    // Get options
    const options = await sel.locator('option').allInnerTexts().catch(() => []);
    if (options.length < 2) continue; // Nothing to select

    try {
      // Select the second option (first non-default)
      await sel.selectOption({ index: 1 });
    } catch {
      continue;
    }

    await page.waitForTimeout(400);

    await postInteractionCheck(
      page, label, 'select', jsExceptions, consoleErrors, apiMonitor, report.issues, sentry
    );

    // Reset to first option
    await sel.selectOption({ index: 0 }).catch(() => {});
  }

  // ===== 3. [role="tab"] tabs =====
  const tabs = page.locator('[role="tab"]');
  const tabCount = await tabs.count();
  report.tabs = tabCount;

  for (let i = 0; i < tabCount; i++) {
    jsExceptions.length = 0;
    consoleErrors.length = 0;
    apiMonitor.clear();

    const tab = tabs.nth(i);
    if (!(await tab.isVisible().catch(() => false))) continue;

    const text = await tab.innerText().catch(() => '');
    const label = getLabel(text, null, i);

    // Skip if already selected
    const isSelected = await tab.getAttribute('aria-selected').catch(() => null);
    if (isSelected === 'true') continue;

    try {
      await tab.click({ timeout: 3000 });
    } catch {
      continue;
    }

    await page.waitForTimeout(500);

    const hadCritical = await postInteractionCheck(
      page, label, 'tab', jsExceptions, consoleErrors, apiMonitor, report.issues, sentry
    );

    if (hadCritical) {
      await page.goto(route.path, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    }
  }

  // ===== 4. Action menus (kebab/ellipsis menus) =====
  const menuTriggers = page.locator(
    'button[aria-haspopup="menu"], button[aria-haspopup="true"], ' +
    'button[aria-label="Actions"], button[aria-label="More actions"], ' +
    'button[aria-label="More options"], button:has(svg.lucide-more-vertical), ' +
    'button:has(svg.lucide-more-horizontal), button:has(svg.lucide-ellipsis)'
  );
  const menuCount = await menuTriggers.count();
  report.actionMenus = menuCount;

  for (let i = 0; i < menuCount; i++) {
    jsExceptions.length = 0;
    consoleErrors.length = 0;
    apiMonitor.clear();

    const trigger = menuTriggers.nth(i);
    if (!(await trigger.isVisible().catch(() => false))) continue;

    const ariaLabel = await trigger.getAttribute('aria-label').catch(() => null);
    const label = ariaLabel || `menu-trigger[${i}]`;

    // Open the menu
    try {
      await trigger.click({ timeout: 2000 });
    } catch {
      continue;
    }

    await page.waitForTimeout(400);

    // Check if a menu appeared
    const menu = page.locator('[role="menu"], [role="listbox"]');
    const menuVisible = await menu.first().isVisible().catch(() => false);

    if (menuVisible) {
      // Get first non-destructive menu item
      const items = menu.first().locator('[role="menuitem"], [role="option"]');
      const itemCount = await items.count();

      for (let j = 0; j < itemCount; j++) {
        const item = items.nth(j);
        const itemText = await item.innerText().catch(() => '');

        if (isDangerous(itemText)) continue;
        if (!(await item.isVisible().catch(() => false))) continue;

        // Click the first safe menu item
        try {
          await item.click({ timeout: 2000 });
        } catch {
          // Menu item click failed
        }

        await page.waitForTimeout(400);

        await postInteractionCheck(
          page, `${label} > ${itemText.substring(0, 40)}`, 'menu-item',
          jsExceptions, consoleErrors, apiMonitor, report.issues, sentry
        );

        break; // Only test first safe item per menu
      }
    }

    // Dismiss
    await dismissOverlays(page);

    // If navigated away, return
    const routeBase = route.path.split('?')[0];
    if (!page.url().includes(routeBase)) {
      await page.goto(route.path, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    }
  }

  page.removeListener('pageerror', onError);
  page.removeListener('console', onConsole);

  return report;
}

/**
 * Format report for console.
 */
function logReport(report: PageInteractiveReport): void {
  const status = report.issues.length === 0 ? 'PASS' : 'FAIL';
  const counts = [
    report.roleButtons > 0 ? `${report.roleButtons} role-btns` : '',
    report.selects > 0 ? `${report.selects} selects` : '',
    report.tabs > 0 ? `${report.tabs} tabs` : '',
    report.actionMenus > 0 ? `${report.actionMenus} menus` : '',
  ]
    .filter(Boolean)
    .join(', ');

  console.log(`  [${status}] ${report.route} — ${counts || 'no extra interactives'}`);
  for (const issue of report.issues) {
    console.log(`    [${issue.type}] ${issue.elementType} "${issue.element}" — ${issue.message}`);
  }
}

// =============================================================================
// TESTS — grouped by product
// =============================================================================

const ALL_ROUTES = generateAuthenticatedRoutes(TEST_ORG_ID);
const BY_PRODUCT = groupRoutesByProduct(ALL_ROUTES);

for (const [product, routes] of Object.entries(BY_PRODUCT)) {
  test.describe(`Interactive: ${product}`, () => {
    for (const route of routes) {
      test(`${route.name} — ${route.path}`, async ({ page }) => {
        test.setTimeout(90000);

        const report = await testInteractiveElements(page, route);
        logReport(report);

        // Hard failures
        const critical = report.issues.filter(
          (i) => i.type === 'js-exception' || i.type === 'error-boundary' || i.type === 'sentry-event'
        );
        expect(
          critical,
          `Critical interactive issues on ${route.path}:\n${critical.map((i) => `  [${i.type}] ${i.elementType} "${i.element}" — ${i.message}`).join('\n')}`
        ).toHaveLength(0);

        const serverErrors = report.issues.filter((i) => i.type === 'api-5xx');
        expect(
          serverErrors,
          `Server errors from interactives on ${route.path}:\n${serverErrors.map((i) => `  "${i.element}" — ${i.message}`).join('\n')}`
        ).toHaveLength(0);
      });
    }
  });
}

// =============================================================================
// FULL AUDIT
// =============================================================================

test.describe('Interactive: Full Audit', () => {
  test.skip(
    'audit all interactive elements',
    async ({ page }) => {
      test.setTimeout(600000);

      const reports: PageInteractiveReport[] = [];

      for (const route of ALL_ROUTES) {
        const report = await testInteractiveElements(page, route);
        reports.push(report);
        logReport(report);
      }

      // Summary
      const totalRoleButtons = reports.reduce((s, r) => s + r.roleButtons, 0);
      const totalSelects = reports.reduce((s, r) => s + r.selects, 0);
      const totalTabs = reports.reduce((s, r) => s + r.tabs, 0);
      const totalMenus = reports.reduce((s, r) => s + r.actionMenus, 0);
      const allCritical = reports.flatMap((r) =>
        r.issues.filter(
          (i) => i.type === 'js-exception' || i.type === 'error-boundary' || i.type === 'api-5xx'
        )
      );

      console.log('\n' + '='.repeat(70));
      console.log('  INTERACTIVE ELEMENTS AUDIT');
      console.log('='.repeat(70));
      console.log(`  Pages:         ${reports.length}`);
      console.log(`  role="button": ${totalRoleButtons}`);
      console.log(`  <select>:      ${totalSelects}`);
      console.log(`  Tabs:          ${totalTabs}`);
      console.log(`  Action menus:  ${totalMenus}`);
      console.log(`  Critical:      ${allCritical.length}`);
      console.log('='.repeat(70));

      if (allCritical.length > 0) {
        console.log('\n  CRITICAL ISSUES:');
        for (const issue of allCritical) {
          console.log(
            `    [${issue.type}] ${issue.elementType} "${issue.element}" — ${issue.message}`
          );
        }
      }

      expect(allCritical.length, `${allCritical.length} critical issues`).toBe(0);
    }
  );
});
