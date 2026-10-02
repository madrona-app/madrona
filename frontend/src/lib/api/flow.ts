/**
 * Flow domain module — Runs, Pipelines, Connectors, Datasets, Entities,
 * Profiles, Schedules, Jobs, Transformers, Projections, and Data Onboarding.
 */
import { z } from 'zod';
import { apiFetch, validate, buildQueryString } from './_utils';
import type { JsonValue, JsonObject } from '../../types/api';
import type { ProjectionsResponse } from '../../types/projection';
import {
  RunSchema,
  PaginatedRunsSchema,
  EntityDetailSchema,
  EntitiesResponseSchema,
  EntityTypesResponseSchema,
  PaginatedChangesSchema,
  ConnectorDefinitionSchema,
  ConnectorInstanceSchema,
  DatasetSchema,
  EntityQueryResponseSchema,
  PipelineSchema,
  RollbackCheckResultSchema,
  RollbackResultSchema,
  ExtractionSchemaResponseSchema,
  PipelineScheduleSchema,
  JobsResponseSchema,
  TransformerSchema,
  ProfileSchemaZ,
  ConnectionTestResultSchema,
  CatalogResultSchema,
  ObjectDescriptionSchema,
  PreviewResultSchema,
  ActionResultSchema,
  ProjectionProfilesResponseSchema,
  ProjectionProfileUpdateResponseSchema,
  type Run,
  type EntityDetail,
  type EntitiesResponse,
  type EntityTypesResponse,
  type ConnectorDefinition,
  type ConnectorInstance,
  type Dataset,
  type EntityQueryResponse,
  type EntityQueryFilters,
  type EntityExportFormat,
  type Pipeline,
} from '../schemas';

// ============================================================================
// Runs
// ============================================================================

export const getRuns = async (params?: {
  organization_id?: string;
  pipeline_id?: string;
  dataset_id?: string;
  status?: string;
  limit?: number;
  offset?: number;
}) => {
  const orgId = params?.organization_id;
  if (!orgId) throw new Error('organization_id is required');

  const queryParams = { ...params };
  delete queryParams.organization_id;

  const query = buildQueryString(queryParams);
  const data = await apiFetch(`/organizations/${orgId}/runs${query}`);
  return validate(PaginatedRunsSchema, data);
};

export const getRun = async (runId: string, organizationId: string): Promise<Run> => {
  const data = await apiFetch(`/organizations/${organizationId}/runs/${runId}`);
  return validate(RunSchema, data);
};

export const createRun = async (pipelineId: string, organizationId: string, options?: { force_full_sync?: boolean }): Promise<Run> => {
  const data = await apiFetch(`/organizations/${organizationId}/runs`, {
    method: 'POST',
    body: JSON.stringify({
      pipeline_id: pipelineId,
      ...(options?.force_full_sync !== undefined && { force_full_sync: options.force_full_sync })
    }),
  });
  return validate(RunSchema, data);
};

export const executeRun = async (runId: string, organizationId: string): Promise<Run> => {
  const data = await apiFetch(`/organizations/${organizationId}/runs/${runId}/execute`, {
    method: 'POST',
  });
  return validate(RunSchema, data);
};

export const republishRun = async (runId: string, organizationId: string): Promise<Run> => {
  const data = await apiFetch(`/organizations/${organizationId}/runs/${runId}/republish`, {
    method: 'POST',
  });
  return validate(RunSchema, data);
};

export const deleteRun = async (runId: string, organizationId: string): Promise<void> => {
  await apiFetch(`/organizations/${organizationId}/runs/${runId}`, {
    method: 'DELETE',
  });
};

// ============================================================================
// Rollback types and functions
// ============================================================================

export interface RollbackCheckResult {
  can_rollback: boolean;
  partial: boolean;
  total_changes: number;
  rollbackable_changes: number;
  conflict_entities: string[];
  reason?: string | null;
}

