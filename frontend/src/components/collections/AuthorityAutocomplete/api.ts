/**
 * Authority Autocomplete API
 *
 * Data contract and API client for the autocomplete backend.
 */

import type {
  AutocompleteSearchRequest,
  AutocompleteSearchResponse,
  AutocompleteSuggestion,
  FieldType,
  ReferenceSource,
} from './types';
import { logger } from '../../../lib/logger';
import { getCsrfToken } from '../../../lib/apiClient';

// ============================================================================
// API ENDPOINTS
// ============================================================================

/**
 * Backend API endpoints for autocomplete.
 *
 * Base URL: /api/v1/organizations/{orgId}/autocomplete
 */
export const AUTOCOMPLETE_ENDPOINTS = {
  /**
   * POST /search
   *
   * Search for suggestions across local and external sources.
   * Organization ID is passed in request body, not URL.
   *
   * Request: AutocompleteSearchRequest
   * Response: AutocompleteSearchResponse
   */
  search: (_orgId: string) => `/autocomplete/search`,

  /**
   * GET /recent?fieldType={type}&limit={n}
   *
   * Get user's recent entries for a field type (no external search).
   * Fast, local-only endpoint for initial suggestions.
   */
  recent: (_orgId: string) => `/autocomplete/recent`,

  /**
   * GET /popular?fieldType={type}&limit={n}
   *
   * Get most-used values in the organization for a field type.
   */
  popular: (_orgId: string) => `/autocomplete/popular`,

  /**
   * POST /resolve
   *
   * Resolve a reference URI to get full details.
   * Used when user selects a suggestion to get complete metadata.
   */
  resolve: (_orgId: string) => `/autocomplete/resolve`,

  /**
   * POST /link
   *
   * Add a reference link to an existing value.
   * Used by the "link later" feature.
   */
  link: (_orgId: string) => `/autocomplete/link`,

  /**
   * POST /select
   *
   * Record that a user selected a suggestion.
   * Caches the term and triggers hierarchy sync for Getty terms.
   */
  select: (_orgId: string) => `/autocomplete/select`,
};

// ============================================================================
// FIELD TYPE CONFIGURATION
// ============================================================================

/**
 * Configuration for each field type.
 * Determines which reference sources are relevant.
 */
/**
 * Museum-focused vocabulary configuration by field type.
 * Prioritizes Getty vocabularies (AAT, ULAN, TGN) which are the industry standard.
 */
export const FIELD_TYPE_CONFIG: Record<FieldType, {
  /** Which reference sources to search */
  sources: ReferenceSource[];

  /** Placeholder text */
  placeholder: string;

  /** Example value for empty state */
  example: string;

  /** Description for help text */
  description: string;
}> = {
  creator: {
    sources: ['ULAN', 'Wikidata', 'Local'],
    placeholder: 'Search for artist or maker...',
    example: 'e.g., Claude Monet',
    description: 'Artists, makers, designers, and other creators (Getty ULAN)',
  },
  material: {
    sources: ['AAT', 'Wikidata', 'Local'],
    placeholder: 'Search for material...',
    example: 'e.g., oil paint, bronze, canvas',
    description: 'Physical materials and substances (Getty AAT)',
  },
  technique: {
    sources: ['AAT', 'Wikidata', 'Local'],
    placeholder: 'Search for technique...',
    example: 'e.g., impasto, etching, casting',
    description: 'Processes and techniques (Getty AAT)',
  },
  place: {
    sources: ['TGN', 'Wikidata', 'Local'],
    placeholder: 'Search for place...',
    example: 'e.g., Florence, Italy',
    description: 'Geographic and historical locations (Getty TGN)',
  },
  subject: {
    sources: ['AAT', 'Iconclass', 'Wikidata', 'Local'],
    placeholder: 'Search for subject...',
    example: 'e.g., landscapes, Madonna and Child',
    description: 'Subject matter and iconography (Getty AAT, Iconclass)',
  },
  classification: {
    sources: ['AAT', 'Local'],
    placeholder: 'Search for object type...',
    example: 'e.g., painting, sculpture, print',
    description: 'Object classification and type (Getty AAT)',
  },
  organization: {
    sources: ['VIAF', 'Wikidata', 'Local'],
    placeholder: 'Search for organization...',
    example: 'e.g., Louvre, Metropolitan Museum',
    description: 'Museums, galleries, and institutions (VIAF)',
  },
};

// ============================================================================
// API CLIENT
// ============================================================================

/**
 * API client for autocomplete operations.
 */
export class AutocompleteApiClient {
  private baseUrl: string;
  private organizationId: string;
  private abortController: AbortController | null = null;

  constructor(baseUrl: string, organizationId: string) {
    this.baseUrl = baseUrl;
    this.organizationId = organizationId;
  }

  /**
   * Search for suggestions.
   * Cancels any pending search when called.
   */
  async search(request: AutocompleteSearchRequest): Promise<AutocompleteSearchResponse> {
    // Cancel any pending request
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();

    const url = AUTOCOMPLETE_ENDPOINTS.search(this.organizationId);

    // Convert to snake_case for backend
    const backendRequest = {
      query: request.query,
      field_type: request.fieldType,
      organization_id: request.organizationId,
      limit: request.limit,
      sources: request.sources,
      context: request.context,
    };

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      const csrfToken = getCsrfToken();
      if (csrfToken) {
        headers['X-CSRF-Token'] = csrfToken;
      }

      const response = await fetch(`${this.baseUrl}${url}`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify(backendRequest),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`Search failed: ${response.statusText}`);
      }

