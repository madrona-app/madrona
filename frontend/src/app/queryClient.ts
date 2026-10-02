import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { getGlobalShowToast } from '../contexts/ToastContext';
import { ApiError } from '../lib/apiClient';
import { logger } from '../lib/logger';

const queryCache = new QueryCache({
  onError: (error, query) => {
    const key = String(query.queryKey[0] ?? 'unknown');

    if (error instanceof ApiError && error.status >= 500) {
      // Server error — always report
      logger.error(`Query failed [${key}]:`, error);
    } else if (!(error instanceof ApiError)) {
      // Not an API error — likely a schema validation failure, transform bug,
      // or other code-level error. These indicate contract mismatches and
      // should always reach Sentry.
      logger.error(`Query error [${key}]:`, error);
    }
    // 4xx ApiErrors (auth, permissions, not-found) are expected — skip
  },
});

const mutationCache = new MutationCache({
  onError: (error, _variables, _context, mutation) => {
    // Skip if the mutation has its own onError handler
    if (mutation.options.onError) return;

    const showToast = getGlobalShowToast();
    if (!showToast) {
      // Toast context not yet mounted — would otherwise be silently dropped
      logger.error('Mutation failed (pre-mount):', error);
      return;
    }

    let message = 'Something went wrong. Please try again.';
    if (error instanceof ApiError) {
      message = error.message;
    } else if (error instanceof TypeError && error.message === 'Failed to fetch') {
      message = 'Network error — check your connection and try again.';
    }

    showToast({
      type: 'error',
      title: 'Something went wrong',
      message,
      action: {
        label: 'Retry',
        onClick: () => {
          // Re-run the failed mutation with its original variables.
          // execute() resets state and runs the mutation fn; rejection is
          // handled by this same onError, so swallow the returned promise.
          void mutation.execute(mutation.state.variables);
        },
      },
    });
  },
});

export const queryClient = new QueryClient({
  queryCache,
  mutationCache,
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 2 * 60 * 1000, // 2 minutes — prevents redundant refetches on route changes
    },
  },
});
