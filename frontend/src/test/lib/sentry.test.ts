/**
 * frontend/.env carries a real DSN, so every local build reported into the
 * same Sentry project as the deployed app — tagged environment=development,
 * with localhost URLs. That was the bulk of that project's unresolved issues.
 *
 * initSentry now refuses to arm for a development build unless
 * VITE_SENTRY_ALLOW_DEV is set. The flag is computed at module load from
 * import.meta.env, so each case re-imports the module with a fresh registry.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

async function loadWith(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return import('../../lib/sentry');
}

describe('sentryEnabled', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllEnvs());

  it('stays off when no DSN is configured', async () => {
    const m = await loadWith({ VITE_SENTRY_DSN: '', VITE_SENTRY_ENVIRONMENT: 'production' });
    expect(m.sentryEnabled).toBe(false);
  });

  it('stays off for a development build even with a real DSN', async () => {
    // The exact shape of the bug: a DSN is present, so the old `if (!DSN)`
    // guard passed and local runs reported to the shared project.
    const m = await loadWith({
      VITE_SENTRY_DSN: 'https://abc@o1.ingest.sentry.io/2',
      VITE_SENTRY_ENVIRONMENT: 'development',
    });
    expect(m.sentryEnabled).toBe(false);
  });

  it('arms for a non-development environment', async () => {
    const m = await loadWith({
      VITE_SENTRY_DSN: 'https://abc@o1.ingest.sentry.io/2',
      VITE_SENTRY_ENVIRONMENT: 'production',
    });
    expect(m.sentryEnabled).toBe(true);
  });

  it('can be opted back in for a development build', async () => {
    const m = await loadWith({
      VITE_SENTRY_DSN: 'https://abc@o1.ingest.sentry.io/2',
      VITE_SENTRY_ENVIRONMENT: 'development',
      VITE_SENTRY_ALLOW_DEV: 'true',
    });
    expect(m.sentryEnabled).toBe(true);
  });

  it('treats any value other than the literal "true" as not opted in', async () => {
    const m = await loadWith({
      VITE_SENTRY_DSN: 'https://abc@o1.ingest.sentry.io/2',
      VITE_SENTRY_ENVIRONMENT: 'development',
      VITE_SENTRY_ALLOW_DEV: '1',
    });
    expect(m.sentryEnabled).toBe(false);
  });

  it('does not set a user when disabled', async () => {
    const m = await loadWith({ VITE_SENTRY_DSN: '', VITE_SENTRY_ENVIRONMENT: 'development' });
    expect(() => m.setSentryUser('u1', 'o1')).not.toThrow();
    expect(m.sentryEnabled).toBe(false);
  });
});
