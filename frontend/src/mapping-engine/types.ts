/**
 * Madrona Mapping Engine v1 — Type Definitions
 * 
 * Core types for the mapping and transformation engine that converts
 * source records to canonical records.
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 * CORE RESPONSIBILITIES (Type-Level Contract)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Transform: SourceRecord → CanonicalRecord
 *   Input:  Raw snapshot from external system (immutable)
 *   Output: Normalized, schema-compliant canonical entity
 *   Via:    Mapping rules + optional TransformPipeline
 * 
 * Report: Transformation diagnostics (MappingReport)
 *   Statistics: Rules applied/skipped/failed, fields mapped/dropped
 *   Diagnostics: Warnings, errors, field counts
 *   NOT lineage: No per-field transformation tracking
 * 
 * Project: Format-specific output generation
 *   Source mode:      Return SourceRecord.raw (pre-transformation)
 *   Destination mode: Return CanonicalRecord (post-transformation)
 *   Deterministic:    Same snapshotId + mappingId → same output
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type {
  SourceRecord,
  CanonicalRecord,
  Mapping,
  TransformPipeline,
  MappingReport,
} from '../types/canonical';

// Re-export types from canonical for convenience
export type { MappingReport };

// ═══════════════════════════════════════════════════════════════════════════
// DECLARATIVE MAPPING DSL — Rule Types
// ═══════════════════════════════════════════════════════════════════════════
//
// The mapping DSL provides declarative rules for common transformation patterns.
//
// DESIGN GOALS:
// - Declarative over imperative (describe WHAT, not HOW)
// - Type-safe rule variants (discriminated union)
// - Composable rules (combine multiple rules for complex mappings)
// - Human-readable configuration (JSON-serializable)
// - Extensible transform functions (register custom transforms)
//
// SOURCE SELECTORS:
// Rules use string paths or SourceSelector objects to extract values:
// - Simple path: "fields.Title"
// - JSONPath: "$.data.artwork.title"
// - Template: "{{fields.Title}} ({{fields.Year}})"
// - Constant: { type: 'constant', value: 'Fixed Value' }
// 
// See selectors.ts for full SourceSelector API (selectOne, selectMany).
//
// RULE TYPES:
// 1. SetFieldRule      - Map scalar fields (label, description)
// 2. MapArrayRule      - Map arrays (identifiers, classifications)
// 3. EmitRelationshipRule - Create entity relationships
// 4. EmitWarningRule   - Validation warnings for data quality
// 5. SetExtensionRule  - Domain-specific metadata extensions
//
// EXAMPLE COMPLETE MAPPING:
// ```typescript
// const artworkMapping: MappingDSLRule[] = [
//   // Scalar fields with fallbacks
//   { id: 'set_label', name: 'Set label', type: 'SetField', 
//     toPath: 'label', from: 'fields.Title', coalesce: ['fields.ObjectName'],
//     default: 'Untitled' },
//
//   // Arrays with templates
//   { id: 'map_ids', name: 'Map identifiers', type: 'MapArray',
//     toPath: 'identifiers', fromMany: 'fields.AccessionNumbers',
//     itemTemplate: { type: 'accession', value: '{{item}}', system: 'tms' } },
//
//   // Relationships
//   { id: 'emit_creator', name: 'Creator relationship', type: 'EmitRelationship',
//     relationshipType: 'created_by', targetFrom: 'fields.ArtistID',
//     roleFrom: 'fields.Role', whenFrom: 'fields.CreationDate' },
//
//   // Validation
//   { id: 'warn_label', name: 'Warn missing label', type: 'EmitWarning',
//     whenMissing: ['fields.Title'], message: 'No title found', severity: 'error' },
//
//   // Extensions
//   { id: 'set_tms', name: 'TMS metadata', type: 'SetExtension',
//     namespace: 'org.tms', extensionType: 'conservation',
//     dataFrom: 'fields.ConservationData' },
// ];
// ```
//
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Base properties shared by all mapping rules.
 */
