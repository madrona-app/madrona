import { z } from 'zod';

// ============================================================================
// CANONICAL PAYLOAD ENVELOPE VALIDATION
// ============================================================================
// These schemas validate the canonical envelope structure for entity payloads.
// The envelope validation is lenient enough for legacy records while still
// providing runtime type safety for the canonical structure.

/**
 * Allowed top-level keys in a canonical payload.
 * Any other keys indicate source-specific data leakage.
 */
export const CANONICAL_ALLOWED_KEYS = new Set([
  'id', 'type', 'label', 'provenance', 'meta',
  'description', 'status',
  'identifiers', 'classifications', 'properties',
  'relationships', 'media', 'rights', 'extensions',
]);

/**
 * Lenient provenance schema for envelope validation.
 * Only validates presence of source coordinates, not full details.
 */
export const ProvenanceEnvelopeSchema = z.object({
  source: z.object({
    system: z.string(),
    recordId: z.string(),
  }).nullable().optional(),
  // Alternative flat structure (legacy)
  system: z.string().nullable().optional(),
  recordId: z.string().nullable().optional(),
  ingestedAt: z.string().nullable().optional(),
  migrationRequired: z.boolean().nullable().optional(),
}).passthrough();

/**
 * Lenient meta schema for envelope validation.
 * Detects schema version and validation status.
 */
export const MetaEnvelopeSchema = z.object({
  schemaVersion: z.string().nullable().optional(),
  validationStatus: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
}).passthrough();

/**
 * Canonical payload envelope schema.
 * Validates the expected structure while being lenient on details.
 * This enables detecting legacy records and unknown keys at runtime.
 */
export const CanonicalPayloadEnvelopeSchema = z.object({
  // Required fields
  id: z.string(),
  type: z.string(),
  label: z.string(),
  // Provenance and meta are required but can have flexible structure
  provenance: ProvenanceEnvelopeSchema.nullable().optional(),
  meta: MetaEnvelopeSchema.nullable().optional(),
  // Optional standard fields
  description: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  identifiers: z.array(z.object({
    scheme: z.string(),
    value: z.string(),
  })).nullable().optional(),
  classifications: z.array(z.any()).nullable().optional(),
  properties: z.record(z.string(), z.any()).nullable().optional(),
  relationships: z.array(z.any()).nullable().optional(),
  media: z.array(z.any()).nullable().optional(),
  rights: z.any().nullable().optional(),
  extensions: z.array(z.any()).nullable().optional(),
}).passthrough(); // Allow extra keys for detection

export type CanonicalPayloadEnvelope = z.infer<typeof CanonicalPayloadEnvelopeSchema>;

/**
 * Result of canonical payload validation.
 */
export interface CanonicalPayloadValidation {
  isValid: boolean;
  isLegacy: boolean;
  unknownKeys: string[];
  warnings: string[];
  errors: string[];
}

/**
 * Validate a payload against the canonical envelope schema.
 * Returns detailed validation results including legacy detection and unknown keys.
 *
 * @param payload - The payload to validate
 * @returns Validation result with legacy status and warnings
 *
 * @example
 * ```typescript
 * const result = validateCanonicalPayload(entity.payload);
 * if (result.isLegacy) {
 *   console.warn('Legacy payload - migration recommended');
 * }
 * if (result.unknownKeys.length > 0) {
 *   console.warn('Unknown keys detected:', result.unknownKeys);
 * }
 * ```
 */
