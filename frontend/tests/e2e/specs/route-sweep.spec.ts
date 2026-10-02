/**
 * Walk every app route and fail on the ones that break.
 *
 * The API sweep (backend/scripts/api_sweep.py) found eleven 500s the unit
 * suites missed, by asking the application for its own route list and calling
 * all of it. Nothing was doing the equivalent for the frontend: 288 routes, and
 * a page that throws on mount looks exactly like a page nobody has visited.
 *
 * This is a smoke test, not an assertion suite. It says which routes error, not
 * whether they render the right thing. Three signals fail a route, all of them
 * unambiguous:
 *
 *   - an uncaught exception on the page (`pageerror`)
 *   - a rendered error boundary (`[data-testid="error-boundary"]`)
 *   - a 5xx from any request the page made
 *
 * Console errors are collected and printed but do not fail: too much of what
 * lands there is third-party noise to treat as a defect signal.
 *
 * A 429 is different, and does fail. Visiting 243 pages in a couple of minutes
 * puts the sweep over the global read limit, and a throttled page never reaches
 * its handlers — so it cannot report a fault it never triggered. The walk paces
 * itself, revisits a throttled route once after a pause, and fails if any route
 * is still throttled, because a quiet run that was mostly rate-limited is worse
 * than a red one.
 *
 * Routes needing an id other than the organization are filled from
 * tests/.auth/route-ids.json when it exists. Generate it with
 *
 *     cd backend && ./venv/bin/python scripts/dump_route_ids.py \
 *         --out ../frontend/tests/.auth/route-ids.json
 *
 * which reuses the API sweep's resolver rather than reimplementing id lookup in
 * TypeScript, where it would drift. Without the file the sweep still runs and
 * covers every route that needs only the organization; anything else is skipped
 * and counted, so a thin run reports itself as thin.
 */
import { test, expect } from '@playwright/test';

import { buildUrl, declaredRoutes, loadRouteIds, signIn } from '../utils/app-routes';

/** Benign console output that says nothing about the page's health. */
const CONSOLE_NOISE = [
  /favicon/i,
  /ResizeObserver loop/i,
  /Download the React DevTools/i,
  /\[vite\]/i,
];

test.describe('route sweep', () => {
  // 288 routes at a few seconds each. Generous, and it runs alone.
  test.setTimeout(30 * 60 * 1000);

  test('no app route throws, renders an error boundary, or 5xxs', async ({ page }) => {
    const { orgId, orgSlug } = await signIn(page);
    const routeIds = loadRouteIds();
    console.log(`route ids loaded: ${Object.keys(routeIds).length} parameter(s)`);

    const routes = declaredRoutes();
    const broken: string[] = []; // uncaught error, error boundary, or 5xx
    const noisy: string[] = []; // console errors only
    const skipped: string[] = [];
    const throttled: string[] = [];
    let visited = 0;

    // The global limiter allows 600 reads a minute per client, and each page
    // makes several calls. Stay under it rather than measuring a throttled app.
    const PACE_MS = 400;

    for (const route of routes) {
      const url = buildUrl(route, orgId, routeIds, orgSlug);
      if (!url) {
        skipped.push(route);
        continue;
      }

      const pageErrors: string[] = [];
      const serverErrors: string[] = [];
      const consoleErrors: string[] = [];
      let rateLimited = false;

      const onPageError = (err: Error) => pageErrors.push(err.message.split('\n')[0]);
      const onResponse = (resp: { status(): number; url(): string }) => {
        if (resp.status() >= 500) serverErrors.push(`${resp.status()} ${resp.url()}`);
        if (resp.status() === 429) rateLimited = true;
      };
      const onConsole = (msg: { type(): string; text(): string }) => {
        if (msg.type() !== 'error') return;
        const text = msg.text();
        if (!CONSOLE_NOISE.some((pattern) => pattern.test(text))) consoleErrors.push(text);
      };

      page.on('pageerror', onPageError);
      page.on('response', onResponse);
      page.on('console', onConsole);

      try {
        await page.goto(url, { waitUntil: 'commit', timeout: 20000 });
        // networkidle never settles here: the app holds a websocket open.
        await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(600); // let a first render and its fetches land

        if (rateLimited) {
          // One retry after the window clears; a throttled page proves nothing.
          await page.waitForTimeout(20000);
          rateLimited = false;
          pageErrors.length = 0;
          serverErrors.length = 0;
          consoleErrors.length = 0;
          await page.goto(url, { waitUntil: 'commit', timeout: 20000 });
          await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
          await page.waitForTimeout(600);
          if (rateLimited) throttled.push(route);
        }

        const boundary = await page
          .locator('[data-testid="error-boundary"]')
          .count()
          .catch(() => 0);

        const faults: string[] = [];
        if (pageErrors.length) faults.push(`threw: ${pageErrors[0]}`);
        if (boundary > 0) faults.push('rendered an error boundary');
        if (serverErrors.length) faults.push(`server error: ${serverErrors[0]}`);
        if (faults.length) broken.push(`${route}\n      ${faults.join('\n      ')}`);
        else if (consoleErrors.length) noisy.push(`${route} — ${consoleErrors[0].slice(0, 120)}`);
        visited += 1;
        await page.waitForTimeout(PACE_MS);
      } finally {
        page.off('pageerror', onPageError);
        page.off('response', onResponse);
        page.off('console', onConsole);
      }
    }

    console.log(
      `\nroute sweep: visited ${visited} of ${routes.length} routes; ` +
        `skipped ${skipped.length} needing an id beyond :orgId`,
    );
    if (noisy.length) {
      console.log(`\n${noisy.length} route(s) logged a console error (not failed):`);
      for (const entry of noisy) console.log(`  ${entry}`);
    }

    expect(
      throttled,
      `${throttled.length} route(s) were still rate-limited after a retry, so this ` +
        `run is incomplete and its silence means nothing:\n    ${throttled.join('\n    ')}`,
    ).toEqual([]);

    expect(
      broken,
      `${broken.length} route(s) failed:\n    ${broken.join('\n    ')}`,
    ).toEqual([]);
  });
});
