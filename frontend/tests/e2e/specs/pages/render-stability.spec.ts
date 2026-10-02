import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import {
  generateAuthenticatedRoutes,
  groupRoutesByProduct,
  createApiErrorMonitor,
  type TestRoute,
} from '../../utils';

/**
 * Render Stability Tests
 *
 * Catches race-condition crashes that surface during React's render cycle:
 *   - Null access before data loads (e.g., formData.object_number when formData is null)
 *   - Error boundaries triggered during initial render
 *   - JS exceptions thrown during component mount
 *
 * Strategy:
 *   1. Navigate to every page
 *   2. Listen for pageerror events during the ENTIRE navigation + render phase
 *   3. Check for error boundaries immediately after page settles
 *   4. Force a re-render by toggling visibility (simulates StrictMode double-render)
 *   5. Check again for errors after re-render
 *
 * This catches the class of bugs where:
 *   - Data is null on first render but arrives by the time Playwright checks
 *   - React StrictMode would catch it but the app doesn't enable StrictMode
 *   - Error boundaries catch and display errors that button tests never see
 *
 * Run:
 *   npx playwright test render-stability.spec.ts --project=chromium
 */

const TEST_ORG_ID =
  process.env.PLAYWRIGHT_TEST_ORG_ID || 'c62f6243-b50e-4f10-a6b3-80425de6c01d';

const _IGNORED_CONSOLE_PATTERNS: RegExp[] = [
  /Download the React DevTools/,
  /Warning: ReactDOM.render is no longer supported/,
  /Third-party cookie will be blocked/,
  /Failed to load resource.*favicon/,
  /\[vite\]/,
  /\[HMR\]/,
  /Manifest: Line:/,
  /cannot be a descendant/, // DOM nesting warnings — separate concern
];

const IGNORED_API_PATTERNS: RegExp[] = [
  /\/health/,
  /\/auth\/csrf/,
];

interface RenderIssue {
  phase: 'navigation' | 'initial-render' | 're-render' | 'error-boundary';
  type: 'js-exception' | 'error-boundary' | 'api-5xx' | 'sentry-event';
  message: string;
}

interface RenderResult {
  route: TestRoute;
  issues: RenderIssue[];
  renderTimeMs: number;
}

/**
 * Check for error boundary on page.
 */
async function hasErrorBoundary(page: Page): Promise<string | null> {
  // Check data-testid error boundary
  const boundary = page.locator('[data-testid="error-boundary"], .error-boundary').first();
  if (await boundary.isVisible().catch(() => false)) {
    const text = await boundary.innerText().catch(() => '');
    return text.substring(0, 200);
  }

  // Check SectionErrorBoundary pattern
  const sectionError = page.locator('text=/This section encountered an error/i').first();
  if (await sectionError.isVisible().catch(() => false)) {
    const parent = sectionError.locator('..');
    const text = await parent.innerText().catch(() => '');
    return text.substring(0, 200);
  }

  // Check generic "something went wrong" pattern
  const bodyText = await page.locator('body').innerText().catch(() => '');
  if (
    /something went wrong/i.test(bodyText) &&
    /error/i.test(bodyText) &&
    bodyText.length < 500
  ) {
    return bodyText.substring(0, 200);
  }

  return null;
}

/**
 * Test render stability for a single page.
 */
