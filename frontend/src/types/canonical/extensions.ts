/**
 * Madrona Canonical Schema v1 — Validation, Invariants, and Fixtures
 *
 * This module provides:
 * - Zod runtime validation schemas for all canonical types
 * - Invariant enforcement functions for data integrity
 * - Example fixtures for testing and documentation
 */

import { z } from 'zod';
import type {
  CanonicalRecord,
  SourceRecord,
  MappingReport,
  ProjectionResponse,
  Provenance,
} from './base';

// ============================================================================
// RUNTIME VALIDATION SCHEMAS (Zod)
// ============================================================================

/**
 * Runtime validation schemas for canonical data structures.
 *
 * These Zod schemas provide:
 * - Type-safe runtime validation at API boundaries
 * - Descriptive error messages for validation failures
 * - Schema version mismatch detection
 * - Reusable validation logic across frontend and backend
 *
 * USAGE:
 * ```typescript
 * // Validate API response
 * const result = CanonicalRecordSchema.safeParse(apiResponse);
 * if (!result.success) {
 *   console.error('Validation failed:', result.error.format());
 *   return;
 * }
 * const record: CanonicalRecord = result.data;
 *
 * // Validate with schema version check
 * const validated = validateCanonicalRecord(apiResponse);
 * if (!validated.success) {
 *   if (validated.error.schemaVersionMismatch) {
 *     console.warn('Schema version mismatch:', validated.error.message);
 *   }
 * }
 * ```
 */

/**
 * Zod schema for Provenance interface.
 * Validates source system coordinates and pipeline references.
 */
export const ProvenanceSchema = z.object({
  system: z.string().min(1, 'Source system identifier is required'),
  dataset: z.string().optional(),
  recordId: z.string().min(1, 'Source record ID is required'),
  sourceRecordId: z.string().min(1, 'Source record ID is required'),
  snapshotId: z.string().min(1, 'Snapshot ID is required'),
  mappingId: z.string().min(1, 'Mapping ID is required'),
  transformId: z.string().min(1, 'Transform ID is required'),
  pipelineId: z.string().optional(),
  ingestedAt: z.string().datetime('Ingested timestamp must be valid ISO 8601'),
  contentHash: z.string().optional(),
});

/**
 * Zod schema for Meta interface.
 * Validates system-managed metadata fields.
 */
export const MetaSchema = z.object({
  schemaVersion: z.string()
    .regex(/^\d+\.\d+\.\d+$/, 'Schema version must be semantic version (e.g., 1.0.0)'),
  createdAt: z.string().datetime('Created timestamp must be valid ISO 8601'),
  updatedAt: z.string().datetime('Updated timestamp must be valid ISO 8601'),
});

/**
 * Zod schema for Identifier interface.
 */
export const IdentifierSchema = z.object({
  scheme: z.string().min(1, 'Identifier scheme is required'),
  value: z.string().min(1, 'Identifier value is required'),
});

/**
 * Zod schema for Classification interface.
 */
export const ClassificationSchema = z.object({
  scheme: z.string().min(1, 'Classification scheme is required'),
  id: z.string().optional(),
  label: z.string().optional(),
});

/**
 * Zod schema for Relationship interface.
 */
export const RelationshipSchema = z.object({
  type: z.string().min(1, 'Relationship type is required'),
  target: z.string().min(1, 'Relationship target is required'),
  role: z.string().optional(),
  label: z.string().optional(),
});

/**
 * Zod schema for MediaReference interface.
 */
export const MediaReferenceSchema = z.object({
  id: z.string().min(1, 'Media reference ID is required'),
  type: z.enum(['image', 'video', 'audio', 'document', 'model', 'other']),
  url: z.string().url('Media URL must be valid URL').optional(),
  label: z.string().optional(),
  role: z.string().optional(),
});

/**
 * Zod schema for Extension interface.
 */
export const ExtensionSchema = z.object({
  namespace: z.string().min(1, 'Extension namespace is required'),
  type: z.string().min(1, 'Extension type is required'),
  data: z.record(z.string(), z.any()),
});

/**
 * Zod schema for CanonicalRecordType.
 */
export const CanonicalRecordTypeSchema = z.enum([
  'Object',
  'Work',
  'Agent',
  'Place',
  'Event',
  'Media',
]);

/**
 * Zod schema for CanonicalRecord interface.
 * Validates the complete canonical record structure with all required and optional fields.
 */
