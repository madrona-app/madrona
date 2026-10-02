import type { Page } from '@playwright/test';

export interface CapturedSentryEvent {
  message: string;
  type: string;
  timestamp: number;
}

/**
 * Intercepts Sentry.captureException / captureMessage calls in the browser.
 *
 * Many errors are caught by application code (e.g., Zod validation failures
 * in the API layer) and reported to Sentry without crashing the page. Standard
 * Playwright error detection (pageerror, console.error) misses these entirely.
 *
 * This utility injects a script that monkey-patches the Sentry client's
 * captureException and captureMessage methods, collecting events into a
 * window array that the test can read back.
 *
 * Usage:
 *   const sentry = new SentryIntercept(page);
 *   await sentry.install();          // call BEFORE navigating
 *   await page.goto('/some-page');
 *   const events = await sentry.drain();
 *   // assert on events
 */
export class SentryIntercept {
  constructor(private page: Page) {}

  /**
   * Inject the intercept script. Must be called before page.goto().
   * Uses page.addInitScript so it runs on every navigation/reload.
   */
  async install(): Promise<void> {
    await this.page.addInitScript(() => {
      // Collected events
      (window as any).__SENTRY_TEST_EVENTS__ = [];

      // Patch Sentry hub/client when it initializes
      const patchSentry = () => {
        const sentry = (window as any).__SENTRY__;
        if (!sentry) return false;

        // Sentry v7/v8 — patch the hub's captureException
        const hub = sentry.hub;
        if (hub && !hub.__patched_for_test) {
          const origCapture = hub.captureException?.bind(hub);
          const origMessage = hub.captureMessage?.bind(hub);

          if (origCapture) {
            hub.captureException = (err: any, ...args: any[]) => {
              (window as any).__SENTRY_TEST_EVENTS__.push({
                message: err?.message || err?.toString?.() || String(err),
                type: 'exception',
                timestamp: Date.now(),
              });
              return origCapture(err, ...args);
            };
          }

          if (origMessage) {
            hub.captureMessage = (msg: string, ...args: any[]) => {
              (window as any).__SENTRY_TEST_EVENTS__.push({
                message: msg,
                type: 'message',
                timestamp: Date.now(),
              });
              return origMessage(msg, ...args);
            };
          }

          hub.__patched_for_test = true;
        }

        // Sentry v8 functional API — patch the global scope
        if (typeof sentry.captureException === 'function' && !sentry.__patched_for_test) {
          const origCapture = sentry.captureException;
          const origMessage = sentry.captureMessage;

          sentry.captureException = (err: any, ...args: any[]) => {
            (window as any).__SENTRY_TEST_EVENTS__.push({
              message: err?.message || err?.toString?.() || String(err),
              type: 'exception',
              timestamp: Date.now(),
            });
            return origCapture(err, ...args);
          };

          if (origMessage) {
            sentry.captureMessage = (msg: string, ...args: any[]) => {
              (window as any).__SENTRY_TEST_EVENTS__.push({
                message: msg,
                type: 'message',
                timestamp: Date.now(),
              });
              return origMessage(msg, ...args);
            };
          }

          sentry.__patched_for_test = true;
        }

        return true;
      };

      // Also intercept the Sentry SDK's client.captureException directly
      // by watching for Sentry's envelope transport — this is the most
      // reliable hook since it catches ALL events regardless of API shape
      const origFetch = window.fetch;
      window.fetch = function (...args: any[]) {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
        if (url.includes('sentry.io') && url.includes('/envelope/')) {
          try {
            const body = typeof args[1]?.body === 'string' ? args[1].body : '';
            // Sentry envelopes are newline-delimited JSON
            const lines = body.split('\n');
            for (const line of lines) {
              try {
                const parsed = JSON.parse(line);
                if (parsed?.exception?.values?.[0]?.value) {
                  (window as any).__SENTRY_TEST_EVENTS__.push({
                    message: parsed.exception.values[0].value,
                    type: 'exception',
                    timestamp: Date.now(),
                  });
                }
              } catch {
                // not JSON or not an event line
              }
            }
          } catch {
            // parsing failed, continue
          }
        }
        return origFetch.apply(window, args as any);
      };

      // Try to patch immediately and retry on a short interval
      if (!patchSentry()) {
        let attempts = 0;
        const interval = setInterval(() => {
          if (patchSentry() || ++attempts > 50) {
            clearInterval(interval);
          }
        }, 100);
      }
    });
  }

  /**
   * Read and clear all captured Sentry events.
   */
  async drain(): Promise<CapturedSentryEvent[]> {
    return this.page.evaluate(() => {
      const events = (window as any).__SENTRY_TEST_EVENTS__ || [];
      (window as any).__SENTRY_TEST_EVENTS__ = [];
      return events;
    });
  }

  /**
   * Read events without clearing (peek).
   */
  async peek(): Promise<CapturedSentryEvent[]> {
    return this.page.evaluate(() => {
      return (window as any).__SENTRY_TEST_EVENTS__ || [];
    });
  }

  /**
   * Clear all captured events.
   */
  async clear(): Promise<void> {
    await this.page.evaluate(() => {
      (window as any).__SENTRY_TEST_EVENTS__ = [];
    });
  }
}

/**
 * Create and install a Sentry intercept for a page.
 * Call this BEFORE navigating to any page.
 */
export async function createSentryIntercept(page: Page): Promise<SentryIntercept> {
  const intercept = new SentryIntercept(page);
  await intercept.install();
  return intercept;
}
