/**
 * Authority-Aware Autocomplete
 *
 * A smart autocomplete component for CDWA reference fields that integrates
 * external reference sources while keeping the experience simple for catalogers.
 *
 * @example
 * ```tsx
 * import { AuthorityAutocomplete } from '@/components/collections/AuthorityAutocomplete';
 *
 * function CreatorField() {
 *   const [creator, setCreator] = useState<AuthorityBackedValue | null>(null);
 *
 *   return (
 *     <AuthorityAutocomplete
 *       fieldType="creator"
 *       value={creator}
 *       onChange={setCreator}
 *       placeholder="Search for artist..."
 *     />
 *   );
 * }
 * ```
 */

// Main component
export { AuthorityAutocomplete, default } from './AuthorityAutocomplete';

// Hook for custom implementations
export { useAutocomplete, FALLBACK_STRATEGIES } from './useAutocomplete';

// Types
export type {
  // Props
  AuthorityAutocompleteProps,
  FieldType,

  // Value types
  AuthorityBackedValue,
  ReferenceLink,
  ReferenceSource,

  // API types
  AutocompleteSearchRequest,
  AutocompleteSearchResponse,
  AutocompleteSuggestion,
  SuggestionSource,

  // State
  AutocompleteState,
  AutocompleteEvents,
} from './types';

// Constants
export { REFERENCE_SOURCE_LABELS } from './types';

// API utilities
export {
  AutocompleteApiClient,
  AUTOCOMPLETE_ENDPOINTS,
  FIELD_TYPE_CONFIG,
  getMockSuggestions,
} from './api';