export interface BaseRule {
  /**
   * Unique rule identifier.
   * 
   * Used for debugging, reporting, and rule dependencies.
   * 
   * Examples:
   * - "set_label"
   * - "map_identifiers"
   * - "emit_creator_relationship"
   */
  id: string;
  
  /**
   * Human-readable rule name.
   * 
   * Displayed in mapping reports and UI.
   * 
   * Examples:
   * - "Set artwork label"
   * - "Map identifier array"
   * - "Emit creator relationship"
   */
  name: string;
  
  /**
   * Whether this rule is enabled.
   * 
   * Optional. Defaults to true.
   * Disabled rules are skipped during execution.
   */
  enabled?: boolean;
}

/**
 * Set a scalar field in the canonical record.
 * 
 * Handles simple field mappings like label, description, or nested properties.
 * 
 * @example
 * ```typescript
 * const rule: SetFieldRule = {
 *   id: 'set_label',
 *   name: 'Set artwork label',
 *   type: 'SetField',
 *   toPath: 'label',
 *   from: 'fields.Title',
 *   coalesce: ['fields.ObjectName', 'fields.DisplayName'],
 *   default: 'Untitled',
 * };
 * ```
 */
export interface SetFieldRule extends BaseRule {
  /**
   * Rule type discriminator.
   */
  type: 'SetField';
  
  /**
   * Target path in canonical record.
   * 
   * Supports dot notation for nested fields.
   * 
   * Examples:
   * - "label"
   * - "description"
   * - "properties.medium"
   * - "dates.created"
   */
  toPath: string;
  
  /**
   * Source path to extract value from.
   * 
   * Supports dot notation, JSONPath, or array indexing.
   * 
   * Examples:
   * - "fields.Title"
   * - "$.data.artwork.name"
   * - "rows[0].description"
   */
  from: string;
  
  /**
   * Optional fallback paths to try if primary path is null/missing.
   * 
   * Evaluated in order until a non-null value is found.
   * 
   * Examples:
   * - ["fields.ObjectName", "fields.DisplayName"]
   * - ["description_long", "description_short"]
   */
  coalesce?: string[];
  
  /**
   * Default value if all extraction attempts fail.
   * 
   * Examples:
   * - "Untitled"
   * - "Unknown"
   * - null
   */
  default?: JsonValue;
  
  /**
   * Optional transform function to apply to extracted value.
   * 
   * Examples:
   * - "trim"
   * - "normalizeDate"
   * - "toUpperCase"
   */
  transform?: string;
}

/**
 * Map an array field from source to canonical record.
 * 
 * Handles arrays like identifiers, classifications, or relationships
 * where each item needs transformation or templating.
 * 
 * @example
 * ```typescript
 * const rule: MapArrayRule = {
 *   id: 'map_identifiers',
 *   name: 'Map identifier array',
 *   type: 'MapArray',
 *   toPath: 'identifiers',
 *   fromMany: 'fields.AccessionNumbers',
 *   itemTemplate: {
 *     type: 'accession_number',
 *     value: '{{item}}',
 *     system: 'tms',
 *   },
 * };
 * ```
 */
export interface MapArrayRule extends BaseRule {
  /**
   * Rule type discriminator.
   */
  type: 'MapArray';
  
  /**
   * Target path in canonical record.
   * 
   * Must point to an array field.
   * 
   * Examples:
   * - "identifiers"
   * - "classifications"
   * - "alternativeLabels"
   */
  toPath: string;
  
  /**
   * Source path to array data.
   * 
   * Must extract an array or iterable collection.
   * 
   * Examples:
   * - "fields.AccessionNumbers"
   * - "$.identifiers[*]"
   * - "keywords"
   */
  fromMany: string;
  
  /**
   * Template object for each array item.
   * 
   * Supports {{item}} placeholder for current item value.
   * Supports {{index}} placeholder for current index.
   * Supports {{parent.path}} for accessing parent record fields.
   * 
   * Examples:
   * - { type: 'accession', value: '{{item}}' }
   * - { id: '{{item.id}}', label: '{{item.name}}' }
   */
  itemTemplate?: Record<string, JsonValue>;
  