export const CanonicalRecordSchema = z.object({
  id: z.string().min(1, 'Canonical record ID is required'),
  type: CanonicalRecordTypeSchema,
  label: z.string().min(1, 'Canonical record label is required'),
  provenance: ProvenanceSchema,
  meta: MetaSchema,
  description: z.string().optional(),
  identifiers: z.array(IdentifierSchema).optional(),
  classifications: z.array(ClassificationSchema).optional(),
  properties: z.record(z.string(), z.any()).optional(),
  dates: z.record(z.string(), z.string()).optional(),
  relationships: z.array(RelationshipSchema).optional(),
  media: z.array(MediaReferenceSchema).optional(),
  rights: z.object({
    statement: z.string(),
    uri: z.string().optional(),
    holder: z.string().optional(),
    from_date: z.string().optional(),
    to_date: z.string().optional(),
  }).optional(),
  extensions: z.array(ExtensionSchema).optional(),
});

/**
 * Zod schema for SourceRecord interface.
 * Validates immutable source data snapshots.
 */
export const SourceRecordSchema = z.object({
  id: z.string().min(1, 'Source record ID is required'),
  source: z.object({
    system: z.string().min(1, 'Source system is required'),
    dataset: z.string().optional(),
    recordId: z.string().min(1, 'Source record ID is required'),
  }),
  capturedAt: z.string().datetime('Captured timestamp must be valid ISO 8601'),
  raw: z.record(z.string(), z.any()),
  meta: z.record(z.string(), z.any()),
});

/**
 * Zod schema for MappingReport interface.
 * Validates transformation diagnostic reports.
 */
export const MappingReportSchema = z.object({
  references: z.object({
    pipelineId: z.string().optional(),
    snapshotId: z.string().min(1, 'Snapshot ID is required'),
    mappingId: z.string().min(1, 'Mapping ID is required'),
    transformId: z.string().min(1, 'Transform ID is required'),
  }),
  status: z.enum(['success', 'partial', 'failed']),
  warnings: z.array(z.string()),
  ruleExecution: z.object({
    totalRules: z.number().int().nonnegative(),
    executedRules: z.number().int().nonnegative(),
    skippedRules: z.number().int().nonnegative(),
    failedRules: z.number().int().nonnegative(),
    fieldsMapped: z.number().int().nonnegative(),
    fieldsDropped: z.number().int().nonnegative(),
  }),
  diffSummary: z.object({
    sourceFieldCount: z.number().int().nonnegative(),
    canonicalFieldCount: z.number().int().nonnegative(),
    fieldsAdded: z.array(z.string()),
    fieldsTransformed: z.number().int().nonnegative(),
    fieldsDropped: z.number().int().nonnegative(),
    enrichmentsApplied: z.number().int().nonnegative(),
  }),
});

/**
 * Zod schema for ProjectionResponse interface.
 * Validates ephemeral projection outputs.
 */
export const ProjectionResponseSchema = z.object({
  recordId: z.string().min(1, 'Record ID is required'),
  mode: z.enum(['source', 'destination']),
  mappingId: z.string().nullable(),
  snapshotId: z.string().min(1, 'Snapshot ID is required'),
  projection: z.record(z.string(), z.any()),
  meta: z.object({
    hash: z.string().min(1, 'Projection hash is required'),
    generatedAt: z.string().datetime('Generated timestamp must be valid ISO 8601'),
  }),
});

/**
 * Enhanced validation result with schema version mismatch detection.
 */
export type ValidationResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: {
        message: string;
        issues: z.ZodIssue[];
        schemaVersionMismatch?: boolean;
      };
    };

/**
 * Validate a canonical record with schema version mismatch detection.
 *
 * This function provides enhanced validation that checks not only the structure
 * but also detects schema version mismatches that might indicate data migration needs.
 *
 * @param data - The data to validate as a CanonicalRecord
 * @param expectedVersion - The expected schema version (default: '1.0.0')
 * @returns Validation result with descriptive errors and schema version info
 *
 * @example
 * ```typescript
 * const result = validateCanonicalRecord(apiResponse);
 * if (!result.success) {
 *   if (result.error.schemaVersionMismatch) {
 *     console.warn('Schema version mismatch - migration may be needed');
 *     console.warn(result.error.message);
 *   } else {
 *     console.error('Validation failed:', result.error.issues);
 *   }
 *   return;
 * }
 * const record = result.data;
 * ```
 */
