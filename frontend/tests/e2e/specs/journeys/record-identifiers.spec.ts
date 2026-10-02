import { test, expect } from '../../fixtures';

/**
 * Record detail pages must not describe non-object records in object terms.
 *
 * The record-detail rail and its narrow-viewport twin were written for
 * collection objects and hardcoded that assumption. Every other record type
 * reuses the same wrapper, so a person's page showed:
 *
 *   OBJECT #  Person      wrong label, and the value was the type
 *   TYPE      Person      the same string again
 *   LOCATION  Not set     flagged as a missing required field
 *   Rights: Unknown       rights attach to objects and media, not people
 *
 * None of it was caught by unit tests: the components were tested in
 * isolation with object-shaped props, and the defect was in what the *page*
 * passed them. It took looking at the running application.
 *
 * These assert against the rendered page for that reason. The rail is the
 * `dl` in the sticky column; the strip is the `region` below the header,
 * which carries the same fields for narrow viewports and had the identical
 * bug.
 */

const RAIL = 'dl';
const STRIP = '[role="region"][aria-label="Key record information"]';

test.describe('Record detail identifiers', () => {
  test('a person is not given an object number or a location', async ({ page, orgId, request }) => {
    const list = await request.get(
      `/api/organizations/${orgId}/collections/constituents?limit=1`,
    );
    expect(list.ok()).toBeTruthy();
    const body = await list.json();
    const first = (body.items ?? body.constituents ?? body.data ?? [])[0];
    test.skip(!first, 'no person record seeded in this organization');

    await page.goto(
      `/organizations/${orgId}/collections/constituents/${first.constituent_id}`,
    );
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await expect(page.locator(RAIL).first()).toBeVisible({ timeout: 15000 });

    // The identifier row: a person has no object number, so the row is absent
    // rather than mislabelled.
    await expect(page.getByText('Object #', { exact: true })).toHaveCount(0);

    // A person is never shelved. The row used to render as a missing required
    // field, complete with warning styling.
    const rail = page.locator(RAIL).first();
    await expect(rail.getByText('Location', { exact: true })).toHaveCount(0);

    // Rights attach to objects and media.
    await expect(page.getByText(/^Rights:/)).toHaveCount(0);

    // What should be there.
    await expect(rail.getByText('Type', { exact: true })).toBeVisible();
  });

  test('the person type is not repeated as an identifier', async ({ page, orgId, request }) => {
    // The regression proper: the page passed the type label as object_number,
    // so "Person" rendered twice in the rail — once under OBJECT #, once
    // under TYPE.
    const list = await request.get(
      `/api/organizations/${orgId}/collections/constituents?limit=1`,
    );
    const body = await list.json();
    const first = (body.items ?? body.constituents ?? body.data ?? [])[0];
    test.skip(!first, 'no person record seeded in this organization');

    await page.goto(
      `/organizations/${orgId}/collections/constituents/${first.constituent_id}`,
    );
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    const rail = page.locator(RAIL).first();
    await expect(rail).toBeVisible({ timeout: 15000 });
    const type = (first.constituent_type ?? 'person').toLowerCase();
    const label = type === 'person' ? 'Person' : type;
    await expect(rail.getByText(label, { exact: true })).toHaveCount(1);
  });

  test('the narrow-viewport strip carries the same corrections', async ({ page, orgId, request }) => {
    // The strip is lg:hidden, so fixing only the rail would have moved the
    // bug below 1280px rather than removing it. It is in the DOM regardless
    // of viewport, so this asserts on content, not visibility.
    const list = await request.get(
      `/api/organizations/${orgId}/collections/constituents?limit=1`,
    );
    const body = await list.json();
    const first = (body.items ?? body.constituents ?? body.data ?? [])[0];
    test.skip(!first, 'no person record seeded in this organization');

    await page.goto(
      `/organizations/${orgId}/collections/constituents/${first.constituent_id}`,
    );
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    const strip = page.locator(STRIP);
    await expect(strip).toHaveCount(1, { timeout: 15000 });
    const text = (await strip.innerText()).replace(/\s+/g, ' ');

    expect(text).not.toMatch(/Object #/);
    expect(text).not.toMatch(/Location/);
    expect(text).not.toMatch(/Rights:/);
    expect(text).toMatch(/Type/);

    // Location is the one block with no trailing separator, so Rights supplies
    // its own. With both hidden, a stale implementation left "• •" behind.
    expect(text).not.toMatch(/•\s*•/);
  });

  test('a collection object still shows its object number and location', async ({ page, orgId, request }) => {
    // The other half of the fix: none of the above may leak into the page the
    // object semantics are correct for.
    const list = await request.get(
      `/api/organizations/${orgId}/collections/objects?limit=1`,
    );
    const body = await list.json();
    const first = (body.items ?? body.objects ?? body.data ?? [])[0];
    test.skip(!first, 'no collection object seeded in this organization');

    await page.goto(`/organizations/${orgId}/collections/objects/${first.object_id}`);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    // Scope to the rail. The strip carries the same labels but is lg:hidden,
    // so an unscoped .first() resolves to the hidden copy at desktop width.
    const rail = page.locator(RAIL).first();
    await expect(rail).toBeVisible({ timeout: 15000 });
    await expect(rail.getByText('Object #', { exact: true })).toBeVisible();
    await expect(rail.getByText('Location', { exact: true })).toBeVisible();
  });
});
