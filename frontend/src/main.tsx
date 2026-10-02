import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initSentry } from './lib/sentry'
import { logger } from './lib/logger'
import './index.css'
import './styles/flow.css'
import App from './App.tsx'

// Initialize Sentry before rendering (no-op if VITE_SENTRY_DSN is not set)
initSentry()

// Catch unhandled promise rejections that escape React and async boundaries.
// When Sentry DSN is configured, Sentry's GlobalHandlers integration already
// captures these — we only log to console to avoid double-reporting.
// When DSN is absent, logger.error is our only record.
window.addEventListener('unhandledrejection', (event) => {
  const error = event.reason instanceof Error
    ? event.reason
    : new Error(String(event.reason));

  if (import.meta.env.VITE_SENTRY_DSN) {
    // Sentry GlobalHandlers already captures this — just log to console
    // eslint-disable-next-line no-console -- avoid double-reporting to Sentry
    console.error('[Madrona] Unhandled promise rejection:', error);
  } else {
    // No Sentry listening — logger.error is our only record
    logger.error('Unhandled promise rejection:', error);
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
