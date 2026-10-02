import { test as base, type APIRequestContext } from '@playwright/test';
import { LoginPage, CollectionObjectPage } from '../page-objects';
import {
  ApiHelpers,
  generateTestObjectNumber,
  CreateObjectResponse,
} from './api-helpers';
import { ApiErrorMonitor, createApiErrorMonitor } from '../utils/api-error-monitor';

/**
 * Custom fixture types.
 */
export interface CustomFixtures {
  /** Organization ID for authenticated tests */
  orgId: string;
  /** API helpers for test data management */
  apiHelpers: ApiHelpers;
  /** Login page object */
  loginPage: LoginPage;
  /** Collection object page object */
  collectionObjectPage: CollectionObjectPage;
  /** Generated unique test object number */
  testObjectNumber: string;
  /** Pre-created test collection object (with automatic cleanup) */
  testCollectionObject: CreateObjectResponse;
  /** API error monitor - tracks failed API calls during test */
  apiErrorMonitor: ApiErrorMonitor;
}

/**
 * Extended Playwright test with custom fixtures.
 */
// `/api/me` is identical for the whole run (same seeded user/org), but both
// the `page` and `orgId` fixtures need it. Calling it per-test under parallel
// load floods the backend's rate limiter (429s that fail the fixtures). Cache
// it at module scope — that's per worker process — so it's fetched once and
// reused for every test on that worker.
let _cachedMe: { user_id?: string; active_organization_id?: string } | null = null;

async function resolveMe(
  request: APIRequestContext
): Promise<{ user_id?: string; active_organization_id?: string }> {
  if (_cachedMe) return _cachedMe;
  const res = await request.get('/api/me');
  if (!res.ok()) {
    throw new Error(
      `/api/me returned ${res.status()} — is auth.setup's storageState valid ` +
        `and the backend running?`
    );
  }
  _cachedMe = (await res.json()) as {
    user_id?: string;
    active_organization_id?: string;
  };
  return _cachedMe;
}

export const test = base.extend<CustomFixtures>({
  /**
   * Override the built-in `page` to suppress the Guide onboarding welcome.
   *
   * GuideOnboardingWelcome renders a `fixed inset-0 z-[90]` overlay whose
   * backdrop is `pointer-events-auto` — it sits over the whole viewport and
   * intercepts the first click on any page, and it occupies the slot where the
   * "Ask Guide" FAB would be. That broke nearly every interaction test (create
   * links/buttons time out; the FAB is never clickable). The app suppresses it
   * once dismissed via localStorage `madrona.guide.onboarding.seen`, a map of
   * `${userId}::${orgId} -> timestamp`. Seed that flag before any navigation so
   * the welcome never opens — the same state a returning user has.
   */
  page: async ({ page, request }, use) => {
    const d = await resolveMe(request).catch(() => ({} as Record<string, never>));
    if (d.user_id && d.active_organization_id) {
      const seen = JSON.stringify({
        [`${d.user_id}::${d.active_organization_id}`]: 1,
      });
      await page.addInitScript(
        ([key, val]) => {
          try {
            window.localStorage.setItem(key, val);
          } catch {
            /* ignore */
          }
        },
        ['madrona.guide.onboarding.seen', seen] as const
      );
    }
    // `use` here is the Playwright fixture callback, not React 19's `use`
    // hook — react-hooks/rules-of-hooks false-positives on the name.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(page);
  },

  /**
   * Organization UUID for the authenticated test user.
   */
  orgId: [
    async ({ request }, use) => {
      // The seeded test org's UUID is random per `seed_e2e_test_data` run, so
      // it can't be hardcoded. PLAYWRIGHT_TEST_ORG_ID was historically passed
      // the org *slug* ("e2e-test-org"), but the API routes type the path
      // param as `organization_id: UUID` and reject a slug with 422 — and
      // `page.goto('/organizations/<slug>/...')` can't resolve it either. That
      // mismatch failed the entire journey suite while auth.setup still passed
      // (it uses the minted session's real org, not this fixture).
      //
      // Resolve the authenticated user's real active-org UUID from /api/me
      // (the chromium project's storageState authenticates `request`). An
      // explicit UUID-shaped env var still wins, to target a specific org.
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const override = process.env.PLAYWRIGHT_TEST_ORG_ID;
      if (override && UUID_RE.test(override)) {
        await use(override);
        return;
      }

      const data = await resolveMe(request);
      if (!data.active_organization_id) {
        throw new Error(
          'orgId fixture: /api/me returned no active_organization_id — is the ' +
            'e2e user a member of an org (seed_e2e_test_data)?'
        );
      }
      await use(data.active_organization_id);
    },
    { scope: 'test' },
  ],

  /**
   * API helpers with authenticated request context.
   */
  apiHelpers: [
    async ({ request, orgId }, use) => {
      const helpers = new ApiHelpers(request, orgId);
      await use(helpers);
    },
    { scope: 'test' },
  ],

  /**
   * Login page object.
   */
  loginPage: [
    async ({ page }, use) => {
      const loginPage = new LoginPage(page);
      await use(loginPage);
    },
    { scope: 'test' },
  ],

  /**
   * Collection object page object.
   */
  collectionObjectPage: [
    async ({ page, orgId }, use) => {
      const objectPage = new CollectionObjectPage(page, orgId);
      await use(objectPage);
    },
    { scope: 'test' },
  ],

  /**
   * Generate a unique test object number for each test.
   */
  testObjectNumber: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const objectNumber = generateTestObjectNumber();
      await use(objectNumber);
    },
    { scope: 'test' },
  ],

  /**
   * Create a test collection object via API before the test,
   * and clean it up after.
   */
  testCollectionObject: [
    async ({ apiHelpers, testObjectNumber }, use) => {
      // Setup: Create the object via API
      const createdObject = await apiHelpers.createCollectionObject({
        object_number: testObjectNumber,
        title: `Test Object ${testObjectNumber}`,
        description: 'Created by E2E test fixture',
      });

      // Provide the object to the test
      await use(createdObject);

      // Teardown: Delete the object
      try {
        await apiHelpers.deleteCollectionObject(createdObject.object_id);
      } catch (error) {
        console.warn(
          `Failed to cleanup test object ${createdObject.object_id}:`,
          error
        );
      }
    },
    { scope: 'test' },
  ],

  /**
   * API error monitor - tracks failed API calls during test.
   * Use monitor.ignoreUrls() to exclude known failing endpoints.
   * Check monitor.hasErrors() and monitor.getErrorReport() at end of test.
   */
  apiErrorMonitor: [
    async ({ page }, use) => {
      const monitor = createApiErrorMonitor(page);
      await use(monitor);
    },
    { scope: 'test' },
  ],
});

/**
 * Re-export expect from Playwright.
 */
export { expect } from '@playwright/test';
