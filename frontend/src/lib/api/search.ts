/**
 * OpenSearch-Powered Entity Search
 */
import { apiFetch } from './_utils';

// Search request types
export interface SearchQuery {
  q?: string;
  fields?: string[];
  fuzziness?: string;
}

export interface SearchFilters {
  dataset_id?: string[];
  entity_type?: string[];
  creator_name?: string;
  date_from?: string;
  date_to?: string;
  on_display?: boolean;
  classification_scheme?: string;
  classification_term?: string;
}

export interface SearchSort {
  field: string;
  order: 'asc' | 'desc';
}

export type AdvancedSearchField =
  | 'any'
  | 'title'
  | 'object_number'
  | 'object_name'
  | 'description'
  | 'creator'
  | 'classification'
  | 'material'
  | 'technique'
  | 'subject'
  | 'place'
  | 'inscription'
  | 'provenance'
  | 'credit_line';
export type AdvancedSearchOperator = 'contains' | 'equals' | 'starts_with' | 'not_contains';

export interface AdvancedCriterion {
  field: AdvancedSearchField;
  operator: AdvancedSearchOperator;
  value: string;
}

export interface SearchRequest {
  query?: SearchQuery;
  filters?: SearchFilters;
  sort?: SearchSort;
  advanced_criteria?: AdvancedCriterion[];
  advanced_operator?: 'and' | 'or';
  limit?: number;
  offset?: number;
  include_facets?: boolean;
  facet_size?: number;
  highlight?: boolean;
}

// Search response types
export interface SearchHit {
  entity_key: string;
  entity_type?: string;
  dataset_id?: string;
  title?: string;
  object_number?: string;
  description?: string;
  thumbnail_url?: string;
  creators?: Array<{ name: string; role: string; id?: string }>;
  dates?: {
    created_display?: string;
    created_earliest?: string;
    created_latest?: string;
    acquired?: string;
  };
  score: number;
  highlights?: Record<string, string[]>;
}

export interface FacetBucket {
  key: string;
  doc_count: number;
  label?: string;
}

export interface Facet {
  field: string;
  buckets: FacetBucket[];
}

export interface SearchResponse {
  hits: SearchHit[];
  total: number;
  facets?: Facet[];
  took_ms: number;
  next_offset?: number;
}

export interface AutocompleteSuggestion {
  value: string;
  entity_key: string;
  highlight?: string;
}

export interface AutocompleteResponse {
  suggestions: AutocompleteSuggestion[];
}

export interface SimilarEntity {
  entity_key: string;
  title?: string;
  thumbnail_url?: string;
  score: number;
}

export interface SimilarResponse {
  similar: SimilarEntity[];
}

// Search API functions
export async function searchEntities(
  organizationId: string,
  request: SearchRequest
): Promise<SearchResponse> {
  return apiFetch(`/search?organization_id=${organizationId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
}

export async function getAutocomplete(
  organizationId: string,
  query: string,
  field: string = 'title',
  limit: number = 10
): Promise<AutocompleteResponse> {
  const params = new URLSearchParams({
    organization_id: organizationId,
    q: query,
    field,
    limit: limit.toString(),
  });
  return await apiFetch(`/search/autocomplete?${params}`);
}

export async function findSimilarEntities(
  organizationId: string,
  entityKey: string,
  limit: number = 10
): Promise<SimilarResponse> {
  const params = new URLSearchParams({
    organization_id: organizationId,
    limit: limit.toString(),
  });
  return await apiFetch(`/search/similar/${encodeURIComponent(entityKey)}?${params}`);
}

// Search health check
export async function getSearchHealth(): Promise<{
  status: string;
  cluster_name?: string;
  number_of_nodes?: number;
  message?: string;
}> {
  return apiFetch<{
    status: string;
    cluster_name?: string;
    number_of_nodes?: number;
    message?: string;
  }>('/health/search');
}
