import { test as setup } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const authFile = 'tests/.auth/user.json';

// hooks/useOnboardingSeen.ts — a map of `${userId}::${orgId}` -> dismissed-at.
const ONBOARDING_SEEN_KEY = 'madrona.guide.onboarding.seen';

/**
 * Check if existing auth is still valid (has refresh token with future expiry)
 */
function hasValidAuth(): boolean {
  try {
    const authPath = path.resolve(authFile);
    if (!fs.existsSync(authPath)) return false;

    const data = JSON.parse(fs.readFileSync(authPath, 'utf8'));

    // A state saved before the onboarding flag was added would be reused
    // as-is and leave the welcome scrim over every page. Re-mint instead.
    const origins: { localStorage?: { name: string }[] }[] = data.origins || [];
    const hasOnboardingFlag = origins.some((o) =>
      (o.localStorage || []).some((item) => item.name === ONBOARDING_SEEN_KEY),
    );
    if (!hasOnboardingFlag) return false;

    const cookies = data.cookies || [];
    const refreshToken = cookies.find((c: { name: string; expires: number }) => c.name === 'refresh_token');

    if (!refreshToken) return false;

    // Valid if it expires more than 1 hour from now
    const expiresAt = refreshToken.expires * 1000;
    const oneHourFromNow = Date.now() + 60 * 60 * 1000;
    return expiresAt > oneHourFromNow;
  } catch {
    return false;
  }
}

/**
 * Authentication setup — runs once before all tests.
 *
 * The Cognito login UI has no CI/mock mode and is MFA-gated for the admin
 * e2e user, so driving it non-interactively is impossible (see GitHub
 * issue #37). Instead we mint a session directly via the test-only,
 * non-production-gated endpoint `/api/test-support/mint-session`
 * (backend: routers/test_support.py — 404s in production).
 *
 * The Madrona session IS the `refresh_token` HttpOnly cookie:
 * `require_auth` falls back to it when no Bearer header is present, which
 * is exactly how the SPA authenticates (it stores no tokens client-side).
 * So we POST the mint endpoint on the SPA's own origin, let the
 * Set-Cookie land in the browser context, and persist storageState.
 */
setup('authenticate', async ({ page }) => {
  setup.setTimeout(30000);

  if (hasValidAuth()) {
    console.log('✅ Using existing auth state (still valid)');
    return;
  }

  const email = process.env.PLAYWRIGHT_TEST_EMAIL;
  if (!email) {
    console.log('⚠️ PLAYWRIGHT_TEST_EMAIL not set — writing empty auth state');
    await page.context().storageState({ path: authFile });
    return;
  }

  console.log('🔐 Minting session for:', email);

  // POST on the SPA's own origin (baseURL) so the refresh_token cookie is
  // scoped to the origin the app runs on — exactly what the real login
  // flow produces. Uses the page's request context so the Set-Cookie is
  // stored on the browser context we then snapshot.
  const resp = await page.request.post('/api/test-support/mint-session', {
    data: { email },
    headers: { 'Content-Type': 'application/json' },
  });

  if (!resp.ok()) {
    const body = await resp.text();
    throw new Error(
      `mint-session failed (${resp.status()}): ${body}\n` +
      `Is the backend running with APP_ENV != production and the e2e ` +
      `user seeded (seed_e2e_test_data)?`
    );
  }

  const data = await resp.json();
  console.log('✅ Session minted for', data.email, '(org', data.active_organization_id, ')');

  // Sanity-check the cookie authenticates the SPA's bootstrap call.
  const me = await page.request.get('/api/me');
  if (!me.ok()) {
    throw new Error(`minted cookie did not authenticate /api/me (${me.status()})`);
  }

  // Mark the Guide onboarding welcome as already dismissed, in the stored
  // state itself. The welcome is a full-viewport scrim (GuideOnboardingWelcome)
  // that takes every click until someone dismisses it, and a freshly seeded
  // user has never dismissed it. The `page` fixture in fixtures/test-fixtures.ts
  // sets the same flag, but only specs that import `test` from there get it;
  // the page sweeps import @playwright/test directly, so on every page they
  // swept the first click landed in the welcome and each later one timed out
  // behind it — about 1,200 dead 3-second clicks a run, the buttons behind
  // never exercised. Here it reaches every spec that uses this storageState.
  const { user_id: userId, active_organization_id: orgId } = (await me.json()) as {
    user_id?: string;
    active_organization_id?: string;
  };
  if (!userId || !orgId) {
    throw new Error('/api/me returned no user_id or active_organization_id');
  }
  await page.goto('/');
  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key, value),
    [ONBOARDING_SEEN_KEY, JSON.stringify({ [`${userId}::${orgId}`]: Date.now() })] as const,
  );

  fs.mkdirSync(path.dirname(path.resolve(authFile)), { recursive: true });
  await page.context().storageState({ path: authFile });
  console.log('💾 Auth state saved to:', authFile);
});
