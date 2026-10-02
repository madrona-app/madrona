import { z } from 'zod';

// ============================================================================
// VOCABULARY SCHEMAS
// ============================================================================

// Vocabulary term schema - matches VocabularyTermResult.to_dict() from backend
export const VocabularyTermSchema = z.object({
  term_id: z.string().nullable().optional(),  // null for remote Getty results not yet cached
  vocabulary: z.string(),  // aat, ulan, tgn, local
  external_id: z.string().nullable().optional(),
  external_uri: z.string().nullable().optional(),
  preferred_term: z.string(),
  alternate_terms: z.array(z.string()).nullable().optional(),
  scope_note: z.string().nullable().optional(),
  broader_term: z.string().nullable().optional(),
  hierarchy_path: z.string().nullable().optional(),
  is_local: z.boolean(),  // true if from local cache
  usage_count: z.number(),
  facet: z.string().nullable().optional(),  // AAT facet category
  hierarchy_fetched_at: z.string().nullable().optional(),  // When Celery last synced hierarchy
  getty_modified_at: z.string().nullable().optional(),  // Getty's last modification date
  // ULAN-specific fields (for artist/architect records)
  dates: z.string().nullable().optional(),  // Life dates (e.g., "1853-1890")
  nationality: z.string().nullable().optional(),  // Nationality (e.g., "Dutch")
  // TGN-specific fields (for geographic records)
  place_type: z.string().nullable().optional(),  // Type of place (e.g., "city", "region")
  parent_place: z.string().nullable().optional(),  // Parent geographic entity
  latitude: z.number().nullable().optional(),  // TGN record coordinates
  longitude: z.number().nullable().optional(),
});

export type VocabularyTerm = z.infer<typeof VocabularyTermSchema>;

// Term hierarchy response — broader/narrower BFS results + related terms.
// Matches VocabularyHierarchyService.get_term_hierarchy().
export const VocabularyTraversalTermSchema = z.object({
  term_id: z.string(),
  vocabulary: z.string(),
  external_id: z.string().nullable().optional(),
  preferred_term: z.string(),
  depth: z.number().int().nonnegative().optional(),
});
export type VocabularyTraversalTerm = z.infer<typeof VocabularyTraversalTermSchema>;

export const VocabularyTermHierarchySchema = z.object({
  term: z.object({
    term_id: z.string(),
    vocabulary: z.string(),
    external_id: z.string().nullable().optional(),
    external_uri: z.string().nullable().optional(),
    preferred_term: z.string(),
    alternate_terms: z.array(z.string()).nullable().optional(),
    scope_note: z.string().nullable().optional(),
    facet: z.string().nullable().optional(),
    hierarchy_path: z.string().nullable().optional(),
    hierarchy_fetched_at: z.string().nullable().optional(),
  }),
  broader_terms: z.array(VocabularyTraversalTermSchema),
  narrower_terms: z.array(VocabularyTraversalTermSchema),
  related_terms: z.array(VocabularyTraversalTermSchema),
});
export type VocabularyTermHierarchy = z.infer<typeof VocabularyTermHierarchySchema>;

// ============================================================================
// CDWA PERSON AUTHORITIES SCHEMA (CDWA Category 28)
// ============================================================================

export const PersonAuthorityStatusSchema = z.enum(['active', 'deprecated', 'merged']);
export type PersonAuthorityStatus = z.infer<typeof PersonAuthorityStatusSchema>;