async function testRenderStability(
  page: Page,
  route: TestRoute
): Promise<RenderResult> {
  const issues: RenderIssue[] = [];
  const jsExceptions: string[] = [];

  const onError = (err: Error) => {
    jsExceptions.push(`${err.name}: ${err.message}`);
  };
  page.on('pageerror', onError);

  const apiMonitor = createApiErrorMonitor(page);
  apiMonitor.ignoreUrls(...IGNORED_API_PATTERNS);

  const start = Date.now();

  // ── Phase 1: Navigate ──
  try {
    await page.goto(route.path, { waitUntil: 'domcontentloaded', timeout: 20000 });
  } catch (err) {
    issues.push({
      phase: 'navigation',
      type: 'js-exception',
      message: err instanceof Error ? err.message : 'Navigation failed',
    });
    page.removeListener('pageerror', onError);
    return { route, issues, renderTimeMs: Date.now() - start };
  }

  // Wait for network + React render to settle
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(800); // Extra settle time for lazy components

  const renderTimeMs = Date.now() - start;

  // ── Phase 2: Check initial render ──

  // JS exceptions during render?
  if (jsExceptions.length > 0) {
    for (const ex of jsExceptions) {
      issues.push({
        phase: 'initial-render',
        type: 'js-exception',
        message: ex.substring(0, 300),
      });
    }
  }

  // Error boundary visible?
  const boundaryText = await hasErrorBoundary(page);
  if (boundaryText) {
    issues.push({
      phase: 'initial-render',
      type: 'error-boundary',
      message: boundaryText,
    });
  }

  // 5xx during page load?
  const apiErrors = apiMonitor.getErrors().filter((e) => e.status >= 500);
  if (apiErrors.length > 0) {
    issues.push({
      phase: 'initial-render',
      type: 'api-5xx',
      message: apiErrors
        .map((e) => `${e.method} ${new URL(e.url).pathname} => ${e.status}`)
        .join('; ')
        .substring(0, 300),
    });
  }

  // ── Phase 3: Force re-render via visibility toggle ──
  // This simulates what StrictMode does: unmount + remount
  // By navigating away and back, we force a full component lifecycle
  jsExceptions.length = 0;
  apiMonitor.clear();

  try {
    // Navigate to a minimal page
    await page.goto('about:blank', { waitUntil: 'load', timeout: 5000 });
    await page.waitForTimeout(100);

    // Navigate back
    await page.goto(route.path, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(800);

    // Check for re-render errors
    if (jsExceptions.length > 0) {
      for (const ex of jsExceptions) {
        issues.push({
          phase: 're-render',
          type: 'js-exception',
          message: ex.substring(0, 300),
        });
      }
    }

    const reRenderBoundary = await hasErrorBoundary(page);
    if (reRenderBoundary) {
      issues.push({
        phase: 're-render',
        type: 'error-boundary',
        message: reRenderBoundary,
      });
    }

    const reRenderApiErrors = apiMonitor.getErrors().filter((e) => e.status >= 500);
    if (reRenderApiErrors.length > 0) {
      issues.push({
        phase: 're-render',
        type: 'api-5xx',
        message: reRenderApiErrors
          .map((e) => `${e.method} ${new URL(e.url).pathname} => ${e.status}`)
          .join('; ')
          .substring(0, 300),
      });
    }
  } catch {
    // Re-render navigation failed — not critical
  }

  page.removeListener('pageerror', onError);
  return { route, issues, renderTimeMs };
}

// =============================================================================
// TESTS — grouped by product
// =============================================================================

const ALL_ROUTES = generateAuthenticatedRoutes(TEST_ORG_ID);
const BY_PRODUCT = groupRoutesByProduct(ALL_ROUTES);

for (const [product, routes] of Object.entries(BY_PRODUCT)) {
  test.describe(`Render: ${product}`, () => {
    for (const route of routes) {
      test(`${route.name} — ${route.path}`, async ({ page }) => {
        test.setTimeout(60000);

        const result = await testRenderStability(page, route);

        // Log
        if (result.issues.length > 0) {
          console.log(`\n  RENDER ISSUES on ${route.path} (${result.renderTimeMs}ms):`);
          for (const issue of result.issues) {
            console.log(`    [${issue.phase}] [${issue.type}] ${issue.message}`);
          }
        }

        // Assert: no JS exceptions during any render phase
        const exceptions = result.issues.filter((i) => i.type === 'js-exception');
        expect(
          exceptions,
          `JS exceptions on ${route.path}:\n${exceptions.map((i) => `  [${i.phase}] ${i.message}`).join('\n')}`
        ).toHaveLength(0);

        // Assert: no error boundaries
        const boundaries = result.issues.filter((i) => i.type === 'error-boundary');
        expect(
          boundaries,
          `Error boundaries on ${route.path}:\n${boundaries.map((i) => `  [${i.phase}] ${i.message}`).join('\n')}`
        ).toHaveLength(0);

        // Assert: no 5xx
        const serverErrors = result.issues.filter((i) => i.type === 'api-5xx');
        expect(
          serverErrors,
          `Server errors on ${route.path}:\n${serverErrors.map((i) => `  [${i.phase}] ${i.message}`).join('\n')}`
        ).toHaveLength(0);
      });
    }
  });
}

// =============================================================================
// WORKSPACE RENDER STABILITY — tests detail pages with real data
// =============================================================================

// Workspace-render tests use the real org (orgId fixture) so they reach real
// records; config.listPath holds a relative slug joined at test time.
const collectionsBase = (orgId: string) => `/organizations/${orgId}/collections`;

const WORKSPACE_ROUTES = [
  { name: 'Objects', listPath: 'objects', pattern: /\/objects\/[a-f0-9-]+/ },
  { name: 'Loans In', listPath: 'loans-in', pattern: /\/loans-in\/[a-f0-9-]+/ },
  { name: 'Loans Out', listPath: 'loans-out', pattern: /\/loans-out\/[a-f0-9-]+/ },
  { name: 'Entries', listPath: 'entries', pattern: /\/entries\/[a-f0-9-]+/ },
  { name: 'Acquisitions', listPath: 'acquisitions', pattern: /\/acquisitions\/[a-f0-9-]+/ },
  { name: 'Conservation', listPath: 'conservation', pattern: /\/conservation\/[a-f0-9-]+/ },
  { name: 'Deaccessions', listPath: 'deaccessions', pattern: /\/deaccessions\/[a-f0-9-]+/ },
  { name: 'Valuations', listPath: 'valuations', pattern: /\/valuations\/[a-f0-9-]+/ },
  { name: 'Insurance', listPath: 'insurance', pattern: /\/insurance\/policies\/[a-f0-9-]+/ },
  { name: 'Incidents', listPath: 'incidents', pattern: /\/incidents\/[a-f0-9-]+/ },
  { name: 'Events', listPath: 'events', pattern: /\/events\/[a-f0-9-]+/ },
  { name: 'Constituents', listPath: 'constituents', pattern: /\/constituents\/[a-f0-9-]+/ },
  { name: 'Exhibitions', listPath: 'exhibitions', pattern: /\/exhibitions\/[a-f0-9-]+/ },
  { name: 'Condition Reports', listPath: 'condition-reports', pattern: /\/condition-reports\/[a-f0-9-]+/ },
];

test.describe('Render: Workspace Pages', () => {
  for (const config of WORKSPACE_ROUTES) {
    test(`${config.name} workspace — render without crash`, async ({ page, orgId }) => {
      test.setTimeout(60000);

      // Capture ALL errors during the entire test
      const jsExceptions: string[] = [];
      page.on('pageerror', (err) => {
        jsExceptions.push(`${err.name}: ${err.message}`);
      });

      // Navigate to list, click first record. Rows navigate via onClick (not
      // <a href>), so click the row.
      await page.goto(`${collectionsBase(orgId)}/${config.listPath}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      const firstLink = page.locator('table tbody tr').first();
      const hasRecords = await firstLink.isVisible({ timeout: 8000 }).catch(() => false);

      if (!hasRecords) {
        test.skip();
        return;
      }

      await firstLink.click({ timeout: 5000 });
      await page.waitForURL(config.pattern, { timeout: 15000 }).catch(() => {});
      // Four of the five procedure lists navigate on a row click; the
      // deaccessions list does not — its rows carry an anchor instead and
      // render with cursor:auto. Rather than skip (which reads as a pass and
      // meant these assertions never ran for that list), fall back to the
      // link inside the row, which is how a user reaches the record there.
      if (!config.pattern.test(page.url())) {
        const rowLink = firstLink.locator('a[href]').first();
        if (await rowLink.count()) {
          await rowLink.click({ timeout: 5000 }).catch(() => {});
          await page.waitForURL(config.pattern, { timeout: 15000 }).catch(() => {});
          await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        }
      }

      expect(config.pattern.test(page.url()),
        `${config.name}: could not open a record from the list, by row click or row link`,
      ).toBeTruthy();
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1000); // Full settle

      // Check for render crashes
      expect(
        jsExceptions,
        `JS exceptions during ${config.name} workspace render:\n${jsExceptions.join('\n')}`
      ).toHaveLength(0);

      const boundaryText = await hasErrorBoundary(page);
      expect(
        boundaryText,
        `Error boundary in ${config.name} workspace: ${boundaryText}`
      ).toBeNull();
    });
  }
});
