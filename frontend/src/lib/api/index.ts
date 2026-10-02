/**
 * API Module Barrel
 *
 * Re-exports all domain modules. Consumer code imports from '../../lib/api'
 * which resolves to the parent api.ts shim (file takes precedence over directory).
 */

// Shared utilities (apiFetch, ApiError, getFriendlyErrorMessage, etc.)
export { apiFetch, ApiError, getFriendlyErrorMessage, getCsrfToken, API_BASE_URL } from './_utils';
export type { ApiFetchOptions } from '../apiClient';

// Domain modules
export * from './flow';
export * from './search';
export * from './admin';
export * from './collections';
export * from './procedure';
export * from './shipments';
export * from './constituent-media';
export * from './media';
export * from './authorities';
export * from './workspaces';
export * from './reports';
export * from './relationships';
export * from './exhibit';
export * from './events';
export * from './discover';
export * from './departments';
export * from './dashboard';
export * from './approvals';