export interface RollbackResult {
  rollback_run_id: string;
  status: 'success' | 'partial' | 'failed';
  reverted_creates: number;
  reverted_updates: number;
  reverted_deletes: number;
  skipped_conflicts: number;
  republish_status?: string | null;
}

export const checkRollbackFeasibility = async (
  runId: string,
  organizationId: string
): Promise<RollbackCheckResult> => {
  const data = await apiFetch(`/organizations/${organizationId}/runs/${runId}/rollback/check`);
  return validate(RollbackCheckResultSchema, data);
};

export const rollbackRun = async (
  runId: string,
  organizationId: string,
  options?: { force_partial?: boolean; skip_republish?: boolean }
): Promise<RollbackResult> => {
  const data = await apiFetch(`/organizations/${organizationId}/runs/${runId}/rollback`, {
    method: 'POST',
    body: JSON.stringify(options || {}),
  });
  return validate(RollbackResultSchema, data);
};

// ============================================================================
// Entities
// ============================================================================

export const getEntityTypes = async (tenantId: string): Promise<EntityTypesResponse> => {
  const query = buildQueryString({ organization_id: tenantId });
  const data = await apiFetch(`/entity-types${query}`);
  return validate(EntityTypesResponseSchema, data);
};

export const getEntities = async (params: {
  organization_id: string;
  entity_type?: string;
  pipeline_id?: string;
  dataset_id?: string;
  q?: string;
  limit?: number;
  offset?: number;
}): Promise<EntitiesResponse> => {
  const query = buildQueryString(params);
  const data = await apiFetch(`/entities${query}`);
  return validate(EntitiesResponseSchema, data);
};

export const getEntity = async (entityKey: string, tenantId: string): Promise<EntityDetail> => {
  const query = buildQueryString({ organization_id: tenantId });
  const data = await apiFetch(`/entities/${entityKey}${query}`);
  return validate(EntityDetailSchema, data);
};

// ============================================================================
// Changes
// ============================================================================

export const getRunChanges = async (
  runId: string,
  organizationId: string,
  params?: { limit?: number; offset?: number }
) => {
  const query = params ? buildQueryString(params) : '';
  const data = await apiFetch(`/organizations/${organizationId}/runs/${runId}/changes${query}`);
  return validate(PaginatedChangesSchema, data);
};

// ============================================================================
// Connector Definitions
// ============================================================================

export const getConnectorDefinitions = async (): Promise<ConnectorDefinition[]> => {
  const data = await apiFetch('/connector-definitions');
  return validate(z.array(ConnectorDefinitionSchema), data);
};

// Extraction Schemas (for PipelineSource.parameters configuration)
export interface ExtractionSchema {
  definitionKey: string;
  displayName?: string;
  direction?: string;
  sourceType?: string;
  extractionSchema: Record<string, any> | null;
  objectSchema: Record<string, any> | null;
  columnMappingSchema: Record<string, any> | null;
  message?: string;
}

export const getExtractionSchema = async (definitionKey: string): Promise<ExtractionSchema> => {
  const data = await apiFetch(`/connector-definitions/${definitionKey}/extraction-schema`);
  return validate(ExtractionSchemaResponseSchema, data) as unknown as ExtractionSchema;
};

export const listExtractionSchemas = async (direction?: 'source' | 'target' | 'both'): Promise<{ schemas: ExtractionSchema[] }> => {
  const query = direction ? buildQueryString({ direction }) : '';
  const data = await apiFetch(`/extraction-schemas${query}`);
  return validate(z.object({ schemas: z.array(ExtractionSchemaResponseSchema) }).passthrough(), data) as unknown as { schemas: ExtractionSchema[] };
};

// ============================================================================
// Connector Instances
// ============================================================================

export const getConnectorInstances = async (tenantId?: string): Promise<ConnectorInstance[]> => {
  const query = tenantId ? buildQueryString({ organization_id: tenantId }) : '';
  const data = await apiFetch(`/connector-instances${query}`);
  return validate(z.array(ConnectorInstanceSchema), data);
};

