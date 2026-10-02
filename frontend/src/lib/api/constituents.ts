// =============================================================================
// Constituents API (unified contacts + person authorities)
// =============================================================================

import { apiFetch, buildQueryString } from './_utils';

// ============================================================================
// Types
// ============================================================================

export interface Constituent {
  constituent_id: string;
  organization_id: string;
  constituent_type: string;
  name: string;
  first_name?: string;
  last_name?: string;
  display_name?: string;
  sort_name?: string;
  title?: string;
  role?: string;
  organization_name?: string;
  department?: string;
  email?: string;
  phone?: string;
  phone_secondary?: string;
  website?: string;
  address?: Record<string, string>;
  // CDWA Identity
  given_name?: string;
  family_name?: string;
  name_prefix?: string;
  name_suffix?: string;
  variant_names?: string[];
  nationality?: string;
  nationalities?: string[];
  culture?: string;
  life_roles?: string[];
  gender?: string;
  // CDWA Existence
  birth_date_display?: string;
  birth_date_earliest?: string;
  birth_place?: string;
  birth_place_tgn_id?: string;
  death_date_display?: string;
  death_date_earliest?: string;
  death_place?: string;
  death_place_tgn_id?: string;
  active_date_display?: string;
  // Biography
  biography?: string;
  biography_source?: string;
  // External
  ulan_id?: string;
  viaf_id?: string;
  wikidata_id?: string;
  loc_id?: string;
  // Status
  is_active: boolean;
  status: string;
  is_verified: boolean;
  notes?: string;
  internal_notes?: string;
  cataloger_notes?: string;
  // Audit
  created_at?: string;
  updated_at?: string;
  // Counts
  linked_records_count?: number;
}

export interface ConstituentXref {
  xref_id: string;
  organization_id: string;
  constituent_id: string;
  entity_type: string;
  entity_id: string;
  role: string;
  role_qualifier?: string;
  attribution_certainty?: string;
  attribution_note?: string;
  display_order: number;
  display_name_override?: string;
  is_primary: boolean;
  start_date?: string;
  end_date?: string;
  location?: string;
  notes?: string;
  created_at?: string;
  constituent?: Constituent;
}

export interface ConstituentRelation {
  relation_id: string;
  from_constituent_id: string;
  to_constituent_id: string;
  relationship_type: string;
  relationship_note?: string;
  start_date?: string;
  end_date?: string;
  from_constituent?: Constituent;
  to_constituent?: Constituent;
}

export interface ConstituentSearchResult {
  id: string;
  source: string; // 'local' | 'ulan'
  label: string;
  description?: string;
  dates?: string;
  nationality?: string;
  roles?: string[];
  ulan_id?: string;
  constituent_id?: string;
  uri?: string;
}

// ============================================================================
// CRUD
// ============================================================================

export async function getConstituents(
  organizationId: string,
  params?: {
    q?: string;
    constituent_type?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }
): Promise<{ items: Constituent[]; total: number }> {
  const query = buildQueryString(params || {});
  return await apiFetch(`/organizations/${organizationId}/collections/constituents${query}`);
}

