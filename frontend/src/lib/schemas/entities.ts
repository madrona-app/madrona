import { z } from 'zod';

// ============================================================================
// FIELD ACCESS MIXIN
// ============================================================================
// Backend field_access_service attaches _restricted_fields to every entity
// response. This mixin provides the TypeScript type so pages don't need `as any`.

/** Mixin for entities that may include backend field-access metadata. */
export interface WithFieldAccess {
  _restricted_fields?: string[];
}

// ============================================================================
// COLLECTIONS SCHEMAS
// ============================================================================

// Other Number Types - Controlled vocabulary for other_numbers field
export const OtherNumberTypeSchema = z.object({
  type_id: z.string(),
  organization_id: z.string(),
  name: z.string(),
  code: z.string(),
  description: z.string().nullish(),
  sort_order: z.number(),
  is_active: z.boolean(),
  is_system: z.boolean(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  created_by: z.string().nullish(),
});

export type OtherNumberType = z.infer<typeof OtherNumberTypeSchema>;

export const OtherNumberTypesResponseSchema = z.object({
  types: z.array(OtherNumberTypeSchema),
  total: z.number(),
});

export type OtherNumberTypesResponse = z.infer<typeof OtherNumberTypesResponseSchema>;

// Collection Object - Core required fields
export const CollectionObjectSchema = z.object({
  object_id: z.string(),
  organization_id: z.string(),
  primary_image_url: z.string().nullable().optional(),
  object_number: z.string(),
  titles: z.array(z.object({
    title: z.string(),
    title_type: z.string().nullish(),
    language: z.string().nullish(),
    is_preferred: z.boolean().default(false),
  })).nullish(),
  object_name: z.string().nullable().optional(),
  object_name_type: z.string().nullable().optional(),
  object_name_language: z.string().nullable().optional(),
  number_of_objects: z.number().nullable().optional(),
  brief_description: z.string().nullable().optional(),
  full_description: z.string().nullable().optional(),
  comments: z.string().nullable().optional(),
  distinguishing_features: z.string().nullable().optional(),
  department_id: z.string().nullable().optional(),
  content_description: z.string().nullable().optional(),
  object_type: z.string().nullable().optional(),
  classifications: z.array(z.object({
    link_id: z.string().nullable().optional(),
    value_id: z.string().nullable().optional(),
    term: z.string().nullish(),
    value_key: z.string().nullish(),
  })).nullish(),
  object_status: z.string().default('active'),
  is_discoverable: z.boolean().nullable().optional().default(false),
  discoverable_at: z.string().nullable().optional(),

  // procedure identification
  other_numbers: z.array(z.object({
    type: z.string(),
    value: z.string(),
  })).nullish(),

  // procedure production (creators now via contacts join table)
  creation_date_display: z.string().nullable().optional(),
  creation_date_earliest: z.string().nullable().optional(),
  creation_date_latest: z.string().nullable().optional(),
  creation_place: z.string().nullable().optional(),
  creation_place_details: z.any().nullable().optional(),
  production_reason: z.string().nullable().optional(),
  production_note: z.string().nullable().optional(),

  // procedure physical description
  physical_description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  form: z.string().nullable().optional(),
  materials: z.array(z.object({
    name: z.string(),
    part: z.string().nullable().optional(),
    vocabulary_term_id: z.string().nullable().optional(),
  })).nullish(),
  techniques: z.array(z.object({
    name: z.string(),
    part: z.string().nullable().optional(),
    vocabulary_term_id: z.string().nullable().optional(),
  })).nullish(),
  measurements: z.array(z.object({
    dimension: z.string(),
    value: z.number(),
    unit: z.string(),
    part: z.string().nullable().optional(),
  })).nullish(),
  inscriptions: z.array(z.string()).nullish(),
  edition: z.string().nullable().optional(),
  copy_number: z.string().nullable().optional(),
  edition_size: z.number().nullable().optional(),
  edition_note: z.string().nullable().optional(),
  state_number: z.number().nullable().optional(),
  total_states: z.number().nullable().optional(),
  state_description: z.string().nullable().optional(),
  catalog_level: z.string().nullable().optional(),
  age: z.string().nullable().optional(),
  age_qualifier: z.string().nullable().optional(),
  age_unit: z.string().nullable().optional(),
  orientation: z.string().nullable().optional(),
  arrangement: z.string().nullable().optional(),
  installation_instructions: z.string().nullable().optional(),
  technical_attributes: z.any().nullable().optional(),
  facture_description: z.string().nullable().optional(),
  watermarks: z.any().nullable().optional(),
  components: z.any().nullable().optional(),
  condition_rating: z.string().nullable().optional(),  // derived from latest condition report
  condition_date: z.string().nullable().optional(),    // derived from latest condition report
  condition_note: z.string().nullable().optional(),
  completeness: z.string().nullable().optional(),
  completeness_note: z.string().nullable().optional(),
  conservation_priority: z.string().nullable().optional(),
  next_condition_check_date: z.string().nullable().optional(),
  hazards: z.any().nullable().optional(),
  environmental_requirements: z.any().nullable().optional(),
  salvage_priority: z.string().nullable().optional(),
  handling_requirements: z.string().nullable().optional(),

  // procedure subject
  subjects: z.array(z.object({
    term: z.string(),
    type: z.string().nullable().optional(),
    vocabulary_term_id: z.string().nullable().optional(),
  })).nullish(),

  // procedure associations
  associated_people: z.array(z.object({
    name: z.string(),
    role: z.string().nullable().optional(),
    vocabulary_term_id: z.string().nullable().optional(),
  })).nullish(),
  associated_places: z.array(z.object({
    name: z.string(),
    type: z.string().nullable().optional(),
    vocabulary_term_id: z.string().nullable().optional(),
  })).nullish(),

  // procedure history
  provenance: z.string().nullable().optional(),
  provenance_structured: z.any().nullable().optional(),
  exhibition_history: z.any().nullable().optional(),
  publication_history: z.any().nullable().optional(),
  object_history_note: z.string().nullable().optional(),
  usage: z.string().nullable().optional(),
  usage_note: z.string().nullable().optional(),
  associated_events: z.any().nullable().optional(),
  associated_organizations: z.any().nullable().optional(),
  associated_concepts: z.any().nullable().optional(),
  associated_cultural_affinity: z.string().nullable().optional(),
  association_note: z.string().nullable().optional(),

  // Archaeological context
  excavation_site: z.string().nullable().optional(),
  excavation_date: z.string().nullable().optional(),
  archaeological_context: z.any().nullable().optional(),
  field_collection_number: z.string().nullable().optional(),

  // procedure depicted
  depicted_people: z.any().nullable().optional(),
  depicted_organizations: z.any().nullable().optional(),
  depicted_places: z.any().nullable().optional(),
  depicted_events: z.any().nullable().optional(),
  depicted_objects: z.any().nullable().optional(),
  depicted_activities: z.any().nullable().optional(),
  depicted_concepts: z.any().nullable().optional(),

  // procedure acquisition
  acquisition_date: z.string().nullable().optional(),
  acquisition_method: z.string().nullable().optional(),
  acquisition_source: z.string().nullable().optional(),
  acquisition_source_type: z.string().nullable().optional(),
  acquisition_cost: z.number().nullable().optional(),
  acquisition_currency: z.string().nullable().optional(),
  acquisition_funding_source: z.string().nullable().optional(),
  acquisition_provisos: z.string().nullable().optional(),
  acquisition_reason: z.string().nullable().optional(),
  acquisition_note: z.string().nullable().optional(),
  credit_line: z.string().nullable().optional(),
  accession_date: z.string().nullable().optional(),

  // Valuation
  current_value: z.number().nullable().optional(),
  current_value_currency: z.string().nullable().optional(),
  current_value_date: z.string().nullable().optional(),
  insurance_value: z.number().nullable().optional(),
  insurance_value_currency: z.string().nullable().optional(),
  insurance_note: z.string().nullable().optional(),
  valuation_history: z.any().nullable().optional(),

  // Location and inventory
  barcode: z.string().nullable().optional(),
  last_inventoried_date: z.string().nullable().optional(),
  last_inventoried_by: z.string().nullable().optional(),
  current_location_id: z.string().nullable().optional(),
  current_location_fitness: z.string().nullable().optional(),
  current_location_note: z.string().nullable().optional(),
  current_location_date: z.string().nullable().optional(),
  current_location: z.object({
    location_id: z.string(),
    name: z.string(),
    path: z.string().nullable().optional(),
    location_type: z.string(),
    on_display: z.boolean().nullable().optional(),
  }).nullable().optional(),
  home_location_id: z.string().nullable().optional(),
  home_location: z.object({
    location_id: z.string(),
    name: z.string(),
    path: z.string().nullable().optional(),
    location_type: z.string(),
  }).nullable().optional(),

  // Custom fields
  custom_fields: z.record(z.string(), z.any()).nullish(),

  // Constituent cross-references (from ConstituentXref)
  constituents: z.array(z.object({
    xref_id: z.string(),
    organization_id: z.string().optional(),
    entity_type: z.string().optional(),
    entity_id: z.string().optional(),
    constituent_id: z.string(),
    role: z.string(),
    role_qualifier: z.string().nullable().optional(),
    attribution_certainty: z.string().nullable().optional(),
    display_order: z.number(),
    display_name_override: z.string().nullable().optional(),
    start_date: z.string().nullable().optional(),
    end_date: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
    created_by: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
    updated_by: z.string().nullable().optional(),
    constituent: z.object({
      constituent_id: z.string(),
      organization_id: z.string(),
      constituent_type: z.string(),
      name: z.string(),
      email: z.string().nullable().optional(),
      phone: z.string().nullable().optional(),
    }).nullable().optional(),
  })).nullable().optional(),

  // Computed/aggregated creators (derived from contacts with creator role)
  creators: z.array(z.object({
    name: z.string(),
    role: z.string().nullable().optional(),
    attribution: z.string().nullable().optional(),
    authority_id: z.string().nullable().optional(),
    ulan_id: z.string().nullable().optional(),
  })).nullish(),

  // Metadata
  created_at: z.string(),
  updated_at: z.string(),
  created_by: z.string().nullable().optional(),
  updated_by: z.string().nullable().optional(),

  // Linked acquisition record (from acquisition_objects join)
  // Uses inline schema since AcquisitionSchema is defined later in the file
  acquisition: z.object({
    acquisition_id: z.string(),
    acquisition_number: z.string(),
    acquisition_method: z.string(),
    acquisition_date: z.string().nullable().optional(),
    source_name: z.string().nullable().optional(),
    source_type: z.string().nullable().optional(),
    funding_source: z.string().nullable().optional(),
    cost: z.number().nullable().optional(),
    cost_currency: z.string().nullable().optional(),
    legal_status: z.string().nullable().optional(),
    provisos: z.string().nullable().optional(),
    credit_line: z.string().nullable().optional(),
    accession_number: z.string().nullable().optional(),
    accession_date: z.string().nullable().optional(),
    accessioning_approved: z.boolean(),
    status: z.string(),
  }).nullable().optional(),

  // Parts (for multi-part objects like tea sets, armor)
  // Uses inline schema since ObjectPartSchema is defined later in the file
  parts: z.array(z.object({
    part_id: z.string(),
    organization_id: z.string(),
    object_id: z.string(),
    part_number: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    current_location_id: z.string().nullable().optional(),
    current_location_fitness: z.enum(['suitable', 'temporary', 'unsuitable']).nullable().optional(),
    current_location_note: z.string().nullable().optional(),
    current_location_date: z.string().nullable().optional(),
    current_location_name: z.string().nullable().optional(),
    current_location_path: z.string().nullable().optional(),
    current_location_on_display: z.boolean().nullable().optional(),
    home_location_id: z.string().nullable().optional(),
    home_location_name: z.string().nullable().optional(),
    home_location_path: z.string().nullable().optional(),
    barcode: z.string().nullable().optional(),
    display_order: z.number(),
    created_at: z.string().nullable().optional(),
    created_by: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
    updated_by: z.string().nullable().optional(),
  })).nullable().optional(),
  parts_count: z.number().nullable().optional(),

  // Counts from link tables (materials and techniques)
  material_count: z.number().nullable().optional(),
  technique_count: z.number().nullable().optional(),

  // Relationship link tables (populated in full serialization)
  style_periods: z.array(z.any()).nullable().optional(),
  person_authorities: z.array(z.any()).nullable().optional(),
  place_authorities: z.array(z.any()).nullable().optional(),
  related_objects: z.array(z.any()).nullable().optional(),
  relationship_count: z.number().nullable().optional(),
  citation_count: z.number().nullable().optional(),
  event_count: z.number().nullable().optional(),
  citations: z.array(z.any()).nullable().optional(),
});

export type CollectionObject = z.infer<typeof CollectionObjectSchema>;

// Collection Object list item (lighter schema for lists)
export const CollectionObjectListItemSchema = z.object({
  object_id: z.string(),
  object_number: z.string(),
  title: z.string().nullish(),
  titles: z.array(z.object({
    title: z.string(),
    title_type: z.string().nullish(),
    language: z.string().nullish(),
    is_preferred: z.boolean().nullable().optional(),
  })).nullish(),
  object_name: z.string().nullish(),
  brief_description: z.string().nullish(),
  object_type: z.string().nullish(),
  classification: z.string().nullish(),
  classifications: z.array(z.object({
    link_id: z.string().nullable().optional(),
    value_id: z.string().nullable().optional(),
    term: z.string().nullish(),
    value_key: z.string().nullish(),
  })).nullish(),
  object_status: z.string().nullish(),
  primary_image_url: z.string().nullish(),
  creation_date_display: z.string().nullish(),
  creators: z.array(z.object({
    name: z.string(),
    role: z.string().nullish(),
    attribution: z.string().nullish(),
  })).nullish(),
  current_location: z.object({
    location_id: z.string(),
    name: z.string(),
    path: z.string().nullable().optional(),
    location_type: z.string(),
    on_display: z.boolean().nullable().optional(),
  }).nullish(),
  updated_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  // Optional fields that may be included in list responses
  materials: z.array(z.object({
    name: z.string(),
  })).nullish(),
  creation_date: z.object({
    text: z.string().nullish(),
    earliest: z.string().nullish(),
    latest: z.string().nullish(),
  }).nullish(),
  person_authority_count: z.number().nullable().optional(),
});

export type CollectionObjectListItem = z.infer<typeof CollectionObjectListItemSchema>;

// Paginated Collection Objects response
export const PaginatedCollectionObjectsSchema = z.object({
  items: z.array(CollectionObjectListItemSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export type PaginatedCollectionObjects = z.infer<typeof PaginatedCollectionObjectsSchema>;

// Location schema
// Define the base schema without children first to avoid circular reference
const LocationBaseSchema = z.object({
  location_id: z.string(),
  organization_id: z.string(),
  parent_id: z.string().nullable().optional(),
  path: z.string().nullable().optional(),
  depth: z.number().nullable().optional(),
  name: z.string(),
  code: z.string().nullable().optional(),
  barcode: z.string().nullable().optional(),
  location_type: z.enum(['building', 'floor', 'room', 'case', 'shelf', 'drawer', 'other']),
  is_external: z.boolean().nullable().optional(),
  on_display: z.boolean().nullable().optional(),
  capacity: z.number().nullable().optional(),
  current_count: z.number().nullable().optional(),
  climate_controlled: z.boolean().nullable().optional(),
  default_fitness: z.string().nullable().optional(),
  condition: z.string().nullable().optional(),
  security_level: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string().nullable().optional(),
});

// Define the Location type with recursive children
export type Location = z.infer<typeof LocationBaseSchema> & {
  children?: Location[];
};

// Full LocationSchema with lazy children reference
export const LocationSchema: z.ZodType<Location> = LocationBaseSchema.extend({
  children: z.lazy(() => z.array(LocationSchema)).optional(),
});

// Movement schema
export const MovementSchema = z.object({
  movement_id: z.string(),
  organization_id: z.string(),
  movement_reference_number: z.string().nullable().optional(),
  object_id: z.string(),
  object_number: z.string().nullable().optional(),
  object_title: z.string().nullable().optional(),
  from_location_id: z.string().nullable().optional(),
  from_location_name: z.string().nullable().optional(),
  from_location_path: z.string().nullable().optional(),
  to_location_id: z.string(),
  to_location_name: z.string().nullable().optional(),
  to_location_path: z.string().nullable().optional(),
  location_fitness: z.string().nullable().optional(),
  movement_date: z.string().nullable().optional(),
  planned_removal_date: z.string().nullable().optional(),
  removal_date: z.string().nullable().optional(),
  planned_return_date: z.string().nullable().optional(),
  reason: z.string(),
  movement_note: z.string().nullable().optional(),
  reference_type: z.string().nullable().optional(),
  reference_id: z.string().nullable().optional(),
  authorized_by: z.string().nullable().optional(),
  authorizer_id: z.string().nullable().optional(),
  authorizer_name: z.string().nullable().optional(),
  authorization_date: z.string().nullable().optional(),
  authorization_note: z.string().nullable().optional(),
  movement_contact: z.string().nullable().optional(),
  movement_method: z.string().nullable().optional(),
  moved_by: z.string().nullable().optional(),
  moved_by_name: z.string().nullable().optional(),
  handler_id: z.string().nullable().optional(),
  handler_name: z.string().nullable().optional(),
  organization_courier: z.boolean().nullable().optional(),
  courier_name: z.string().nullable().optional(),
  shipper_id: z.string().nullable().optional(),
  shipper_name: z.string().nullable().optional(),
  shipping_method: z.string().nullable().optional(),
  shipping_tracking_number: z.string().nullable().optional(),
  shipping_insurance_value: z.string().nullable().optional(),
  shipping_insurance_currency: z.string().nullable().optional(),
  shipping_note: z.string().nullable().optional(),
  condition_note: z.string().nullable().optional(),
  condition_report_id: z.string().nullable().optional(),
  status: z.enum(['pending', 'in_transit', 'completed', 'cancelled']),
  created_at: z.string(),
  created_by: z.string().nullable().optional(),
  // Part info (for multi-part objects)
  part_id: z.string().nullable().optional(),
  part_number: z.string().nullable().optional(),
  part_name: z.string().nullable().optional(),
});

export type Movement = z.infer<typeof MovementSchema>;

// Object Part - part-level location tracking
export const ObjectPartSchema = z.object({
  part_id: z.string(),
  organization_id: z.string(),
  object_id: z.string(),
  part_number: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  current_location_id: z.string().nullable().optional(),
  current_location_fitness: z.enum(['suitable', 'temporary', 'unsuitable']).nullable().optional(),
  current_location_note: z.string().nullable().optional(),
  current_location_date: z.string().nullable().optional(),
  current_location_name: z.string().nullable().optional(),
  current_location_path: z.string().nullable().optional(),
  current_location_on_display: z.boolean().nullable().optional(),
  home_location_id: z.string().nullable().optional(),
  home_location_name: z.string().nullable().optional(),
  home_location_path: z.string().nullable().optional(),
  barcode: z.string().nullable().optional(),
  display_order: z.number(),
  created_at: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  updated_by: z.string().nullable().optional(),
});

export type ObjectPart = z.infer<typeof ObjectPartSchema>;

// NAGPRA (Native American Graves Protection and Repatriation Act) schemas
export const NagpraActionSchema = z.object({
  action_id: z.string(),
  organization_id: z.string(),
  object_id: z.string(),
  action_number: z.string(),
  group_reference: z.string().nullable().optional(),
  origin_type: z.string(),
  nagpra_category: z.string(),
  funerary_association: z.string().nullable().optional(),
  category_basis: z.string().nullable().optional(),
  category_determined_date: z.string().nullable().optional(),
  category_determined_by: z.string().nullable().optional(),
  geographic_origin: z.string().nullable().optional(),
  site_name: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  county: z.string().nullable().optional(),
  affiliation_status: z.string(),
  affiliated_party_id: z.string().nullable().optional(),
  affiliation_basis: z.string().nullable().optional(),
  affiliation_evidence_types: z.array(z.string()).nullable().optional(),
  affiliation_determined_date: z.string().nullable().optional(),
  display_consent: z.string(),
  display_consent_date: z.string().nullable().optional(),
  access_consent: z.string(),
  access_consent_date: z.string().nullable().optional(),
  research_consent: z.string(),
  research_consent_date: z.string().nullable().optional(),
  handling_preferences: z.string().nullable().optional(),
  storage_preferences: z.string().nullable().optional(),
  hold_active: z.boolean(),
  notice_type: z.string().nullable().optional(),
  notice_submitted_date: z.string().nullable().optional(),
  notice_published_date: z.string().nullable().optional(),
  notice_fr_citation: z.string().nullable().optional(),
  waiting_period_end_date: z.string().nullable().optional(),
  transfer_date: z.string().nullable().optional(),
  transfer_recipient_id: z.string().nullable().optional(),
  transfer_method: z.string().nullable().optional(),
  transfer_note: z.string().nullable().optional(),
  deaccession_id: z.string().nullable().optional(),
  coordinator_id: z.string().nullable().optional(),
  identified_date: z.string().nullable().optional(),
  consultation_initiated_date: z.string().nullable().optional(),
  closed_date: z.string().nullable().optional(),
  inventory_deadline: z.string().nullable().optional(),
  status: z.string(),
  action_note: z.string().nullable().optional(),
  internal_note: z.string().nullable().optional(),
  created_at: z.string(),
  created_by: z.string().nullable().optional(),
  updated_at: z.string(),
  updated_by: z.string().nullable().optional(),
});

export type NagpraAction = z.infer<typeof NagpraActionSchema>;

export const NagpraConsultationEventSchema = z.object({
  event_id: z.string(),
  action_id: z.string(),
  organization_id: z.string(),
  consulting_party_id: z.string().nullable().optional(),
  consulting_party_name: z.string().nullable().optional(),
  event_date: z.string(),
  event_type: z.string(),
  direction: z.string(),
  subject: z.string(),
  description: z.string().nullable().optional(),
  participants: z.array(z.string()).nullable().optional(),
  outcomes: z.string().nullable().optional(),
  follow_up_required: z.boolean(),
  follow_up_date: z.string().nullable().optional(),
  follow_up_note: z.string().nullable().optional(),
  document_references: z.array(z.record(z.string(), z.any())).nullable().optional(),
  recorded_by: z.string().nullable().optional(),
  created_at: z.string(),
});

export type NagpraConsultationEvent = z.infer<typeof NagpraConsultationEventSchema>;

// Collections Search schemas (OpenSearch integration)
export const CollectionsSearchFiltersSchema = z.object({
  object_type: z.array(z.string()).nullable().optional(),
  classification: z.array(z.string()).nullable().optional(),
  object_status: z.array(z.string()).nullable().optional(),
  location_id: z.array(z.string()).nullable().optional(),
  on_display: z.boolean().nullable().optional(),
  creator_name: z.string().nullable().optional(),
  material: z.string().nullable().optional(),
  technique: z.string().nullable().optional(),
  date_from: z.string().nullable().optional(),
  date_to: z.string().nullable().optional(),
  acquisition_method: z.string().nullable().optional(),
  condition_rating: z.array(z.string()).nullable().optional(),
  is_discoverable: z.boolean().nullable().optional(),
  // Relationship-based filters ("Find objects that...")
  has_active_loan: z.boolean().nullable().optional(),
  has_conservation: z.boolean().nullable().optional(),
  has_relationships: z.boolean().nullable().optional(),
  has_contacts: z.boolean().nullable().optional(),
  has_images: z.boolean().nullable().optional(),
  // "Needs attention" filters
  missing_location: z.boolean().nullable().optional(),
  missing_images: z.boolean().nullable().optional(),
  missing_rights: z.boolean().nullable().optional(),
  needs_valuation: z.boolean().nullable().optional(),
});

export type CollectionsSearchFilters = z.infer<typeof CollectionsSearchFiltersSchema>;

export const CollectionsAdvancedCriterionSchema = z.object({
  field: z.enum([
    'title', 'object_number', 'object_name', 'description',
    'creator', 'material', 'technique', 'subject',
    'place', 'inscription', 'provenance', 'classification',
    'credit_line', 'any',
  ]),
  operator: z.enum(['contains', 'equals', 'starts_with', 'not_contains']),
  value: z.string(),
});

export type CollectionsAdvancedCriterion = z.infer<typeof CollectionsAdvancedCriterionSchema>;

export const CollectionsSearchRequestSchema = z.object({
  query: z.object({
    q: z.string().nullable().optional(),
    fields: z.array(z.string()).nullable().optional(),
  }).nullable().optional(),
  filters: CollectionsSearchFiltersSchema.nullable().optional(),
  sort: z.object({
    field: z.string(),
    order: z.enum(['asc', 'desc']),
  }).nullable().optional(),
  advanced_criteria: z.array(CollectionsAdvancedCriterionSchema).nullable().optional(),
  advanced_operator: z.enum(['and', 'or']).nullable().optional(),
  limit: z.number().nullable().optional(),
  offset: z.number().nullable().optional(),
  include_facets: z.boolean().nullable().optional(),
  facet_size: z.number().nullable().optional(),
  highlight: z.boolean().nullable().optional(),
});

export type CollectionsSearchRequest = z.infer<typeof CollectionsSearchRequestSchema>;

export const CollectionsSearchHitSchema = z.object({
  object_id: z.string(),
  object_number: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  object_name: z.string().nullable().optional(),
  brief_description: z.string().nullable().optional(),
  object_type: z.string().nullable().optional(),
  classification: z.string().nullable().optional(),
  object_status: z.string().nullable().optional(),
  is_discoverable: z.boolean().nullish(),
  primary_image_url: z.string().nullish(),
  creation_date_display: z.string().nullish(),
  creators: z.array(z.object({
    name: z.string(),
    role: z.string().nullable().optional(),
  })).nullable().optional(),
  materials: z.array(z.object({
    name: z.string(),
  })).nullable().optional(),
  creation_date: z.object({
    text: z.string().nullish(),
    earliest: z.string().nullish(),
    latest: z.string().nullish(),
  }).nullish(),
  current_location: z.object({
    name: z.string(),
  }).nullable().optional(),
  score: z.number().nullable().optional(),
  highlights: z.record(z.string(), z.array(z.string())).nullable().optional(),
  // Additional search result fields from OpenSearch transformer
  person_authority_count: z.number().nullable().optional(),
  associated_people: z.array(z.object({
    name: z.string(),
    role: z.string().nullable().optional(),
  })).nullable().optional(),
  image_count: z.number().nullable().optional(),
  has_rights: z.boolean().nullable().optional(),
  active_procedures_count: z.number().nullable().optional(),
});

export type CollectionsSearchHit = z.infer<typeof CollectionsSearchHitSchema>;

export const FacetBucketSchema = z.object({
  key: z.string(),
  doc_count: z.number(),
  label: z.string().nullable().optional(),
});

export const FacetSchema = z.object({
  field: z.string(),
  buckets: z.array(FacetBucketSchema),
});

export type Facet = z.infer<typeof FacetSchema>;

export const CollectionsSearchResponseSchema = z.object({
  hits: z.array(CollectionsSearchHitSchema),
  total: z.number(),
  facets: z.array(FacetSchema).nullable().optional(),
  took_ms: z.number(),
  next_offset: z.number().nullable().optional(),
});

export type CollectionsSearchResponse = z.infer<typeof CollectionsSearchResponseSchema>;

// ============================================================================
// CDWA OBJECT RELATIONSHIPS SCHEMA (CDWA Category 20)
// ============================================================================

export const ObjectRelationshipTypeSchema = z.enum([
  'study_for', 'copy_of', 'part_of', 'pendant_of', 'version_of',
  'derived_from', 'model_for', 'preparatory_for', 'related_to',
  'after', 'based_on', 'replica_of'
]);
export type ObjectRelationshipType = z.infer<typeof ObjectRelationshipTypeSchema>;

export const ObjectRelationshipSchema = z.object({
  relationship_id: z.string(),
  organization_id: z.string(),
  source_object_id: z.string(),
  related_object_id: z.string().nullable().optional(),
  external_work_title: z.string().nullable().optional(),
  external_work_creator: z.string().nullable().optional(),
  external_work_date: z.string().nullable().optional(),
  external_work_location: z.string().nullable().optional(),
  external_work_identifier: z.string().nullable().optional(),
  external_work_thumbnail_url: z.string().nullable().optional(),
  related_object_summary: z.object({
    title: z.string().nullable().optional(),
    object_number: z.string().nullable().optional(),
    object_type: z.string().nullable().optional(),
    creation_date: z.string().nullable().optional(),
    thumbnail_url: z.string().nullable().optional(),
  }).nullable().optional(),
  relationship_type: z.string(),
  relationship_direction: z.string().nullable().optional(),
  sequence_number: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
});

export type ObjectRelationship = z.infer<typeof ObjectRelationshipSchema>;

export const ObjectRelationshipsResponseSchema = z.object({
  outgoing: z.array(ObjectRelationshipSchema),
  incoming: z.array(ObjectRelationshipSchema),
});

export type ObjectRelationshipsResponse = z.infer<typeof ObjectRelationshipsResponseSchema>;

// ============================================================================
// CDWA EXTENDED AUTHORITIES - Context, Critical Response, Cataloging, Watermark
// ============================================================================

// Critical Response (CDWA 19)
export const DocumentTypeEnum = z.enum([
  'essay', 'review', 'catalog_entry', 'diary', 'letter',
  'lecture', 'interview', 'article', 'book', 'other'
]);
export type DocumentType = z.infer<typeof DocumentTypeEnum>;

export const CriticalResponseSchema = z.object({
  response_id: z.string(),
  organization_id: z.string(),
  object_id: z.string(),
  comment_text: z.string(),
  comment_summary: z.string().nullable().optional(),
  document_type: DocumentTypeEnum,
  author_name: z.string().nullable().optional(),
  author_authority_id: z.string().nullable().optional(),
  comment_date_display: z.string().nullable().optional(),
  comment_date_earliest: z.string().nullable().optional(),
  comment_date_latest: z.string().nullable().optional(),
  circumstances: z.string().nullable().optional(),
  publication_info: z.string().nullable().optional(),
  citation_id: z.string().nullable().optional(),
  source_page: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});

export type CriticalResponse = z.infer<typeof CriticalResponseSchema>;

export const CriticalResponsesListSchema = z.object({
  critical_responses: z.array(CriticalResponseSchema),
});

export type CriticalResponsesList = z.infer<typeof CriticalResponsesListSchema>;

// Cataloging History (CDWA 25)
export const RecordTypeEnum = z.enum([
  'initial', 'update', 'revision', 'migration', 'merge', 'split'
]);
export type RecordType = z.infer<typeof RecordTypeEnum>;

export const CatalogingHistorySchema = z.object({
  history_id: z.string(),
  organization_id: z.string(),
  object_id: z.string(),
  cataloger_name: z.string().nullable().optional(),
  cataloger_id: z.string().nullable().optional(),
  institution: z.string().nullable().optional(),
  catalog_date: z.string().nullable().optional(),
  catalog_language: z.string().nullable().optional(),
  record_type: RecordTypeEnum,
  fields_modified: z.array(z.string()).nullable().optional(),
  change_summary: z.string().nullable().optional(),
  previous_values: z.record(z.string(), z.any()).nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
});

export type CatalogingHistory = z.infer<typeof CatalogingHistorySchema>;

export const CatalogingHistoryListSchema = z.object({
  cataloging_history: z.array(CatalogingHistorySchema),
});

export type CatalogingHistoryList = z.infer<typeof CatalogingHistoryListSchema>;

// Object Context (CDWA 17)
export const ContextTypeEnum = z.enum([
  'architectural', 'historical_location', 'event', 'archaeological', 'original_site'
]);
export type ContextType = z.infer<typeof ContextTypeEnum>;

export const ObjectContextSchema = z.object({
  context_id: z.string(),
  organization_id: z.string(),
  object_id: z.string(),
  context_type: ContextTypeEnum,
  building_name: z.string().nullable().optional(),
  site_name: z.string().nullable().optional(),
  part_placement: z.string().nullable().optional(),
  architectural_date_display: z.string().nullable().optional(),
  architectural_date_earliest: z.string().nullable().optional(),
  architectural_date_latest: z.string().nullable().optional(),
  historical_place_id: z.string().nullable().optional(),
  historical_date_display: z.string().nullable().optional(),
  historical_date_earliest: z.string().nullable().optional(),
  historical_date_latest: z.string().nullable().optional(),
  event_id: z.string().nullable().optional(),
  event_description: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  display_order: z.number(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});

export type ObjectContext = z.infer<typeof ObjectContextSchema>;

export const ObjectContextsListSchema = z.object({
  contexts: z.array(ObjectContextSchema),
});

export type ObjectContextsList = z.infer<typeof ObjectContextsListSchema>;

// Watermark Schema (for CollectionObject.watermarks field)
export const WatermarkSchema = z.object({
  identification: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  date_earliest: z.string().nullable().optional(),
  date_latest: z.string().nullable().optional(),
  briquet_number: z.string().nullable().optional(),
  location_on_work: z.string().nullable().optional(),
});

export type Watermark = z.infer<typeof WatermarkSchema>;

// ============================================================================
// EVENTS - Museum Programming Activities
// ============================================================================

export const EventTypeEnum = z.enum([
  'teaching_session',
  'program',
  'opening_reception',
  'donor_development',
  'internal',
]);
export type EventType = z.infer<typeof EventTypeEnum>;

export const EventStatusEnum = z.enum(['draft', 'scheduled', 'completed', 'cancelled']);
export type EventStatus = z.infer<typeof EventStatusEnum>;

export const EventObjectRoleEnum = z.enum(['primary', 'supporting', 'reference']);
export type EventObjectRole = z.infer<typeof EventObjectRoleEnum>;

export const EventPlannedUseEnum = z.enum(['display', 'discuss', 'handle', 'photograph', 'record']);
export type EventPlannedUse = z.infer<typeof EventPlannedUseEnum>;

export const SessionFormatEnum = z.enum(['gallery', 'study_room', 'handling_session']);
export type SessionFormat = z.infer<typeof SessionFormatEnum>;

export const EventAudienceEnum = z.enum(['public', 'members', 'internal']);
export type EventAudience = z.infer<typeof EventAudienceEnum>;

export const EventSchema = z.object({
  event_id: z.string(),
  organization_id: z.string(),
  event_reference_number: z.string(),
  title: z.string(),
  event_type: EventTypeEnum,
  status: EventStatusEnum,
  start_at: z.string().nullable().optional(),
  end_at: z.string().nullable().optional(),
  location_id: z.string().nullable().optional(),
  location_name: z.string().nullable().optional(),
  location_path: z.string().nullable().optional(),
  owner_user_id: z.string().nullable().optional(),
  owner_name: z.string().nullable().optional(),
  // Teaching fields
  course_code: z.string().nullable().optional(),
  instructor_id: z.string().nullable().optional(),
  instructor_name: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
  institution: z.string().nullable().optional(),
  headcount: z.number().nullable().optional(),
  session_format: SessionFormatEnum.nullable().optional(),
  // Program fields
  audience: EventAudienceEnum.nullable().optional(),
  capacity: z.number().nullable().optional(),
  registration_url: z.string().nullable().optional(),
  // General
  description: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  // Counts
  object_count: z.number().nullable().optional(),
  participant_count: z.number().nullable().optional(),
  // Audit
  created_at: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  updated_by: z.string().nullable().optional(),
  // Nested data (when fetching full event)
  object_links: z.array(z.any()).nullable().optional(),
  participants: z.array(z.any()).nullable().optional(),
});

export type Event = z.infer<typeof EventSchema>;

export const PaginatedEventsSchema = z.object({
  items: z.array(EventSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export type PaginatedEvents = z.infer<typeof PaginatedEventsSchema>;

export const EventObjectLinkSchema = z.object({
  event_object_id: z.string(),
  organization_id: z.string(),
  event_id: z.string(),
  object_id: z.string(),
  role: EventObjectRoleEnum,
  planned_use: EventPlannedUseEnum,
  requirements: z.record(z.string(), z.any()).nullable().optional(),
  notes: z.string().nullable().optional(),
  display_order: z.number(),
  created_at: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  object: z.object({
    object_id: z.string(),
    object_number: z.string(),
    title: z.string().nullable().optional(),
    object_name: z.string().nullable().optional(),
    object_status: z.string().nullable().optional(),
    current_location_id: z.string().nullable().optional(),
    current_location_name: z.string().nullable().optional(),
  }).nullable().optional(),
});

export type EventObjectLink = z.infer<typeof EventObjectLinkSchema>;

export const EventObjectLinksResponseSchema = z.object({
  objects: z.array(EventObjectLinkSchema),
  total: z.number(),
});

export type EventObjectLinksResponse = z.infer<typeof EventObjectLinksResponseSchema>;

export const EventParticipantSchema = z.object({
  participant_id: z.string(),
  organization_id: z.string(),
  event_id: z.string(),
  contact_id: z.string(),
  role: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  contact: z.object({
    contact_id: z.string(),
    display_name: z.string(),
    contact_type: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
  }).nullable().optional(),
});

export type EventParticipant = z.infer<typeof EventParticipantSchema>;

export const EventParticipantsResponseSchema = z.object({
  participants: z.array(EventParticipantSchema),
  total: z.number(),
});

export type EventParticipantsResponse = z.infer<typeof EventParticipantsResponseSchema>;

export const CollectionsImpactSchema = z.object({
  needs_movement_plan: z.boolean(),
  needs_condition_checks: z.boolean(),
  needs_rights_verification: z.boolean(),
  objects_needing_movement: z.array(z.object({
    object_id: z.string(),
    object_number: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    planned_use: z.string(),
    role: z.string(),
  })),
  objects_needing_condition_check: z.array(z.object({
    object_id: z.string(),
    object_number: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    planned_use: z.string(),
    role: z.string(),
  })),
  objects_needing_rights_check: z.array(z.object({
    object_id: z.string(),
    object_number: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    planned_use: z.string(),
    role: z.string(),
  })),
  event_status: z.string(),
  total_objects: z.number(),
});

export type CollectionsImpact = z.infer<typeof CollectionsImpactSchema>;

export const ObjectEventsResponseSchema = z.object({
  events: z.array(EventSchema.extend({
    link: z.object({
      event_object_id: z.string(),
      role: z.string(),
      planned_use: z.string(),
      notes: z.string().nullable().optional(),
    }),
  })),
  total: z.number(),
});

export type ObjectEventsResponse = z.infer<typeof ObjectEventsResponseSchema>;

// ============================================================================
// TASKS (My Tasks feature)
// ============================================================================

export const TaskStatusEnum = z.enum(['todo', 'in_progress', 'blocked', 'done']);
export type TaskStatus = z.infer<typeof TaskStatusEnum>;

export const TaskPriorityEnum = z.enum(['low', 'normal', 'high', 'urgent']);
export type TaskPriority = z.infer<typeof TaskPriorityEnum>;

export const RelatedEntityTypeEnum = z.enum([
  'exhibition', 'collection_object', 'condition_report',
  'loan_in', 'loan_out', 'acquisition', 'conservation', 'media',
  'object_entry', 'constituent'
]);
export type RelatedEntityType = z.infer<typeof RelatedEntityTypeEnum>;

export const TaskSchema = z.object({
  task_id: z.string(),
  organization_id: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  status: TaskStatusEnum,
  status_label: z.string(),
  priority: TaskPriorityEnum,
  priority_label: z.string(),
  assigned_user_id: z.string().nullable().optional(),
  assigned_user_name: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  created_by_name: z.string().nullable().optional(),
  completed_by: z.string().nullable().optional(),
  app_context: z.string().nullable().optional(),
  related_entity_type: z.string().nullable().optional(),
  related_entity_id: z.string().nullable().optional(),
  related_entity_label: z.string().nullable().optional(),
});

export type Task = z.infer<typeof TaskSchema>;

export const PaginatedTasksSchema = z.object({
  items: z.array(TaskSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export type PaginatedTasks = z.infer<typeof PaginatedTasksSchema>;

export const TaskEnumsSchema = z.object({
  statuses: z.array(z.object({ value: z.string(), label: z.string() })),
  priorities: z.array(z.object({ value: z.string(), label: z.string() })),
  related_entity_types: z.array(z.string()),
});

export type TaskEnums = z.infer<typeof TaskEnumsSchema>;

// ============================================================================
// DISCOVER / GALLERY SCHEMAS
// ============================================================================

export const DiscoverCollectionInfoSchema = z.object({
  organization_name: z.string(),
  organization_slug: z.string(),
  total_discoverable: z.number(),
  hero_image_url: z.string().nullable().optional(),
  page_title: z.string().nullable().optional(),
  page_subtitle: z.string().nullable().optional(),
  show_object_count: z.boolean(),
  default_view_mode: z.enum(['grid', 'list']),
  default_sort: z.string(),
}).passthrough();

export const DiscoverHitSchema = z.object({
  object_id: z.string(),
  object_number: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  brief_description: z.string().nullable().optional(),
  creators: z.array(z.string()),
  creation_date_display: z.string().nullable().optional(),
  classification: z.string().nullable().optional(),
  object_type: z.string().nullable().optional(),
  thumbnail_url: z.string().nullable().optional(),
  has_image: z.boolean(),
}).passthrough();

export const DiscoverSearchResponseSchema = z.object({
  hits: z.array(DiscoverHitSchema),
  total: z.number(),
  facets: z.array(z.object({ field: z.string(), buckets: z.array(z.object({ key: z.string(), count: z.number() })) })).nullable().optional(),
  next_offset: z.number().nullable().optional(),
}).passthrough();

export const DiscoverObjectDetailSchema = z.object({
  object_id: z.string(),
  object_number: z.string(),
  canonical_url: z.string(),
  title: z.string().nullable().optional(),
  object_type: z.string().nullable().optional(),
  classification: z.string().nullable().optional(),
  creators: z.array(z.string()),
  media: z.array(z.object({}).passthrough()),
  has_image: z.boolean(),
}).passthrough();

export const DiscoverConfigSchema = z.object({
  hero_media_id: z.string().nullable().optional(),
  page_title: z.string().nullable().optional(),
  page_subtitle: z.string().nullable().optional(),
  show_object_count: z.boolean(),
  default_view_mode: z.enum(['grid', 'list']),
  default_sort: z.string(),
}).passthrough();

export const DiscoverStatsSchema = z.object({
  total_objects: z.number(),
  discoverable_count: z.number(),
  private_count: z.number(),
  pending_schedules: z.number(),
}).passthrough();

export const DiscoverPreviewResultSchema = DiscoverObjectDetailSchema.extend({
  is_currently_discoverable: z.boolean(),
  unpublished_media_count: z.number(),
  preview_warnings: z.array(z.string()),
}).passthrough();

export const PublishScheduleSchema = z.object({
  schedule_id: z.string(),
  action: z.enum(['publish', 'unpublish']),
  scheduled_for: z.string(),
  status: z.enum(['pending', 'executed', 'cancelled', 'failed']),
  created_at: z.string(),
}).passthrough();

export const ToggleDiscoverableResponseSchema = z.object({
  object_id: z.string(),
  is_discoverable: z.boolean(),
  discoverable_at: z.string().nullable().optional(),
}).passthrough();

export const BulkToggleDiscoverableResponseSchema = z.object({
  updated: z.number(),
  is_discoverable: z.boolean(),
  skipped: z.array(z.object({
    object_id: z.string(),
    reason: z.string(),
  })).optional(),
}).passthrough();

export const PublishByCriteriaResponseSchema = z.object({}).passthrough();

export const PublicEventSchema = z.object({
  event_id: z.string(),
  title: z.string(),
  event_type: z.string(),
  status: z.string(),
  start_at: z.string().nullable().optional(),
  end_at: z.string().nullable().optional(),
}).passthrough();

export const PublicStaffMemberSchema = z.object({
  constituent_id: z.string(),
  name: z.string(),
}).passthrough();

export const PublicVenueSchema = z.object({
  venue_id: z.string(),
  name: z.string(),
}).passthrough();

export const DiscoverRelatedHitSchema = z.object({
  object_id: z.string(),
  object_number: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  creators: z.array(z.string()),
}).passthrough();

// ============================================================================
// CONTENT CMS SCHEMAS
// ============================================================================

export const ContentBlockSchema = z.object({
  block_id: z.string(),
  block_type: z.string(),
  content: z.record(z.string(), z.unknown()),
  sort_order: z.number(),
}).passthrough();

export const ContentPageSchema = z.object({
  page_id: z.string(),
  slug: z.string(),
  title: z.string(),
  page_type: z.string(),
  status: z.string(),
  published_at: z.string().nullable().optional(),
  sort_order: z.number(),
}).passthrough();

export const ContentCategorySchema = z.object({
  category_id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable().optional(),
  sort_order: z.number(),
}).passthrough();

export const ContentMenuSchema = z.object({
  location: z.string(),
  name: z.string(),
  items: z.array(z.object({}).passthrough()),
}).passthrough();

export const PageTreeNodeSchema = z.object({
  page_id: z.string(),
  slug: z.string(),
  title: z.string(),
  status: z.string(),
  sort_order: z.number(),
  depth: z.number(),
  children: z.array(z.lazy((): z.ZodTypeAny => PageTreeNodeSchema)),
}).passthrough();

export const ContentRedirectSchema = z.object({
  redirect_id: z.string(),
  source_path: z.string(),
  target_path: z.string(),
  redirect_type: z.number(),
  is_active: z.boolean(),
}).passthrough();
