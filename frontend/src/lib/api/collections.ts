// =============================================================================
// Collections API
// =============================================================================

import { apiFetch, validate, buildQueryString, ApiError } from './_utils';

import {
  CollectionObjectSchema,
  PaginatedCollectionObjectsSchema,
  LocationSchema,
  MovementSchema,
  CollectionsSearchResponseSchema,
  VocabularyTermSchema,
  VocabularyTermHierarchySchema,
  OtherNumberTypeSchema,
  OtherNumberTypesResponseSchema,
  ObjectProceduresSchema,
  ObjectPartSchema,
  NagpraActionSchema,
  NagpraConsultationEventSchema,
  type CollectionObject,
  type PaginatedCollectionObjects,
  type Location,
  type Movement,
  type CollectionsSearchRequest,
  type CollectionsSearchResponse,
  type VocabularyTerm,
  type VocabularyTermHierarchy,
  type OtherNumberType,
  type OtherNumberTypesResponse,
  type ObjectProcedures,
  type ObjectPart,
  type NagpraAction,
  type NagpraConsultationEvent,
} from '../schemas';
import { CrateOutSchema, type CrateOut } from '../schemas/generated';

// --- Collection Objects ---

export async function getCollectionObjects(
  organizationId: string,
  params?: {
    limit?: number;
    offset?: number;
    search?: string;
    object_type?: string;
    classification?: string;
    object_status?: string;
    location_id?: string;
    on_display?: boolean;
    sort_by?: string;
    sort_order?: 'asc' | 'desc';
    include_location?: boolean;
  }
): Promise<PaginatedCollectionObjects> {
  // Always include location data for list view (needed for completeness indicators)
  const query = buildQueryString({ include_location: true, ...params });
  const data = await apiFetch(`/organizations/${organizationId}/collections/objects${query}`);
  return validate(PaginatedCollectionObjectsSchema, data);
}

export async function getCollectionObject(
  organizationId: string,
  objectId: string
): Promise<CollectionObject> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}`);
  return validate(CollectionObjectSchema, data);
}

export async function createCollectionObject(
  organizationId: string,
  object: Partial<CollectionObject>
): Promise<CollectionObject> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/objects`, {
    method: 'POST',
    body: JSON.stringify(object),
  });
  return validate(CollectionObjectSchema, data);
}

export async function updateCollectionObject(
  organizationId: string,
  objectId: string,
  updates: Partial<CollectionObject>
): Promise<CollectionObject> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return validate(CollectionObjectSchema, data);
}

export async function deleteCollectionObject(
  organizationId: string,
  objectId: string
): Promise<void> {
  await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}`, {
    method: 'DELETE',
  });
}

// --- Other Number Types (Controlled Vocabulary) ---

export async function getOtherNumberTypes(
  organizationId: string,
  params?: { include_inactive?: boolean }
): Promise<OtherNumberTypesResponse> {
  const query = buildQueryString(params || {});
  const data = await apiFetch(`/organizations/${organizationId}/collections/settings/other-number-types${query}`);
  return validate(OtherNumberTypesResponseSchema, data);
}

export async function createOtherNumberType(
  organizationId: string,
  type: { name: string; code: string; description?: string; sort_order?: number }
): Promise<OtherNumberType> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/settings/other-number-types`, {
    method: 'POST',
    body: JSON.stringify(type),
  });
  return validate(OtherNumberTypeSchema, data);
}

export async function updateOtherNumberType(
  organizationId: string,
  typeId: string,
  updates: { name?: string; code?: string; description?: string; sort_order?: number; is_active?: boolean }
): Promise<OtherNumberType> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/settings/other-number-types/${typeId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return validate(OtherNumberTypeSchema, data);
}

export async function deleteOtherNumberType(
  organizationId: string,
  typeId: string
): Promise<void> {
  await apiFetch(`/organizations/${organizationId}/collections/settings/other-number-types/${typeId}`, {
    method: 'DELETE',
  });
}

// --- Object Procedures ---

export async function getObjectProcedures(
  organizationId: string,
  objectId: string
): Promise<ObjectProcedures> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/procedures`);
  return validate(ObjectProceduresSchema, data);
}

// --- Collections Search (OpenSearch) ---

export async function searchCollections(
  organizationId: string,
  request: CollectionsSearchRequest
): Promise<CollectionsSearchResponse> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/search`, {
    method: 'POST',
    body: JSON.stringify(request),
  });
  return validate(CollectionsSearchResponseSchema, data);
}

export async function autocompleteCollections(
  organizationId: string,
  query: string,
  field: string = 'title',
  limit: number = 10
): Promise<{ suggestions: Array<{ value: string; object_id: string; object_number?: string; highlight?: string }> }> {
  const params = buildQueryString({ q: query, field, limit });
  return await apiFetch(`/organizations/${organizationId}/collections/search/autocomplete${params}`);
}

