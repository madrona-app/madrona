/**
 * API Client with HttpOnly cookie authentication support
 *
 * Features:
 * - All requests include credentials: 'include' for HttpOnly cookies
 * - Automatic CSRF token handling for state-changing requests
 * - JSON parsing and typed error handling
 * - No token storage in localStorage/sessionStorage
 * - Global error event emission for permission failures
 */

import { logger } from './logger';

/**
 * Collapse identifiers out of a path so Sentry can group by route.
 *
 * Every 403 was logged with the raw path in the message, so a single stale
 * organization context produced one distinct Sentry issue per endpoint the
 * app touched — roughly ninety of them from one browsing session, which
 * buried the real errors. The raw path is still attached as context.
 */
export function routeTemplate(path: string): string {
  return path
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:n')
    .split('?')[0];
}

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

// Global error event emitter for permission failures
type ApiErrorListener = (error: { status: number; message: string; code?: string }) => void;
const errorListeners: Set<ApiErrorListener> = new Set();

export function onApiError(listener: ApiErrorListener): () => void {
  errorListeners.add(listener);
  return () => errorListeners.delete(listener);
}

function emitApiError(error: { status: number; message: string; code?: string }) {
  errorListeners.forEach(listener => listener(error));
}

// Custom error class for API errors
export class ApiError extends Error {
  status: number;
  code?: string;
  details?: Record<string, any>;

