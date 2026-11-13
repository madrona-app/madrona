/**
 * useAutocomplete Hook
 *
 * Manages autocomplete state with fallback logic for offline/error scenarios.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useDebounce } from '../../../hooks/useDebounce';
import type {
  AutocompleteSuggestion,
  AuthorityBackedValue,
  FieldType,
} from './types';
import { AutocompleteApiClient, getMockSuggestions, FIELD_TYPE_CONFIG } from './api';
import { API_BASE_URL } from '../../../lib/apiClient';
import { logger } from '../../../lib/logger';

// ============================================================================
// CONFIGURATION
// ============================================================================

const DEFAULT_DEBOUNCE_MS = 300;
const DEFAULT_MAX_SUGGESTIONS = 8;
const LOCAL_STORAGE_KEY_PREFIX = 'madrona_autocomplete_recent_';
const MAX_RECENT_ITEMS = 20;

// ============================================================================
// FALLBACK LOGIC
// ============================================================================

/**
 * Fallback behaviors when things go wrong.
 *
 * Philosophy: The component should ALWAYS work, even if degraded.
 * Users should never be blocked from entering data.
 */
export const FALLBACK_STRATEGIES = {
  /**
   * Network unavailable or API error:
   * - Show local suggestions only (recent + cached)
   * - Allow manual entry
   * - No error shown to user (silent degradation)
   */
  NETWORK_ERROR: 'network_error',

  /**
   * External service timeout:
   * - Show local suggestions immediately
   * - Continue waiting for external (up to 5s)
   * - Show external when they arrive (if dropdown still open)
   */
  EXTERNAL_TIMEOUT: 'external_timeout',

  /**
   * No suggestions found:
   * - Show "Use as entered" option
   * - No error or warning
   */
  NO_RESULTS: 'no_results',

  /**
   * Rate limited:
   * - Use cached results
   * - Reduce search frequency
   */
  RATE_LIMITED: 'rate_limited',
} as const;

// ============================================================================
// LOCAL STORAGE HELPERS
// ============================================================================

/**
 * Get recent entries from local storage.
 * Used for instant suggestions before any API call.
 */
function getLocalRecent(fieldType: FieldType, orgId: string): AutocompleteSuggestion[] {
  try {
    const key = `${LOCAL_STORAGE_KEY_PREFIX}${orgId}_${fieldType}`;
    const stored = localStorage.getItem(key);
    if (!stored) return [];

    const items = JSON.parse(stored) as AuthorityBackedValue[];
    return items.map((item, index) => ({
      id: `local-${index}`,
      label: item.value,
      source: 'recent' as const,
      score: 1.0 - index * 0.01, // Slight score decrease for older items
      reference: item.authorities?.[0],
    }));
  } catch {
    return [];
  }
}

/**
 * Save a value to recent entries.
 */
function saveToRecent(
  fieldType: FieldType,
  orgId: string,
  value: AuthorityBackedValue
): void {
  try {
    const key = `${LOCAL_STORAGE_KEY_PREFIX}${orgId}_${fieldType}`;
    const stored = localStorage.getItem(key);
    let items: AuthorityBackedValue[] = stored ? JSON.parse(stored) : [];

    // Remove if already exists (to move to top)
    items = items.filter((item) => item.value !== value.value);

    // Add to top
    items.unshift(value);

    // Trim to max
    items = items.slice(0, MAX_RECENT_ITEMS);

    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    // Ignore storage errors
  }
}

// ============================================================================
// SUGGESTION MERGING
// ============================================================================

/**
 * Merge and deduplicate suggestions from multiple sources.
 * Prioritizes: recent > organization > external
 */
