import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  apiFetch,
  ApiError,
  setCsrfToken,
  getCsrfToken,
  fetchCsrfToken,
  getFriendlyErrorMessage,
  routeTemplate,
} from '../../lib/apiClient';

// Mock global fetch
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe('apiClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCsrfToken(null);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('ApiError', () => {
    it('creates error with all properties', () => {
      const error = new ApiError('Something failed', 400, 'VALIDATION_ERROR', { field: 'email' });

      expect(error.message).toBe('Something failed');
      expect(error.status).toBe(400);
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.details).toEqual({ field: 'email' });
      expect(error.name).toBe('ApiError');
    });

    it('creates error with minimal properties', () => {
      const error = new ApiError('Server error', 500);

      expect(error.message).toBe('Server error');
      expect(error.status).toBe(500);
      expect(error.code).toBeUndefined();
      expect(error.details).toBeUndefined();
    });
  });

  describe('CSRF token management', () => {
    it('stores and retrieves CSRF token', () => {
      expect(getCsrfToken()).toBeNull();

      setCsrfToken('test-token-123');
      expect(getCsrfToken()).toBe('test-token-123');

      setCsrfToken(null);
      expect(getCsrfToken()).toBeNull();
    });

    it('fetchCsrfToken fetches and stores token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ csrf_token: 'fetched-token' }),
      });

      const token = await fetchCsrfToken();

      expect(token).toBe('fetched-token');
      expect(getCsrfToken()).toBe('fetched-token');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/auth/csrf'),
        { credentials: 'include' }
      );
    });

    it('fetchCsrfToken throws on failed response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(fetchCsrfToken()).rejects.toThrow(ApiError);
    });

    it('fetchCsrfToken throws if no token in response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      await expect(fetchCsrfToken()).rejects.toThrow('No CSRF token in response');
    });
  });

  describe('apiFetch', () => {
    describe('successful requests', () => {
      it('makes GET request with credentials', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: 'test' }),
        });

        const result = await apiFetch('/test');

        expect(result).toEqual({ data: 'test' });
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/test'),
          expect.objectContaining({
            credentials: 'include',
          })
        );
      });

      it('makes POST request with JSON body', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ created: true }),
        });

        await apiFetch('/test', {
          method: 'POST',
          body: JSON.stringify({ name: 'test' }),
        });

        expect(mockFetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ name: 'test' }),
            headers: expect.objectContaining({
              'Content-Type': 'application/json',
            }),
          })
        );
      });

      it('includes CSRF token for state-changing requests', async () => {
        setCsrfToken('csrf-token-123');

        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({}),
        });

        await apiFetch('/test', { method: 'POST' });

        expect(mockFetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            headers: expect.objectContaining({
              'X-CSRF-Token': 'csrf-token-123',
            }),
          })
        );
      });

      it('does not include CSRF token for GET requests', async () => {
        setCsrfToken('csrf-token-123');

        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({}),
        });

        await apiFetch('/test', { method: 'GET' });

        const callHeaders = mockFetch.mock.calls[0][1].headers;
        expect(callHeaders['X-CSRF-Token']).toBeUndefined();
      });

      it('handles 204 no-content response', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 204,
          headers: new Headers(),
        });

        const result = await apiFetch('/test', { method: 'DELETE' });

        expect(result).toEqual({});
      });

      it('handles non-JSON response', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/plain' }),
          text: async () => 'plain text response',
        });

        const result = await apiFetch('/test');

        expect(result).toBe('plain text response');
      });
    });

    describe('error handling', () => {
      it('throws ApiError for non-2xx response', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 404,
          json: async () => ({ error: 'Not found' }),
        });

        await expect(apiFetch('/test')).rejects.toThrow(ApiError);
      });

      it('parses error message from response', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: async () => ({ error: { message: 'Invalid input', code: 'INVALID' } }),
        });

        try {
          await apiFetch('/test');
        } catch (error) {
          expect(error).toBeInstanceOf(ApiError);
          expect((error as ApiError).message).toBe('Invalid input');
          expect((error as ApiError).code).toBe('INVALID');
        }
      });

      it('handles error response as string', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: async () => ({ error: 'Simple error message' }),
        });

        try {
          await apiFetch('/test');
        } catch (error) {
          expect((error as ApiError).message).toBe('Simple error message');
        }
      });

      it('handles unparseable error response', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: async () => { throw new Error('Invalid JSON'); },
        });

        try {
          await apiFetch('/test');
        } catch (error) {
          expect(error).toBeInstanceOf(ApiError);
          expect((error as ApiError).status).toBe(500);
        }
      });
    });

    describe('URL handling', () => {
      it('prepends API base URL for relative paths', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({}),
        });

        await apiFetch('/organizations/123');

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringMatching(/\/api\/organizations\/123$/),
          expect.any(Object)
        );
      });

      it('uses full URL when provided', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({}),
        });

        await apiFetch('https://external.api/endpoint');

        expect(mockFetch).toHaveBeenCalledWith(
          'https://external.api/endpoint',
          expect.any(Object)
        );
      });
    });
  });

  describe('getFriendlyErrorMessage', () => {
    it('returns friendly message for 401', () => {
      const error = new ApiError('Unauthorized', 401);
      expect(getFriendlyErrorMessage(error)).toBe('Please log in to continue.');
    });

    it('returns friendly message for 403', () => {
      const error = new ApiError('Forbidden', 403);
      expect(getFriendlyErrorMessage(error)).toBe('You do not have permission to perform this action.');
    });

    it('returns friendly message for 404', () => {
      const error = new ApiError('Not found', 404);
      expect(getFriendlyErrorMessage(error)).toBe('Resource not found.');
    });

    it('returns friendly message for 429', () => {
      const error = new ApiError('Rate limited', 429);
      expect(getFriendlyErrorMessage(error)).toBe('Too many requests. Please wait a moment and try again.');
    });

    it('returns friendly message for server errors', () => {
      expect(getFriendlyErrorMessage(new ApiError('Error', 500))).toBe('Server error. Please try again later.');
      expect(getFriendlyErrorMessage(new ApiError('Error', 502))).toBe('Server error. Please try again later.');
      expect(getFriendlyErrorMessage(new ApiError('Error', 503))).toBe('Server error. Please try again later.');
    });

    it('returns custom message for 400 errors', () => {
      const error = new ApiError('Email is invalid', 400);
      expect(getFriendlyErrorMessage(error)).toBe('Email is invalid');
    });

    it('handles non-ApiError errors', () => {
      const error = new Error('Network error');
      expect(getFriendlyErrorMessage(error)).toBe('Network error');
    });

    it('handles unknown error types', () => {
      expect(getFriendlyErrorMessage('string error')).toBe('An unexpected error occurred.');
      expect(getFriendlyErrorMessage(null)).toBe('An unexpected error occurred.');
    });
  });
});

