/**
 * Types for database connector extraction configuration.
 *
 * These types define the structure of PipelineSource.parameters for database connectors,
 * specifying how data should be extracted from source tables/views/collections.
 */

/**
 * Transform to apply to extracted column values.
 */
export type ColumnTransform = 'none' | 'trim' | 'lowercase' | 'uppercase' | 'parse_date' | 'parse_json';

/**
 * Maps a source column to a canonical record field.
 */
export interface ColumnMapping {
  /** Column name in source table/query result */
  sourceColumn: string;
  /** Target field path in canonical record (e.g., 'label', 'properties.title') */
  targetField: string;
  /** Optional transformation to apply */
  transform?: ColumnTransform;
}

/**
 * Filter configuration for extraction queries.
 */
export interface ExtractionFilter {
  /** WHERE clause (without 'WHERE'), e.g., 'status = :status AND active = 1' */
  sql: string;
  /** Named parameters for the WHERE clause */
  params?: Record<string, string | number | boolean>;
}

/**
 * Configuration for extracting from a single table/view/collection.
 */
export interface ExtractionObject {
  /** Object ID from catalog discovery (identifies table/view) */
  objectId?: string;
  /** Schema name (e.g., 'dbo', 'public'). Can override objectId. */
  schema?: string;
  /** Table/view name. Can override objectId. */
  table?: string;
  /** Custom SQL query (overrides table selection). Use parameterized queries only. */
  customQuery?: string;
  /** Column to use as entity ID (required for incremental sync) */
  idColumn?: string;
  /** Column for incremental sync (e.g., 'updated_at', 'modified_date') */
  watermarkColumn?: string;
  /** WHERE clause conditions (parameterized) */
  filter?: ExtractionFilter;
  /** Columns to select (empty = all columns) */
  columns?: string[];
  /** How source columns map to canonical record fields */
  columnMappings?: ColumnMapping[];
  /** Maximum rows to extract (for testing/sampling) */
  limit?: number;
}

/**
 * Canonical record entity types.
 */
export type EntityType = 'Object' | 'Work' | 'Agent' | 'Place' | 'Event' | 'Media';

/**
 * Sync mode for extraction.
 */
export type SyncMode = 'full' | 'incremental';

/**
 * Extraction configuration stored in PipelineSource.parameters for database connectors.
 */
export interface ExtractionConfig {
  /** Sync mode: 'full' replaces all data, 'incremental' uses watermark */
  syncMode?: SyncMode;
  /** Tables/views to extract from (can be multiple for multi-table sync) */
  objects: ExtractionObject[];
  /** Canonical record type for extracted entities */
  entityType?: EntityType;
  /** Rows per batch during extraction (100-10000, default 1000) */
  batchSize?: number;
  /** Continue extraction if individual rows fail to process */
  continueOnError?: boolean;
}

/**
 * Creates a new empty extraction object.
 */
export function createEmptyExtractionObject(): ExtractionObject {
  return {
    schema: '',
    table: '',
    idColumn: '',
    columnMappings: [],
  };
}

/**
 * Creates a new empty extraction config.
 */
export function createEmptyExtractionConfig(): ExtractionConfig {
  return {
    syncMode: 'full',
    objects: [createEmptyExtractionObject()],
    entityType: 'Object',
    batchSize: 1000,
    continueOnError: false,
  };
}

/**
 * Creates a new empty column mapping.
 */
export function createEmptyColumnMapping(): ColumnMapping {
  return {
    sourceColumn: '',
    targetField: '',
    transform: 'none',
  };
}

/**
 * Valid target fields for column mappings.
 */
export const CANONICAL_TARGET_FIELDS = [
  { value: 'id', label: 'ID', description: 'Unique identifier for the entity' },
  { value: 'label', label: 'Label', description: 'Primary display title' },
  { value: 'description', label: 'Description', description: 'Text description' },
  { value: 'type', label: 'Type', description: 'Entity type classification' },
  { value: 'status', label: 'Status', description: 'Current status' },
  { value: 'properties.title', label: 'Title (property)', description: 'Title in properties object' },
  { value: 'properties.subtitle', label: 'Subtitle (property)', description: 'Subtitle in properties object' },
  { value: 'properties.date', label: 'Date (property)', description: 'Date in properties object' },
  { value: 'properties.location', label: 'Location (property)', description: 'Location in properties object' },
  { value: 'properties.category', label: 'Category (property)', description: 'Category in properties object' },
] as const;

/**
 * Column transform options.
 */
export const COLUMN_TRANSFORMS: { value: ColumnTransform; label: string; description: string }[] = [
  { value: 'none', label: 'None', description: 'No transformation' },
  { value: 'trim', label: 'Trim', description: 'Remove leading/trailing whitespace' },
  { value: 'lowercase', label: 'Lowercase', description: 'Convert to lowercase' },
  { value: 'uppercase', label: 'Uppercase', description: 'Convert to uppercase' },
  { value: 'parse_date', label: 'Parse Date', description: 'Parse as ISO date' },
  { value: 'parse_json', label: 'Parse JSON', description: 'Parse as JSON object' },
];

/**
 * Entity type options.
 */
export const ENTITY_TYPES: { value: EntityType; label: string; description: string }[] = [
  { value: 'Object', label: 'Object', description: 'Physical or digital object' },
  { value: 'Work', label: 'Work', description: 'Creative or intellectual work' },
  { value: 'Agent', label: 'Agent', description: 'Person or organization' },
  { value: 'Place', label: 'Place', description: 'Geographic location' },
  { value: 'Event', label: 'Event', description: 'Historical or scheduled event' },
  { value: 'Media', label: 'Media', description: 'Media asset (image, video, etc.)' },
];
