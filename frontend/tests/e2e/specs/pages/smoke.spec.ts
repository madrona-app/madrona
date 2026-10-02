import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';
import {
  generateAuthenticatedRoutes,
  groupRoutesByProduct,
  createApiErrorMonitor,
  type TestRoute,
} from '../../utils';

/**
 * Page Smoke Tests
 *
 * Visits every route derived from navigationConfig and checks for:
 *   1. Console errors (JS exceptions, React errors)
 *   2. Failed API requests (4xx/5xx)
 *   3. React error boundaries (crash screens)
 *   4. Page completely blank (nothing rendered)
 *   5. Uncaught JS exceptions
 *
 * Run:
 *   npx playwright test smoke.spec.ts --project=chromium
 *
 * Run single product:
 *   npx playwright test smoke.spec.ts --project=chromium -g "collections"
 */

const TEST_ORG_ID =
  process.env.PLAYWRIGHT_TEST_ORG_ID ||
  'c62f6243-b50e-4f10-a6b3-80425de6c01d';

// Routes that are expected to 404 or require specific entity IDs
const SKIP_ROUTES: RegExp[] = [
  // Detail/edit pages that need a real entity ID in the URL
  /\/new$/,
];

// API patterns to ignore (known acceptable errors)
const IGNORED_API_PATTERNS: RegExp[] = [
  /\/health/, // health checks may fail in test
  /\/auth\/csrf/, // CSRF fetch before login
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

interface PageIssue {
  type: 'console-error' | 'js-exception' | 'api-error' | 'error-boundary' | 'blank-page' | 'timeout';
  message: string;
  detail?: string;
}

interface PageResult {
  route: TestRoute;
  issues: PageIssue[];
  loadTimeMs: number;
}

/**
 * Visit a page and collect all issues.
 */
async function smokePage(page: Page, route: TestRoute): Promise<PageResult> {
  const issues: PageIssue[] = [];
  const consoleErrors: string[] = [];
  const jsExceptions: string[] = [];

  // Collect console errors
  const onConsole = (msg: ConsoleMessage) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (IGNORED_CONSOLE_PATTERNS.some((p) => p.test(text))) return;
    consoleErrors.push(text);
  };
  page.on('console', onConsole);

  // Collect uncaught exceptions
  const onError = (error: Error) => {
    jsExceptions.push(`${error.name}: ${error.message}`);
  };
  page.on('pageerror', onError);

  // Monitor API errors
  const apiMonitor = createApiErrorMonitor(page);
  apiMonitor.ignoreUrls(...IGNORED_API_PATTERNS);

  const start = Date.now();
  let loadTimeMs = 0;

  try {
    // Navigate — use domcontentloaded instead of networkidle to avoid hanging
    // on long-polling or websocket connections
    const response = await page.goto(route.path, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Wait for network to mostly settle (but don't hang)
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Extra wait for React to finish rendering
    await page.waitForTimeout(500);

    loadTimeMs = Date.now() - start;

    // Check: HTTP response status
    if (response && response.status() >= 500) {
      issues.push({
        type: 'api-error',
        message: `Page returned HTTP ${response.status()}`,
      });
    }

    // Check: React error boundary
    const errorBoundary = await page
      .locator('[data-testid="error-boundary"], .error-boundary')
      .first()
      .isVisible()
      .catch(() => false);

    if (!errorBoundary) {
      // Also check for common error boundary text patterns
      const bodyText = await page.locator('body').innerText().catch(() => '');
      if (
        /something went wrong/i.test(bodyText) &&
        /error/i.test(bodyText) &&
        bodyText.length < 500 // short page = likely just error message
      ) {
        issues.push({
          type: 'error-boundary',
          message: 'Page appears to show an error boundary',
          detail: bodyText.substring(0, 200),
        });
      }
    } else {
      issues.push({
        type: 'error-boundary',
        message: 'Error boundary element visible on page',
      });
    }

    // Check: Blank page (nothing rendered in #root or body is nearly empty)
    const rootContent = await page
      .locator('#root')
      .innerHTML()
      .catch(() => '');
    if (rootContent.trim().length < 20) {
      issues.push({
        type: 'blank-page',
        message: 'Page appears blank (#root has minimal content)',
        detail: rootContent.substring(0, 100),
      });
    }

    // Check: API errors from monitor
    const apiErrors = apiMonitor.getErrors();
    for (const err of apiErrors) {
      issues.push({
        type: 'api-error',
        message: `${err.method} ${abbreviateUrl(err.url)} => ${err.status}`,
        detail: err.statusText,
      });
    }
  } catch (error) {
    loadTimeMs = Date.now() - start;
    issues.push({
      type: 'timeout',
      message: error instanceof Error ? error.message : 'Navigation failed',
    });
  }

  // Collect console errors captured during the page lifecycle
  for (const msg of consoleErrors) {
    issues.push({
      type: 'console-error',
      message: msg.substring(0, 300),
    });
  }

  for (const msg of jsExceptions) {
    issues.push({
      type: 'js-exception',
      message: msg.substring(0, 300),
    });
  }

  // Cleanup listeners
  page.removeListener('console', onConsole);
  page.removeListener('pageerror', onError);

  return { route, issues, loadTimeMs };
}

/**
 * Shorten API URLs for readable output.
 */
function abbreviateUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname;
  } catch {
    return url.substring(0, 80);
  }
}