function mergeSuggestions(
  local: AutocompleteSuggestion[],
  external: AutocompleteSuggestion[],
  maxTotal: number
): AutocompleteSuggestion[] {
  const seen = new Set<string>();
  const result: AutocompleteSuggestion[] = [];

  // Helper to add unique suggestions
  const addUnique = (suggestions: AutocompleteSuggestion[]) => {
    for (const suggestion of suggestions) {
      // Same label from different reference sources (e.g. a local term and
      // its LCSH heading) are distinct choices; repeats from one source are not.
      const key = `${suggestion.label.toLowerCase()}|${suggestion.reference?.source ?? ''}`;
      if (!seen.has(key) && result.length < maxTotal) {
        seen.add(key);
        result.push(suggestion);
      }
    }
  };

  // Add in priority order
  addUnique(local.filter((s) => s.source === 'recent'));
  addUnique(local.filter((s) => s.source === 'organization'));
  addUnique(local.filter((s) => s.source === 'vocabulary'));
  addUnique(external);

  return result;
}

// ============================================================================
// MAIN HOOK
// ============================================================================

interface UseAutocompleteOptions {
  fieldType: FieldType;
  organizationId: string;
  initialValue?: string;
  maxSuggestions?: number;
  debounceMs?: number;
  onSelect?: (value: AuthorityBackedValue) => void;
  /** Offer "use as entered" for text that matches no suggestion */
  allowCreate?: boolean;
  /**
   * Strict vocabulary mode: only suggestions backed by the vocabulary or a
   * reference source are offered, and a chosen reference-source term is saved
   * to the organization's vocabulary before onSelect fires.
   */
  strict?: boolean;
  /** Object field key passed to the vocabulary cache as applicable_fields */
  strictField?: string;
}

/**
 * Whether a suggestion is acceptable for a strict field: a local vocabulary
 * term, anything carrying a reference-source link, or a local authority record.
 */
export function isVocabularyBacked(s: AutocompleteSuggestion): boolean {
  if (s.source === 'vocabulary') return true;
  if (s.reference?.uri) return true;
  const meta = s.metadata as { authority_id?: string | null } | undefined;
  return !!meta?.authority_id;
}

interface UseAutocompleteReturn {
  // State
  inputValue: string;
  setInputValue: (value: string) => void;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  suggestions: AutocompleteSuggestion[];
  highlightedIndex: number;
  setHighlightedIndex: (index: number) => void;
  isLoading: boolean;
  isOffline: boolean;

  /** One-off message for screen readers (e.g. why Enter did nothing) */
  notice: string;
  /** Number of options in the listbox, including "use as entered" */
  optionCount: number;
  /** Whether the "use as entered" option is shown */
  showCreateOption: boolean;

  // Actions
  handleSelect: (suggestion: AutocompleteSuggestion) => void;
  handleCreateNew: () => void;
  handleKeyDown: (event: React.KeyboardEvent) => void;
  handleFocus: () => void;
  handleBlur: () => void;
  clear: () => void;

  // Helpers
  getInputProps: () => React.InputHTMLAttributes<HTMLInputElement>;
  getMenuProps: () => React.HTMLAttributes<HTMLUListElement>;
  getItemProps: (index: number) => React.HTMLAttributes<HTMLLIElement>;
}