  /**
   * Optional mapper function name for complex transformations.
   * 
   * Used when itemTemplate is insufficient.
   * 
   * Examples:
   * - "mapIdentifier"
   * - "parseClassification"
   * - "buildRelationship"
   */
  mapperFn?: string;
  
  /**
   * Optional filter condition to apply to array items.
   * 
   * Examples:
   * - "{{item.type}} === 'primary'"
   * - "{{item.value}} !== null"
   */
  filter?: string;
}

/**
 * Emit a relationship from the canonical record to another entity.
 * 
 * Creates relationship entries that link this record to related entities.
 * 
 * @example
 * ```typescript
 * const rule: EmitRelationshipRule = {
 *   id: 'emit_creator',
 *   name: 'Emit creator relationship',
 *   type: 'EmitRelationship',
 *   relationshipType: 'created_by',
 *   targetFrom: 'fields.ArtistID',
 *   roleFrom: 'fields.ArtistRole',
 *   whenFrom: 'fields.CreationDate',
 *   whereFrom: 'fields.CreationLocation',
 * };
 * ```
 */
export interface EmitRelationshipRule extends BaseRule {
  /**
   * Rule type discriminator.
   */
  type: 'EmitRelationship';
  
  /**
   * Relationship type identifier.
   * 
   * Defines the semantic relationship between entities.
   * 
   * Examples:
   * - "created_by"
   * - "part_of"
   * - "related_to"
   * - "depicts"
   */
  relationshipType: string;
  
  /**
   * Source path to target entity identifier.
   * 
   * Extracts the ID of the related entity.
   * 
   * Examples:
   * - "fields.ArtistID"
   * - "related_object_id"
   * - "$.parent.id"
   */
  targetFrom: string;
  
  /**
   * Optional source path to relationship role.
   * 
   * Describes the role in this relationship.
   * 
   * Examples:
   * - "fields.ArtistRole" → "painter"
   * - "contributor_role" → "editor"
   */
  roleFrom?: string;
  
  /**
   * Optional source path to temporal context.
   * 
   * Describes when the relationship occurred.
   * 
   * Examples:
   * - "fields.CreationDate"
   * - "contribution_date"
   */
  whenFrom?: string;
  
  /**
   * Optional source path to spatial context.
   * 
   * Describes where the relationship occurred.
   * 
   * Examples:
   * - "fields.CreationLocation"
   * - "contribution_location"
   */
  whereFrom?: string;
  
  /**
   * Optional condition for emitting relationship.
   * 
   * If condition evaluates to false, relationship is not created.
   * 
   * Examples:
   * - "{{targetFrom}} !== null"
   * - "{{relationshipType}} === 'primary'"
   */
  condition?: string;
}

/**
 * Emit a warning when validation conditions are not met.
 * 
 * Used for data quality checks and validation reporting.
 * 
 * @example
 * ```typescript
 * const rule: EmitWarningRule = {
 *   id: 'warn_missing_label',
 *   name: 'Warn if label is missing',
 *   type: 'EmitWarning',
 *   whenMissing: ['fields.Title', 'fields.ObjectName'],
 *   message: 'No label found in Title or ObjectName fields',
 *   severity: 'error',
 * };
 * ```
 */
export interface EmitWarningRule extends BaseRule {
  /**
   * Rule type discriminator.
   */
  type: 'EmitWarning';
  
  /**
   * Source paths to check for missing data.
   * 
   * Warning is emitted if ALL paths are null/undefined.
   * 
   * Examples:
   * - ["fields.Title"]
   * - ["fields.Title", "fields.ObjectName"]
   */
  whenMissing: string[];
  
  /**
   * Warning message to include in report.
   * 
   * Supports template placeholders.
   * 
   * Examples:
   * - "Missing required field: label"
   * - "No identifier found in {{whenMissing}}"
   */
  message: string;
  
  /**
   * Optional severity level.
   * 
   * Defaults to 'warning'.
   * 
   * - "info": Informational message
   * - "warning": Non-critical issue
   * - "error": Critical validation failure
   */
  severity?: 'info' | 'warning' | 'error';
}

