/**
 * Canonical Record Runtime Validation
 *
 * Provides Zod-based runtime validation for canonical records at the API boundary.
 * Validates the envelope structure without deep validation of properties/extensions.
 *
 * Purpose:
 * - Catch malformed payloads before they crash the UI
 * - Detect and gracefully handle legacy payloads
 * - Log diagnostic information for debugging
 *
 * Usage:
 *   import { parseCanonicalRecord, parseCanonicalRecordSafe } from './canonicalValidation';
 *
 *   // Throws on invalid (use in data fetching)
 *   const record = parseCanonicalRecord(payload, { endpoint: '/api/entities/123' });
 *
 *   // Returns result object (use in UI components)
 *   const result = parseCanonicalRecordSafe(payload);
 *   if (result.type === 'legacy') { ... }
 *   if (result.type === 'invalid') { ... }
 *   if (result.type === 'valid') { ... }
 */

import { z } from 'zod';
import { logger } from './logger';

// =============================================================================
// CANONICAL ENVELOPE SCHEMAS
// =============================================================================

/**
 * Canonical record type enum.
 */
export const CanonicalRecordTypeSchema = z.enum([
  'Object',
  'Work',
  'Agent',
  'Place',
  'Event',
  'Media',
]);

export type CanonicalRecordType = z.infer<typeof CanonicalRecordTypeSchema>;

/**
 * Provenance source coordinates - identifies where the record came from.
 * This is the stable identity of the source record.
 */
const ProvenanceSourceSchema = z.object({
  system: z.string().min(1),
  dataset: z.string().optional().nullable(),
  recordId: z.string().min(1),
});

/**
 * Provenance envelope - tracks source and ingestion metadata.
 * Uses lenient validation for optional fields that may vary by backend version.
 */
const ProvenanceEnvelopeSchema = z.object({
  source: ProvenanceSourceSchema,
  sourceRecordId: z.string().optional().nullable(),
  snapshotId: z.string().optional().nullable(),
  mappingId: z.string().optional().nullable(),
  transformId: z.string().optional().nullable(),
  pipelineId: z.string().optional().nullable(),
  ingestedAt: z.string(), // ISO 8601 timestamp
}).passthrough();

/**
 * Meta envelope - system-managed metadata.
 */
const MetaEnvelopeSchema = z.object({
  schemaVersion: z.string(),
  createdAt: z.string(), // ISO 8601 timestamp
  updatedAt: z.string(), // ISO 8601 timestamp
  hash: z.string().optional().nullable(),
  // Legacy fields
  validationStatus: z.string().optional(),
  originalFormat: z.string().optional(),
}).passthrough();

/**
 * Identifier schema - external IDs.
 */
const IdentifierSchema = z.object({
  scheme: z.string(),
  value: z.string(),
});

/**
 * Extension schema - namespaced custom data.
 */
const ExtensionSchema = z.object({
  namespace: z.string(),
  type: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Canonical record envelope schema.
 *
 * This is a LENIENT schema that validates the envelope structure without
 * enforcing deep validation of properties, classifications, etc.
 *
 * Required fields: id, type, label, provenance, meta
 * Optional fields: everything else (validated if present)
 */
export const CanonicalRecordEnvelopeSchema = z.object({
  // Required core fields
  id: z.string().min(1, 'Canonical record ID is required'),
  type: CanonicalRecordTypeSchema,
  label: z.string().min(1, 'Canonical record label is required'),

  // Required metadata
  provenance: ProvenanceEnvelopeSchema,
  meta: MetaEnvelopeSchema,

  // Optional fields with minimal validation
  description: z.string().optional().nullable(),
  status: z.string().optional().nullable(),
  identifiers: z.array(IdentifierSchema).optional(),
  classifications: z.array(z.object({
    scheme: z.string(),
    id: z.string().optional().nullable(),
    label: z.string().optional().nullable(),
  })).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  relationships: z.array(z.object({
    type: z.string(),
    target: z.string(),
    role: z.string().optional().nullable(),
    label: z.string().optional().nullable(),
  })).optional(),
  media: z.array(z.object({
    id: z.string(),
    type: z.string(),
    url: z.string().optional().nullable(),
    label: z.string().optional().nullable(),
    role: z.string().optional().nullable(),
  })).optional(),
  rights: z.object({
    statement: z.string().optional(),
    uri: z.string().optional(),
    holder: z.string().optional(),
  }).optional().nullable(),
  extensions: z.array(ExtensionSchema).optional(),
}).passthrough(); // Allow unknown fields for forward compatibility

export type CanonicalRecordEnvelope = z.infer<typeof CanonicalRecordEnvelopeSchema>;

// =============================================================================
// LEGACY DETECTION
// =============================================================================

/**
 * Check if a payload is a legacy (pre-canonical) format.
 *
 * Legacy payloads are detected by:
 * - Missing required canonical fields (id, type, label)
 * - Missing provenance or meta blocks
 * - meta.schemaVersion === 'legacy'
 * - meta.validationStatus === 'legacy'
 */
export function isLegacyPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return true; // Non-objects are treated as legacy
  }

  const data = payload as Record<string, unknown>;

  // Check for explicit legacy markers
  const meta = data.meta as Record<string, unknown> | undefined;
  if (meta?.schemaVersion === 'legacy' || meta?.validationStatus === 'legacy') {
    return true;
  }

  // Check for missing required canonical fields
  if (typeof data.id !== 'string' || !data.id) return true;
  if (typeof data.type !== 'string' || !data.type) return true;
  if (typeof data.label !== 'string' || !data.label) return true;

  // Check for missing provenance or meta
  if (!data.provenance || typeof data.provenance !== 'object') return true;
  if (!data.meta || typeof data.meta !== 'object') return true;

  // Check for nested source in provenance
  const prov = data.provenance as Record<string, unknown>;
  if (!prov.source || typeof prov.source !== 'object') return true;

  return false;
}

