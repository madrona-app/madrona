/**
 * Open every modal the app offers and check it is usable by assistive technology.
 *
 * The route sweep walks 261 routes but never clicks anything, so it could not see
 * that 36 modals wrapped their own dialog in aria-hidden="true" — the dialog and
 * its focused input sat inside a hidden subtree, and a screen reader following the
 * attribute would have found an empty dialog. Chrome reported it only when a modal
 * was actually opened.
 *
 * This clicks the openers and asserts what useAccessibleModal already promises:
 *
 *   - the dialog is not inside an aria-hidden subtree
 *   - aria-modal="true" is set, which is what makes the rest of the page inert
 *   - the dialog has an accessible name
 *   - focus has moved into the dialog
 *
 * Escape-to-close is reported but not failed: a confirmation may reasonably
 * decline to dismiss on Escape, and failing it would make this gate argue about
 * product decisions instead of accessibility.
 *
 * Safety: this clicks real buttons against a real database, so openers are chosen
 * from an allowlist of names that create or configure, and anything whose name
 * suggests it destroys, publishes or approves is skipped outright — a stray
 * "Delete" would also remove the fixture rows the sweep depends on.
 */
import { test, expect } from '@playwright/test';

import { buildUrl, declaredRoutes, loadRouteIds, signIn } from '../utils/app-routes';

/** Names that plausibly open a dialog without changing anything. */
const OPENER = /^(new|create|add|upload|share|invite|configure|manage|schedule|export|import|edit|filter|columns|settings|link|assign|generate|preview)\b/i;

/** Names never to click, whatever else they match. */
const DESTRUCTIVE =
  /(delete|remove|revoke|archive|deaccession|discard|publish|unpublish|approve|reject|reset|sign out|log out|disable|deactivate|cancel|purge|clear|send|submit|execute|run now|retry|rollback|restore|merge|apply)/i;

interface Finding {
  route: string;
  opener: string;
  problems: string[];
}

test.describe('modal sweep', () => {
  test.setTimeout(45 * 60 * 1000);

  test('every modal is reachable by assistive technology', async ({ page }) => {
    const { orgId, orgSlug } = await signIn(page);
    const ids = loadRouteIds();
    const routes = declaredRoutes();

    const findings: Finding[] = [];
    const noEscape: string[] = [];
    let opened = 0;
    let routesWithOpeners = 0;

    for (const route of routes) {
      const url = buildUrl(route, orgId, ids, orgSlug);
      if (!url) continue;

      await page.goto(url, { waitUntil: 'commit', timeout: 20000 });
      await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(700);

      // Candidate openers, by accessible name.
      const buttons = page.getByRole('button');
      const count = Math.min(await buttons.count().catch(() => 0), 40);
      const candidates: { index: number; name: string }[] = [];
      for (let i = 0; i < count; i += 1) {
        const name = ((await buttons.nth(i).textContent().catch(() => '')) || '').trim();
        if (!name || name.length > 40) continue;
        if (DESTRUCTIVE.test(name) || !OPENER.test(name)) continue;
        candidates.push({ index: i, name });
      }
      if (!candidates.length) continue;

      // A dialog already on screen is not this route's modal to judge. The app
      // access guard renders one on load for any app the user cannot open, and an
      // earlier version of this sweep credited it to whichever button it clicked
      // next — three findings that were one guard dialog seen three times.
      if (await page.locator('[role="dialog"]').count().catch(() => 0)) continue;

      routesWithOpeners += 1;

      // Two per route: enough to catch a shared modal component, cheap enough to
      // walk the whole app.
      for (const candidate of candidates.slice(0, 2)) {
        const button = buttons.nth(candidate.index);
        if (!(await button.isVisible().catch(() => false))) continue;
        if (!(await button.isEnabled().catch(() => false))) continue;

        await button.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(900);

        const dialog = page.locator('[role="dialog"]').first();
        if (!(await dialog.count().catch(() => 0))) continue; // not an opener
        opened += 1;


        const problems = await dialog
          .evaluate((el) => {
            const issues: string[] = [];

            let node: HTMLElement | null = el.parentElement;
            while (node) {
              if (node.getAttribute('aria-hidden') === 'true') {
                issues.push('inside an aria-hidden subtree');
                break;
              }
              node = node.parentElement;
            }

            if (el.getAttribute('aria-modal') !== 'true') {
              issues.push('no aria-modal="true"');
            }

            const labelledBy = el.getAttribute('aria-labelledby');
            const named =
              (el.getAttribute('aria-label') || '').trim().length > 0 ||
              (labelledBy
                ? labelledBy
                    .split(/\s+/)
                    .some((id) => (document.getElementById(id)?.textContent || '').trim().length > 0)
                : false);
            if (!named) issues.push('no accessible name');

            if (!el.contains(document.activeElement)) {
              issues.push('focus is outside the dialog');
            }
            return issues;
          })
          .catch(() => ['could not be inspected']);

        if (problems.length) {
          findings.push({ route, opener: candidate.name, problems });
        }

        // Escape, then force-close if it lingers, so the next probe starts clean.
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(400);
        if (await dialog.count().catch(() => 0)) {
          noEscape.push(`${route} — "${candidate.name}"`);
          await page.goto(url, { waitUntil: 'commit', timeout: 20000 }).catch(() => {});
          await page.waitForTimeout(500);
        }
      }
    }

    console.log(
      `\nmodal sweep: opened ${opened} dialog(s) from ${routesWithOpeners} route(s) ` +
        `with candidate openers, out of ${routes.length} routes`,
    );
    if (noEscape.length) {
      console.log(`\n${noEscape.length} dialog(s) did not close on Escape (not failed):`);
      for (const entry of noEscape.slice(0, 20)) console.log(`  ${entry}`);
    }

    const report = findings.map(
      (f) => `${f.route}\n      opener: "${f.opener}"\n      ${f.problems.join('\n      ')}`,
    );
    expect(
      report,
      `${findings.length} dialog(s) are not usable by assistive technology:\n    ` +
        report.join('\n    '),
    ).toEqual([]);
  });
});