/**
 * Set extension data for domain-specific metadata.
 * 
 * Populates the canonical record's extensions array with
 * source-specific or domain-specific data that doesn't fit
 * the core schema.
 * 
 * @example
 * ```typescript
 * const rule: SetExtensionRule = {
 *   id: 'set_tms_extension',
 *   name: 'Set TMS-specific metadata',
 *   type: 'SetExtension',
 *   namespace: 'org.tms',
 *   extensionType: 'conservation_status',
 *   dataFrom: 'fields.ConservationData',
 * };
 * ```
 */
export interface SetExtensionRule extends BaseRule {
  /**
   * Rule type discriminator.
   */
  type: 'SetExtension';
  
  /**
   * Extension namespace.
   * 
   * Namespaces prevent collisions between different systems.
   * Use reverse-domain notation.
   * 
   * Examples:
   * - "org.tms"
   * - "com.airtable"
   * - "edu.smithsonian"
   */
  namespace: string;
  
  /**
   * Extension type within namespace.
   * 
   * Identifies the kind of extension data.
   * 
   * Examples:
   * - "conservation_status"
   * - "acquisition_metadata"
   * - "exhibition_history"
   */
  extensionType: string;
  
  /**
   * Source path to extension data.
   * 
   * Extracts data to store in extension.
   * 
   * Examples:
   * - "fields.ConservationData"
   * - "$.metadata.custom"
   * - "raw_data"
   */
  dataFrom: string;
  
  /**
   * Optional transform function for extension data.
   * 
   * Examples:
   * - "parseJSON"
   * - "normalizeExtensionData"
   */
  transform?: string;
}

/**
 * Discriminated union of all mapping rule types.
 * 
 * Type-safe rule variant for declarative mapping configurations.
 */
export type MappingDSLRule =
  | SetFieldRule
  | MapArrayRule
  | EmitRelationshipRule
  | EmitWarningRule
  | SetExtensionRule;

/**
 * Legacy mapping rule (deprecated, use MappingDSLRule instead).
 * 
 * @deprecated Use MappingDSLRule for new mapping configurations
 */
export interface MappingRule {
  /**
   * Rule identifier (for debugging and reports).
   */
  id: string;
  
  /**
   * Path to extract data from source record.
   * Supports JSONPath, dot notation, or custom extractors.
   * 
   * Examples:
   * - "fields.Title" (dot notation)
   * - "$.data.title" (JSONPath)
   * - "rows[0].name" (array access)
   */
  sourcePath: string;
  
  /**
   * Target path in canonical record.
   * 
   * Examples:
   * - "label"
   * - "properties.creator"
   * - "dates.created"
   */
  targetPath: string;
  
  /**
   * Optional transformation function name.
   * 
   * Examples:
   * - "toISO8601Date"
   * - "trimWhitespace"
   * - "parseJSON"
   */
  transform?: string;
  
  /**
   * Default value if source data is missing or null.
   */
  defaultValue?: JsonValue;
  
  /**
   * Whether this field is required for a valid canonical record.
   */
  required?: boolean;
  
  /**
   * Whether to skip this rule entirely.
   */
  disabled?: boolean;
}

/**
 * Compilation diagnostic message.
 * 
 * Reports issues found during mapping compilation.
 */
export interface CompilationDiagnostic {
  /**
   * Diagnostic severity.
   * 
   * - "error": Compilation failed, mapping cannot be executed
   * - "warning": Potential issue, mapping can still execute
   * - "info": Informational message about compilation
   */
  severity: 'error' | 'warning' | 'info';
  
  /**
   * Rule ID this diagnostic applies to.
   * 
   * Undefined for mapping-level diagnostics.
   */
  ruleId?: string;
  
  /**
   * Human-readable diagnostic message.
   */
  message: string;
  
  /**
   * Optional error code for programmatic handling.
   * 
   * Examples:
   * - "MISSING_REQUIRED_FIELD"
   * - "INVALID_SELECTOR"
   * - "UNKNOWN_TRANSFORM"
   */
  code?: string;
}

/**
 * Pre-compiled extractor function for efficient value extraction.
 * 
 * Generated during compilation from SourceSelector configurations.
 */