export interface ReindexResult {
  success: boolean;
  total: number;
  indexed: number;
  errors: number;
}

export async function reindexCollections(
  organizationId: string
): Promise<ReindexResult> {
  return await apiFetch(`/organizations/${organizationId}/collections/search/reindex`, {
    method: 'POST',
  });
}

// --- Locations ---

export async function getLocations(
  organizationId: string,
  params?: {
    q?: string;
    parent_location_id?: string;
    location_type?: string;
    include_tree?: boolean;
    is_active?: boolean;
  }
): Promise<{ items: Location[] }> {
  const query = buildQueryString(params || {});
  return await apiFetch(`/organizations/${organizationId}/collections/locations${query}`);
}

export async function getLocation(
  organizationId: string,
  locationId: string
): Promise<Location> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/locations/${locationId}`);
  return validate(LocationSchema, data);
}

export async function createLocation(
  organizationId: string,
  location: Partial<Location>
): Promise<Location> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/locations`, {
    method: 'POST',
    body: JSON.stringify(location),
  });
  return validate(LocationSchema, data);
}

export async function updateLocation(
  organizationId: string,
  locationId: string,
  updates: Partial<Location>
): Promise<Location> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/locations/${locationId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return validate(LocationSchema, data);
}

export async function deleteLocation(
  organizationId: string,
  locationId: string
): Promise<void> {
  await apiFetch(`/organizations/${organizationId}/collections/locations/${locationId}`, {
    method: 'DELETE',
  });
}

// --- Movements ---

export async function getMovements(
  organizationId: string,
  params?: {
    q?: string;
    object_id?: string;
    location_id?: string;
    movement_type?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }
): Promise<{ items: Movement[]; total: number }> {
  const query = buildQueryString(params || {});
  return await apiFetch(`/organizations/${organizationId}/collections/movements${query}`);
}

export async function getMovement(
  organizationId: string,
  movementId: string
): Promise<Movement> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/movements/${movementId}`);
  return validate(MovementSchema, data);
}

export async function createMovement(
  organizationId: string,
  movement: Partial<Movement>
): Promise<Movement> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/movements`, {
    method: 'POST',
    body: JSON.stringify(movement),
  });
  return validate(MovementSchema, data);
}

export async function updateMovement(
  organizationId: string,
  movementId: string,
  updates: Partial<Movement>
): Promise<Movement> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/movements/${movementId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return validate(MovementSchema, data);
}

export async function deleteMovement(
  organizationId: string,
  movementId: string
): Promise<void> {
  await apiFetch(`/organizations/${organizationId}/collections/movements/${movementId}`, {
    method: 'DELETE',
  });
}

// --- Object Parts ---

export async function getObjectParts(
  organizationId: string,
  objectId: string
): Promise<{ parts: ObjectPart[]; total: number }> {
  return await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/parts`);
}

export async function getObjectPart(
  organizationId: string,
  objectId: string,
  partId: string
): Promise<ObjectPart> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/parts/${partId}`);
  return validate(ObjectPartSchema, data);
}

export async function createObjectPart(
  organizationId: string,
  objectId: string,
  part: {
    name?: string;
    description?: string;
    current_location_id?: string;
    current_location_fitness?: string;
    current_location_note?: string;
    home_location_id?: string;
    barcode?: string;
  }
): Promise<ObjectPart> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/parts`, {
    method: 'POST',
    body: JSON.stringify(part),
  });
  return validate(ObjectPartSchema, data);
}

export async function updateObjectPart(
  organizationId: string,
  objectId: string,
  partId: string,
  updates: {
    name?: string;
    description?: string;
    current_location_id?: string | null;
    current_location_fitness?: string | null;
    current_location_note?: string | null;
    home_location_id?: string | null;
    barcode?: string | null;
    display_order?: number;
  }
): Promise<ObjectPart> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/parts/${partId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return validate(ObjectPartSchema, data);
}

export async function deleteObjectPart(
  organizationId: string,
  objectId: string,
  partId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/parts/${partId}`, {
    method: 'DELETE',
  });
}

// --- Vocabulary ---

export async function searchVocabulary(
  organizationId: string,
  params: {
    vocabulary_type: 'aat' | 'ulan' | 'tgn' | 'custom';
    query: string;
    limit?: number;
    facet?: 'materials' | 'techniques' | 'styles_periods' | 'object_types';
  }
): Promise<{ terms: VocabularyTerm[] }> {
  // Map frontend param names to backend expected names
  const backendParams = {
    q: params.query,
    vocabulary: params.vocabulary_type,
    limit: params.limit,
    facet: params.facet,
    include_remote: true,
  };
  const queryString = buildQueryString(backendParams);
  return await apiFetch(`/organizations/${organizationId}/collections/vocabulary/search${queryString}`);
}

