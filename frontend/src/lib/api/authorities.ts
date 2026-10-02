import { z } from 'zod';
import { apiFetch, validate, buildQueryString } from './_utils';
import {
  PersonAuthoritySchema,
  PaginatedAuthoritiesSchema,
  AuthorityRelationsSchema,
  PersonAuthorityRelationSchema,
  ObjectPersonAuthoritySchema,
  ObjectRelationshipSchema,
  ObjectRelationshipsResponseSchema,
  CitationSchema,
  PaginatedCitationsSchema,
  ObjectCitationLinkSchema,
  // Materials and Techniques - AAT vocabulary links
  ObjectMaterialSchema,
  ObjectTechniqueSchema,
  // CDWA Extended Authorities
  PlaceAuthoritySchema,
  PlaceAuthoritiesListSchema,
  ObjectPlaceAuthoritySchema,
  StylePeriodAuthoritySchema,
  StylePeriodAuthoritiesListSchema,
  ObjectStylePeriodSchema,
  SubjectAuthoritySchema,
  SubjectAuthoritiesListSchema,
  ObjectSubjectSchema,
  CriticalResponseSchema,
  CriticalResponsesListSchema,
  CatalogingHistorySchema,
  CatalogingHistoryListSchema,
  ObjectContextSchema,
  ObjectContextsListSchema,
} from '../schemas';
import type {
  PersonAuthority,
  PaginatedAuthorities,
  AuthorityRelations,
  PersonAuthorityRelation,
  ObjectPersonAuthority,
  ObjectRelationship,
  ObjectRelationshipsResponse,
  Citation,
  PaginatedCitations,
  ObjectCitationLink,
  ObjectMaterial,
  ObjectTechnique,
  PlaceAuthority,
  PlaceAuthoritiesList,
  ObjectPlaceAuthority,
  StylePeriodAuthority,
  StylePeriodAuthoritiesList,
  ObjectStylePeriod,
  SubjectAuthority,
  SubjectAuthoritiesList,
  ObjectSubject,
  CriticalResponse,
  CriticalResponsesList,
  CatalogingHistory,
  CatalogingHistoryList,
  ObjectContext,
  ObjectContextsList,
} from '../schemas';

// ============================================================================
// CDWA PERSON AUTHORITIES API (CDWA Category 28)
// ============================================================================

export async function getAuthorities(
  organizationId: string,
  params?: {
    limit?: number;
    offset?: number;
    search?: string;
    status?: string;
    is_verified?: boolean;
  }
): Promise<PaginatedAuthorities> {
  const query = buildQueryString(params || {});
  const data = await apiFetch(`/organizations/${organizationId}/collections/authorities${query}`);
  return validate(PaginatedAuthoritiesSchema, data);
}

export async function getAuthority(
  organizationId: string,
  authorityId: string
): Promise<PersonAuthority> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/authorities/${authorityId}`);
  return validate(PersonAuthoritySchema, data);
}

export async function createAuthority(
  organizationId: string,
  authority: Partial<PersonAuthority>
): Promise<PersonAuthority> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/authorities`, {
    method: 'POST',
    body: JSON.stringify(authority),
  });
  return validate(PersonAuthoritySchema, data);
}

export async function updateAuthority(
  organizationId: string,
  authorityId: string,
  updates: Partial<PersonAuthority>
): Promise<PersonAuthority> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/authorities/${authorityId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
  return validate(PersonAuthoritySchema, data);
}

export async function deleteAuthority(
  organizationId: string,
  authorityId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/collections/authorities/${authorityId}`, {
    method: 'DELETE',
  });
}

export async function mergeAuthorities(
  organizationId: string,
  sourceId: string,
  targetId: string
): Promise<{ message: string; source_authority_id: string; target_authority_id: string }> {
  return await apiFetch(`/organizations/${organizationId}/collections/authorities/${sourceId}/merge`, {
    method: 'POST',
    body: JSON.stringify({ target_authority_id: targetId }),
  });
}

// Authority Relations (teacher/student/colleague)
export async function getAuthorityRelations(
  organizationId: string,
  authorityId: string
): Promise<AuthorityRelations> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/authorities/${authorityId}/relations`);
  return validate(AuthorityRelationsSchema, data);
}