export type CompiledExtractor = (source: Record<string, unknown>) => JsonValue | undefined;

/**
 * Pre-compiled rule with optimized extractor functions.
 * 
 * Created during compilation for efficient execution.
 */
export interface CompiledDSLRule {
  /**
   * Original rule configuration.
   */
  rule: MappingDSLRule;
  
  /**
   * Pre-compiled extractor function for primary selector.
   */
  extractor: CompiledExtractor;
  
  /**
   * Pre-compiled fallback extractors (for coalesce).
   */
  fallbackExtractors?: CompiledExtractor[];
  
  /**
   * Pre-compiled array extractor (for MapArrayRule).
   */
  arrayExtractor?: (source: Record<string, any>) => JsonValue[];
  
  /**
   * Pre-resolved transform function (if specified).
   */
  transformFn?: (value: unknown, context: TransformContext) => unknown;
}

/**
 * Compiled mapping configuration ready for execution.
 * 
 * Pre-validated and optimized mapping with executable extractors.
 */
export interface CompiledMapping {
  /**
   * Original mapping metadata.
   */
  mapping: Mapping;
  
  /**
   * Compiled DSL rules with pre-parsed extractors.
   */
  compiledRules: CompiledDSLRule[];
  
  /**
   * Legacy compiled rules (deprecated).
   * 
   * @deprecated Use compiledRules instead
   */
  rules?: MappingRule[];
  
  /**
   * Rule execution order (by rule ID).
   */
  executionOrder: string[];
  
  /**
   * Compilation diagnostics (warnings and errors).
   * 
   * Empty array if compilation was successful with no warnings.
   */
  diagnostics: CompilationDiagnostic[];
  
  /**
   * Whether compilation succeeded.
   * 
   * False if any error-level diagnostics were generated.
   */
  valid: boolean;
  
  /**
   * Apply this compiled mapping to a source record.
   * 
   * Executes all rules and produces a canonical record.
   * 
   * @param sourceRecord - Source record to transform
   * @param context - Execution context
   * @returns Partial canonical record (to be validated after)
   * 
   * @example
   * ```typescript
   * const compiled = compileMapping(mapping, rules);
   * if (compiled.valid) {
   *   const result = compiled.apply(sourceRecord, context);
   *   console.log('Transformed:', result);
   * }
   * ```
   */
  apply: (
    sourceRecord: SourceRecord,
    context: TransformContext
  ) => Partial<CanonicalRecord>;
}

/**
 * Transform step in a pipeline.
 */
export interface TransformStep {
  /**
   * Step type identifier.
   */
  type: string;
  
  /**
   * Step configuration.
   */
  config: Record<string, any>;
}

/**
 * Context passed through transformation pipeline.
 */
export interface TransformContext {
  /**
   * Source record being transformed.
   */
  sourceRecord: SourceRecord;
  
  /**
   * Partial canonical record (built up through pipeline).
   */
  canonicalRecord: Partial<CanonicalRecord>;
  
  /**
   * Warnings accumulated during transformation.
   */
  warnings: string[];
  
  /**
   * Metadata about rule execution.
   */
  ruleStats: {
    totalRules: number;
    executedRules: number;
    skippedRules: number;
    failedRules: number;
  };
}

/**
 * Result of a single mapping rule execution.
 */
export interface RuleExecutionResult {
  /**
   * Rule that was executed.
   */
  rule: MappingRule;
  
  /**
   * Whether the rule executed successfully.
   */
  success: boolean;
  
  /**
   * Extracted value from source.
   */
  sourceValue?: JsonValue;

  /**
   * Transformed value written to canonical.
   */
  targetValue?: JsonValue;
  
  /**
   * Error message if rule failed.
   */
  error?: string;
  
  /**
   * Whether rule was skipped (disabled or source missing).
   */
  skipped: boolean;
}

/**
 * Result of mapping engine execution.
 */
export interface MappingEngineResult {
  /**
   * Whether transformation succeeded.
   */
  success: boolean;
  
  /**
   * Produced canonical record (if successful or partial).
   */
  canonicalRecord?: CanonicalRecord;
  