export async function getVocabularyTerm(
  organizationId: string,
  termId: string
): Promise<VocabularyTerm> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/vocabulary/${termId}`);
  return validate(VocabularyTermSchema, data);
}

/**
 * Cache a Getty vocabulary term locally.
 * Used when selecting a remote term from search results.
 * Returns the cached term with a local term_id.
 */
export async function cacheVocabularyTerm(
  organizationId: string,
  term: {
    vocabulary: string;
    external_id: string;
    external_uri?: string;
    preferred_term: string;
    scope_note?: string;
    broader_term?: string;
    hierarchy_path?: string;
    applicable_fields?: string[];
  }
): Promise<{ term_id: string }> {
  return await apiFetch(`/organizations/${organizationId}/collections/vocabulary/cache`, {
    method: 'POST',
    body: JSON.stringify(term),
  });
}

export async function createCustomVocabularyTerm(
  organizationId: string,
  term: {
    vocabulary_type: 'custom';
    preferred_label: string;
    alternate_labels?: string[];
    scope_note?: string;
    broader_term_id?: string;
  }
): Promise<VocabularyTerm> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/vocabulary`, {
    method: 'POST',
    body: JSON.stringify(term),
  });
  return validate(VocabularyTermSchema, data);
}

/**
 * Fetch a vocabulary term's full hierarchy (broader, narrower, related).
 * Pass `sync=true` to force a synchronous Getty refresh when stale; the
 * default is to queue a background sync if the cached hierarchy is older
 * than 30 days.
 */
export async function getVocabularyTermHierarchy(
  organizationId: string,
  termId: string,
  opts?: { sync?: boolean }
): Promise<VocabularyTermHierarchy> {
  const query = buildQueryString(opts?.sync ? { sync: 'true' } : {});
  const data = await apiFetch(
    `/organizations/${organizationId}/collections/vocabulary/terms/${termId}/hierarchy${query}`
  );
  return validate(VocabularyTermHierarchySchema, data);
}

/**
 * Import a Getty vocabulary term as a global cached term.
 * Used by Vocabulary Explorer to import terms shared across all orgs.
 * Queues a background task to fetch full hierarchy.
 */
export async function importGettyTerm(
  organizationId: string,
  term: {
    vocabulary: 'aat' | 'ulan' | 'tgn';
    external_id: string;
    preferred_term: string;
    external_uri?: string;
    scope_note?: string;
    broader_term?: string;
    facet?: string;
  }
): Promise<{
  status: 'queued' | 'already_exists';
  term_id?: string;
  task_id?: string;
  vocabulary: string;
  external_id: string;
  preferred_term: string;
}> {
  return await apiFetch(`/organizations/${organizationId}/collections/vocabulary/import`, {
    method: 'POST',
    body: JSON.stringify(term),
  });
}

// ============================================================================
// LOOKUP VALUES - Database-managed dropdowns
// ============================================================================

export interface LookupCategory {
  category_id: string;
  category_key: string;
  display_name: string;
  description: string | null;
  applicable_contexts: string[];
  supports_icons: boolean;
}

export interface LookupValue {
  value_id: string;
  category_id: string;
  organization_id: string | null;
  value_key: string;
  label: string;
  description: string | null;
  icon_name: string | null;
  sort_order: number;
  is_active: boolean;
  is_hidden: boolean;
  is_system: boolean;
}

export interface LookupCategoryWithValues extends LookupCategory {
  values: LookupValue[];
}

export async function getAllLookups(
  organizationId: string,
  params?: { context?: string; include_hidden?: boolean }
): Promise<LookupCategoryWithValues[]> {
  const query = buildQueryString(params || {});
  return await apiFetch(`/organizations/${organizationId}/lookups${query}`);
}

export async function getLookupCategory(
  organizationId: string,
  categoryKey: string,
  params?: { include_hidden?: boolean }
): Promise<{ category: LookupCategory; values: LookupValue[] }> {
  const query = buildQueryString(params || {});
  return await apiFetch(`/organizations/${organizationId}/lookups/${categoryKey}${query}`);
}