export async function createAuthorityRelation(
  organizationId: string,
  authorityId: string,
  relation: {
    related_authority_id: string;
    relationship_type: string;
    start_date?: string;
    end_date?: string;
    notes?: string;
  }
): Promise<PersonAuthorityRelation> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/authorities/${authorityId}/relations`, {
    method: 'POST',
    body: JSON.stringify(relation),
  });
  return validate(PersonAuthorityRelationSchema, data);
}

export async function deleteAuthorityRelation(
  organizationId: string,
  authorityId: string,
  relationId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/collections/authorities/${authorityId}/relations/${relationId}`, {
    method: 'DELETE',
  });
}

// Object-Authority Links
export async function getObjectAuthorities(
  organizationId: string,
  objectId: string
): Promise<ObjectPersonAuthority[]> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/authorities`);
  // Backend returns bare array for authorities (unlike other taxonomy endpoints)
  const items = Array.isArray(data) ? data : data.authorities ?? [];
  return z.array(ObjectPersonAuthoritySchema).parse(items);
}

export async function linkObjectAuthority(
  organizationId: string,
  objectId: string,
  link: {
    authority_id: string;
    role: string;
    role_qualifier?: string;
    attribution_certainty?: string;
    display_order?: number;
    display_name_override?: string;
    notes?: string;
  }
): Promise<ObjectPersonAuthority> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/authorities`, {
    method: 'POST',
    body: JSON.stringify(link),
  });
  return validate(ObjectPersonAuthoritySchema, data);
}

export async function updateObjectAuthorityLink(
  organizationId: string,
  objectId: string,
  linkId: string,
  updates: Partial<{
    role: string;
    role_qualifier: string;
    attribution_certainty: string;
    display_order: number;
    display_name_override: string;
    notes: string;
  }>
): Promise<ObjectPersonAuthority> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/authorities/${linkId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return validate(ObjectPersonAuthoritySchema, data);
}

export async function unlinkObjectAuthority(
  organizationId: string,
  objectId: string,
  linkId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/authorities/${linkId}`, {
    method: 'DELETE',
  });
}

// ============================================================================
// OBJECT MATERIALS - AAT vocabulary links (CDWA 11.1)
// ============================================================================

export async function getObjectMaterials(
  organizationId: string,
  objectId: string
): Promise<ObjectMaterial[]> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/materials`);
  return z.array(ObjectMaterialSchema).parse(data);
}

export async function linkObjectMaterial(
  organizationId: string,
  objectId: string,
  link: {
    vocabulary_term_id: string;
    part?: string;
    extent?: string;
    notes?: string;
    display_order?: number;
  }
): Promise<ObjectMaterial> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/materials`, {
    method: 'POST',
    body: JSON.stringify(link),
  });
  return ObjectMaterialSchema.parse(data);
}

export async function unlinkObjectMaterial(
  organizationId: string,
  objectId: string,
  linkId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/materials/${linkId}`, {
    method: 'DELETE',
  });
}

// ============================================================================
// OBJECT TECHNIQUES - AAT vocabulary links (CDWA 11.1)
// ============================================================================

export async function getObjectTechniques(
  organizationId: string,
  objectId: string
): Promise<ObjectTechnique[]> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/techniques`);
  return z.array(ObjectTechniqueSchema).parse(data);
}

export async function linkObjectTechnique(
  organizationId: string,
  objectId: string,
  link: {
    vocabulary_term_id: string;
    part?: string;
    extent?: string;
    notes?: string;
    display_order?: number;
  }
): Promise<ObjectTechnique> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/techniques`, {
    method: 'POST',
    body: JSON.stringify(link),
  });
  return ObjectTechniqueSchema.parse(data);
}