  /**
   * Transformation diagnostic report.
   */
  report: MappingReport;
  
  /**
   * Fatal error if transformation failed completely.
   */
  error?: string;
}

/**
 * Options for mapping engine execution.
 */
export interface MappingEngineOptions {
  /**
   * Whether to throw on validation failures.
   */
  throwOnValidationError?: boolean;
  
  /**
   * Whether to include detailed debug information.
   */
  debug?: boolean;
  
  /**
   * Schema version to validate against.
   */
  expectedSchemaVersion?: string;
  
  /**
   * Pipeline ID for provenance tracking.
   */
  pipelineId?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// ENGINE INPUT/OUTPUT TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * JSON-compatible value type for arbitrary structured data.
 * 
 * Represents any value that can be serialized to JSON.
 */
export type JsonValue = 
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Runtime context for engine execution.
 * 
 * Provides execution environment metadata for provenance tracking,
 * audit logging, and multi-tenant isolation.
 * 
 * @example
 * ```typescript
 * const context: EngineContext = {
 *   pipelineId: 'route_smithsonian_api',
 *   orgId: 'org_smithsonian',
 *   userId: 'user_curator_jsmith',
 *   now: '2026-01-14T10:30:00Z',
 * };
 * ```
 */
export interface EngineContext {
  /**
   * Pipeline identifier for this transformation.
   *
   * Links the transformation to a specific ingestion pipeline.
   * Used in CanonicalRecord.provenance.pipelineId.
   * 
   * Examples:
   * - "route_tms_scheduled_sync"
   * - "route_airtable_webhook"
   * - "route_manual_upload"
   */
  pipelineId: string;
  
  /**
   * Organization identifier (multi-tenant isolation).
   * 
   * Optional. Used for access control and data partitioning.
   * 
   * Examples:
   * - "org_smithsonian"
   * - "org_met_museum"
   */
  orgId?: string;
  
  /**
   * User identifier who triggered the transformation.
   * 
   * Optional. Used for audit logging and attribution.
   * 
   * Examples:
   * - "user_curator_jsmith"
   * - "system_scheduler"
   */
  userId?: string;
  
  /**
   * ISO 8601 timestamp when transformation was initiated.
   * 
   * Used for provenance tracking (ingestedAt) and temporal queries.
   * 
   * Example: "2026-01-14T10:30:00Z"
   */
  now: string;
}

/**
 * Safety limits for canonical record validation.
 * 
 * Prevents resource exhaustion and ensures reasonable data sizes.
 * When limits are exceeded, values are truncated and warnings are added
 * to the MappingReport.
 * 
 * @example
 * ```typescript
 * const limits: SafetyLimits = {
 *   maxLabelLength: 500,
 *   maxDescriptionLength: 10000,
 *   maxRelationships: 100,
 *   maxMediaCount: 50,
 *   maxExtensionSizeBytes: 1024 * 100, // 100KB
 * };
 * ```
 */
export interface SafetyLimits {
  /**
   * Maximum length for canonical record label field.
   * 
   * Labels exceeding this length will be truncated with "..." suffix.
   * 
   * Default: 500 characters
   */
  maxLabelLength?: number;
  
  /**
   * Maximum length for canonical record description field.
   * 
   * Descriptions exceeding this length will be truncated with "..." suffix.
   * 
   * Default: 10000 characters (10KB)
   */
  maxDescriptionLength?: number;
  
  /**
   * Maximum number of relationships in relationships array.
   * 
   * Relationships exceeding this count will be dropped and warning added.
   * 
   * Default: 100 relationships
   */
  maxRelationships?: number;
  
  /**
   * Maximum number of media items in Media canonical records.
   * 
   * Media arrays exceeding this count will be truncated and warning added.
   * 
   * Default: 50 media items
   */
  maxMediaCount?: number;
  