/**
 * A 403 is an authorization outcome, not a crash — but every one was logged
 * with the raw path in the message, and logger.warn reports to Sentry. Since
 * each page calls a different endpoint, a single stale organization context
 * produced roughly ninety distinct Sentry issues from one browsing session,
 * which was most of what sat in that project.
 *
 * Grouping by route template collapses those to one issue per endpoint shape,
 * while the raw path stays attached as structured context.
 */
describe('routeTemplate', () => {
  it('replaces a UUID with a stable placeholder', () => {
    expect(routeTemplate('/organizations/c62f6243-b50e-4f10-a6b3-80425de6c01d/context'))
      .toBe('/organizations/:id/context');
  });

  it('collapses every UUID in a nested path', () => {
    expect(
      routeTemplate(
        '/organizations/c62f6243-b50e-4f10-a6b3-80425de6c01d/media/f9aac7c4-ab0c-4475-8f7b-3c6614913920/download'
      )
    ).toBe('/organizations/:id/media/:id/download');
  });

  it('groups two different organizations to the same template', () => {
    const a = routeTemplate('/organizations/c62f6243-b50e-4f10-a6b3-80425de6c01d/roles');
    const b = routeTemplate('/organizations/8c7f6c62-f5ca-462d-adc2-b17c75e45807/roles');
    expect(a).toBe(b);
  });

  it('drops the query string, which carries paging and filters', () => {
    expect(routeTemplate('/organizations/c62f6243-b50e-4f10-a6b3-80425de6c01d/collections/entries?limit=25&offset=0'))
      .toBe('/organizations/:id/collections/entries');
  });

  it('replaces numeric path segments', () => {
    expect(routeTemplate('/reports/42/download')).toBe('/reports/:n/download');
  });

  it('leaves a path with no identifiers alone', () => {
    expect(routeTemplate('/api/me/overview-preferences')).toBe('/api/me/overview-preferences');
  });

  it('does not mangle words that merely contain hex', () => {
    expect(routeTemplate('/datasets/deadbeef-cafe')).toBe('/datasets/deadbeef-cafe');
  });
});