export function validateCanonicalRecord(
  data: unknown,
  expectedVersion: string = '1.0.0'
): ValidationResult<CanonicalRecord> {
  const result = CanonicalRecordSchema.safeParse(data);

  if (!result.success) {
    return {
      success: false,
      error: {
        message: 'Canonical record validation failed',
        issues: result.error.issues,
      },
    };
  }

  // Check for schema version mismatch
  const actualVersion = result.data.meta.schemaVersion;
  if (actualVersion !== expectedVersion) {
    return {
      success: false,
      error: {
        message: `Schema version mismatch: expected ${expectedVersion}, got ${actualVersion}`,
        issues: [],
        schemaVersionMismatch: true,
      },
    };
  }

  return { success: true, data: result.data };
}

/**
 * Validate a source record.
 *
 * @param data - The data to validate as a SourceRecord
 * @returns Validation result with descriptive errors
 */
export function validateSourceRecord(data: unknown): ValidationResult<SourceRecord> {
  const result = SourceRecordSchema.safeParse(data);

  if (!result.success) {
    return {
      success: false,
      error: {
        message: 'Source record validation failed',
        issues: result.error.issues,
      },
    };
  }

  return { success: true, data: result.data };
}

/**
 * Validate a mapping report.
 *
 * @param data - The data to validate as a MappingReport
 * @returns Validation result with descriptive errors
 */
export function validateMappingReport(data: unknown): ValidationResult<MappingReport> {
  const result = MappingReportSchema.safeParse(data);

  if (!result.success) {
    return {
      success: false,
      error: {
        message: 'Mapping report validation failed',
        issues: result.error.issues,
      },
    };
  }

  return { success: true, data: result.data };
}

/**
 * Validate a projection response.
 *
 * @param data - The data to validate as a ProjectionResponse
 * @returns Validation result with descriptive errors
 */
export function validateProjectionResponse(
  data: unknown
): ValidationResult<ProjectionResponse> {
  const result = ProjectionResponseSchema.safeParse(data);

  if (!result.success) {
    return {
      success: false,
      error: {
        message: 'Projection response validation failed',
        issues: result.error.issues,
      },
    };
  }

  return { success: true, data: result.data };
}

/**
 * Format Zod validation errors into human-readable messages.
 *
 * Useful for displaying validation errors to users or logging.
 *
 * @param issues - Zod validation issues from a failed parse
 * @returns Array of formatted error messages
 *
 * @example
 * ```typescript
 * const result = CanonicalRecordSchema.safeParse(data);
 * if (!result.success) {
 *   const messages = formatValidationErrors(result.error.issues);
 *   messages.forEach(msg => console.error(msg));
 * }
 * ```
 */
export function formatValidationErrors(issues: z.ZodIssue[]): string[] {
  return issues.map((issue) => {
    const path = issue.path.join('.');
    return `${path ? `${path}: ` : ''}${issue.message}`;
  });
}

// ============================================================================
// CANONICAL INVARIANT ENFORCEMENT
// ============================================================================

/**
 * Invariant violation error with descriptive context.
 */
export class CanonicalInvariantError extends Error {
  invariant: string;
  details: string;
  data?: unknown;

  constructor(invariant: string, details: string, data?: unknown) {
    super(`Canonical invariant violated: ${invariant} - ${details}`);
    this.name = 'CanonicalInvariantError';
    this.invariant = invariant;
    this.details = details;
    this.data = data;
  }
}

/**
 * Result of invariant checking.
 */
export type InvariantCheckResult =
  | { valid: true }
  | { valid: false; violations: string[] };

/**
 * Canonical field keys that extensions must not overwrite.
 * These are the reserved top-level keys in CanonicalRecord.
 */
const CANONICAL_RESERVED_KEYS = [
  'id',
  'type',
  'label',
  'provenance',
  'meta',
  'description',
  'identifiers',
  'classifications',
  'properties',
  'dates',
  'relationships',
  'media',
  'rights',
  'extensions',
] as const;

/**
 * Check that a CanonicalRecord has valid provenance.
 *
 * INVARIANT: CanonicalRecord must always have provenance
 *
 * Provenance is required for reproducibility, audit, and debugging.
 * A canonical record without provenance cannot be traced back to its
 * source data, making it impossible to verify or replay transformations.
 *
 * @param record - The canonical record to check
 * @returns Invariant check result
 *
 * @example
 * ```typescript
 * const result = assertProvenanceExists(record);
 * if (!result.valid) {
 *   throw new CanonicalInvariantError(
 *     'provenance_required',
 *     result.violations.join('; '),
 *     record
 *   );
 * }
 * ```
 */