export function validateCanonicalPayload(payload: unknown): CanonicalPayloadValidation {
  const warnings: string[] = [];
  const errors: string[] = [];

  // Handle non-object payloads
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      isValid: false,
      isLegacy: true,
      unknownKeys: [],
      warnings: [],
      errors: ['Payload is not an object'],
    };
  }

  const data = payload as Record<string, unknown>;

  // Detect unknown top-level keys
  const unknownKeys = Object.keys(data).filter(key => !CANONICAL_ALLOWED_KEYS.has(key));
  if (unknownKeys.length > 0) {
    warnings.push(`Unknown top-level keys detected: ${unknownKeys.join(', ')}`);
  }

  // Detect legacy payload
  const meta = data.meta as Record<string, unknown> | undefined;
  const isLegacy = meta?.schemaVersion === 'legacy' ||
                   meta?.validationStatus === 'legacy' ||
                   !data.provenance ||
                   !data.meta;

  if (isLegacy) {
    warnings.push('Legacy payload format - migration recommended');
  }

  // Try envelope validation
  const result = CanonicalPayloadEnvelopeSchema.safeParse(data);
  if (!result.success) {
    // Extract key issues
    const issues = result.error.issues;
    for (const issue of issues) {
      if (issue.code === 'invalid_type' && issue.path.length === 1) {
        errors.push(`Missing required field: ${String(issue.path[0])}`);
      }
    }

    return {
      isValid: false,
      isLegacy,
      unknownKeys,
      warnings,
      errors: errors.length > 0 ? errors : ['Envelope validation failed'],
    };
  }

  return {
    isValid: true,
    isLegacy,
    unknownKeys,
    warnings,
    errors: [],
  };
}

/**
 * Check if a payload is in canonical format (vs legacy pass-through).
 * This is a quick check, not full validation.
 */
export function isCanonicalPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }

  const data = payload as Record<string, unknown>;

  // Check for required canonical fields
  if (typeof data.id !== 'string' ||
      typeof data.type !== 'string' ||
      typeof data.label !== 'string') {
    return false;
  }

  // Check for provenance and meta (can be legacy format)
  if (!data.provenance || !data.meta) {
    return false;
  }

  // Check meta.schemaVersion isn't "legacy"
  const meta = data.meta as Record<string, unknown>;
  if (meta.schemaVersion === 'legacy') {
    return false;
  }

  return true;
}

// ============================================================================
// STANDARD API SCHEMAS
// ============================================================================

// Run status enum
export const RunStatusSchema = z.enum([
  'pending',
  'queued',
  'running',
  'publishing',
  'success',
  'warning',
  'failed',
  'failed_publish',
  'failed_finalize',
  'canceled',
  'rolled_back',
]);

export type RunStatus = z.infer<typeof RunStatusSchema>;

// Run step schemas for tracking per-source/per-destination execution
export const RunSourceStepSchema = z.object({
  step_id: z.string(),
  pipeline_source_id: z.string(),
  connector_instance_id: z.string().nullable().optional(),
  status: z.string(),
  counts: z.record(z.string(), z.number()).nullable().optional(),
  error: z.string().nullable().optional(),
  started_at: z.string().nullable().optional(),
  finished_at: z.string().nullable().optional(),
});

export const RunDestinationStepSchema = z.object({
  step_id: z.string(),
  pipeline_destination_id: z.string(),
  connector_instance_id: z.string().nullable().optional(),
  status: z.string(),
  counts: z.record(z.string(), z.number()).nullable().optional(),
  error: z.string().nullable().optional(),
  started_at: z.string().nullable().optional(),
  finished_at: z.string().nullable().optional(),
});

export type RunSourceStep = z.infer<typeof RunSourceStepSchema>;
export type RunDestinationStep = z.infer<typeof RunDestinationStepSchema>;

// Run schema
export const RunSchema = z.object({
  run_id: z.string(),
  pipeline_id: z.string().nullable().optional(),
  target_connector_instance_id: z.string().nullable().optional(),
  status: RunStatusSchema,
  started_at: z.string().nullable().optional(),  // Optional: not present on newly created runs
  finished_at: z.string().nullable().optional(),  // Optional: not present on newly created runs
  duration_ms: z.number().nullable().optional(),  // Optional: not present on newly created runs
  counts: z.object({
    processed: z.number(),
    created: z.number(),
    updated: z.number(),
    noop: z.number(),
    failed: z.number(),
    deleted: z.number().nullable().optional(),
  }).nullable().optional(),
  parameters: z.record(z.string(), z.any()).nullable().optional(),
  error: z.string().nullable().optional(),
  error_stage: z.string().nullable().optional(),
  error_at: z.string().nullable().optional(),
  published_at: z.string().nullable().optional(),
  // Rollback fields
  rolled_back_at: z.string().nullable().optional(),
  rolled_back_by_run_id: z.string().nullable().optional(),
  rollback_of_run_id: z.string().nullable().optional(),
  // Run steps (per-source and per-destination execution tracking)
  sources: z.array(RunSourceStepSchema).nullable().optional(),
  destinations: z.array(RunDestinationStepSchema).nullable().optional(),
  run_status: z.string().nullable().optional(), // Computed status from steps: 'succeeded', 'partial', 'failed'
});