export async function unlinkObjectTechnique(
  organizationId: string,
  objectId: string,
  linkId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/techniques/${linkId}`, {
    method: 'DELETE',
  });
}

// ============================================================================
// ULAN PERSON AUTHORITY SEARCH & IMPORT
// ============================================================================

export interface ULANSearchResult {
  id: string;
  source: 'local' | 'ulan';
  label: string;
  description?: string;
  dates?: string;
  nationality?: string;
  roles?: string[];
  ulan_id?: string;
  authority_id?: string;
  uri?: string;
}

export interface ULANSearchResponse {
  query: string;
  results: ULANSearchResult[];
}

/**
 * Search for person authorities including ULAN.
 * Returns local records first, then ULAN results.
 */
export async function searchPersonAuthoritiesWithULAN(
  organizationId: string,
  query: string,
  options?: {
    include_ulan?: boolean;
    limit?: number;
  }
): Promise<ULANSearchResponse> {
  const params = buildQueryString({
    q: query,
    include_ulan: options?.include_ulan ?? true,
    limit: options?.limit ?? 20,
  });
  return await apiFetch(`/organizations/${organizationId}/person-authorities/search${params}`);
}

/**
 * Import a ULAN record into local PersonAuthority.
 * Returns the created or existing authority.
 */
export async function importULANRecord(
  organizationId: string,
  ulanId: string
): Promise<{
  authority_id: string;
  preferred_name: string;
  display_name: string;
  ulan_id: string;
  is_new: boolean;
}> {
  return await apiFetch(`/organizations/${organizationId}/person-authorities/import-ulan`, {
    method: 'POST',
    body: JSON.stringify({ ulan_id: ulanId }),
  });
}

// ============================================================================
// CDWA OBJECT RELATIONSHIPS API (CDWA Category 20)
// ============================================================================

export async function getObjectRelationships(
  organizationId: string,
  objectId: string
): Promise<ObjectRelationshipsResponse> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/relationships`);
  return validate(ObjectRelationshipsResponseSchema, data);
}

export async function createObjectRelationship(
  organizationId: string,
  objectId: string,
  relationship: {
    relationship_type: string;
    related_object_id?: string;
    external_work_title?: string;
    external_work_creator?: string;
    external_work_date?: string;
    external_work_location?: string;
    external_work_identifier?: string;
    external_work_thumbnail_url?: string;
    relationship_direction?: string;
    sequence_number?: number;
    notes?: string;
  }
): Promise<ObjectRelationship> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/relationships`, {
    method: 'POST',
    body: JSON.stringify(relationship),
  });
  return validate(ObjectRelationshipSchema, data);
}

export async function updateObjectRelationship(
  organizationId: string,
  relationshipId: string,
  updates: Partial<{
    relationship_type: string;
    relationship_direction: string;
    sequence_number: number;
    external_work_title: string;
    external_work_creator: string;
    external_work_date: string;
    external_work_location: string;
    external_work_identifier: string;
    notes: string;
  }>
): Promise<ObjectRelationship> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/relationships/${relationshipId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return validate(ObjectRelationshipSchema, data);
}

export async function deleteObjectRelationship(
  organizationId: string,
  relationshipId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/collections/relationships/${relationshipId}`, {
    method: 'DELETE',
  });
}

export interface WikidataArtworkResult {
  qid: string;
  title: string;
  description: string;
  creator: string | null;
  date: string | null;
  location: string | null;
  thumbnail_url: string | null;
  uri: string;
}

export async function searchWikidataArtworks(
  organizationId: string,
  query: string,
  limit = 10,
): Promise<{ query: string; results: WikidataArtworkResult[] }> {
  return await apiFetch(
    `/organizations/${organizationId}/collections/relationships/wikidata-artwork-search?q=${encodeURIComponent(query)}&limit=${limit}`,
  );
}

// ============================================================================
// CDWA CITATIONS API (CDWA Category 27)
// ============================================================================

export async function getCitations(
  organizationId: string,
  params?: {
    limit?: number;
    offset?: number;
    search?: string;
    citation_type?: string;
  }
): Promise<PaginatedCitations> {
  const query = buildQueryString(params || {});
  const data = await apiFetch(`/organizations/${organizationId}/collections/citations${query}`);
  return validate(PaginatedCitationsSchema, data);
}

export async function getCitation(
  organizationId: string,
  citationId: string
): Promise<Citation> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/citations/${citationId}`);
  return validate(CitationSchema, data);
}

export async function createCitation(
  organizationId: string,
  citation: Partial<Citation>
): Promise<Citation> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/citations`, {
    method: 'POST',
    body: JSON.stringify(citation),
  });
  return validate(CitationSchema, data);
}

export async function updateCitation(
  organizationId: string,
  citationId: string,
  updates: Partial<Citation>
): Promise<Citation> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/citations/${citationId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return validate(CitationSchema, data);
}

