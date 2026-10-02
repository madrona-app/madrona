// Backend API response types

/**
 * JSON-serializable value type for fields that can hold any JSON value.
 * Use this instead of `any` for JSON data structures.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * JSON object type - a record of JSON values.
 */
export type JsonObject = { [key: string]: JsonValue };

export interface Run {
  run_id: string;
  organization_id: string;
  pipeline_id: string;
  status: 'pending' | 'queued' | 'running' | 'publishing' | 'success' | 'warning' | 'failed' | 'failed_publish' | 'failed_finalize' | 'canceled';
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
  processed_count: number;
  created_count: number;
  updated_count: number;
  noop_count: number;
  deleted_count: number;
  target_url: string | null;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    limit: number;
    offset: number;
    count: number;
    total_count: number;
  };
}

export interface Entity {
  entity_key: string;
  entity_type: string;
  organization_id: string;
  pipeline_id: string;
  dataset_id: string | null;
  title: string | null;
  object_number: string | null;
  modified_at: string | null;
  thumbnail_url: string | null;
  canonical_url: string | null;
  last_seen_at: string;
  last_run_id: string;
  payload: JsonObject;  // Canonical payload for projection rendering
}

export interface EntityDetail extends Entity {
  payload: JsonObject;
  fields: {
    title: string | null;
    object_number: string | null;
    modified_at: string | null;
    thumbnail_url: string | null;
  };
}

export interface ChangeEvent {
  change_id: string;
  run_id: string;
  entity_key: string;
  change_type: 'created' | 'updated' | 'noop';
  changed_at: string;
  field_diffs: FieldDiff[];
  pipeline_name?: string | null;
  dataset_name?: string | null;
  entity_type?: string | null;
}

export interface FieldDiff {
  field_name: string;
  old_value: JsonValue;
  new_value: JsonValue;
  array_delta?: number | null;
}

export interface Organization {
  organization_id: string;
  name: string;
  slug: string;
  timezone: string;
  created_at: string;
}

export interface ConnectorDefinition {
  connector_definition_id: string;
  name: string;
  type: 'source' | 'target';
  config_schema: JsonObject | null;
  created_at: string;
}

export interface ConnectorInstance {
  connector_instance_id: string;
  organization_id: string;
  connector_definition_id: string;
  name: string;
  config: JsonObject;
  created_at: string;
}

export interface Pipeline {
  pipeline_id: string;
  organization_id: string;
  source_instance_id: string;
  target_instance_id: string;
  options: JsonObject | null;
  created_at: string;
}