export function assertProvenanceExists(
  record: Partial<CanonicalRecord>
): InvariantCheckResult {
  const violations: string[] = [];

  if (!record.provenance) {
    violations.push('Provenance is required but missing');
    return { valid: false, violations };
  }

  // Check required provenance fields
  const requiredFields: (keyof Provenance)[] = [
    'system',
    'recordId',
    'sourceRecordId',
    'snapshotId',
    'mappingId',
    'transformId',
    'ingestedAt',
  ];

  for (const field of requiredFields) {
    if (!record.provenance[field]) {
      violations.push(`Provenance.${field} is required but missing`);
    }
  }

  return violations.length > 0
    ? { valid: false, violations }
    : { valid: true };
}

/**
 * Check that a CanonicalRecord does not contain raw source payloads.
 *
 * INVARIANT: CanonicalRecord must not contain raw source payloads
 *
 * Canonical records should reference source records via provenance.snapshotId,
 * not embed the raw source data. Embedding source data:
 * - Bloats canonical records with potentially large payloads
 * - Violates the separation between source and canonical layers
 * - Makes canonical records harder to query and serialize
 * - Prevents proper source data versioning and immutability
 *
 * This check looks for suspicious keys that suggest raw source embedding:
 * - "raw", "raw_data", "source_raw"
 * - "source_payload", "original_data"
 * - Keys with "airtable_", "salesforce_", etc. prefixes (should be in extensions)
 *
 * @param record - The canonical record to check
 * @returns Invariant check result
 *
 * @example
 * ```typescript
 * const result = assertNoRawSourceData(record);
 * if (!result.valid) {
 *   console.warn('Record contains raw source data:', result.violations);
 * }
 * ```
 */
export function assertNoRawSourceData(
  record: Partial<CanonicalRecord>
): InvariantCheckResult {
  const violations: string[] = [];

  // Suspicious top-level keys that suggest raw source embedding
  const suspiciousKeys = [
    'raw',
    'raw_data',
    'source_raw',
    'source_payload',
    'original_data',
    'original_payload',
    '_raw',
    '_source',
  ];

  const recordKeys = Object.keys(record);

  for (const key of suspiciousKeys) {
    if (recordKeys.includes(key)) {
      violations.push(
        `Suspicious key "${key}" suggests raw source data embedding. ` +
        `Use provenance.snapshotId to reference source data instead.`
      );
    }
  }

  // Check for source-system-specific prefixes that should be in extensions
  const systemPrefixes = [
    'airtable_',
    'salesforce_',
    'postgres_',
    'mongodb_',
    'api_',
    'emuseum_',
    'tms_',
  ];

  for (const key of recordKeys) {
    for (const prefix of systemPrefixes) {
      if (key.startsWith(prefix)) {
        violations.push(
          `Key "${key}" has source-system prefix "${prefix}". ` +
          `Source-specific data should be in extensions, not top-level canonical fields.`
        );
      }
    }
  }

  return violations.length > 0
    ? { valid: false, violations }
    : { valid: true };
}

/**
 * Check that extensions do not overwrite canonical field keys.
 *
 * INVARIANT: Extensions must not overwrite canonical keys
 *
 * Extensions are supplementary data that must not interfere with canonical
 * fields. Allowing extensions to overwrite canonical keys would:
 * - Break the stable API contract for canonical records
 * - Create ambiguity about which value is authoritative
 * - Make schema evolution unpredictable
 * - Violate the "safe to ignore" principle for extensions
 *
 * This check ensures extension namespaces don't collide with reserved
 * canonical field names.
 *
 * @param record - The canonical record to check
 * @returns Invariant check result
 *
 * @example
 * ```typescript
 * const result = assertExtensionsDontOverwrite(record);
 * if (!result.valid) {
 *   throw new CanonicalInvariantError(
 *     'extension_key_collision',
 *     result.violations.join('; '),
 *     record
 *   );
 * }
 * ```
 */
export function assertExtensionsDontOverwrite(
  record: Partial<CanonicalRecord>
): InvariantCheckResult {
  const violations: string[] = [];

  if (!record.extensions || record.extensions.length === 0) {
    return { valid: true }; // No extensions, nothing to check
  }

  // Check each extension's namespace doesn't match canonical keys
  for (const extension of record.extensions) {
    if (CANONICAL_RESERVED_KEYS.includes(extension.namespace as any)) {
      violations.push(
        `Extension namespace "${extension.namespace}" collides with reserved canonical field. ` +
        `Use a namespaced prefix like "source:${extension.namespace}" or "org:${extension.namespace}".`
      );
    }

    // Check extension.data doesn't try to overwrite canonical structure
    const dataKeys = Object.keys(extension.data);
    for (const key of dataKeys) {
      if (CANONICAL_RESERVED_KEYS.includes(key as any)) {
        violations.push(
          `Extension "${extension.namespace}:${extension.type}" contains data key "${key}" ` +
          `that matches a reserved canonical field. This may cause confusion.`
        );
      }
    }
  }

  return violations.length > 0
    ? { valid: false, violations }
    : { valid: true };
}