export function useAutocomplete({
  fieldType,
  organizationId,
  initialValue = '',
  maxSuggestions = DEFAULT_MAX_SUGGESTIONS,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  onSelect,
  allowCreate = true,
  strict = false,
  strictField,
}: UseAutocompleteOptions): UseAutocompleteReturn {
  // State
  const [inputValue, setInputValue] = useState(initialValue);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [localSuggestions, setLocalSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [externalSuggestions, setExternalSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [notice, setNotice] = useState('');

  // Refs
  const apiClientRef = useRef<AutocompleteApiClient | null>(null);

  // Sync inputValue when external value changes (e.g., loading existing record)
  useEffect(() => {
    setInputValue(initialValue);
  }, [initialValue]);

  // Initialize API client
  useEffect(() => {
    apiClientRef.current = new AutocompleteApiClient(API_BASE_URL, organizationId);
    return () => {
      apiClientRef.current?.cancel();
    };
  }, [organizationId]);

  // Debounced search query
  const debouncedQuery = useDebounce(inputValue, debounceMs);

  // Combined suggestions (strict fields only offer vocabulary-backed terms)
  const merged = mergeSuggestions(
    localSuggestions,
    externalSuggestions,
    maxSuggestions
  );
  const suggestions = strict ? merged.filter(isVocabularyBacked) : merged;
  const canCreate = allowCreate && !strict;
  const showCreateOption = canCreate && inputValue.trim().length > 0;
  const optionCount = suggestions.length + (showCreateOption ? 1 : 0);

  // ══════════════════════════════════════════════════════════════════════════
  // LOCAL SEARCH (Immediate)
  // ══════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    if (!inputValue.trim()) {
      // Show recent when input is empty
      const recent = getLocalRecent(fieldType, organizationId);
      setLocalSuggestions(recent.slice(0, 5));
      return;
    }

    // Filter local suggestions
    const recent = getLocalRecent(fieldType, organizationId);
    const query = inputValue.toLowerCase();
    const filtered = recent.filter((s) =>
      s.label.toLowerCase().includes(query)
    );
    setLocalSuggestions(filtered);
  }, [inputValue, fieldType, organizationId]);

  // ══════════════════════════════════════════════════════════════════════════
  // EXTERNAL SEARCH (Debounced)
  // ══════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    if (!debouncedQuery.trim() || debouncedQuery.length < 2) {
      setExternalSuggestions([]);
      setIsLoading(false);
      return;
    }

    // Don't search if organizationId is not available yet
    if (!organizationId) {
      return;
    }

    const searchExternal = async () => {
      setIsLoading(true);

      try {
        const client = apiClientRef.current;
        if (!client) return;

        const response = await client.search({
          query: debouncedQuery,
          fieldType,
          organizationId,
          limit: maxSuggestions,
          sources: ['external'],
        });

        setExternalSuggestions(response.suggestions);
        setIsOffline(false);
      } catch (error) {
        // Fallback: Use mock data in development, empty in production
        if (import.meta.env.DEV) {
          const mock = getMockSuggestions(debouncedQuery, fieldType);
          setExternalSuggestions(mock.filter((s) => s.source !== 'recent'));
        } else {
          setExternalSuggestions([]);
        }

        // Check if we're offline
        if (!navigator.onLine) {
          setIsOffline(true);
        }

        logger.warn('External search failed, using fallback', error);
      } finally {
        setIsLoading(false);
      }
    };

    searchExternal();
  }, [debouncedQuery, fieldType, organizationId, maxSuggestions]);

  // ══════════════════════════════════════════════════════════════════════════
  // HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  const handleSelect = useCallback(
    (suggestion: AutocompleteSuggestion) => {
      const value: AuthorityBackedValue = {
        value: suggestion.label,
        authorities: suggestion.reference ? [suggestion.reference] : undefined,
      };

      // Save to recent
      saveToRecent(fieldType, organizationId, value);

      // Update input
      setInputValue(suggestion.label);
      setIsOpen(false);
      setHighlightedIndex(-1);

      const commit = () => onSelect?.(value);

      // Strict fields: make sure a reference-source term is in the org's
      // vocabulary before the value is saved, so the API recognises it even
      // where only the text is stored. A failure still commits — the API then
      // answers with a field-named error instead of silently dropping input.
      if (strict && suggestion.reference?.uri && suggestion.source !== 'vocabulary') {
        const client = apiClientRef.current;
        if (client) {
          client.select(suggestion, strictField).catch((error) => {
            logger.warn('Caching selected term failed', error);
          }).finally(commit);
          return;
        }
      }
      commit();
    },
    [fieldType, organizationId, onSelect, strict, strictField]
  );

  const handleCreateNew = useCallback(() => {
    if (!inputValue.trim()) return;
    if (!canCreate) {
      setNotice('New terms cannot be added to this field. Choose a suggestion from the list.');
      return;
    }

    const value: AuthorityBackedValue = {
      value: inputValue.trim(),
      // No authorities - user entered manually
    };

    // Save to recent
    saveToRecent(fieldType, organizationId, value);

    // Close dropdown
    setIsOpen(false);
    setHighlightedIndex(-1);

    // Notify parent
    onSelect?.(value);
  }, [inputValue, canCreate, fieldType, organizationId, onSelect]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          if (!isOpen) {
            setIsOpen(true);
          } else if (optionCount > 0) {
            setHighlightedIndex((prev) => (prev < optionCount - 1 ? prev + 1 : 0));
          }
          break;

        case 'ArrowUp':
          event.preventDefault();
          if (!isOpen) {
            setIsOpen(true);
          } else if (optionCount > 0) {
            setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : optionCount - 1));
          }
          break;

        case 'Enter':
          event.preventDefault();
          if (isOpen && highlightedIndex >= 0 && highlightedIndex < suggestions.length) {
            handleSelect(suggestions[highlightedIndex]);
          } else {
            // Highlighted "use as entered", or nothing highlighted
            handleCreateNew();
          }
          break;

        case 'Escape':
          if (isOpen) {
            // Close the list without leaving a surrounding dialog
            event.preventDefault();
            event.stopPropagation();
            setIsOpen(false);
            setHighlightedIndex(-1);
          }
          break;

        case 'Tab':
          if (isOpen && highlightedIndex >= 0 && highlightedIndex < suggestions.length) {
            handleSelect(suggestions[highlightedIndex]);
          }
          setIsOpen(false);
          setHighlightedIndex(-1);
          break;
      }
    },
    [isOpen, suggestions, optionCount, highlightedIndex, handleSelect, handleCreateNew]
  );

  const handleFocus = useCallback(() => {
    setIsOpen(true);
  }, []);

  const handleBlur = useCallback(() => {
    // Delay to allow click on suggestion
    setTimeout(() => {
      setIsOpen(false);
    }, 150);
  }, []);

  const clear = useCallback(() => {
    setInputValue('');
    setIsOpen(false);
    setHighlightedIndex(-1);
    setLocalSuggestions([]);
    setExternalSuggestions([]);
  }, []);

  // ══════════════════════════════════════════════════════════════════════════
  // PROP GETTERS
  // ══════════════════════════════════════════════════════════════════════════

  const getInputProps = useCallback(
    (): React.InputHTMLAttributes<HTMLInputElement> => ({
      value: inputValue,
      onChange: (e) => {
        setInputValue(e.target.value);
        setNotice('');
        setIsOpen(true);
        setHighlightedIndex(-1);
      },
      onFocus: handleFocus,
      onBlur: handleBlur,
      onKeyDown: handleKeyDown,
      placeholder: FIELD_TYPE_CONFIG[fieldType]?.placeholder,
      autoComplete: 'off',
      'aria-expanded': isOpen,
      'aria-haspopup': 'listbox',
      'aria-autocomplete': 'list',
      role: 'combobox',
    }),
    [inputValue, isOpen, fieldType, handleFocus, handleBlur, handleKeyDown]
  );

  const getMenuProps = useCallback(
    (): React.HTMLAttributes<HTMLUListElement> => ({
      role: 'listbox',
      'aria-label': 'Suggestions',
    }),
    []
  );

  const getItemProps = useCallback(
    (index: number): React.HTMLAttributes<HTMLLIElement> => ({
      role: 'option',
      'aria-selected': highlightedIndex === index,
      onClick: () => {
        if (index < suggestions.length) {
          handleSelect(suggestions[index]);
        } else {
          handleCreateNew();
        }
      },
      onMouseEnter: () => setHighlightedIndex(index),
    }),
    [highlightedIndex, suggestions, handleSelect, handleCreateNew]
  );

  return {
    inputValue,
    setInputValue,
    isOpen,
    setIsOpen,
    suggestions,
    highlightedIndex,
    setHighlightedIndex,
    isLoading,
    isOffline,
    notice,
    optionCount,
    showCreateOption,
    handleSelect,
    handleCreateNew,
    handleKeyDown,
    handleFocus,
    handleBlur,
    clear,
    getInputProps,
    getMenuProps,
    getItemProps,
  };
}