export async function createLookupValue(
  organizationId: string,
  categoryKey: string,
  data: {
    value_key: string;
    label: string;
    description?: string;
    icon_name?: string;
    sort_order?: number;
  }
): Promise<LookupValue> {
  return await apiFetch(`/organizations/${organizationId}/lookups/${categoryKey}`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateLookupValue(
  organizationId: string,
  valueId: string,
  data: {
    label?: string;
    description?: string;
    icon_name?: string;
    sort_order?: number;
    is_active?: boolean;
  }
): Promise<LookupValue> {
  return await apiFetch(`/organizations/${organizationId}/lookups/values/${valueId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteLookupValue(
  organizationId: string,
  valueId: string
): Promise<void> {
  await apiFetch(`/organizations/${organizationId}/lookups/values/${valueId}`, {
    method: 'DELETE',
  });
}

export async function toggleHideLookupValue(
  organizationId: string,
  valueId: string,
  hidden: boolean
): Promise<{ message: string; hidden: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/lookups/values/${valueId}/hide`, {
    method: 'PUT',
    body: JSON.stringify({ hidden }),
  });
}

export async function updateLookupSortOrder(
  organizationId: string,
  categoryKey: string,
  valueIds: string[]
): Promise<{ message: string; count: number }> {
  return await apiFetch(`/organizations/${organizationId}/lookups/${categoryKey}/sort`, {
    method: 'PUT',
    body: JSON.stringify({ value_ids: valueIds }),
  });
}

// --- Object Classifications (link table) ---

export async function getObjectClassifications(
  organizationId: string,
  objectId: string
) {
  return await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/classifications`);
}

export async function linkObjectClassification(
  organizationId: string,
  objectId: string,
  data: { value_id: string }
) {
  return await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/classifications`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function unlinkObjectClassification(
  organizationId: string,
  objectId: string,
  linkId: string
) {
  return await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/classifications/${linkId}`, {
    method: 'DELETE',
  });
}

// --- NAGPRA Actions ---

export async function getObjectNagpraAction(
  organizationId: string,
  objectId: string
): Promise<NagpraAction | null> {
  try {
    const data = await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/nagpra`);
    return validate(NagpraActionSchema, data);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function createNagpraAction(
  organizationId: string,
  objectId: string,
  action: Partial<NagpraAction>
): Promise<NagpraAction> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/nagpra`, {
    method: 'POST',
    body: JSON.stringify(action),
  });
  return validate(NagpraActionSchema, data);
}

export async function updateNagpraAction(
  organizationId: string,
  actionId: string,
  updates: Partial<NagpraAction>
): Promise<NagpraAction> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/nagpra-actions/${actionId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return validate(NagpraActionSchema, data);
}

export async function deleteNagpraAction(
  organizationId: string,
  actionId: string
): Promise<void> {
  await apiFetch(`/organizations/${organizationId}/collections/nagpra-actions/${actionId}`, {
    method: 'DELETE',
  });
}

// --- NAGPRA Consultation Events ---

export async function getNagpraConsultationEvents(
  organizationId: string,
  actionId: string
): Promise<{ consultation_events: NagpraConsultationEvent[]; total: number }> {
  return await apiFetch(`/organizations/${organizationId}/collections/nagpra-actions/${actionId}/consultation-events`);
}

export async function createNagpraConsultationEvent(
  organizationId: string,
  actionId: string,
  event: Partial<NagpraConsultationEvent>
): Promise<NagpraConsultationEvent> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/nagpra-actions/${actionId}/consultation-events`, {
    method: 'POST',
    body: JSON.stringify(event),
  });
  return validate(NagpraConsultationEventSchema, data);
}

export async function updateNagpraConsultationEvent(
  organizationId: string,
  actionId: string,
  eventId: string,
  updates: Partial<NagpraConsultationEvent>
): Promise<NagpraConsultationEvent> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/nagpra-actions/${actionId}/consultation-events/${eventId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return validate(NagpraConsultationEventSchema, data);
}

export async function deleteNagpraConsultationEvent(
  organizationId: string,
  actionId: string,
  eventId: string
): Promise<void> {
  await apiFetch(`/organizations/${organizationId}/collections/nagpra-actions/${actionId}/consultation-events/${eventId}`, {
    method: 'DELETE',
  });
}

// =============================================================================
// Crates
// =============================================================================

export async function getCrate(
  organizationId: string,
  crateId: string
): Promise<CrateOut> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/crates/${crateId}`);
  return validate(CrateOutSchema, data);
}

export async function createCrate(
  organizationId: string,
  data: Record<string, unknown>
): Promise<Record<string, unknown>> {
  return apiFetch(`/organizations/${organizationId}/collections/crates`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateCrate(
  organizationId: string,
  crateId: string,
  data: Record<string, unknown>
): Promise<Record<string, unknown>> {
  return apiFetch(`/organizations/${organizationId}/collections/crates/${crateId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteCrate(
  organizationId: string,
  crateId: string
): Promise<void> {
  await apiFetch(`/organizations/${organizationId}/collections/crates/${crateId}`, {
    method: 'DELETE',
  });
}