/**
 * Check that schemaVersion is present and valid.
 *
 * INVARIANT: schemaVersion must be present and valid
 *
 * The schemaVersion field is critical for:
 * - Schema migration detection and execution
 * - Forward/backward compatibility checks
 * - API contract versioning
 * - Client-side conditional rendering
 *
 * Valid schema versions must:
 * - Follow semantic versioning (major.minor.patch)
 * - Be non-empty strings
 * - Match the expected schema version for the current system
 *
 * @param record - The canonical record to check
 * @param expectedVersion - The expected schema version (default: '1.0.0')
 * @returns Invariant check result
 *
 * @example
 * ```typescript
 * const result = assertSchemaVersionValid(record, '1.0.0');
 * if (!result.valid) {
 *   if (result.violations.some(v => v.includes('mismatch'))) {
 *     console.warn('Schema migration may be needed:', result.violations);
 *   } else {
 *     throw new CanonicalInvariantError(
 *       'invalid_schema_version',
 *       result.violations.join('; '),
 *       record
 *     );
 *   }
 * }
 * ```
 */
export function assertSchemaVersionValid(
  record: Partial<CanonicalRecord>,
  expectedVersion: string = '1.0.0'
): InvariantCheckResult {
  const violations: string[] = [];

  if (!record.meta) {
    violations.push('Meta is required but missing (needed for schemaVersion)');
    return { valid: false, violations };
  }

  const { schemaVersion } = record.meta;

  if (!schemaVersion) {
    violations.push('Meta.schemaVersion is required but missing');
    return { valid: false, violations };
  }

  // Check semantic versioning format
  const semverPattern = /^\d+\.\d+\.\d+$/;
  if (!semverPattern.test(schemaVersion)) {
    violations.push(
      `Meta.schemaVersion "${schemaVersion}" is not valid semantic version (expected format: X.Y.Z)`
    );
  }

  // Check version match
  if (schemaVersion !== expectedVersion) {
    violations.push(
      `Meta.schemaVersion mismatch: expected "${expectedVersion}", got "${schemaVersion}". ` +
      `Schema migration may be required.`
    );
  }

  return violations.length > 0
    ? { valid: false, violations }
    : { valid: true };
}

/**
 * Run all canonical invariant checks on a record.
 *
 * This is the primary function to call during ingest and projection to ensure
 * a canonical record follows all required invariants.
 *
 * @param record - The canonical record to validate
 * @param options - Validation options
 * @returns Combined invariant check result
 *
 * @example
 * ```typescript
 * // During ingest pipeline
 * const result = enforceCanonicalInvariants(canonicalRecord, {
 *   expectedSchemaVersion: '1.0.0',
 *   throwOnViolation: true,
 * });
 *
 * if (!result.valid) {
 *   console.error('Invariant violations:', result.violations);
 *   // Handle violations (log, reject, fix)
 * }
 *
 * // During projection
 * const result = enforceCanonicalInvariants(projectedRecord, {
 *   checkRawSource: true, // Extra strict
 *   throwOnViolation: false, // Log warnings instead
 * });
 * ```
 */
export function enforceCanonicalInvariants(
  record: Partial<CanonicalRecord>,
  options: {
    expectedSchemaVersion?: string;
    checkRawSource?: boolean;
    throwOnViolation?: boolean;
  } = {}
): InvariantCheckResult {
  const {
    expectedSchemaVersion = '1.0.0',
    checkRawSource = true,
    throwOnViolation = false,
  } = options;

  const allViolations: string[] = [];

  // Check 1: Provenance must exist
  const provenanceCheck = assertProvenanceExists(record);
  if (!provenanceCheck.valid) {
    allViolations.push(...provenanceCheck.violations);
  }

  // Check 2: Schema version must be valid
  const schemaCheck = assertSchemaVersionValid(record, expectedSchemaVersion);
  if (!schemaCheck.valid) {
    allViolations.push(...schemaCheck.violations);
  }

  // Check 3: Extensions must not overwrite canonical keys
  const extensionsCheck = assertExtensionsDontOverwrite(record);
  if (!extensionsCheck.valid) {
    allViolations.push(...extensionsCheck.violations);
  }

  // Check 4: No raw source data (optional, can be expensive)
  if (checkRawSource) {
    const rawSourceCheck = assertNoRawSourceData(record);
    if (!rawSourceCheck.valid) {
      allViolations.push(...rawSourceCheck.violations);
    }
  }

  const result: InvariantCheckResult =
    allViolations.length > 0
      ? { valid: false, violations: allViolations }
      : { valid: true };

  // Optionally throw on violation
  if (!result.valid && throwOnViolation) {
    throw new CanonicalInvariantError(
      'canonical_invariants_violated',
      result.violations.join('; '),
      record
    );
  }

  return result;
}