  constructor(
    message: string,
    status: number,
    code?: string,
    details?: Record<string, any>
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// Role override for platform admin permission testing.
// Stored in sessionStorage so it persists across page refreshes but not tabs.
const ROLE_OVERRIDE_KEY = 'madrona_role_override';
const SYSTEM_OVERRIDE_ROLES = new Set(['admin', 'registrar', 'curator', 'publisher', 'viewer']);
let roleOverride: string | null = null;
try {
  const stored = sessionStorage.getItem(ROLE_OVERRIDE_KEY);
  // Accept system role keys or UUID strings (custom roles)
  const isValidUUID = stored && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stored);
  if (stored && (SYSTEM_OVERRIDE_ROLES.has(stored) || isValidUUID)) {
    roleOverride = stored;
  } else if (stored) {
    // Clear stale/invalid role key from previous session
    sessionStorage.removeItem(ROLE_OVERRIDE_KEY);
  }
} catch { /* SSR or restricted context */ }

export function setRoleOverride(role: string | null) {
  roleOverride = role;
  if (role) {
    sessionStorage.setItem(ROLE_OVERRIDE_KEY, role);
  } else {
    sessionStorage.removeItem(ROLE_OVERRIDE_KEY);
  }
}

export function getRoleOverride(): string | null {
  return roleOverride;
}

// CSRF token stored in memory (not localStorage).
// Also set as a cookie by the server (double-submit pattern).
let csrfToken: string | null = null;

export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

export function getCsrfToken(): string | null {
  // Prefer in-memory token; fall back to cookie (set by server)
  if (csrfToken) return csrfToken;
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Fetch CSRF token from backend and store in memory.
 * The server also sets the token as a cookie (double-submit pattern):
 * both the X-CSRF-Token header and csrf_token cookie must match.
 */
export async function fetchCsrfToken(): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/auth/csrf`, {
    credentials: 'include',
  });

  if (!response.ok) {
    throw new ApiError('Failed to fetch CSRF token', response.status);
  }

  const data = await response.json();
  const token = data.csrf_token;

  if (!token) {
    throw new ApiError('No CSRF token in response', 500);
  }

  setCsrfToken(token);
  return token;
}

/**
 * Enhanced fetch wrapper with HttpOnly cookie support
 * 
 * @param path - API path (relative to API_BASE_URL) or full URL
 * @param options - Fetch options (will be enhanced with credentials and headers)
 * @returns Parsed JSON response
 * @throws ApiError on non-2xx responses
 */
export interface ApiFetchOptions extends RequestInit {
  skipAuth?: boolean;
  /** Internal: prevents infinite CSRF retry loops */
  _csrfRetried?: boolean;
  /**
   * Assert that the JSON response contains these top-level keys.
   * Missing keys are logged as warnings (reported to Sentry) and
   * the response is still returned — this is a safety net, not a gate.
   *
   * Usage: apiFetch<{ roles: Role[] }>('/roles', { expectKeys: ['roles'] })
   */
  expectKeys?: string[];
}

export async function apiFetch<T = any>(
  path: string,
  options: ApiFetchOptions = {}
): Promise<T> {
  // Build full URL
  const url = path.startsWith('http') ? path : `${API_BASE_URL}${path}`;

  // Build headers
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
  };

  // Add Content-Type for requests with body (but not FormData - browser sets it automatically)
  if (options.body && !headers['Content-Type'] && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  // Add CSRF token for state-changing requests (double-submit pattern)
  const method = (options.method || 'GET').toUpperCase();
  const isStateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  const currentCsrfToken = getCsrfToken();

  if (isStateChanging && currentCsrfToken) {
    headers['X-CSRF-Token'] = currentCsrfToken;
  }

  // Add role override header for platform admin permission testing
  if (roleOverride) {
    headers['X-Role-Override'] = roleOverride;
  }

  // Make request with credentials included
  const response = await fetch(url, {
    ...options,
    credentials: 'include', // Always include HttpOnly cookies
    headers,
  });

  // Handle non-2xx responses
  if (!response.ok) {
    let errorMessage = `Request failed with status ${response.status}`;
    let errorCode: string | undefined;
    let errorDetails: Record<string, any> | undefined;

    try {
      const errorData = await response.json();

      // Handle different error response formats
      if (errorData.error) {
        if (typeof errorData.error === 'string') {
          errorMessage = errorData.error;
        } else if (errorData.error.message) {
          errorMessage = errorData.error.message;
          errorCode = errorData.error.code;
          errorDetails = errorData.error.details;
        }
      } else if (errorData.message) {
        errorMessage = errorData.message;
      }

      // Detect MFA challenge responses
      if (errorData.mfaRequired) {
        errorDetails = { ...errorDetails, mfaRequired: true };
      }
      if (errorData.mfaStale) {
        errorDetails = {
          ...errorDetails,
          mfaStale: true,
          mfaAgeMinutes: errorData.mfaAgeMinutes,
          requiredFreshnessMinutes: errorData.requiredFreshnessMinutes,
        };
      }
    } catch {
      // Failed to parse error response, use default message
    }

    // Auto-refresh CSRF token and retry once on CSRF validation failure
    if (response.status === 403 && errorCode === 'csrf_error' && !options._csrfRetried) {
      try {
        await fetchCsrfToken();
        return apiFetch<T>(path, { ...options, _csrfRetried: true });
      } catch {
        // CSRF refresh failed — fall through to normal error handling
      }
    }

    // Emit global error event and report to Sentry for permission failures (403)
    if (response.status === 403) {
      emitApiError({
        status: response.status,
        message: errorMessage,
        code: errorCode,
      });
      logger.warn(`Permission denied: ${method} ${routeTemplate(path)}`, {
        status: 403,
        path,
        route: routeTemplate(path),
        method,
        code: errorCode,
        message: errorMessage,
        roleOverride: roleOverride || undefined,
      });
    }

    throw new ApiError(errorMessage, response.status, errorCode, errorDetails);
  }

  // Parse successful response
  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    const data = await response.json();

    // Safety net: check that expected top-level keys exist in the response
    if (options.expectKeys && data && typeof data === 'object' && !Array.isArray(data)) {
      const missing = options.expectKeys.filter(key => !(key in data));
      if (missing.length > 0) {
        logger.warn(
          `[API] Response shape mismatch on ${method} ${path}: ` +
          `missing keys [${missing.join(', ')}], ` +
          `received keys [${Object.keys(data).join(', ')}]`
        );
      }
    }

    return data;
  }

  // Return empty object for no-content responses
  if (response.status === 204) {
    return {} as T;
  }

  // Binary responses (PDFs, images, CSVs, etc.)
  if (contentType && (
    contentType.includes('application/pdf') ||
    contentType.includes('application/octet-stream') ||
    contentType.includes('text/csv') ||
    contentType.includes('image/') ||
    contentType.includes('application/zip')
  )) {
    return response.blob() as unknown as T;
  }

  // For other non-JSON responses, return text
  const text = await response.text();
  return text as unknown as T;
}

/**
 * Helper to get user-friendly error message
 */
export function getFriendlyErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    // Validation errors (from Zod or backend) always carry a useful message
    if (error.code === 'validation_error') {
      return error.message || 'Invalid data. Please check your input.';
    }
    switch (error.status) {
      case 400:
        return error.message || 'Invalid request. Please check your input.';
      case 401:
        return 'Please log in to continue.';
      case 403:
        return 'You do not have permission to perform this action.';
      case 404:
        return 'Resource not found.';
      case 409:
        return error.message || 'This action conflicts with existing data.';
      case 422:
        return error.message || 'The server returned unexpected data.';
      case 429:
        return 'Too many requests. Please wait a moment and try again.';
      case 500:
      case 502:
      case 503:
        return 'Server error. Please try again later.';
      default:
        return error.message || 'An unexpected error occurred.';
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'An unexpected error occurred.';
}