  /**
   * Maximum size in bytes for extensions object.
   * 
   * Extensions exceeding this size (JSON.stringify) will be dropped and warning added.
   * 
   * Default: 102400 bytes (100KB)
   */
  maxExtensionSizeBytes?: number;
}

/**
 * Default safety limits for canonical record validation.
 */
export const DEFAULT_SAFETY_LIMITS: Required<SafetyLimits> = {
  maxLabelLength: 500,
  maxDescriptionLength: 10000,
  maxRelationships: 100,
  maxMediaCount: 50,
  maxExtensionSizeBytes: 102400, // 100KB
};

/**
 * Request to ingest a source record and produce a canonical record.
 * 
 * Primary input to the mapping engine's ingest() function.
 * 
 * @example
 * ```typescript
 * const request: IngestRequest = {
 *   sourceRecord: snapshot,
 *   mapping: mappingConfig,
 *   transformPipeline: enrichmentPipeline,
 *   profile: 'glam_museum',
 *   context: {
 *     pipelineId: 'route_tms_sync',
 *     now: new Date().toISOString(),
 *   },
 * };
 * ```
 */
export interface IngestRequest {
  /**
   * Source record to transform.
   * 
   * Immutable snapshot containing raw data from external system.
   */
  sourceRecord: SourceRecord;
  
  /**
   * Mapping configuration defining field transformations.
   * 
   * Specifies how to extract source fields and map to canonical schema.
   */
  mapping: Mapping;
  
  /**
   * Optional transformation pipeline for enrichment.
   * 
   * Additional processing steps to normalize, validate, or enrich data.
   */
  transformPipeline?: TransformPipeline;
  
  /**
   * Optional profile identifier for context-specific transformations.
   * 
   * Profiles can customize mapping behavior for different use cases.
   * 
   * Examples:
   * - "glam_museum": Museum-specific enrichments
   * - "enterprise_dam": Enterprise DAM normalization
   */
  profile?: string;
  
  /**
   * Execution context for provenance and audit.
   */
  context: EngineContext;
  
  /**
   * Optional safety limits for canonical record validation.
   * 
   * If not provided, DEFAULT_SAFETY_LIMITS will be used.
   * Prevents resource exhaustion by truncating large values.
   */
  safetyLimits?: SafetyLimits;
}

/**
 * Result of ingesting a source record.
 * 
 * Output from the mapping engine's ingest() function.
 * 
 * @example
 * ```typescript
 * const result: IngestResult = {
 *   canonicalRecord: {
 *     id: 'obj_starry_night',
 *     type: 'Object',
 *     label: 'The Starry Night',
 *     // ... additional fields
 *   },
 *   mappingReport: {
 *     status: 'success',
 *     ruleExecution: { fieldsMapped: 15, failedRules: 0 },
 *     // ... diagnostic details
 *   },
 * };
 * ```
 */
export interface IngestResult {
  /**
   * Produced canonical record.
   * 
   * Normalized, schema-compliant entity ready for storage or API export.
   */
  canonicalRecord: CanonicalRecord;
  
  /**
   * Transformation diagnostic report.
   * 
   * Describes rules applied, fields mapped, warnings, and errors.
   * Does NOT include per-field lineage.
   */
  mappingReport: MappingReport;
}

/**
 * Request to project a canonical record to a destination format.
 * 
 * Supports generating format-specific payloads for export or preview.
 * 
 * @example
 * ```typescript
 * const request: ProjectRequest = {
 *   canonicalRecord: record,
 *   mapping: destinationMapping,
 *   snapshotId: 'snap_abc123',
 *   mode: 'destination',
 * };
 * ```
 */
export interface ProjectRequest {
  /**
   * Canonical record to project.
   * 
   * Source data for generating destination payload.
   */
  canonicalRecord: CanonicalRecord;
  
  /**
   * Destination mapping configuration.
   * 
   * Defines how to transform canonical fields to destination format.
   */
  mapping: Mapping;
  
  /**
   * Snapshot identifier for deterministic output.
   * 
   * Links projection to specific source record version.
   */
  snapshotId: string;
  