/**
 * Validate a canonical record is safe for API consumption.
 *
 * This is a convenience wrapper that runs both Zod schema validation
 * and invariant checks, suitable for API boundary validation.
 *
 * @param data - The data to validate
 * @param options - Validation options
 * @returns Combined validation result
 *
 * @example
 * ```typescript
 * // API endpoint handler
 * app.post('/entities', (req, res) => {
 *   const result = validateCanonicalRecordForAPI(req.body, {
 *     expectedSchemaVersion: '1.0.0',
 *   });
 *
 *   if (!result.valid) {
 *     return res.status(400).json({
 *       error: 'Invalid canonical record',
 *       details: result.errors,
 *     });
 *   }
 *
 *   // Safe to persist
 *   await saveCanonicalRecord(result.data);
 *   res.json(result.data);
 * });
 * ```
 */
export function validateCanonicalRecordForAPI(
  data: unknown,
  options: {
    expectedSchemaVersion?: string;
    checkRawSource?: boolean;
  } = {}
):
  | { valid: true; data: CanonicalRecord }
  | { valid: false; errors: string[] }
{
  const { expectedSchemaVersion = '1.0.0', checkRawSource = true } = options;

  // Step 1: Zod schema validation
  const schemaValidation = validateCanonicalRecord(data, expectedSchemaVersion);
  if (!schemaValidation.success) {
    return {
      valid: false,
      errors: formatValidationErrors(schemaValidation.error.issues),
    };
  }

  const record = schemaValidation.data;

  // Step 2: Invariant checks
  const invariantCheck = enforceCanonicalInvariants(record, {
    expectedSchemaVersion,
    checkRawSource,
    throwOnViolation: false,
  });

  if (!invariantCheck.valid) {
    return {
      valid: false,
      errors: invariantCheck.violations,
    };
  }

  return { valid: true, data: record };
}

// ============================================================================
// EXAMPLE FIXTURES
// ============================================================================

/**
 * Example CanonicalRecord (Object type) representing a museum artwork.
 *
 * This fixture demonstrates:
 * - Complete canonical record structure with all required fields
 * - Museum-style cultural heritage data (artwork with creator, date, materials)
 * - Proper use of identifiers, classifications, and relationships
 * - Media references for images
 * - Rights and licensing information
 * - Extensions for domain-specific data
 *
 * Suitable for:
 * - API documentation examples
 * - Unit test fixtures
 * - Schema validation testing
 * - Frontend development and prototyping
 */