export async function deleteCitation(
  organizationId: string,
  citationId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/collections/citations/${citationId}`, {
    method: 'DELETE',
  });
}

// ============================================================================
// OBJECT-CITATION LINKING API
// ============================================================================

export async function getObjectCitations(
  organizationId: string,
  objectId: string
): Promise<{ citations: ObjectCitationLink[]; total: number }> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/citations`);
  return {
    citations: data.citations.map((c: unknown) => validate(ObjectCitationLinkSchema, c)),
    total: data.total,
  };
}

export async function linkObjectCitation(
  organizationId: string,
  objectId: string,
  data: {
    citation_id: string;
    page_reference?: string;
    figure_reference?: string;
    plate_reference?: string;
    catalog_number?: string;
    works_cited?: boolean;
    works_illustrated?: boolean;
    is_primary?: boolean;
    display_order?: number;
    link_note?: string;
  }
): Promise<ObjectCitationLink> {
  const result = await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/citations`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return validate(ObjectCitationLinkSchema, result);
}

export async function updateObjectCitationLink(
  organizationId: string,
  objectId: string,
  linkId: string,
  data: Partial<{
    page_reference: string;
    figure_reference: string;
    plate_reference: string;
    catalog_number: string;
    works_cited: boolean;
    works_illustrated: boolean;
    is_primary: boolean;
    display_order: number;
    link_note: string;
  }>
): Promise<ObjectCitationLink> {
  const result = await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/citations/${linkId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  return validate(ObjectCitationLinkSchema, result);
}

export async function unlinkObjectCitation(
  organizationId: string,
  objectId: string,
  linkId: string
): Promise<{ message: string }> {
  return await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/citations/${linkId}`, {
    method: 'DELETE',
  });
}

// ============================================================================
// CDWA EXTENDED AUTHORITIES API
// ============================================================================

// --- Place Authorities (CDWA 29) ---

export async function getPlaceAuthorities(
  organizationId: string,
  params?: {
    limit?: number;
    offset?: number;
    search?: string;
    place_type?: string;
    status?: string;
  }
): Promise<PlaceAuthoritiesList> {
  const query = buildQueryString(params || {});
  const data = await apiFetch(`/organizations/${organizationId}/collections/place-authorities${query}`);
  return validate(PlaceAuthoritiesListSchema, data);
}

export async function getPlaceAuthority(
  organizationId: string,
  authorityId: string
): Promise<PlaceAuthority> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/place-authorities/${authorityId}`);
  return validate(PlaceAuthoritySchema, data);
}

export async function createPlaceAuthority(
  organizationId: string,
  authority: Partial<PlaceAuthority>
): Promise<PlaceAuthority> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/place-authorities`, {
    method: 'POST',
    body: JSON.stringify(authority),
  });
  return validate(PlaceAuthoritySchema, data);
}

export async function updatePlaceAuthority(
  organizationId: string,
  authorityId: string,
  updates: Partial<PlaceAuthority>
): Promise<PlaceAuthority> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/place-authorities/${authorityId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return validate(PlaceAuthoritySchema, data);
}

export async function deletePlaceAuthority(
  organizationId: string,
  authorityId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/collections/place-authorities/${authorityId}`, {
    method: 'DELETE',
  });
}

export async function updatePlaceGeometry(
  organizationId: string,
  placeAuthorityId: string,
  geometry: {
    type: 'point';
    latitude: number;
    longitude: number;
  } | {
    type: 'polygon';
    coordinates: Array<[number, number]>;
  }
): Promise<{ success: boolean; place_authority_id: string; geometry_type: string }> {
  return await apiFetch(`/organizations/${organizationId}/geo/places/${placeAuthorityId}/geometry`, {
    method: 'PUT',
    body: JSON.stringify(geometry),
  });
}

// Object-Place Authority Links
export async function getObjectPlaceAuthorities(
  organizationId: string,
  objectId: string
): Promise<ObjectPlaceAuthority[]> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/place-authorities`);
  return z.array(ObjectPlaceAuthoritySchema).parse(data.place_authorities ?? []);
}