export type Run = z.infer<typeof RunSchema>;

// Paginated runs response (backend returns different format)
export const PaginatedRunsSchema = z.object({
  items: z.array(RunSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export type PaginatedRuns = z.infer<typeof PaginatedRunsSchema>;

// Pagination schema for other endpoints
export const PaginationSchema = z.object({
  limit: z.number(),
  offset: z.number(),
  count: z.number(),
  total_count: z.number(),
});

// Paginated response schema factory
export const createPaginatedSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    data: z.array(itemSchema),
    pagination: PaginationSchema,
  });

// Entity schema
export const EntitySchema = z.object({
  entity_key: z.string(),
  entity_type: z.string(),
  title: z.string().nullable().optional(),
  object_number: z.string().nullable().optional(),
  modified_at: z.string().nullable().optional(),
  thumbnail_url: z.string().nullable().optional(),
  canonical_url: z.string().nullable().optional(),
  last_seen_at: z.string(),
  last_run_id: z.string().nullable().optional(),
  dataset_id: z.string().nullable().optional(),
  payload: z.record(z.string(), z.any()),
});

export type Entity = z.infer<typeof EntitySchema>;

export const EntityDetailSchema = z.object({
  entity_key: z.string(),
  entity_type: z.string(),
  source_system: z.string(),
  source_id: z.string(),
  canonical_url: z.string().nullable().optional(),
  payload: z.record(z.string(), z.any()),
  payload_hash: z.string(),
  extracted_at: z.string().nullable().optional(),
  last_seen_at: z.string().nullable().optional(),
  last_run_id: z.string().nullable().optional(),
  dataset_id: z.string().nullable().optional(),
  fields: z.object({
    title: z.string().nullable().optional(),
    object_number: z.string().nullable().optional(),
    modified_at: z.string().nullable().optional(),
    thumbnail_url: z.string().nullable().optional(),
  }),
});

export type EntityDetail = z.infer<typeof EntityDetailSchema>;

// Entity type schema
export const EntityTypeSchema = z.object({
  entity_type: z.string(),
  count: z.number(),
});

export type EntityType = z.infer<typeof EntityTypeSchema>;

export const EntityTypesResponseSchema = z.object({
  organization_id: z.string(),
  entity_types: z.array(EntityTypeSchema),
});

export type EntityTypesResponse = z.infer<typeof EntityTypesResponseSchema>;

// Display profile schema
export const DisplayProfileSchema = z.object({
  primary_field: z.string(),
  secondary_field: z.string(),
  thumbnail_field: z.string(),
});

export type DisplayProfile = z.infer<typeof DisplayProfileSchema>;

// Entities list response
export const EntitiesResponseSchema = z.object({
  organization_id: z.string(),
  entity_type: z.string().nullable().optional(),
  display: DisplayProfileSchema,
  items: z.array(EntitySchema),
  limit: z.number(),
  offset: z.number(),
  total: z.number(),
});

export type EntitiesResponse = z.infer<typeof EntitiesResponseSchema>;

export const PaginatedEntitiesSchema = createPaginatedSchema(EntitySchema);
export type PaginatedEntities = z.infer<typeof PaginatedEntitiesSchema>;

// Change event schema
export const FieldDiffSchema = z.object({
  field_name: z.string(),
  old_value: z.any(),
  new_value: z.any(),
  array_delta: z.number().nullable().optional(),
});

export const ChangeEventSchema = z.object({
  change_id: z.string(),
  entity_key: z.string(),
  entity_type: z.string().nullable().optional(),
  change_type: z.enum(['created', 'updated', 'noop']),
  occurred_at: z.string(),
  applied: z.boolean(),
  changed_fields: z.array(z.string()).nullable().optional(),
  old_hash: z.string().nullable().optional(),
  new_hash: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  error_code: z.string().nullable().optional(),
  error_message: z.string().nullable().optional(),
  pipeline_name: z.string().nullable().optional(),
  dataset_name: z.string().nullable().optional(),
  field_diffs: z.array(FieldDiffSchema).nullable().optional(),
});

export type ChangeEvent = z.infer<typeof ChangeEventSchema>;

// Backend returns {changes: [], count, limit, offset, total_count}
export const PaginatedChangesSchema = z.object({
  items: z.array(ChangeEventSchema),
  limit: z.number(),
  offset: z.number(),
  total: z.number(),
});
export type PaginatedChanges = z.infer<typeof PaginatedChangesSchema>;

// Storage schemas
export const StorageUsageSchema = z.object({
  used_bytes: z.number(),
  used_gb: z.number(),
  limit_bytes: z.number(),
  limit_gb: z.number(),
  remaining_bytes: z.number(),
  remaining_gb: z.number(),
  usage_percent: z.number(),
  media_bytes: z.number().nullable().optional(),
  db_bytes: z.number().nullable().optional(),
  search_bytes: z.number().nullable().optional(),
  metered_at: z.string().nullable().optional(),
});

export type StorageUsage = z.infer<typeof StorageUsageSchema>;

export const StorageStatsSchema = z.object({
  tier: z.unknown().nullable().optional(),
  usage: StorageUsageSchema,
  region: z.string(),
});

export type StorageStats = z.infer<typeof StorageStatsSchema>;

export const StorageRegionSchema = z.object({
  code: z.string(),
  name: z.string(),
  default: z.boolean(),
});

export type StorageRegion = z.infer<typeof StorageRegionSchema>;

// Connector schemas
export const ConnectorDefinitionSchema = z.object({
  connector_definition_id: z.string(),
  key: z.string(),
  display_name: z.string(),
  direction: z.enum(['source', 'target', 'both']),
  source_type: z.string().nullable().optional(),
  version: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  config_schema: z.record(z.string(), z.any()),
  created_at: z.string(),
});

export type ConnectorDefinition = z.infer<typeof ConnectorDefinitionSchema>;

export const ConnectorInstanceSchema = z.object({
  connector_instance_id: z.string(),
  organization_id: z.string(),
  connector_definition_id: z.string(),
  name: z.string(),
  status: z.string(),
  config: z.record(z.string(), z.any()),
  direction: z.enum(['source', 'target', 'both']).nullable().optional(),
  definition_key: z.string().nullable().optional(),
  created_at: z.string(),
});

export type ConnectorInstance = z.infer<typeof ConnectorInstanceSchema>;


// ============================================================================
// PIPELINE SCHEMAS
// ============================================================================
// Pipeline is the canonical execution abstraction in Madrona.

export const PipelineSourceSchema = z.object({
  source_id: z.string(),
  connector_instance_id: z.string(),
  enabled: z.boolean(),
  parameters: z.record(z.string(), z.any()),
  ordering: z.number(),
});

export type PipelineSource = z.infer<typeof PipelineSourceSchema>;

export const PipelineDestinationSchema = z.object({
  destination_id: z.string(),
  connector_instance_id: z.string(),
  enabled: z.boolean(),
  parameters: z.record(z.string(), z.any()),
  ordering: z.number(),
  publish_deletes: z.boolean().nullable().optional(),
  delete_strategy: z.enum(['remove', 'mark', 'archive']).nullable().optional(),
});

export type PipelineDestination = z.infer<typeof PipelineDestinationSchema>;

export const PipelineSchema = z.object({
  pipeline_id: z.string(),
  organization_id: z.string(),
  name: z.string().nullable().optional().default('Unnamed Pipeline'),
  dataset_id: z.string().nullable().optional(),
  status: z.string(),
  created_at: z.string(),
  sources: z.array(PipelineSourceSchema).nullable().optional().default([]),
  destinations: z.array(PipelineDestinationSchema).nullable().optional().default([]),
  delete_detection_enabled: z.boolean().nullable().optional(),
  delete_detection_method: z.enum(['full_sync', 'incremental']).nullable().optional(),
  target_profile: z.string().nullable().optional(),
  profile_validation_mode: z.enum(['strict', 'warn', 'none']).nullable().optional(),
});

export type Pipeline = z.infer<typeof PipelineSchema>;

// Dataset schema
export const DatasetSchema = z.object({
  dataset_id: z.string(),
  organization_id: z.string(),
  name: z.string(),
  key: z.string(),
  description: z.string().nullable().optional(),
  source_type: z.string().nullable().optional(),
  schema: z.record(z.string(), z.any()).nullable().optional(),
  role: z.string().nullable().optional().default('canonical'),
  created_at: z.string(),
  updated_at: z.string(),
  entity_count: z.number().nullable().optional(),
});

export type Dataset = z.infer<typeof DatasetSchema>;

// Entity current schema (for export/query)
export const EntityCurrentSchema = z.object({
  entity_key: z.string(),
  entity_type: z.string(),
  dataset_id: z.string().nullable().optional(),
  source_system: z.string(),
  source_id: z.string(),
  canonical_url: z.string().nullable().optional(),
  payload: z.record(z.string(), z.any()),
  extracted_at: z.string(),
  last_seen_at: z.string(),
  updated_at: z.string(),
  last_run_id: z.string().nullable().optional(),
});

export type EntityCurrent = z.infer<typeof EntityCurrentSchema>;

// Entity query response (with cursor pagination)
export const EntityQueryResponseSchema = z.object({
  items: z.array(EntityCurrentSchema),
  next_cursor: z.string().nullable().optional(),
});

export type EntityQueryResponse = z.infer<typeof EntityQueryResponseSchema>;

// Entity query filters
export const EntityQueryFiltersSchema = z.object({
  organization_id: z.string(),
  limit: z.number().nullable().optional(),
  cursor: z.string().nullable().optional(),
  dataset_id: z.array(z.string()).nullable().optional(),
  pipeline_id: z.array(z.string()).nullable().optional(),
  entity_type: z.array(z.string()).nullable().optional(),
  updated_after: z.string().nullable().optional(),
  updated_before: z.string().nullable().optional(),
});

export type EntityQueryFilters = z.infer<typeof EntityQueryFiltersSchema>;

// Entity export formats
export const EntityExportFormatSchema = z.enum(['json', 'jsonl']);
export type EntityExportFormat = z.infer<typeof EntityExportFormatSchema>;

// Generic message/response schemas
export const MessageResponseSchema = z.object({
  message: z.string(),
}).passthrough();

export type MessageResponse = z.infer<typeof MessageResponseSchema>;

export const BulkDeleteResponseSchema = z.object({
  message: z.string(),
  deleted_count: z.number(),
}).passthrough();

export type BulkDeleteResponse = z.infer<typeof BulkDeleteResponseSchema>;

// ============================================================================
// FLOW MODULE ADDITIONAL SCHEMAS
// ============================================================================

export const RollbackCheckResultSchema = z.object({
  can_rollback: z.boolean(),
  partial: z.boolean(),
  total_changes: z.number(),
  rollbackable_changes: z.number(),
  conflict_entities: z.array(z.string()),
  reason: z.string().nullable().optional(),
}).passthrough();

export const RollbackResultSchema = z.object({
  rollback_run_id: z.string(),
  status: z.enum(['success', 'partial', 'failed']),
  reverted_creates: z.number(),
  reverted_updates: z.number(),
  reverted_deletes: z.number(),
  skipped_conflicts: z.number(),
  republish_status: z.string().nullable().optional(),
}).passthrough();

export const ExtractionSchemaResponseSchema = z.object({
  definitionKey: z.string(),
}).passthrough();

export const PipelineScheduleSchema = z.object({
  schedule_id: z.string(),
  pipeline_id: z.string(),
  enabled: z.boolean(),
  type: z.enum(['interval', 'time']),
  timezone: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
}).passthrough();

export const JobSchema = z.object({
  job_id: z.string(),
  organization_id: z.string(),
  status: z.enum(['pending', 'queued', 'running', 'succeeded', 'failed', 'canceled']),
  created_at: z.string(),
}).passthrough();

export const JobsResponseSchema = z.object({
  items: z.array(JobSchema),
  total: z.number(),
  limit: z.number(),
}).passthrough();

export const TransformerSchema = z.object({
  transformer_id: z.string(),
  dataset_id: z.string(),
  target_format: z.string(),
  status: z.enum(['draft', 'active', 'archived']),
  code_length: z.number(),
  generated_at: z.string(),
}).passthrough();

export const ProfileSchemaZ = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string(),
  canonical_type: z.string(),
}).passthrough();

