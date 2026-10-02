import { test, expect } from '../../fixtures';

/**
 * Proxy Health Tests
 *
 * Verifies that Vite dev server proxy rules correctly forward
 * backend routes. Catches regressions where proxy config changes
 * or SPA fallback rewrites break backend API/IIIF/LOD routes.
 *
 * Run:
 *   npx playwright test proxy-health.spec.ts --project=chromium
 */

/**
 * The id of an object to exercise, preferring one that has media.
 *
 * These tests used to scrape the list page for an <a href> containing a UUID.
 * The list navigates by row onClick, so the only anchor matching that pattern
 * is the "New Object" create CTA — every one of these skipped, permanently
 * and silently, which is indistinguishable from passing in a summary.
 */
async function firstObjectId(
  page: import('@playwright/test').Page,
  orgId: string,
): Promise<string | null> {
  const res = await page.request.get(
    `/api/organizations/${orgId}/collections/objects?limit=25`,
  );
  if (!res.ok()) return null;
  const body = await res.json().catch(() => null);
  const objects: Array<Record<string, unknown>> =
    body?.objects ?? body?.items ?? body?.data ?? [];
  if (objects.length === 0) return null;

  // The IIIF manifest route serves only discoverable objects — that is the
  // institution's deliberate opt-in to a public presence — so an object with
  // media but without it returns 404 and the viewer renders an error. Prefer
  // one that satisfies both, then media alone, then anything.
  const hasMedia = (o: Record<string, unknown>) =>
    Boolean(o.primary_image_url || o.thumbnail_url || o.has_media);

  // Discoverability outranks the media hint. The manifest route serves only
  // discoverable objects, so a non-discoverable one fails outright — whereas
  // the list payload's primary_image_url is frequently null even for objects
  // that do have media, which made the media hint alone select the wrong
  // object and produce a 404 that looked like a viewer bug.
  return String(
    (objects.find((o) => o.is_discoverable && hasMedia(o)) ??
      objects.find((o) => o.is_discoverable) ??
      objects.find(hasMedia) ??
      objects[0]).object_id,
  );
}

test.describe('Vite proxy routes', () => {
  test('/api proxies to backend and returns JSON', async ({ request }) => {
    const response = await request.get(`/api/health`);
    // Backend should respond (even if 404 for missing route, it's not Vite's HTML fallback)
    const contentType = response.headers()['content-type'] || '';
    expect(contentType).not.toContain('text/html');
  });

  test('/iiif proxies to backend and does not return Vite HTML', async ({ request }) => {
    // Request a nonexistent IIIF manifest — should get a JSON error from backend, not Vite's index.html
    const response = await request.get('/iiif/3/00000000-0000-0000-0000-000000000000/manifest.json');
    const contentType = response.headers()['content-type'] || '';
    // Backend returns JSON error, not Vite's HTML SPA fallback
    expect(contentType).not.toContain('text/html');
  });

  test('IIIF manifest returns 200 for a real object', async ({ page, orgId }) => {
    // Navigate to collections to get an authenticated session
    await page.goto(`/organizations/${orgId}/collections/objects`);
    await page.waitForLoadState('networkidle');

    // Ask the API which object to use rather than scraping the list for an
    // anchor. The list navigates via a row onClick, not <a href>, so the only
    // matching anchor on the page is the "New Object" CTA — this skipped
    // permanently and the IIIF assertions below never ran once.
    const objectId = await firstObjectId(page, orgId);
    test.skip(!objectId, 'no collection object in this organization');
    const manifestResponse = await page.request.get(`/iiif/3/${objectId}/manifest.json`);

    // Should get a response from the backend (200 or 404 if no media), not Vite's HTML
    const status = manifestResponse.status();
    expect([200, 404]).toContain(status);

    if (status === 200) {
      const body = await manifestResponse.json();
      expect(body).toHaveProperty('@context');
    }
  });

  test('IIIF viewer does not show error for objects with media', async ({ page, orgId }) => {
    // Navigate to an object page
    await page.goto(`/organizations/${orgId}/collections/objects`);
    await page.waitForLoadState('networkidle');

    // Same reason as above: navigate directly rather than hunting an anchor
    // the list does not render.
    const objectId = await firstObjectId(page, orgId);
    test.skip(!objectId, 'no collection object in this organization');
    await page.goto(`/organizations/${orgId}/collections/objects/${objectId}`);
    await page.waitForLoadState('networkidle');

    // This assertion is only meaningful for an object that has media, and
    // firstObjectId prefers one, so an absent thumbnail here means the
    // organization has no media at all rather than that this test is
    // uninteresting.
    const thumbnail = page.locator('img[alt]').first();
    test.skip(
      !(await thumbnail.count()),
      'no object in this organization has media to render',
    );

    // Open the viewer through the control that actually carries the handler.
    // Clicking the <img> times out: it sits inside a `group` wrapper whose
    // hover overlay is absolutely positioned above it, so the click never
    // reaches the image. The page wires setShowIIIFViewer onto that wrapper,
    // and the record rail exposes a labeled expand button for the same
    // action — prefer the accessible control, fall back to the wrapper.
    const expand = page.getByRole('button', { name: /expand image/i }).first();
    if (await expand.count()) {
      await expand.click();
    } else {
      await thumbnail.locator('xpath=ancestor::*[contains(@class,"cursor-pointer")][1]').click();
    }
    await page.waitForTimeout(2000);

    // Verify no "Failed to load" or "404" error in the viewer
    const errorText = page.locator('text=/Image server returned|Failed to load|No image source/i');
    expect(await errorText.count()).toBe(0);
  });
});