export const EXAMPLE_CANONICAL_RECORD: CanonicalRecord = {
  id: "object:museum:2024.15.1",
  type: "Object",
  label: "The Starry Night",

  provenance: {
    system: "collection-management-system",
    dataset: "artworks",
    recordId: "artwork_12345",
    sourceRecordId: "artwork_12345",
    snapshotId: "snap_a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    mappingId: "mapping_artwork_v1.2.0",
    transformId: "transform_enrich_v1.1.0",
    pipelineId: "route_cms_to_canonical",
    ingestedAt: "2024-01-15T14:30:00Z",
    contentHash: "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  },

  meta: {
    schemaVersion: "1.0.0",
    createdAt: "2024-01-15T14:30:00Z",
    updatedAt: "2024-01-15T14:30:00Z",
  },

  description: "A swirling night sky over a small French village, painted in vibrant blues and yellows. The composition features a prominent cypress tree in the foreground and a crescent moon and stars rendered with distinctive circular brushstrokes. Created during the artist's stay at the Saint-Paul-de-Mausole asylum in Saint-Rémy-de-Provence.",

  identifiers: [
    {
      scheme: "accession-number",
      value: "2024.15.1",
    },
    {
      scheme: "local",
      value: "ART-12345",
    },
    {
      scheme: "wikidata",
      value: "Q45585",
    },
  ],

  classifications: [
    {
      scheme: "aat",
      id: "300033618",
      label: "paintings (visual works)",
    },
    {
      scheme: "aat",
      id: "300015050",
      label: "oil paint (paint)",
    },
    {
      scheme: "local",
      label: "Post-Impressionism",
    },
  ],

  properties: {
    creator: "Vincent van Gogh",
    creatorRole: "artist",
    medium: "Oil on canvas",
    dimensions: "73.7 × 92.1 cm (29 × 36 1/4 in.)",
    creationDate: "June 1889",
    creationPlace: "Saint-Rémy-de-Provence, France",
    creditLine: "Acquired through the Bequest of Abigail Aldrich Rockefeller",
    department: "European Paintings",
    onView: true,
    gallery: "Gallery 825",
  },

  dates: {
    created: "1889-06",
    acquired: "1941-05-15",
    published: "2024-01-15",
  },

  relationships: [
    {
      type: "created_by",
      target: "agent:viaf:9854560",
      label: "Vincent van Gogh",
      role: "artist",
    },
    {
      type: "depicts",
      target: "place:geonames:2982652",
      label: "Saint-Rémy-de-Provence",
      role: "location",
    },
    {
      type: "part_of",
      target: "collection:museum:european-paintings",
      label: "European Paintings Collection",
      role: "collection",
    },
  ],

  media: [
    {
      id: "https://cdn.museum.org/images/2024.15.1/full.jpg",
      type: "image",
      url: "https://cdn.museum.org/images/2024.15.1/full.jpg",
      label: "The Starry Night, oil on canvas, 1889",
      role: "primary",
    },
    {
      id: "https://cdn.museum.org/images/2024.15.1/thumb.jpg",
      type: "image",
      url: "https://cdn.museum.org/images/2024.15.1/thumb.jpg",
      label: "Thumbnail",
      role: "thumbnail",
    },
    {
      id: "https://cdn.museum.org/images/2024.15.1/detail_sky.jpg",
      type: "image",
      url: "https://cdn.museum.org/images/2024.15.1/detail_sky.jpg",
      label: "Detail of night sky",
      role: "detail",
    },
  ],

  rights: {
    statement: "Public Domain",
    uri: "https://creativecommons.org/publicdomain/mark/1.0/",
    holder: "Museum Name",
    notes: "This work is in the public domain. No copyright restrictions apply.",
  },

  extensions: [
    {
      namespace: "domain:art-history",
      type: "conservation-notes",
      data: {
        lastConservationDate: "2015-03-10",
        condition: "excellent",
        notes: "Minor surface cleaning performed. No structural issues.",
      },
    },
    {
      namespace: "org:museum",
      type: "exhibition-history",
      data: {
        exhibitions: [
          {
            title: "Van Gogh and the Post-Impressionists",
            venue: "Museum Gallery",
            dates: "2023-06-01/2023-09-15",
          },
        ],
      },
    },
  ],
};

/**
 * Example SourceRecord representing a snapshot from a collection management system.
 *
 * This fixture demonstrates:
 * - Immutable source data snapshot structure
 * - Raw source data preserved exactly as received
 * - Source system coordinates (system, dataset, recordId)
 * - Metadata about the snapshot (hash, byte size, capture method)
 *
 * Suitable for:
 * - Testing transformation reproducibility
 * - Debugging mapping issues
 * - API documentation for ingestion endpoints
 * - Understanding source data structure
 */
export const EXAMPLE_SOURCE_RECORD: SourceRecord = {
  id: "snap_a1b2c3d4-e5f6-7890-abcd-ef1234567890",

  source: {
    system: "collection-management-system",
    dataset: "artworks",
    recordId: "artwork_12345",
  },

  capturedAt: "2024-01-15T14:25:00Z",

  raw: {
    object_id: 12345,
    title: "The Starry Night",
    artist_name: "Vincent van Gogh",
    artist_id: 567,
    date_created: "1889-06",
    medium: "Oil on canvas",
    dimensions_cm: {
      height: 73.7,
      width: 92.1,
    },
    dimensions_in: {
      height: 29.0,
      width: 36.25,
    },
    accession_number: "2024.15.1",
    department: "European Paintings",
    credit_line: "Acquired through the Bequest of Abigail Aldrich Rockefeller",
    description: "A swirling night sky over a small French village, painted in vibrant blues and yellows. The composition features a prominent cypress tree in the foreground and a crescent moon and stars rendered with distinctive circular brushstrokes.",
    creation_place: "Saint-Rémy-de-Provence, France",
    on_view: true,
    gallery_number: "825",
    image_urls: [
      "https://cms.internal/images/12345/full.jpg",
      "https://cms.internal/images/12345/thumb.jpg",
      "https://cms.internal/images/12345/detail1.jpg",
    ],
    classifications: ["painting", "oil painting", "Post-Impressionism"],
    wikidata_id: "Q45585",
    rights_statement: "Public Domain",
    created_at: "2020-03-15T10:00:00Z",
    updated_at: "2024-01-10T16:45:00Z",
  },

  meta: {
    contentHash: "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    byteSize: 2048,
    sourceVersion: "cms-api-v2.1",
    extractionMethod: "rest-api",
    compressionType: null,
  },
};

/**
 * Example MappingReport showing transformation diagnostics.
 *
 * This fixture demonstrates:
 * - Successful transformation with minor warnings
 * - Rule execution statistics
 * - High-level diff summary
 * - Descriptive warning messages
 * - Complete pipeline references
 *
 * Suitable for:
 * - Debugging transformation issues
 * - Quality assurance testing
 * - API documentation for mapping reports
 * - Understanding transformation behavior
 */
export const EXAMPLE_MAPPING_REPORT: MappingReport = {
  references: {
    pipelineId: "route_cms_to_canonical",
    snapshotId: "snap_a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    mappingId: "mapping_artwork_v1.2.0",
    transformId: "transform_enrich_v1.1.0",
  },

  status: "partial",

  warnings: [
    "Source field 'provenance_history' not found, omitting provenance details from canonical",
    "Multiple values found for 'subject_terms', using first value only",
    "Date format 'circa 1889' could not be parsed to ISO 8601, using original format",
  ],

  ruleExecution: {
    totalRules: 42,
    executedRules: 38,
    skippedRules: 3,
    failedRules: 1,
    fieldsMapped: 35,
    fieldsDropped: 7,
  },

  diffSummary: {
    sourceFieldCount: 24,
    canonicalFieldCount: 35,
    fieldsAdded: ["id", "type", "provenance", "meta"],
    fieldsTransformed: 20,
    fieldsDropped: 4,
    enrichmentsApplied: 2,
  },
};

/**
 * Example ProjectionResponse showing destination projection output.
 *
 * This fixture demonstrates:
 * - Ephemeral projection result structure
 * - Destination mode (source → canonical transformation)
 * - Complete canonical record in projection payload
 * - Content hash for determinism verification
 * - Generation timestamp
 *
 * Suitable for:
 * - Testing projection endpoints
 * - Preview/validation workflows
 * - API documentation for projections
 * - Understanding projection vs. persistence
 */
export const EXAMPLE_PROJECTION_RESPONSE: ProjectionResponse = {
  recordId: "artwork_12345",

  mode: "destination",

  mappingId: "mapping_artwork_v1.2.0",

  snapshotId: "snap_a1b2c3d4-e5f6-7890-abcd-ef1234567890",

  projection: {
    id: "object:museum:2024.15.1",
    type: "Object",
    label: "The Starry Night",
    provenance: {
      system: "collection-management-system",
      dataset: "artworks",
      recordId: "artwork_12345",
      sourceRecordId: "artwork_12345",
      snapshotId: "snap_a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      mappingId: "mapping_artwork_v1.2.0",
      transformId: "transform_enrich_v1.1.0",
      ingestedAt: "2024-01-15T14:30:00Z",
    },
    meta: {
      schemaVersion: "1.0.0",
      createdAt: "2024-01-15T14:30:00Z",
      updatedAt: "2024-01-15T14:30:00Z",
    },
    description: "A swirling night sky over a small French village, painted in vibrant blues and yellows.",
    identifiers: [
      {
        scheme: "accession-number",
        value: "2024.15.1",
      },
    ],
    properties: {
      creator: "Vincent van Gogh",
      medium: "Oil on canvas",
      dimensions: "73.7 × 92.1 cm",
      creationDate: "June 1889",
    },
    dates: {
      created: "1889-06",
    },
    media: [
      {
        id: "https://cdn.museum.org/images/2024.15.1/full.jpg",
        type: "image",
        role: "primary",
      },
    ],
  },

  meta: {
    hash: "sha256:1a2b3c4d5e6f7890abcdef1234567890abcdef1234567890abcdef1234567890",
    generatedAt: "2024-01-15T14:30:15Z",
  },
};

/**
 * All example fixtures as a collection for bulk testing.
 */
export const EXAMPLE_FIXTURES = {
  canonicalRecord: EXAMPLE_CANONICAL_RECORD,
  sourceRecord: EXAMPLE_SOURCE_RECORD,
  mappingReport: EXAMPLE_MAPPING_REPORT,
  projectionResponse: EXAMPLE_PROJECTION_RESPONSE,
} as const;