export const getConnectorInstance = async (instanceId: string): Promise<ConnectorInstance> => {
  const data = await apiFetch(`/connector-instances/${instanceId}`);
  return validate(ConnectorInstanceSchema, data);
};

export const createConnectorInstance = async (instance: {
  organization_id: string;
  connector_definition_id: string;
  name: string;
  config: Record<string, any>;
}): Promise<ConnectorInstance> => {
  const data = await apiFetch('/connector-instances', {
    method: 'POST',
    body: JSON.stringify(instance),
  });
  return validate(ConnectorInstanceSchema, data);
};

export const updateConnectorInstance = async (
  instanceId: string,
  updates: {
    name?: string;
    config?: Record<string, any>;
  }
): Promise<ConnectorInstance> => {
  const data = await apiFetch(`/connector-instances/${instanceId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
  return validate(ConnectorInstanceSchema, data);
};

export const deleteConnectorInstance = async (instanceId: string): Promise<void> => {
  await apiFetch(`/connector-instances/${instanceId}`, {
    method: 'DELETE',
  });
};

// ============================================================================
// Database Connector Operations
// ============================================================================

/** Result of testing a database connection */
export interface ConnectionTestResult {
  success: boolean;
  message: string;
  latency_ms?: number;
  server_version?: string;
  server_info?: Record<string, any>;
  error?: string;
  error_code?: string;
}

/** A catalog object (schema, table, collection, etc.) */
export interface CatalogObject {
  id: string;
  name: string;
  type: 'schema' | 'table' | 'view' | 'collection' | 'database';
  schema?: string;
  parent_id?: string;
  row_count?: number;
  size_bytes?: number;
  description?: string;
  children?: CatalogObject[];
}

/** Result of catalog discovery */
export interface CatalogResult {
  objects: CatalogObject[];
  cached: boolean;
  cached_at?: string;
  connector_type?: string;
}

/** Column/field metadata from describing an object */
export interface ColumnMetadata {
  name: string;
  type: string;
  native_type?: string;
  nullable: boolean;
  primary_key?: boolean;
  max_length?: number;
  description?: string;
}

/** Result of describing a catalog object */
export interface ObjectDescription {
  object_id: string;
  object_name: string;
  object_type: string;
  schema?: string;
  columns: ColumnMetadata[];
  row_count?: number;
  size_bytes?: number;
}

/** Filter for data preview */
export interface PreviewFilter {
  column: string;
  operator: 'equals' | 'not_equals' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'is_null' | 'is_not_null';
  value?: JsonValue;
}

/** Sort specification for data preview */
export interface PreviewSort {
  column: string;
  direction: 'asc' | 'desc';
}

/** Result of data preview */
export interface PreviewResult {
  columns: string[];
  rows: JsonObject[];
  total_rows?: number;
  truncated: boolean;
  query_time_ms?: number;
}

/** Available action definition */
export interface ConnectorAction {
  name: string;
  display_name: string;
  description: string;
  input_schema?: JsonObject;
  output_schema?: JsonObject;
}

/** Result of executing an action */
export interface ActionResult {
  success: boolean;
  action: string;
  result?: JsonValue;
  error?: string;
  duration_ms?: number;
}

/**
 * Test connection for a connector instance
 */
export const testConnectorConnection = async (instanceId: string): Promise<ConnectionTestResult> => {
  const data = await apiFetch(`/connector-instances/${instanceId}/test`, {
    method: 'POST',
  });
  return validate(ConnectionTestResultSchema, data);
};

/**
 * Get catalog (schemas/tables/collections) for a connector instance
 */
export const getConnectorCatalog = async (
  instanceId: string,
  options?: { refresh?: boolean }
): Promise<CatalogResult> => {
  const query = options?.refresh ? '?refresh=true' : '';
  const data = await apiFetch(`/connector-instances/${instanceId}/catalog${query}`);
  return validate(CatalogResultSchema, data) as any;
};

/**
 * Describe a specific catalog object (get columns/fields)
 */
export const describeConnectorObject = async (
  instanceId: string,
  objectId: string
): Promise<ObjectDescription> => {
  const data = await apiFetch(`/connector-instances/${instanceId}/catalog/${encodeURIComponent(objectId)}`);
  return validate(ObjectDescriptionSchema, data);
};

/**
 * Preview data from a catalog object
 */
export const previewConnectorData = async (
  instanceId: string,
  params: {
    object_id: string;
    columns?: string[];
    filters?: PreviewFilter[];
    sort?: PreviewSort[];
    limit?: number;
    offset?: number;
  }
): Promise<PreviewResult> => {
  const data = await apiFetch(`/connector-instances/${instanceId}/preview`, {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return validate(PreviewResultSchema, data) as any;
};

/**
 * Get available actions for a connector instance
 */
export const getConnectorActions = async (instanceId: string): Promise<ConnectorAction[]> => {
  const data = await apiFetch(`/connector-instances/${instanceId}/actions`);
  return validate(z.object({ actions: z.array(z.object({ name: z.string(), display_name: z.string(), description: z.string() }).passthrough()) }).passthrough(), data).actions;
};

/**
 * Execute a specific action on a connector instance
 */
export const executeConnectorAction = async (
  instanceId: string,
  actionName: string,
  params?: Record<string, any>
): Promise<ActionResult> => {
  const data = await apiFetch(`/connector-instances/${instanceId}/actions/${actionName}`, {
    method: 'POST',
    body: JSON.stringify(params || {}),
  });
  return validate(ActionResultSchema, data);
};

// ============================================================================
// PIPELINE API
// ============================================================================

export const getPipelines = async (organizationId?: string): Promise<Pipeline[]> => {
  const query = buildQueryString({ organization_id: organizationId });
  const data = await apiFetch(`/pipelines${query}`);
  return validate(z.array(PipelineSchema), data);
};

export const getPipeline = async (pipelineId: string, organizationId: string): Promise<Pipeline> => {
  const data = await apiFetch(`/organizations/${organizationId}/pipelines/${pipelineId}`);
  return validate(PipelineSchema, data);
};

export const createPipeline = async (pipeline: {
  organization_id: string;
  source_instance_id: string;
  target_instance_id?: string;
  dataset_id?: string;
  name?: string;
  options?: Record<string, any>;
}): Promise<Pipeline> => {
  const sources = [{
    connector_instance_id: pipeline.source_instance_id,
    enabled: true,
    parameters: {},
    ordering: 0,
  }];

  const destinations = pipeline.target_instance_id ? [{
    connector_instance_id: pipeline.target_instance_id,
    enabled: true,
    parameters: {},
    ordering: 0,
  }] : [];

  const data = await apiFetch('/pipelines', {
    method: 'POST',
    body: JSON.stringify({
      organization_id: pipeline.organization_id,
      name: pipeline.name || `Pipeline ${new Date().toISOString()}`,
      sources,
      destinations,
      dataset_id: pipeline.dataset_id,
      ...pipeline.options,
    }),
  });
  return validate(PipelineSchema, data);
};

export const updatePipeline = async (
  pipelineId: string,
  updates: {
    organization_id?: string;
    sources?: Array<{
      connector_instance_id: string;
      enabled?: boolean;
      parameters?: Record<string, any>;
      ordering?: number;
    }>;
    destinations?: Array<{
      connector_instance_id: string;
      enabled?: boolean;
      parameters?: Record<string, any>;
      ordering?: number;
      publish_deletes?: boolean;
      delete_strategy?: 'remove' | 'mark' | 'archive' | null;
    }>;
    dataset_id?: string | null;
    status?: string;
    delete_detection_enabled?: boolean;
    delete_detection_method?: 'full_sync' | 'incremental' | null;
    target_profile?: string | null;
    profile_validation_mode?: 'strict' | 'warn' | 'none' | null;
  }
): Promise<Pipeline> => {
  const data = await apiFetch(`/pipelines/${pipelineId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
  return validate(PipelineSchema, data);
};

export const deletePipeline = async (pipelineId: string): Promise<void> => {
  await apiFetch(`/pipelines/${pipelineId}`, {
    method: 'DELETE',
  });
};

// ============================================================================
// Profile types and functions
// ============================================================================

export interface ProfileField {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

export interface Profile {
  name: string;
  version: string;
  description: string;
  canonical_type: string;
  required_fields: ProfileField[];
  recommended_fields: ProfileField[];
  optional_fields: ProfileField[];
}

export interface ProfileListResponse {
  profiles: Profile[];
}

export const getProfiles = async (): Promise<Profile[]> => {
  const data = await apiFetch('/profiles');
  return validate(z.object({ profiles: z.array(ProfileSchemaZ) }).passthrough(), data).profiles as any;
};

export const getProfile = async (profileName: string): Promise<Profile> => {
  const data = await apiFetch(`/profiles/${profileName}`);
  return validate(ProfileSchemaZ, data) as any;
};

// ============================================================================
// Pipeline Schedule
// ============================================================================

// Pipeline Schedule types
export interface PipelineSchedule {
  schedule_id: string;
  pipeline_id: string;
  enabled: boolean;
  type: 'interval' | 'time';
  every_n?: number;
  unit?: 'minutes' | 'hours' | 'days';
  time_hour?: number;
  time_minute?: number;
  timezone: string;
  created_at: string;
  updated_at: string;
  next_run_at?: string;
  last_job?: {
    job_id: string;
    status: string;
    scheduled_for: string | null;
    run_id: string | null;
    created_at: string;
    completed_at: string | null;
  };
}

export interface PipelineScheduleResponse {
  schedule: PipelineSchedule | null;
}

// Pipeline Schedule endpoints
export const getPipelineSchedule = async (pipelineId: string): Promise<PipelineScheduleResponse> => {
  const data = await apiFetch(`/pipelines/${pipelineId}/schedule`);
  return validate(z.object({ schedule: PipelineScheduleSchema.nullable() }).passthrough(), data);
};

export const createPipelineSchedule = async (pipelineId: string, schedule: {
  type: 'interval' | 'time';
  every_n?: number;
  unit?: 'minutes' | 'hours' | 'days';
  time_hour?: number;
  time_minute?: number;
  timezone?: string;
  enabled?: boolean;
}): Promise<PipelineSchedule> => {
  const data = await apiFetch(`/pipelines/${pipelineId}/schedule`, {
    method: 'POST',
    body: JSON.stringify(schedule),
  });
  return validate(PipelineScheduleSchema, data);
};

export const updatePipelineSchedule = async (pipelineId: string, updates: {
  type?: 'interval' | 'time';
  every_n?: number;
  unit?: 'minutes' | 'hours' | 'days';
  time_hour?: number;
  time_minute?: number;
  timezone?: string;
  enabled?: boolean;
}): Promise<PipelineSchedule> => {
  const data = await apiFetch(`/pipelines/${pipelineId}/schedule`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
  return validate(PipelineScheduleSchema, data);
};

export const deletePipelineSchedule = async (pipelineId: string): Promise<void> => {
  await apiFetch(`/pipelines/${pipelineId}/schedule`, {
    method: 'DELETE',
  });
};

export const enablePipelineSchedule = async (pipelineId: string): Promise<PipelineSchedule> => {
  const data = await apiFetch(`/pipelines/${pipelineId}/schedule/enable`, {
    method: 'POST',
  });
  return validate(PipelineScheduleSchema, data);
};

export const disablePipelineSchedule = async (pipelineId: string): Promise<PipelineSchedule> => {
  const data = await apiFetch(`/pipelines/${pipelineId}/schedule/disable`, {
    method: 'POST',
  });
  return validate(PipelineScheduleSchema, data);
};

// ============================================================================
// Jobs
// ============================================================================

// Job types
export interface Job {
  job_id: string;
  organization_id: string;
  schedule_id: string | null;
  pipeline_id: string | null;
  status: 'pending' | 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
  scheduled_for: string | null;
  started_at: string | null;
  finished_at: string | null;
  attempt: number;
  error: string | null;
  run_id: string | null;
  run_status?: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface JobsResponse {
  items: Job[];
  total: number;
  limit: number;
}

// Jobs endpoints
export const getJobs = async (params: {
  organization_id: string;
  pipeline_id?: string;
  schedule_id?: string;
  limit?: number;
}): Promise<JobsResponse> => {
  const query = buildQueryString(params);
  const data = await apiFetch(`/jobs${query}`);
  return validate(JobsResponseSchema, data) as any;
};

// ============================================================================
// Datasets
// ============================================================================

export const getDatasets = async (tenantId: string): Promise<Dataset[]> => {
  const query = buildQueryString({ organization_id: tenantId });
  const data = await apiFetch(`/datasets${query}`);
  // API returns the shared list envelope {items, total, limit, offset}.
  return z.array(DatasetSchema).parse(data?.items);
};

export const createDataset = async (dataset: {
  organization_id: string;
  name: string;
  key: string;
  description?: string;
  source_type: string;
  schema?: Record<string, any>;
}): Promise<Dataset> => {
  const data = await apiFetch('/datasets', {
    method: 'POST',
    body: JSON.stringify(dataset),
  });
  return validate(DatasetSchema, data);
};

export const updateDataset = async (
  datasetId: string,
  updates: {
    name?: string;
    description?: string;
  }
): Promise<Dataset> => {
  const data = await apiFetch(`/datasets/${datasetId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
  return validate(DatasetSchema, data);
};

// ============================================================================
// Entity Export
// ============================================================================

export const queryEntities = async (
  filters: EntityQueryFilters
): Promise<EntityQueryResponse> => {
  const query = buildQueryString(filters);
  const data = await apiFetch(`/entities-current${query}`);
  return validate(EntityQueryResponseSchema, data);
};

export const exportEntities = async (
  filters: Omit<EntityQueryFilters, 'cursor' | 'limit'> & { format?: EntityExportFormat }
): Promise<Blob> => {
  const query = buildQueryString({ ...filters, format: filters.format || 'jsonl' });
  return apiFetch<Blob>(`/entities-current/export${query}`);
};

// ============================================================================
// Transformers
// ============================================================================

export interface Transformer {
  transformer_id: string;
  dataset_id: string;
  target_format: string;
  status: 'draft' | 'active' | 'archived';
  ai_provider: string | null;
  sample_count: number | null;
  code_length: number;
  generated_at: string;
  activated_at: string | null;
}

export const listTransformers = async (datasetId: string): Promise<Transformer[]> => {
  const data = await apiFetch(`/datasets/${datasetId}/transformers`);
  return validate(z.object({ transformers: z.array(TransformerSchema) }).passthrough(), data).transformers as any;
};

export const generateTransformer = async (
  datasetId: string,
  targetFormat: 'dublin-core' | 'lido' | 'schema-org',
  sampleCount: number = 3
): Promise<Transformer> => {
  const data = await apiFetch(`/datasets/${datasetId}/transformers/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target_format: targetFormat, sample_count: sampleCount }),
  });
  return validate(TransformerSchema, data) as any;
};

export const activateTransformer = async (transformerId: string): Promise<void> => {
  await apiFetch(`/datasets/transformers/${transformerId}/activate`, {
    method: 'POST',
  });
};

// ============================================================================
// Profile Settings
// ============================================================================

export interface ProfileSettings {
  [key: string]: JsonValue;
}

export const getOrganizationSettings = async (
  orgId: string,
  scope?: string
): Promise<ProfileSettings> => {
  const query = scope ? `?scope=${scope}` : '';
  const data = await apiFetch(`/organizations/${orgId}/settings${query}`);
  return validate(z.record(z.string(), z.unknown()), data) as any;
};

export const getOrganizationSetting = async (
  orgId: string,
  key: string
): Promise<any> => {
  const data = await apiFetch(`/organizations/${orgId}/settings/${key}`);
  return validate(z.object({ value: z.unknown() }).passthrough(), data).value;
};

export const getDatasetSchema = async (datasetId: string): Promise<{
  dataset_id: string;
  schema_ref: {
    schema_id: string;
    schema_version: string;
    schema_json?: Record<string, any>;
  };
}> => {
  const data = await apiFetch(`/datasets/${datasetId}/schema`);
  return validate(z.object({
    dataset_id: z.string(),
    schema_ref: z.object({
      schema_id: z.string(),
      schema_version: z.string(),
    }).passthrough(),
  }).passthrough(), data);
};

export const getDatasetProjections = async (datasetId: string): Promise<ProjectionsResponse> => {
  try {
    return await apiFetch(`/datasets/${datasetId}/projections`);
  } catch {
    // Return empty projections if endpoint doesn't exist yet
    return {};
  }
};

// ============================================================================
// Projection Profiles
// ============================================================================

// Projection Profiles (org-level display field configuration)
// Scopes match backend: entity_detail, entities_list, search
export type ProjectionProfileScope = 'entity_detail' | 'entities_list' | 'search';

// Profile for a single scope - contains role -> paths mapping
export interface ScopeProfile {
  title: string[];
  subtitle?: string[];
  thumbnail?: string[];
  snippet?: string[];
}

// Full projection config as stored in backend
export interface ProjectionConfig {
  version: string;
  profiles: Record<ProjectionProfileScope, ScopeProfile>;
}

// Response from GET /organizations/{orgId}/projection-profiles
export interface ProjectionProfilesResponse {
  organization_id: string;
  config: ProjectionConfig;
  is_default: boolean;
  defaults: ProjectionConfig;
}

// Response from PUT/DELETE endpoints
export interface ProjectionProfileUpdateResponse {
  organization_id: string;
  config: ProjectionConfig;
  is_default: boolean;
  message: string;
}

export const getProjectionProfiles = async (
  orgId: string
): Promise<ProjectionProfilesResponse> => {
  const data = await apiFetch(`/organizations/${orgId}/projection-profiles`);
  return validate(ProjectionProfilesResponseSchema, data) as any;
};

export const updateProjectionProfiles = async (
  orgId: string,
  config: ProjectionConfig
): Promise<ProjectionProfileUpdateResponse> => {
  const data = await apiFetch(`/organizations/${orgId}/projection-profiles`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  return validate(ProjectionProfileUpdateResponseSchema, data) as any;
};

export const deleteProjectionProfiles = async (
  orgId: string
): Promise<ProjectionProfileUpdateResponse> => {
  const data = await apiFetch(`/organizations/${orgId}/projection-profiles`, {
    method: 'DELETE',
  });
  return validate(ProjectionProfileUpdateResponseSchema, data) as any;
};

// Path suggestions for the UI
export const PROJECTION_PATH_SUGGESTIONS = [
  { path: 'label', description: 'Primary label (recommended for title)' },
  { path: 'description', description: 'Full description text' },
  { path: 'type', description: 'Entity type (Work, Person, Place, etc.)' },
  { path: 'id', description: 'Entity ID (fallback for title)' },
  { path: 'properties.title', description: 'Title from properties' },
  { path: 'properties.creator', description: 'Creator/author name' },
  { path: 'properties.date', description: 'Date field' },
  { path: 'media[0].url', description: 'First media item URL' },
  { path: 'media[role=thumbnail].url', description: 'Thumbnail image URL' },
  { path: 'identifiers[0].value', description: 'First identifier value' },
  { path: 'classifications[0].label', description: 'First classification label' },
];

// =============================================================================
// Data Onboarding API
// =============================================================================

export interface OnboardingProfile {
  name: string;
  version: string;
  description: string;
  canonical_type: string;
  required_properties: string[];
  recommended_properties: string[];
  total_properties: number;
}

export interface FieldAnalysis {
  field_name: string;
  record_count: number;
  present_count: number;
  coverage_percent: number;
  sample_values: JsonValue[];
  value_types: string[];
}

export interface MappingSuggestion {
  source_field: string;
  target_field: string;
  confidence: number;
  reason: string;
}

export interface OnboardingAnalysis {
  record_count: number;
  target_profile: string;
  target_profile_version: string;
  source_fields: FieldAnalysis[];
  required_fields_coverage: Record<string, number>;
  recommended_fields_coverage: Record<string, number>;
  suggested_mappings: MappingSuggestion[];
  unmapped_source_fields: string[];
  unmapped_target_fields: string[];
  valid_count: number;
  invalid_count: number;
  common_issues: JsonObject[];
  readiness_score: number;
}

export interface OnboardingPreview {
  record_count: number;
  sample_records: JsonObject[];
  validation_results: JsonObject[];
  would_pass_count: number;
  would_fail_count: number;
  enrichment_suggestions: JsonObject[];
  success_rate: number;
}

export interface OnboardingResult {
  status: string;
  total_records: number;
  successful_count: number;
  failed_count: number;
  skipped_count: number;
  enriched_count: number;
  success_rate: number;
  errors: JsonObject[];
  onboarded_records?: JsonObject[];
}

export async function getOnboardingProfiles(): Promise<{ profiles: OnboardingProfile[] }> {
  const data = await apiFetch('/onboarding/profiles');
  return validate(z.object({ profiles: z.array(z.object({ name: z.string(), version: z.string(), description: z.string(), canonical_type: z.string() }).passthrough()) }).passthrough(), data) as any;
}

export async function analyzeForOnboarding(
  records: JsonObject[],
  targetProfile: string
): Promise<OnboardingAnalysis> {
  const data = await apiFetch('/onboarding/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ records, target_profile: targetProfile }),
  });
  return validate(z.object({ record_count: z.number(), target_profile: z.string(), readiness_score: z.number() }).passthrough(), data) as unknown as OnboardingAnalysis;
}

export async function previewOnboarding(
  records: JsonObject[],
  targetProfile: string,
  fieldMappings: Record<string, string>,
  options?: {
    sample_size?: number;
    include_enrichment?: boolean;
  }
): Promise<OnboardingPreview> {
  const data = await apiFetch('/onboarding/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      records,
      target_profile: targetProfile,
      field_mappings: fieldMappings,
      ...options,
    }),
  });
  return validate(z.object({ record_count: z.number(), success_rate: z.number() }).passthrough(), data) as unknown as OnboardingPreview;
}