export const PersonAuthoritySchema = z.object({
  authority_id: z.string(),
  organization_id: z.string().nullable().optional(),
  preferred_name: z.string(),
  variant_names: z.array(z.string()).nullish(),
  nationality: z.string().nullable().optional(),
  culture: z.string().nullish(),
  gender: z.string().nullable().optional(),
  life_roles: z.array(z.string()).nullish(),
  birth_date_display: z.string().nullable().optional(),
  birth_date_earliest: z.string().nullable().optional(),
  birth_date_latest: z.string().nullish(),
  birth_place: z.string().nullable().optional(),
  birth_place_tgn_id: z.string().nullish(),
  death_date_display: z.string().nullable().optional(),
  death_date_earliest: z.string().nullable().optional(),
  death_date_latest: z.string().nullish(),
  death_place: z.string().nullable().optional(),
  death_place_tgn_id: z.string().nullish(),
  active_date_display: z.string().nullish(),
  biography: z.string().nullable().optional(),
  ulan_id: z.string().nullable().optional(),
  viaf_id: z.string().nullish(),
  wikidata_id: z.string().nullish(),
  external_uris: z.array(z.string()).nullish(),
  status: PersonAuthorityStatusSchema,
  merged_into_id: z.string().nullish(),
  is_verified: z.boolean(),
  notes: z.string().nullish(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  linked_objects_count: z.number().nullish(),
});

export type PersonAuthority = z.infer<typeof PersonAuthoritySchema>;

export const PaginatedAuthoritiesSchema = z.object({
  items: z.array(PersonAuthoritySchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export type PaginatedAuthorities = z.infer<typeof PaginatedAuthoritiesSchema>;

// Authority Relations (teacher/student/colleague relationships)
export const PersonAuthorityRelationSchema = z.object({
  relation_id: z.string(),
  source_authority_id: z.string(),
  related_authority_id: z.string(),
  relationship_type: z.string(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type PersonAuthorityRelation = z.infer<typeof PersonAuthorityRelationSchema>;

export const AuthorityRelationsSchema = z.object({
  outgoing_relations: z.array(PersonAuthorityRelationSchema),
  incoming_relations: z.array(PersonAuthorityRelationSchema),
});

export type AuthorityRelations = z.infer<typeof AuthorityRelationsSchema>;

// Object-Authority links
export const ObjectPersonAuthorityRoleSchema = z.enum([
  'creator', 'donor', 'previous_owner', 'depicted', 'associated'
]);
export type ObjectPersonAuthorityRole = z.infer<typeof ObjectPersonAuthorityRoleSchema>;

export const ObjectPersonAuthoritySchema = z.object({
  link_id: z.string(),
  object_id: z.string(),
  authority_id: z.string(),
  role: z.string(),
  role_qualifier: z.string().nullable().optional(),
  attribution_certainty: z.string().nullable().optional(),
  display_order: z.number(),
  display_name_override: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  authority: PersonAuthoritySchema.nullable().optional(),
});

export type ObjectPersonAuthority = z.infer<typeof ObjectPersonAuthoritySchema>;

// ============================================================================
// OBJECT MATERIALS SCHEMA - AAT vocabulary links (CDWA 11.1)
// ============================================================================

export const EmbeddedVocabularyTermSchema = z.object({
  term_id: z.string(),
  vocabulary: z.string(),
  external_id: z.string().nullable().optional(),
  external_uri: z.string().nullable().optional(),
  preferred_term: z.string(),
  scope_note: z.string().nullable().optional(),
  broader_term: z.string().nullable().optional(),
});

export type EmbeddedVocabularyTerm = z.infer<typeof EmbeddedVocabularyTermSchema>;

export const ObjectMaterialSchema = z.object({
  link_id: z.string(),
  object_id: z.string(),
  vocabulary_term_id: z.string(),
  part: z.string().nullable().optional(),
  extent: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  display_order: z.number(),
  created_at: z.string().nullable().optional(),
  vocabulary_term: EmbeddedVocabularyTermSchema.nullable().optional(),
});

export type ObjectMaterial = z.infer<typeof ObjectMaterialSchema>;

// ============================================================================
// OBJECT TECHNIQUES SCHEMA - AAT vocabulary links (CDWA 11.1)
// ============================================================================

export const ObjectTechniqueSchema = z.object({
  link_id: z.string(),
  object_id: z.string(),
  vocabulary_term_id: z.string(),
  part: z.string().nullable().optional(),
  extent: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  display_order: z.number(),
  created_at: z.string().nullable().optional(),
  vocabulary_term: EmbeddedVocabularyTermSchema.nullable().optional(),
});

export type ObjectTechnique = z.infer<typeof ObjectTechniqueSchema>;

// ============================================================================
// CDWA CITATIONS SCHEMA (CDWA Category 27)
// ============================================================================

export const CitationTypeSchema = z.enum([
  'book', 'article', 'catalog', 'exhibition_catalog', 'dissertation',
  'website', 'manuscript', 'newspaper', 'journal', 'proceedings', 'other'
]);
export type CitationType = z.infer<typeof CitationTypeSchema>;

export const CitationSchema = z.object({
  citation_id: z.string(),
  organization_id: z.string(),
  citation_type: z.string(),
  // Nullable in the database, and generated.ts has it right; this hand-written
  // copy demanded a string, so any citation without one failed validation and
  // the citations list logged a schema error instead of rendering.
  brief_citation: z.string().nullable().optional(),
  full_citation: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  publication: z.string().nullable().optional(),
  publisher: z.string().nullable().optional(),
  publication_place: z.string().nullable().optional(),
  publication_year: z.number().nullable().optional(),
  volume: z.string().nullable().optional(),
  issue: z.string().nullable().optional(),
  pages: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  doi: z.string().nullable().optional(),
  isbn: z.string().nullable().optional(),
  works_cited: z.boolean(),
  works_illustrated: z.boolean(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});

export type Citation = z.infer<typeof CitationSchema>;

export const PaginatedCitationsSchema = z.object({
  items: z.array(CitationSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export type PaginatedCitations = z.infer<typeof PaginatedCitationsSchema>;

// ============================================================================
// OBJECT-CITATION LINKING SCHEMA
// ============================================================================

export const ObjectCitationLinkSchema = z.object({
  link_id: z.string(),
  organization_id: z.string(),
  object_id: z.string(),
  citation_id: z.string(),
  page_reference: z.string().nullable().optional(),
  figure_reference: z.string().nullable().optional(),
  plate_reference: z.string().nullable().optional(),
  catalog_number: z.string().nullable().optional(),
  works_cited: z.boolean(),
  works_illustrated: z.boolean(),
  is_primary: z.boolean(),
  display_order: z.number(),
  link_note: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  citation: CitationSchema.nullable().optional(),
});

export type ObjectCitationLink = z.infer<typeof ObjectCitationLinkSchema>;

// ============================================================================
// CDWA EXTENDED AUTHORITIES
// ============================================================================

// Place Authority (CDWA 29)
export const PlaceTypeEnum = z.enum([
  'city', 'region', 'country', 'site', 'building', 'district',
  'state', 'province', 'continent', 'body_of_water', 'place'
]);
export type PlaceType = z.infer<typeof PlaceTypeEnum>;

export const PlaceAuthoritySchema = z.object({
  place_authority_id: z.string(),
  organization_id: z.string(),
  preferred_name: z.string(),
  variant_names: z.array(z.string()).nullable().optional(),
  place_type: PlaceTypeEnum,
  tgn_id: z.string().nullable().optional(),
  geonames_id: z.string().nullable().optional(),
  wikidata_id: z.string().nullable().optional(),
  coordinates_lat: z.number().nullable().optional(),
  coordinates_lng: z.number().nullable().optional(),
  parent_place_id: z.string().nullable().optional(),
  hierarchy_path: z.string().nullable().optional(),
  country_code: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  status: z.enum(['active', 'deprecated', 'merged']),
  linked_objects_count: z.number().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});

export type PlaceAuthority = z.infer<typeof PlaceAuthoritySchema>;

export const PlaceRoleEnum = z.enum([
  'creation_place', 'discovery_place', 'depicted_place', 'associated_place',
  'former_location', 'original_location', 'intended_location'
]);
export type PlaceRole = z.infer<typeof PlaceRoleEnum>;

export const ObjectPlaceAuthoritySchema = z.object({
  link_id: z.string(),
  object_id: z.string(),
  place_authority_id: z.string(),
  role: PlaceRoleEnum,
  date_display: z.string().nullable().optional(),
  date_earliest: z.string().nullable().optional(),
  date_latest: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  display_order: z.number(),
  created_at: z.string().nullable().optional(),
  place_authority: PlaceAuthoritySchema.nullable().optional(),
});

export type ObjectPlaceAuthority = z.infer<typeof ObjectPlaceAuthoritySchema>;

export const PlaceAuthoritiesListSchema = z.object({
  items: z.array(PlaceAuthoritySchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export type PlaceAuthoritiesList = z.infer<typeof PlaceAuthoritiesListSchema>;

// Style/Period Authority (CDWA 5)
export const StylePeriodTypeEnum = z.enum([
  'style', 'period', 'group', 'movement', 'school'
]);
export type StylePeriodType = z.infer<typeof StylePeriodTypeEnum>;

export const StylePeriodAuthoritySchema = z.object({
  authority_id: z.string(),
  organization_id: z.string(),
  preferred_term: z.string(),
  variant_terms: z.array(z.string()).nullable().optional(),
  authority_type: StylePeriodTypeEnum,
  aat_id: z.string().nullable().optional(),
  wikidata_id: z.string().nullable().optional(),
  culture: z.string().nullable().optional(),
  date_display: z.string().nullable().optional(),
  date_earliest: z.string().nullable().optional(),
  date_latest: z.string().nullable().optional(),
  geographic_scope: z.string().nullable().optional(),
  parent_authority_id: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  status: z.enum(['active', 'deprecated', 'merged']),
  linked_objects_count: z.number().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});

export type StylePeriodAuthority = z.infer<typeof StylePeriodAuthoritySchema>;

export const AssignmentCertaintyEnum = z.enum(['certain', 'probable', 'possible']);
export type AssignmentCertainty = z.infer<typeof AssignmentCertaintyEnum>;

export const ObjectStylePeriodSchema = z.object({
  link_id: z.string(),
  object_id: z.string(),
  authority_id: z.string(),
  assignment_certainty: AssignmentCertaintyEnum.nullable().optional(),
  assignment_note: z.string().nullable().optional(),
  display_order: z.number(),
  created_at: z.string().nullable().optional(),
  authority: StylePeriodAuthoritySchema.nullable().optional(),
});

export type ObjectStylePeriod = z.infer<typeof ObjectStylePeriodSchema>;

export const StylePeriodAuthoritiesListSchema = z.object({
  items: z.array(StylePeriodAuthoritySchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export type StylePeriodAuthoritiesList = z.infer<typeof StylePeriodAuthoritiesListSchema>;

// Subject Authority (CDWA 31)
export const SubjectTypeEnum = z.enum([
  'iconographic', 'narrative', 'thematic', 'genre', 'decorative', 'symbolic'
]);
export type SubjectType = z.infer<typeof SubjectTypeEnum>;

export const SubjectAuthoritySchema = z.object({
  authority_id: z.string(),
  organization_id: z.string(),
  preferred_term: z.string(),
  variant_terms: z.array(z.string()).nullable().optional(),
  subject_type: SubjectTypeEnum,
  aat_id: z.string().nullable().optional(),
  iconclass_id: z.string().nullable().optional(),
  wikidata_id: z.string().nullable().optional(),
  broader_subject_id: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  status: z.enum(['active', 'deprecated', 'merged']),
  linked_objects_count: z.number().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});

export type SubjectAuthority = z.infer<typeof SubjectAuthoritySchema>;

export const ObjectSubjectSchema = z.object({
  link_id: z.string(),
  object_id: z.string(),
  subject_authority_id: z.string(),
  subject_extent: z.string().nullable().optional(),
  interpretation_note: z.string().nullable().optional(),
  display_order: z.number(),
  created_at: z.string().nullable().optional(),
  subject_authority: SubjectAuthoritySchema.nullable().optional(),
});

export type ObjectSubject = z.infer<typeof ObjectSubjectSchema>;

export const SubjectAuthoritiesListSchema = z.object({
  items: z.array(SubjectAuthoritySchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export type SubjectAuthoritiesList = z.infer<typeof SubjectAuthoritiesListSchema>;