// =============================================================================
// VALIDATION RESULT TYPES
// =============================================================================

export interface CanonicalValidationSuccess {
  type: 'valid';
  record: CanonicalRecordEnvelope;
}

export interface CanonicalValidationLegacy {
  type: 'legacy';
  payload: unknown;
  /** Best-effort extracted fields for display */
  displayLabel: string;
  displayId: string | null;
}

export interface CanonicalValidationError {
  type: 'invalid';
  payload: unknown;
  errors: z.ZodIssue[];
  /** Human-readable error summary */
  message: string;
}

export type CanonicalValidationResult =
  | CanonicalValidationSuccess
  | CanonicalValidationLegacy
  | CanonicalValidationError;

// =============================================================================
// PARSE FUNCTIONS
// =============================================================================

interface ParseOptions {
  /** API endpoint URL for logging */
  endpoint?: string;
  /** Entity ID for logging (if known from wrapper) */
  entityId?: string;
}

/**
 * Log validation failure with diagnostic details.
 */
function logValidationFailure(
  type: 'invalid' | 'legacy',
  payload: unknown,
  options: ParseOptions,
  errors?: z.ZodIssue[]
): void {
  const data = payload as Record<string, unknown> | null;
  const recordId = options.entityId || (data?.id as string) || 'unknown';

  logger.error(`[CanonicalValidation] ${type.toUpperCase()} payload detected`);
  logger.error(`  Endpoint: ${options.endpoint || 'unknown'}`);
  logger.error(`  Record ID: ${recordId}`);

  if (errors && errors.length > 0) {
    logger.error('  Validation issues:');
    errors.slice(0, 5).forEach((issue, i) => {
      logger.error(`    ${i + 1}. ${issue.path.join('.')}: ${issue.message}`);
    });
    if (errors.length > 5) {
      logger.error(`    ... and ${errors.length - 5} more issues`);
    }
  }

  // Log a preview of the payload for debugging
  if (data && typeof data === 'object') {
    logger.error('  Payload preview:', {
      id: data.id,
      type: data.type,
      label: data.label,
      hasProvenance: !!data.provenance,
      hasMeta: !!data.meta,
      keys: Object.keys(data).slice(0, 10),
    });
  }
}

/**
 * Parse and validate a canonical record payload.
 * Returns a discriminated union result - never throws.
 *
 * @param payload - Raw payload to validate
 * @param options - Logging context
 * @returns Validation result (valid | legacy | invalid)
 */
export function parseCanonicalRecordSafe(
  payload: unknown,
  options: ParseOptions = {}
): CanonicalValidationResult {
  // Check for legacy payload first
  if (isLegacyPayload(payload)) {
    logValidationFailure('legacy', payload, options);

    const data = payload as Record<string, unknown> | null;
    return {
      type: 'legacy',
      payload,
      displayLabel: extractDisplayLabel(data),
      displayId: extractDisplayId(data),
    };
  }

  // Attempt strict validation
  const result = CanonicalRecordEnvelopeSchema.safeParse(payload);

  if (result.success) {
    return {
      type: 'valid',
      record: result.data,
    };
  }

  // Validation failed
  logValidationFailure('invalid', payload, options, result.error.issues);

  return {
    type: 'invalid',
    payload,
    errors: result.error.issues,
    message: formatValidationErrors(result.error.issues),
  };
}