export async function createConstituent(
  organizationId: string,
  data: Partial<Constituent>
): Promise<Constituent> {
  return await apiFetch(`/organizations/${organizationId}/collections/constituents`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getConstituent(
  organizationId: string,
  constituentId: string
): Promise<Constituent> {
  return await apiFetch(`/organizations/${organizationId}/collections/constituents/${constituentId}`);
}

export async function updateConstituent(
  organizationId: string,
  constituentId: string,
  data: Partial<Constituent>
): Promise<Constituent> {
  return await apiFetch(`/organizations/${organizationId}/collections/constituents/${constituentId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteConstituent(
  organizationId: string,
  constituentId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/collections/constituents/${constituentId}`, {
    method: 'DELETE',
  });
}

// ============================================================================
// Search
// ============================================================================

export async function searchConstituents(
  organizationId: string,
  params: {
    q: string;
    include_ulan?: boolean;
    limit?: number;
  }
): Promise<{ query: string; results: ConstituentSearchResult[] }> {
  const query = buildQueryString(params);
  return await apiFetch(`/organizations/${organizationId}/collections/constituents/search${query}`);
}

export async function searchUlan(
  organizationId: string,
  params: {
    q: string;
    limit?: number;
  }
): Promise<{ query: string; results: ConstituentSearchResult[] }> {
  const query = buildQueryString(params);
  return await apiFetch(`/organizations/${organizationId}/collections/constituents/ulan-search${query}`);
}

export interface AuthoritySearchResult {
  id: string;
  label: string;
  description?: string;
  authority_id: string;
  uri?: string;
}

export async function searchViaf(
  organizationId: string,
  params: { q: string; limit?: number }
): Promise<{ query: string; results: AuthoritySearchResult[] }> {
  const query = buildQueryString(params);
  return await apiFetch(`/organizations/${organizationId}/collections/constituents/viaf-search${query}`);
}

export async function searchWikidata(
  organizationId: string,
  params: { q: string; limit?: number }
): Promise<{ query: string; results: AuthoritySearchResult[] }> {
  const query = buildQueryString(params);
  return await apiFetch(`/organizations/${organizationId}/collections/constituents/wikidata-search${query}`);
}

export async function searchLoc(
  organizationId: string,
  params: { q: string; limit?: number }
): Promise<{ query: string; results: AuthoritySearchResult[] }> {
  const query = buildQueryString(params);
  return await apiFetch(`/organizations/${organizationId}/collections/constituents/loc-search${query}`);
}

export interface UlanRecord {
  ulan_id: string;
  uri?: string;
  preferred_name?: string;
  display_name?: string;
  sort_name?: string;
  given_name?: string;
  family_name?: string;
  variant_names?: string[];
  birth_date_display?: string;
  birth_place?: string;
  death_date_display?: string;
  death_place?: string;
  nationality?: string;
  nationalities?: string[];
  gender?: string;
  life_roles?: string[];
  biography?: string;
}

export async function getUlanRecord(
  organizationId: string,
  ulanId: string
): Promise<UlanRecord> {
  return await apiFetch(`/organizations/${organizationId}/collections/constituents/ulan/${ulanId}`);
}

export async function importUlan(
  organizationId: string,
  data: { ulan_id: string }
): Promise<Constituent> {
  return await apiFetch(`/organizations/${organizationId}/collections/constituents/import-ulan`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ============================================================================
// Object Constituents
// ============================================================================

export async function getObjectConstituents(
  organizationId: string,
  objectId: string
): Promise<ConstituentXref[]> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/constituents`);
  return data.constituents ?? [];
}

export async function addObjectConstituent(
  organizationId: string,
  objectId: string,
  data: Partial<ConstituentXref>
): Promise<ConstituentXref> {
  return await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/constituents`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateObjectConstituent(
  organizationId: string,
  objectId: string,
  xrefId: string,
  data: Partial<ConstituentXref>
): Promise<ConstituentXref> {
  return await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/constituents/${xrefId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function removeObjectConstituent(
  organizationId: string,
  objectId: string,
  xrefId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/constituents/${xrefId}`, {
    method: 'DELETE',
  });
}

// ============================================================================
// Generic Xrefs
// ============================================================================

export async function getConstituentXrefs(
  organizationId: string,
  params: {
    entity_type: string;
    entity_id: string;
  }
): Promise<ConstituentXref[]> {
  const query = buildQueryString(params);
  const data = await apiFetch(`/organizations/${organizationId}/collections/constituent-xrefs${query}`);
  return data.xrefs ?? [];
}

export async function createConstituentXref(
  organizationId: string,
  data: Partial<ConstituentXref>
): Promise<ConstituentXref> {
  return await apiFetch(`/organizations/${organizationId}/collections/constituent-xrefs`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateConstituentXref(
  organizationId: string,
  xrefId: string,
  data: Partial<ConstituentXref>
): Promise<ConstituentXref> {
  return await apiFetch(`/organizations/${organizationId}/collections/constituent-xrefs/${xrefId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteConstituentXref(
  organizationId: string,
  xrefId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/collections/constituent-xrefs/${xrefId}`, {
    method: 'DELETE',
  });
}

// ============================================================================
// Relations
// ============================================================================

export async function getConstituentRelations(
  organizationId: string,
  constituentId: string
): Promise<ConstituentRelation[]> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/constituents/${constituentId}/relations`);
  return data.relations ?? [];
}

export async function createConstituentRelation(
  organizationId: string,
  constituentId: string,
  data: Partial<ConstituentRelation>
): Promise<ConstituentRelation> {
  return await apiFetch(`/organizations/${organizationId}/collections/constituents/${constituentId}/relations`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function deleteConstituentRelation(
  organizationId: string,
  constituentId: string,
  relationId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/collections/constituents/${constituentId}/relations/${relationId}`, {
    method: 'DELETE',
  });
}

// ============================================================================
// Actions
// ============================================================================

export async function mergeConstituents(
  organizationId: string,
  primaryId: string,
  data: { secondary_id: string }
): Promise<{ message: string; primary_id: string; secondary_id: string }> {
  return await apiFetch(`/organizations/${organizationId}/collections/constituents/${primaryId}/merge`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function verifyConstituent(
  organizationId: string,
  constituentId: string
): Promise<Constituent> {
  return await apiFetch(`/organizations/${organizationId}/collections/constituents/${constituentId}/verify`, {
    method: 'POST',
  });
}

// ============================================================================
// Enums
// ============================================================================

export async function getConstituentEnums(
  organizationId: string
): Promise<Record<string, string[]>> {
  return await apiFetch(`/organizations/${organizationId}/collections/constituents/enums`);
}