export const ConnectionTestResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
}).passthrough();

export const CatalogResultSchema = z.object({
  objects: z.array(z.object({}).passthrough()),
  cached: z.boolean(),
}).passthrough();

export const ObjectDescriptionSchema = z.object({
  object_id: z.string(),
  object_name: z.string(),
  object_type: z.string(),
  columns: z.array(z.object({ name: z.string(), type: z.string(), nullable: z.boolean() }).passthrough()),
}).passthrough();

export const PreviewResultSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.object({}).passthrough()),
  truncated: z.boolean(),
}).passthrough();

export const ActionResultSchema = z.object({
  success: z.boolean(),
  action: z.string(),
}).passthrough();

export const ProjectionProfilesResponseSchema = z.object({
  organization_id: z.string(),
  config: z.object({}).passthrough(),
  is_default: z.boolean(),
  defaults: z.object({}).passthrough(),
}).passthrough();

export const ProjectionProfileUpdateResponseSchema = z.object({
  organization_id: z.string(),
  config: z.object({}).passthrough(),
  is_default: z.boolean(),
  message: z.string(),
}).passthrough();

// ============================================================================
// RELATIONSHIPS MODULE SCHEMAS
// ============================================================================

export const RelationshipDefinitionSchema = z.object({
  definition_id: z.string(),
  organization_id: z.string(),
  name: z.string(),
  relationship_type: z.string(),
  source_field_path: z.string(),
  target_field_path: z.string(),
  enabled: z.boolean(),
  created_at: z.string(),
}).passthrough();