  /**
   * Projection mode.
   * 
   * - "source": Return raw source data (SourceRecord.raw)
   * - "destination": Return transformed canonical data
   */
  mode: 'source' | 'destination';
}

/**
 * Result of projecting to a destination format.
 * 
 * Output from the mapping engine's project() function.
 * 
 * @example
 * ```typescript
 * const result: ProjectResult = {
 *   projectionPayload: {
 *     title: 'The Starry Night',
 *     creator: 'Vincent van Gogh',
 *     // ... destination-specific fields
 *   },
 *   mappingReport: {
 *     status: 'success',
 *     ruleExecution: { fieldsMapped: 8 },
 *   },
 *   meta: {
 *     hash: 'sha256:abc123...',
 *     generatedAt: '2026-01-14T10:30:00Z',
 *     format: 'dublin_core',
 *   },
 * };
 * ```
 */
export interface ProjectResult {
  /**
   * Generated projection payload.
   * 
   * Destination-specific format (JSON, XML metadata, etc.).
   */
  projectionPayload: JsonValue;
  
  /**
   * Transformation diagnostic report.
   * 
   * Describes how canonical fields were mapped to destination format.
   */
  mappingReport: MappingReport;
  
  /**
   * Projection metadata.
   */
  meta: {
    /**
     * Content hash for deterministic validation.
     * 
     * Same inputs → same hash.
     */
    hash: string;
    
    /**
     * ISO 8601 timestamp when projection was generated.
     */
    generatedAt: string;
    
    /**
     * Optional destination format identifier.
     * 
     * Examples: "dublin_core", "cidoc_crm", "json_ld"
     */
    format?: string;
  };
}

/**
 * Source data extractor function type.
 */
export type ExtractorFunction = (source: Record<string, unknown>, path: string) => unknown;

/**
 * Transform function type.
 */
export type TransformFunction = (value: unknown, context: TransformContext) => unknown;

// ═══════════════════════════════════════════════════════════════════════════
// MAPPING ENGINE CONTRACT SUMMARY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mapping Engine — Primary Transformation Contract
 * 
 * The mapping engine is a deterministic transformation system that:
 * 
 * 1. Consumes: IngestRequest (SourceRecord + Mapping + Context)
 * 2. Applies:  Mapping rules + optional TransformPipeline enrichments
 * 3. Produces: IngestResult (CanonicalRecord + MappingReport)
 * 4. Reports:  MappingReport (diagnostic statistics, NO per-field lineage)
 * 5. Projects: ProjectResult (destination-specific payloads with metadata)
 * 
 * DETERMINISM GUARANTEE:
 *   ingest(snapshotId, mappingId, transformId) → same canonical output
 *   project(snapshotId, mappingId) → same projection hash
 * 
 * NON-GOALS:
 *   - Field-level lineage tracking (use MappingReport for aggregate stats)
 *   - Real-time transformation (batch-oriented, snapshot-based)
 *   - Schema migration (create new mapping versions instead)
 * 
 * @example
 * ```typescript
 * // Ingest: Transform source → canonical
 * const ingestReq: IngestRequest = {
 *   sourceRecord: snapshot,
 *   mapping: mappingConfig,
 *   context: { pipelineId: 'route_tms', now: new Date().toISOString() },
 * };
 * const result: IngestResult = await ingest(ingestReq);
 * 
 * // Project: Generate destination payload
 * const projectReq: ProjectRequest = {
 *   canonicalRecord: result.canonicalRecord,
 *   mapping: destinationMapping,
 *   snapshotId: snapshot.id,
 *   mode: 'destination',
 * };
 * const projection: ProjectResult = await project(projectReq);
 * 
 * // Access transformation diagnostics
 * console.log(result.mappingReport.ruleExecution.fieldsMapped);
 * console.log(projection.meta.hash); // Deterministic content hash
 * ```
 */
export type MappingEngineContract = {
  /** 
   * Transform source record to canonical record.
   * 
   * @param request - Ingest request with source, mapping, and context
   * @returns Canonical record and diagnostic report
   */
  ingest: (request: IngestRequest) => Promise<IngestResult>;
  
  /** 
   * Project canonical record to destination format.
   * 
   * @param request - Projection request with mode and mapping
   * @returns Destination payload with metadata and diagnostics
   */
  project: (request: ProjectRequest) => Promise<ProjectResult>;
};