// =============================================================================
// TESTS — one per product group for parallel execution
// =============================================================================

const ALL_ROUTES = generateAuthenticatedRoutes(TEST_ORG_ID);
const BY_PRODUCT = groupRoutesByProduct(ALL_ROUTES);

for (const [product, routes] of Object.entries(BY_PRODUCT)) {
  test.describe(`Smoke: ${product}`, () => {
    for (const route of routes) {
      if (SKIP_ROUTES.some((p) => p.test(route.path))) continue;

      test(`${route.name} — ${route.path}`, async ({ page }) => {
        const result = await smokePage(page, route);

        // Log issues for visibility
        if (result.issues.length > 0) {
          console.log(`\n  Issues on ${route.path} (${result.loadTimeMs}ms):`);
          for (const issue of result.issues) {
            console.log(`    [${issue.type}] ${issue.message}`);
            if (issue.detail) console.log(`      ${issue.detail}`);
          }
        }

        // Hard failures: JS exceptions, error boundaries, blank pages
        const criticalIssues = result.issues.filter(
          (i) =>
            i.type === 'js-exception' ||
            i.type === 'error-boundary' ||
            i.type === 'blank-page'
        );
        expect(
          criticalIssues,
          `Critical issues on ${route.path}:\n${criticalIssues.map((i) => `  [${i.type}] ${i.message}`).join('\n')}`
        ).toHaveLength(0);

        // API 5xx errors are hard failures (server bugs)
        const serverErrors = result.issues.filter(
          (i) => i.type === 'api-error' && i.message.includes('=> 5')
        );
        expect(
          serverErrors,
          `Server errors on ${route.path}:\n${serverErrors.map((i) => `  ${i.message}`).join('\n')}`
        ).toHaveLength(0);

        // API 4xx are warnings logged but don't fail (may be permission-gated)
        // Console errors are warnings logged but don't fail (may be noisy)
      });
    }
  });
}

// =============================================================================
// FULL REPORT — run manually for a complete overview
// =============================================================================

test.describe('Smoke: Full Report', () => {
  test.skip(
    'generate full smoke report',
    async ({ page }) => {
      test.setTimeout(300000);

      const results: PageResult[] = [];
      const routes = ALL_ROUTES.filter(
        (r) => !SKIP_ROUTES.some((p) => p.test(r.path))
      );

      for (const route of routes) {
        const result = await smokePage(page, route);
        results.push(result);

        const icon = result.issues.length === 0 ? '.' : 'x';
        process.stdout.write(icon);
      }

      // Print report
      console.log('\n\n' + '='.repeat(70));
      console.log('  SMOKE TEST REPORT');
      console.log('='.repeat(70));

      const clean = results.filter((r) => r.issues.length === 0);
      const broken = results.filter((r) => r.issues.length > 0);

      console.log(`  Pages tested:  ${results.length}`);
      console.log(`  Clean:         ${clean.length}`);
      console.log(`  With issues:   ${broken.length}`);
      console.log('');

      if (broken.length > 0) {
        // Group by issue type
        const byType: Record<string, PageResult[]> = {};
        for (const r of broken) {
          for (const issue of r.issues) {
            if (!byType[issue.type]) byType[issue.type] = [];
            byType[issue.type].push(r);
          }
        }

        for (const [type, pages] of Object.entries(byType)) {
          const unique = [...new Set(pages.map((p) => p.route.path))];
          console.log(`  [${type}] — ${unique.length} page(s):`);
          for (const p of unique) {
            const result = broken.find((r) => r.route.path === p)!;
            const typeIssues = result.issues.filter((i) => i.type === type);
            for (const issue of typeIssues) {
              console.log(`    ${p}`);
              console.log(`      ${issue.message}`);
            }
          }
          console.log('');
        }

        // Summary table
        console.log('-'.repeat(70));
        console.log('  PAGES WITH ISSUES:');
        console.log('-'.repeat(70));
        for (const r of broken) {
          const types = [...new Set(r.issues.map((i) => i.type))].join(', ');
          console.log(`  ${r.route.path}`);
          console.log(`    ${r.issues.length} issue(s): ${types}`);
        }
      }

      console.log('\n' + '='.repeat(70));

      // Fail if any critical issues
      const criticalPages = broken.filter((r) =>
        r.issues.some(
          (i) =>
            i.type === 'js-exception' ||
            i.type === 'error-boundary' ||
            i.type === 'blank-page' ||
            (i.type === 'api-error' && i.message.includes('=> 5'))
        )
      );
      expect(
        criticalPages.length,
        `${criticalPages.length} page(s) have critical issues`
      ).toBe(0);
    }
  );
});