export const RelationshipDefinitionListResponseSchema = z.object({
  items: z.array(RelationshipDefinitionSchema),
  limit: z.number(),
  offset: z.number(),
  total: z.number(),
}).passthrough();

export const EntityRelationshipSchema = z.object({
  relationship_id: z.string(),
  organization_id: z.string(),
  source_entity_key: z.string(),
  target_entity_key: z.string(),
  relationship_type: z.string(),
  created_at: z.string(),
}).passthrough();

export const EntityRelationshipListResponseSchema = z.object({
  items: z.array(EntityRelationshipSchema),
  limit: z.number(),
  offset: z.number(),
  total: z.number(),
}).passthrough();

export const RelationshipAnalyticsSchema = z.object({
  organization_id: z.string(),
  total_relationships: z.number(),
  by_type: z.array(z.object({ type: z.string(), count: z.number() })),
  by_source: z.array(z.object({ source: z.string(), count: z.number() })),
}).passthrough();

export const DeleteSettingsSchema = z.object({
  delete_detection_enabled: z.boolean(),
  delete_detection_method: z.enum(['full_sync', 'incremental']),
  delete_strategy: z.enum(['remove', 'mark', 'archive']),
}).passthrough();

export const DeleteStatsSchema = z.object({
  active: z.number(),
  soft_deleted: z.number(),
  archived: z.number(),
  marked: z.number(),
  total_deleted: z.number(),
}).passthrough();
