/**
 * Sentry initialization for frontend error tracking.
 *
 * Only active when VITE_SENTRY_DSN is configured AND the build is not a
 * development one.
 *
 * "Safe to leave empty in development" was the intent, but frontend/.env
 * carries a real DSN, so local runs reported into the same project as the
 * deployed app — tagged environment=development, with localhost URLs — and
 * became the majority of its unresolved issues, burying real ones. Set
 * VITE_SENTRY_ALLOW_DEV=true to opt a local build back in.
 */
import * as Sentry from '@sentry/react';

const DSN = import.meta.env.VITE_SENTRY_DSN || '';
const ENVIRONMENT =
  import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE;
const ALLOW_DEV = import.meta.env.VITE_SENTRY_ALLOW_DEV === 'true';

/** Whether this build should report to Sentry at all. */
export const sentryEnabled = Boolean(DSN) && (ENVIRONMENT !== 'development' || ALLOW_DEV);

export function initSentry(): void {
  if (!sentryEnabled) return;

  Sentry.init({
    dsn: DSN,
    environment: ENVIRONMENT,
    tracesSampleRate: parseFloat(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE || '0.1'),
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    sendDefaultPii: false,

    beforeSend(event) {
      // Scrub sensitive data from breadcrumbs
      if (event.request?.headers) {
        const headers = event.request.headers;
        for (const key of Object.keys(headers)) {
          if (/^(authorization|cookie|x-csrf-token)$/i.test(key)) {
            headers[key] = '[Filtered]';
          }
        }
      }
      return event;
    },

    ignoreErrors: [
      // Common browser noise
      'ResizeObserver loop',
      'Non-Error promise rejection',
    ],
  });
}

export function setSentryUser(userId: string, orgId?: string): void {
  if (!sentryEnabled) return;
  Sentry.setUser({ id: userId });
  if (orgId) {
    Sentry.setTag('organization_id', orgId);
  }
}

export function clearSentryUser(): void {
  if (!sentryEnabled) return;
  Sentry.setUser(null);
}