export async function linkObjectPlaceAuthority(
  organizationId: string,
  objectId: string,
  link: {
    place_authority_id: string;
    role: string;
    date_display?: string;
    date_earliest?: string;
    date_latest?: string;
    notes?: string;
    display_order?: number;
  }
): Promise<ObjectPlaceAuthority> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/place-authorities`, {
    method: 'POST',
    body: JSON.stringify(link),
  });
  return validate(ObjectPlaceAuthoritySchema, data);
}

export async function unlinkObjectPlaceAuthority(
  organizationId: string,
  objectId: string,
  linkId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/place-authorities/${linkId}`, {
    method: 'DELETE',
  });
}

// --- Style/Period Authorities (CDWA 5) ---

export async function getStylePeriodAuthorities(
  organizationId: string,
  params?: {
    limit?: number;
    offset?: number;
    search?: string;
    authority_type?: string;
    status?: string;
  }
): Promise<StylePeriodAuthoritiesList> {
  const query = buildQueryString(params || {});
  const data = await apiFetch(`/organizations/${organizationId}/collections/style-period-authorities${query}`);
  return validate(StylePeriodAuthoritiesListSchema, data);
}

export async function getStylePeriodAuthority(
  organizationId: string,
  authorityId: string
): Promise<StylePeriodAuthority> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/style-period-authorities/${authorityId}`);
  return validate(StylePeriodAuthoritySchema, data);
}

export async function createStylePeriodAuthority(
  organizationId: string,
  authority: Partial<StylePeriodAuthority>
): Promise<StylePeriodAuthority> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/style-period-authorities`, {
    method: 'POST',
    body: JSON.stringify(authority),
  });
  return validate(StylePeriodAuthoritySchema, data);
}

export async function updateStylePeriodAuthority(
  organizationId: string,
  authorityId: string,
  updates: Partial<StylePeriodAuthority>
): Promise<StylePeriodAuthority> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/style-period-authorities/${authorityId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return validate(StylePeriodAuthoritySchema, data);
}

export async function deleteStylePeriodAuthority(
  organizationId: string,
  authorityId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/collections/style-period-authorities/${authorityId}`, {
    method: 'DELETE',
  });
}

// Object-Style/Period Links
export async function getObjectStylePeriods(
  organizationId: string,
  objectId: string
): Promise<ObjectStylePeriod[]> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/style-periods`);
  return z.array(ObjectStylePeriodSchema).parse(data.style_periods ?? []);
}

export async function linkObjectStylePeriod(
  organizationId: string,
  objectId: string,
  link: {
    authority_id: string;
    assignment_certainty?: string;
    assignment_note?: string;
    display_order?: number;
  }
): Promise<ObjectStylePeriod> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/style-periods`, {
    method: 'POST',
    body: JSON.stringify(link),
  });
  return validate(ObjectStylePeriodSchema, data);
}

export async function unlinkObjectStylePeriod(
  organizationId: string,
  objectId: string,
  linkId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/style-periods/${linkId}`, {
    method: 'DELETE',
  });
}

// --- Subject Authorities (CDWA 31) ---

export async function getSubjectAuthorities(
  organizationId: string,
  params?: {
    limit?: number;
    offset?: number;
    search?: string;
    subject_type?: string;
    status?: string;
  }
): Promise<SubjectAuthoritiesList> {
  const query = buildQueryString(params || {});
  const data = await apiFetch(`/organizations/${organizationId}/collections/subject-authorities${query}`);
  return validate(SubjectAuthoritiesListSchema, data);
}

export async function searchSubjectsExternal(
  organizationId: string,
  query: string,
  limit = 10
): Promise<Array<{
  id: string;
  label: string;
  description?: string;
  source: string;
  reference?: { uri: string; source: string; label?: string };
}>> {
  try {
    const data = await apiFetch('/autocomplete/search', {
      method: 'POST',
      body: JSON.stringify({
        query,
        field_type: 'subject',
        organization_id: organizationId,
        limit,
        sources: ['external'],
      }),
    });
    return data.suggestions || [];
  } catch {
    return [];
  }
}

export async function getSubjectAuthority(
  organizationId: string,
  authorityId: string
): Promise<SubjectAuthority> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/subject-authorities/${authorityId}`);
  return validate(SubjectAuthoritySchema, data);
}

export async function createSubjectAuthority(
  organizationId: string,
  authority: Partial<SubjectAuthority>
): Promise<SubjectAuthority> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/subject-authorities`, {
    method: 'POST',
    body: JSON.stringify(authority),
  });
  return validate(SubjectAuthoritySchema, data);
}