/**
 * Parse and validate a canonical record payload.
 * Throws CanonicalValidationError on invalid payloads.
 * Returns the payload unchanged for legacy payloads (caller should check isLegacyPayload).
 *
 * @param payload - Raw payload to validate
 * @param options - Logging context
 * @returns Validated canonical record
 * @throws CanonicalValidationError on validation failure
 */
export function parseCanonicalRecord(
  payload: unknown,
  options: ParseOptions = {}
): CanonicalRecordEnvelope | unknown {
  const result = parseCanonicalRecordSafe(payload, options);

  if (result.type === 'valid') {
    return result.record;
  }

  if (result.type === 'legacy') {
    // Return legacy payload as-is - caller can use isLegacyPayload to check
    return payload;
  }

  // Throw on invalid
  throw new CanonicalPayloadError(result.message, result.errors, payload);
}

/**
 * Parse and validate an array of canonical record payloads.
 * Returns results for each payload - does not throw.
 *
 * @param payloads - Array of raw payloads
 * @param options - Logging context
 * @returns Array of validation results
 */
export function parseCanonicalRecordListSafe(
  payloads: unknown[],
  options: ParseOptions = {}
): CanonicalValidationResult[] {
  return payloads.map((payload, index) =>
    parseCanonicalRecordSafe(payload, {
      ...options,
      endpoint: options.endpoint ? `${options.endpoint}[${index}]` : undefined,
    })
  );
}

// =============================================================================
// ERROR CLASS
// =============================================================================

/**
 * Error thrown when canonical payload validation fails.
 */
export class CanonicalPayloadError extends Error {
  readonly issues: z.ZodIssue[];
  readonly payload: unknown;

  constructor(
    message: string,
    issues: z.ZodIssue[],
    payload: unknown
  ) {
    super(message);
    this.name = 'CanonicalPayloadError';
    this.issues = issues;
    this.payload = payload;
  }
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Extract a display label from a payload (best effort).
 */
function extractDisplayLabel(data: Record<string, unknown> | null): string {
  if (!data) return '(Invalid record)';

  // Try canonical label
  if (typeof data.label === 'string' && data.label) return data.label;

  // Try common legacy fields
  if (typeof data.title === 'string' && data.title) return data.title;
  if (typeof data.name === 'string' && data.name) return data.name;

  // Fallback
  return '(Legacy record)';
}

/**
 * Extract a display ID from a payload (best effort).
 */
function extractDisplayId(data: Record<string, unknown> | null): string | null {
  if (!data) return null;

  if (typeof data.id === 'string') return data.id;
  if (typeof data.entity_key === 'string') return data.entity_key;

  return null;
}

/**
 * Format Zod validation errors into a human-readable message.
 */
function formatValidationErrors(issues: z.ZodIssue[]): string {
  if (issues.length === 0) return 'Unknown validation error';

  if (issues.length === 1) {
    const issue = issues[0];
    const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    return `Invalid record payload: ${path}${issue.message}`;
  }

  const paths = issues.slice(0, 3).map(i => i.path.join('.') || 'root');
  const summary = paths.join(', ');
  const remaining = issues.length > 3 ? ` (+${issues.length - 3} more)` : '';

  return `Invalid record payload: issues with ${summary}${remaining}`;
}

// =============================================================================
// UI HELPERS
// =============================================================================

/**
 * Get display props for rendering a canonical record result.
 * Provides consistent fallbacks for legacy and invalid records.
 */
export function getRecordDisplayProps(result: CanonicalValidationResult): {
  label: string;
  id: string | null;
  type: string | null;
  isLegacy: boolean;
  isInvalid: boolean;
  errorMessage: string | null;
} {
  switch (result.type) {
    case 'valid':
      return {
        label: result.record.label,
        id: result.record.id,
        type: result.record.type,
        isLegacy: false,
        isInvalid: false,
        errorMessage: null,
      };

    case 'legacy':
      return {
        label: result.displayLabel,
        id: result.displayId,
        type: null,
        isLegacy: true,
        isInvalid: false,
        errorMessage: null,
      };

    case 'invalid':
      return {
        label: '(Invalid record)',
        id: extractDisplayId(result.payload as Record<string, unknown>),
        type: null,
        isLegacy: false,
        isInvalid: true,
        errorMessage: result.message,
      };
  }
}
