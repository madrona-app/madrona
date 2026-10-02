/**
 * Shared utilities for API domain modules.
 * All domain modules import from here instead of directly from apiClient.
 */
import {
  apiFetch,
  ApiError,
  getFriendlyErrorMessage,
  getCsrfToken,
  API_BASE_URL,
} from '../apiClient';
import { z } from 'zod';
import { logger } from '../logger';

// Re-export apiClient essentials for domain modules
export { apiFetch, ApiError, getFriendlyErrorMessage, getCsrfToken, API_BASE_URL };
export type { ApiFetchOptions } from '../apiClient';

// Validation helper — uses Zod to verify API responses match expected shape.
// On mismatch, logs details for debugging and throws a user-friendly error.
export function validate<T>(schema: z.ZodSchema<T>, data: unknown): T {
  try {
    // If the response contains _restricted_fields, those fields were stripped
    // by the field access system and should not cause validation errors.
    // Make the schema partial for those fields before parsing.
    let effectiveSchema = schema;
    if (data && typeof data === 'object' && '_restricted_fields' in data) {
      const restricted = (data as Record<string, unknown>)._restricted_fields;
      if (Array.isArray(restricted) && restricted.length > 0 && schema instanceof z.ZodObject) {
        const partialKeys: Record<string, true> = {};
        for (const field of restricted) {
          if (typeof field === 'string') partialKeys[field] = true;
        }
        const shape = schema.shape as Record<string, z.ZodTypeAny>;
        const newShape: Record<string, z.ZodTypeAny> = {};
        for (const [key, val] of Object.entries(shape)) {
          newShape[key] = key in partialKeys ? val.optional() : val;
        }
        effectiveSchema = z.object(newShape).passthrough() as unknown as z.ZodSchema<T>;
      }
    }
    return effectiveSchema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      // Build a concise, user-facing summary of what went wrong
      const fieldSummary = error.issues
        .slice(0, 3)
        .map(i => {
          const path = i.path.join('.');
          return path ? `${path}: ${i.message}` : i.message;
        })
        .join('; ');
      const extra = error.issues.length > 3 ? ` (+${error.issues.length - 3} more)` : '';
      const summary = `${fieldSummary}${extra}`;

      // Send the Zod error to Sentry with the field summary for grouping.
      // Pass the ZodError itself (an Error subclass) so Sentry gets a real
      // stack trace, and include the summary for distinct issue grouping.
      logger.error(`Schema validation failed: ${summary}`, error);

      throw new ApiError(
        `Unexpected data from server (${summary})`,
        422,
        'validation_error',
        { errors: error.issues },
      );
    }
    throw error;
  }
}

// Helper to build query string
export function buildQueryString(
  params: Record<string, any> | null | undefined,
): string {
  if (!params) return '';
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      // Handle arrays (for multi-value params like dataset_id[])
      if (Array.isArray(value)) {
        value.forEach((item) => searchParams.append(key, String(item)));
      } else {
        searchParams.append(key, String(value));
      }
    }
  });
  const query = searchParams.toString();
  return query ? `?${query}` : '';
}
