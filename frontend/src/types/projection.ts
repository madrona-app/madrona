/**
 * Projection types for dataset display configuration.
 *
 * Projections define how entity data should be displayed in different contexts
 * (list views, detail views, etc.)
 */

/** The scope/context where a projection is used */
export type ProjectionScope = 'entities_list' | 'entity_detail';

/** Field kind for display rendering */
export type FieldKind = 'text' | 'number' | 'boolean' | 'datetime' | 'json' | 'badge' | 'link' | 'image';

/** Field width for layout */
export type FieldWidth = 'narrow' | 'auto' | 'wide';

/** Field specification for display */
export interface FieldSpec {
  /** Unique key for this field */
  key?: string;
  /** The JSON path to the field in the entity payload */
  path: string;
  /** Display label for the field */
  label: string;
  /** Field kind for rendering */
  kind?: FieldKind;
  /** Field type hint for rendering (alternative to kind) */
  type?: 'string' | 'number' | 'date' | 'boolean' | 'url' | 'image' | 'array' | 'object';
  /** Whether this field is the primary identifier */
  primary?: boolean;
  /** Whether this field is the primary identifier (alias) */
  isPrimary?: boolean;
  /** Whether the field is visible */
  visible?: boolean;
  /** Field width for layout */
  width?: FieldWidth;
  /** Whether empty values are allowed */
  allow_empty?: boolean;
  /** Format string for dates or numbers */
  format?: string;
  /** Whether to truncate long values */
  truncate?: boolean;
  /** Max characters before truncation */
  maxLength?: number;
}

/** Schema reference for a projection */
export interface SchemaRef {
  schema_id: string;
  schema_version: string;
  schema_json?: Record<string, unknown>;
}

/** Projection mode */
export type ProjectionMode = 'strict' | 'hybrid' | 'lenient';

/** A complete projection configuration */
export interface Projection {
  /** Unique identifier */
  projection_id?: string;
  /** The dataset this projection belongs to */
  dataset_id: string;
  /** The scope where this projection applies */
  scope: ProjectionScope;
  /** Display name for this projection */
  name?: string;
  /** Schema reference */
  schema_ref?: SchemaRef;
  /** Projection mode */
  mode?: ProjectionMode;
  /** Fields to display */
  fields: FieldSpec[];
  /** Whether this is the default projection for this scope */
  is_default?: boolean;
  /** When this projection was created */
  created_at?: string;
  /** When this projection was last updated */
  updated_at?: string;
}

/** API response for projection list */
export interface ProjectionsResponse {
  entities_list?: Projection;
  entity_detail?: Projection;
}

/** Display field configuration for rendering */
export interface DisplayFields {
  title: FieldSpec;
  subtitle?: FieldSpec;
  badge?: FieldSpec;
  fields: FieldSpec[];
}
