/**
 * Object Authorities Manager
 *
 * Manages biography/authority links on collection objects.
 * Split into focused components for maintainability.
 *
 * Usage:
 * ```tsx
 * import { ObjectAuthoritiesManager } from './ObjectAuthoritiesManager';
 * ```
 */

export { ObjectAuthoritiesManager } from './ObjectAuthoritiesManager';
export { AddAuthoritySlideOver } from './AddAuthoritySlideOver';
export { EditAuthoritySlideOver } from './EditAuthoritySlideOver';
export { LinkDetailsForm } from './LinkDetailsForm';

// Re-export types
export type {
  ObjectAuthoritiesManagerProps,
  AddAuthoritySlideOverProps,
  EditAuthoritySlideOverProps,
} from './types';