export async function updateSubjectAuthority(
  organizationId: string,
  authorityId: string,
  updates: Partial<SubjectAuthority>
): Promise<SubjectAuthority> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/subject-authorities/${authorityId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return validate(SubjectAuthoritySchema, data);
}

export async function deleteSubjectAuthority(
  organizationId: string,
  authorityId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/collections/subject-authorities/${authorityId}`, {
    method: 'DELETE',
  });
}

// Object-Subject Links
export async function getObjectSubjects(
  organizationId: string,
  objectId: string
): Promise<ObjectSubject[]> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/subjects`);
  return z.array(ObjectSubjectSchema).parse(data.subjects ?? []);
}

export async function linkObjectSubject(
  organizationId: string,
  objectId: string,
  link: {
    subject_authority_id: string;
    subject_extent?: string;
    interpretation_note?: string;
    display_order?: number;
  }
): Promise<ObjectSubject> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/subjects`, {
    method: 'POST',
    body: JSON.stringify(link),
  });
  return validate(ObjectSubjectSchema, data);
}

export async function unlinkObjectSubject(
  organizationId: string,
  objectId: string,
  linkId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/subjects/${linkId}`, {
    method: 'DELETE',
  });
}

// --- Critical Responses (CDWA 19) ---

export async function getObjectCriticalResponses(
  organizationId: string,
  objectId: string
): Promise<CriticalResponsesList> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/critical-responses`);
  return validate(CriticalResponsesListSchema, data);
}

export async function createCriticalResponse(
  organizationId: string,
  objectId: string,
  response: Partial<CriticalResponse>
): Promise<CriticalResponse> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/critical-responses`, {
    method: 'POST',
    body: JSON.stringify(response),
  });
  return validate(CriticalResponseSchema, data);
}

export async function getCriticalResponse(
  organizationId: string,
  responseId: string
): Promise<CriticalResponse> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/critical-responses/${responseId}`);
  return validate(CriticalResponseSchema, data);
}

export async function updateCriticalResponse(
  organizationId: string,
  responseId: string,
  updates: Partial<CriticalResponse>
): Promise<CriticalResponse> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/critical-responses/${responseId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return validate(CriticalResponseSchema, data);
}

export async function deleteCriticalResponse(
  organizationId: string,
  responseId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/collections/critical-responses/${responseId}`, {
    method: 'DELETE',
  });
}

// --- Cataloging History (CDWA 25) ---

export async function getObjectCatalogingHistory(
  organizationId: string,
  objectId: string
): Promise<CatalogingHistoryList> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/cataloging-history`);
  return validate(CatalogingHistoryListSchema, data);
}

export async function createCatalogingHistoryEntry(
  organizationId: string,
  objectId: string,
  entry: Partial<CatalogingHistory>
): Promise<CatalogingHistory> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/cataloging-history`, {
    method: 'POST',
    body: JSON.stringify(entry),
  });
  return validate(CatalogingHistorySchema, data);
}

export async function getCatalogingHistoryEntry(
  organizationId: string,
  historyId: string
): Promise<CatalogingHistory> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/cataloging-history/${historyId}`);
  return validate(CatalogingHistorySchema, data);
}

// --- Object Contexts (CDWA 17) ---

export async function getObjectContexts(
  organizationId: string,
  objectId: string
): Promise<ObjectContextsList> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/contexts`);
  return validate(ObjectContextsListSchema, data);
}

export async function createObjectContext(
  organizationId: string,
  objectId: string,
  context: Partial<ObjectContext>
): Promise<ObjectContext> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/contexts`, {
    method: 'POST',
    body: JSON.stringify(context),
  });
  return validate(ObjectContextSchema, data);
}

export async function updateObjectContext(
  organizationId: string,
  contextId: string,
  updates: Partial<ObjectContext>
): Promise<ObjectContext> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/contexts/${contextId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return validate(ObjectContextSchema, data);
}

export async function deleteObjectContext(
  organizationId: string,
  contextId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/collections/contexts/${contextId}`, {
    method: 'DELETE',
  });
}