export async function executeOnboarding(
  records: JsonObject[],
  targetProfile: string,
  fieldMappings: Record<string, string>,
  options?: {
    auto_enrich?: boolean;
    enrich_fields?: string[];
    skip_invalid?: boolean;
    min_enrichment_confidence?: number;
  }
): Promise<OnboardingResult> {
  const data = await apiFetch('/onboarding/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      records,
      target_profile: targetProfile,
      field_mappings: fieldMappings,
      ...options,
    }),
  });
  return validate(z.object({ status: z.string(), total_records: z.number(), success_rate: z.number() }).passthrough(), data) as unknown as OnboardingResult;
}

export async function suggestMappings(
  sourceFields: string[],
  targetProfile: string
): Promise<{
  suggestions: MappingSuggestion[];
  unmapped_fields: string[];
  target_profile: string;
  available_target_fields: string[];
}> {
  const data = await apiFetch('/onboarding/suggest-mappings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source_fields: sourceFields,
      target_profile: targetProfile,
    }),
  });
  return validate(z.object({
    suggestions: z.array(z.object({ source_field: z.string(), target_field: z.string(), confidence: z.number(), reason: z.string() })),
    unmapped_fields: z.array(z.string()),
    target_profile: z.string(),
    available_target_fields: z.array(z.string()),
  }).passthrough(), data);
}