      const data = await response.json();

      // Convert suggestions from snake_case to camelCase
      const suggestions = (data.suggestions || []).map((s: Record<string, unknown>) => ({
        id: s.id,
        label: s.label,
        description: s.description,
        source: s.source,
        score: s.score,
        reference: s.reference ? {
          uri: (s.reference as Record<string, unknown>).uri,
          source: (s.reference as Record<string, unknown>).source,
          label: (s.reference as Record<string, unknown>).label,
          matchConfidence: (s.reference as Record<string, unknown>).match_confidence,
        } : undefined,
        metadata: s.metadata,
      }));

      // Convert from snake_case backend response to camelCase frontend
      return {
        query: data.query,
        suggestions,
        externalSearched: data.external_searched ?? false,
        warnings: data.warnings,
        searchTimeMs: data.search_time_ms ?? 0,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // Request was cancelled - return empty results
        return {
          query: request.query,
          suggestions: [],
          externalSearched: false,
          searchTimeMs: 0,
        };
      }
      throw error;
    }
  }

  /**
   * Get recent entries for a field type.
   * Fast, local-only query.
   */
  async getRecent(fieldType: FieldType, limit = 5): Promise<AutocompleteSuggestion[]> {
    const url = AUTOCOMPLETE_ENDPOINTS.recent(this.organizationId);
    const params = new URLSearchParams({ field_type: fieldType, limit: String(limit) });

    const response = await fetch(`${this.baseUrl}${url}?${params}`, {
      credentials: 'include',
    });

    if (!response.ok) {
      logger.warn('Failed to fetch recent entries');
      return [];
    }

    const data = await response.json();
    return data.suggestions || [];
  }

  /**
   * Get popular values in the organization.
   */
  async getPopular(fieldType: FieldType, limit = 10): Promise<AutocompleteSuggestion[]> {
    const url = AUTOCOMPLETE_ENDPOINTS.popular(this.organizationId);
    const params = new URLSearchParams({ field_type: fieldType, limit: String(limit) });

    const response = await fetch(`${this.baseUrl}${url}?${params}`, {
      credentials: 'include',
    });

    if (!response.ok) {
      logger.warn('Failed to fetch popular values');
      return [];
    }

    const data = await response.json();
    return data.suggestions || [];
  }

  /**
   * Resolve a reference URI to get full details.
   */
  async resolve(uri: string, source: ReferenceSource): Promise<AutocompleteSuggestion | null> {
    const url = AUTOCOMPLETE_ENDPOINTS.resolve(this.organizationId);

    try {
      const response = await fetch(`${this.baseUrl}${url}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ uri, source }),
      });

      if (!response.ok) {
        return null;
      }

      return await response.json();
    } catch {
      return null;
    }
  }

  /**
   * Cancel any pending search.
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
}

// ============================================================================
// MOCK DATA FOR DEVELOPMENT
// ============================================================================

/**
 * Mock suggestions for development/testing.
 */
export function getMockSuggestions(
  query: string,
  fieldType: FieldType
): AutocompleteSuggestion[] {
  const mockData: Record<FieldType, AutocompleteSuggestion[]> = {
    creator: [
      {
        id: 'recent-1',
        label: 'Claude Monet',
        description: 'French painter, 1840-1926',
        source: 'recent',
        score: 1.0,
        metadata: { dates: '1840-1926', nationality: 'French', type: 'painter' },
      },
      {
        id: 'ulan-500019484',
        label: 'Monet, Claude',
        description: 'French Impressionist painter',
        source: 'getty',
        score: 0.95,
        reference: {
          uri: 'http://vocab.getty.edu/ulan/500019484',
          source: 'ULAN',
          label: 'Monet, Claude',
          matchConfidence: 'exact',
        },
        metadata: { dates: '1840-1926', nationality: 'French', type: 'painter' },
      },
      {
        id: 'wd-Q296',
        label: 'Claude Monet',
        description: 'painter (1840-1926)',
        source: 'wikidata',
        score: 0.9,
        reference: {
          uri: 'https://www.wikidata.org/entity/Q296',
          source: 'Wikidata',
          matchConfidence: 'exact',
        },
      },
    ],
    material: [
      {
        id: 'recent-oil',
        label: 'oil paint',
        source: 'recent',
        score: 1.0,
      },
      {
        id: 'aat-300015050',
        label: 'oil paint',
        description: 'paint made with drying oil as binder',
        source: 'getty',
        score: 0.95,
        reference: {
          uri: 'http://vocab.getty.edu/aat/300015050',
          source: 'AAT',
          matchConfidence: 'exact',
        },
      },
    ],
    technique: [],
    place: [],
    subject: [],
    classification: [],
    organization: [],
  };

  const suggestions = mockData[fieldType] || [];

  // Filter by query
  if (query) {
    const lowerQuery = query.toLowerCase();
    return suggestions.filter(
      (s) =>
        s.label.toLowerCase().includes(lowerQuery) ||
        s.description?.toLowerCase().includes(lowerQuery)
    );
  }

  return suggestions;
}
