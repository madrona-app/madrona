import { apiFetch, buildQueryString, validate } from './_utils';
import { z } from 'zod';
import {
  RelationshipDefinitionListResponseSchema,
  RelationshipDefinitionSchema,
  EntityRelationshipListResponseSchema,
  EntityRelationshipSchema,
  RelationshipAnalyticsSchema,
  DeleteSettingsSchema,
  DeleteStatsSchema,
} from '../schemas';

// =============================================================================
// Relationship Definitions
// =============================================================================

export interface RelationshipDefinition {
  definition_id: string;
  organization_id: string;
  name: string;
  description: string | null;
  relationship_type: string;
  source_dataset_id: string | null;
  source_entity_type: string | null;
  source_field_path: string;
  target_dataset_id: string | null;
  target_entity_type: string | null;
  target_field_path: string;
  match_transform: 'exact' | 'lowercase' | 'trim' | 'normalize_whitespace' | 'normalize_id';
  case_sensitive: boolean;
  enabled: boolean;
  auto_link_on_ingest: boolean;
  bidirectional: boolean;
  inverse_relationship_type: string | null;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface RelationshipDefinitionListResponse {
  items: RelationshipDefinition[];
  limit: number;
  offset: number;
  total: number;
}

export interface RelationshipDefinitionCreateRequest {
  name: string;
  description?: string;
  relationship_type: string;
  source_dataset_id?: string;
  source_entity_type?: string;
  source_field_path: string;
  target_dataset_id?: string;
  target_entity_type?: string;
  target_field_path: string;
  match_transform?: 'exact' | 'lowercase' | 'trim' | 'normalize_whitespace' | 'normalize_id';
  case_sensitive?: boolean;
  enabled?: boolean;
  auto_link_on_ingest?: boolean;
  bidirectional?: boolean;
  inverse_relationship_type?: string;
}

export interface RelationshipDefinitionUpdateRequest {
  name?: string;
  description?: string;
  relationship_type?: string;
  source_field_path?: string;
  target_field_path?: string;
  match_transform?: 'exact' | 'lowercase' | 'trim' | 'normalize_whitespace' | 'normalize_id';
  case_sensitive?: boolean;
  enabled?: boolean;
  auto_link_on_ingest?: boolean;
  bidirectional?: boolean;
  inverse_relationship_type?: string;
}

export async function getRelationshipDefinitions(
  params?: { dataset_id?: string; enabled?: boolean; limit?: number; offset?: number }
): Promise<RelationshipDefinitionListResponse> {
  const query = buildQueryString(params || {});
  const data = await apiFetch(`/relationship-definitions${query}`);
  return validate(RelationshipDefinitionListResponseSchema, data) as any;
}

export async function getRelationshipDefinition(
  definitionId: string
): Promise<{ definition: RelationshipDefinition }> {
  const data = await apiFetch(`/relationship-definitions/${definitionId}`);
  return validate(z.object({ definition: RelationshipDefinitionSchema }).passthrough(), data) as any;
}

export async function createRelationshipDefinition(
  body: RelationshipDefinitionCreateRequest
): Promise<{ definition: RelationshipDefinition }> {
  const data = await apiFetch('/relationship-definitions', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return validate(z.object({ definition: RelationshipDefinitionSchema }).passthrough(), data) as any;
}

export async function updateRelationshipDefinition(
  definitionId: string,
  body: RelationshipDefinitionUpdateRequest
): Promise<{ definition: RelationshipDefinition }> {
  const data = await apiFetch(`/relationship-definitions/${definitionId}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  return validate(z.object({ definition: RelationshipDefinitionSchema }).passthrough(), data) as any;
}

export async function deleteRelationshipDefinition(
  definitionId: string
): Promise<void> {
  await apiFetch(`/relationship-definitions/${definitionId}`, {
    method: 'DELETE',
  });
}

export async function evaluateRelationshipDefinition(
  definitionId: string,
  options?: { skip_existing?: boolean }
): Promise<{ created: number; skipped: number; errors: string[] }> {
  const data = await apiFetch(`/relationship-definitions/${definitionId}/evaluate`, {
    method: 'POST',
    body: JSON.stringify(options || {}),
  });
  return validate(z.object({ created: z.number(), skipped: z.number(), errors: z.array(z.string()) }).passthrough(), data);
}

export async function previewRelationshipDefinition(
  definitionId: string,
  options?: { limit?: number }
): Promise<{
  items: Array<{
    source_entity_key: string;
    target_entity_key: string;
    source_value: string;
    target_value: string;
    confidence: number;
  }>;
  has_more: boolean;
}> {
  const data = await apiFetch(`/relationship-definitions/${definitionId}/preview`, {
    method: 'POST',
    body: JSON.stringify(options || {}),
  });
  return validate(z.object({ items: z.array(z.object({}).passthrough()), has_more: z.boolean() }).passthrough(), data) as any;
}

// =============================================================================
// Entity Relationships
// =============================================================================

export interface EntityRelationship {
  relationship_id: string;
  organization_id: string;
  source_entity_key: string;
  source_dataset_id: string | null;
  target_entity_key: string;
  target_dataset_id: string | null;
  relationship_type: string;
  created_by_source: 'manual' | 'migration' | 'rule' | 'auto_link';
  confidence: number | null;
  extra_data: Record<string, any> | null;
  definition_id: string | null;
  created_at: string;
  created_by_user_id: string | null;
}

export interface EntityRelationshipListResponse {
  items: EntityRelationship[];
  limit: number;
  offset: number;
  total: number;
}

export async function getEntityRelationships(
  entityKey: string,
  organizationId: string,
  params?: { direction?: 'outgoing' | 'incoming' | 'all'; relationship_type?: string; limit?: number; offset?: number }
): Promise<EntityRelationshipListResponse> {
  const query = buildQueryString({ organization_id: organizationId, ...params });
  const data = await apiFetch(`/entities/${encodeURIComponent(entityKey)}/relationships${query}`);
  return validate(EntityRelationshipListResponseSchema, data) as any;
}

export async function createEntityRelationship(
  body: {
    source_entity_key: string;
    target_entity_key: string;
    relationship_type: string;
    source_dataset_id?: string;
    target_dataset_id?: string;
    confidence?: number;
    extra_data?: Record<string, any>;
  }
): Promise<{ relationship: EntityRelationship }> {
  const data = await apiFetch('/relationships', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return validate(z.object({ relationship: EntityRelationshipSchema }).passthrough(), data) as any;
}

export async function deleteEntityRelationship(
  relationshipId: string
): Promise<void> {
  await apiFetch(`/relationships/${relationshipId}`, {
    method: 'DELETE',
  });
}

export async function getRelationshipTypes(organizationId: string): Promise<{
  organization_id: string;
  relationship_types: Array<{ type: string; count: number }>;
  total_relationships: number;
}> {
  const data = await apiFetch(`/relationship-types?organization_id=${organizationId}`);
  return validate(z.object({ organization_id: z.string(), relationship_types: z.array(z.object({ type: z.string(), count: z.number() })), total_relationships: z.number() }).passthrough(), data);
}

// Relationship analytics
export interface RelationshipAnalytics {
  organization_id: string;
  total_relationships: number;
  by_type: Array<{ type: string; count: number }>;
  by_source: Array<{ source: string; count: number }>;
  top_entities: Array<{ entity_key: string; label: string; relationship_count: number }>;
  recent_relationships: EntityRelationship[];
}

export async function getRelationshipAnalytics(organizationId: string): Promise<RelationshipAnalytics> {
  const data = await apiFetch(`/relationships/analytics?organization_id=${organizationId}`);
  return validate(RelationshipAnalyticsSchema, data) as any;
}

// =============================================================================
// Delete Detection API
// =============================================================================

export interface DeleteSettings {
  delete_detection_enabled: boolean;
  delete_detection_method: 'full_sync' | 'incremental';
  delete_strategy: 'remove' | 'mark' | 'archive';
}

export interface ArchivedEntity {
  entity_key: string;
  entity_type: string;
  source_system: string;
  source_id: string;
  payload: Record<string, any>;
  deleted_at: string | null;
  archived_at: string | null;
  archive_reason: string | null;
}

export interface MarkedEntity {
  entity_key: string;
  entity_type: string;
  source_system: string;
  source_id: string;
  deletion_marked_at: string | null;
}

export interface DeleteStats {
  active: number;
  soft_deleted: number;
  archived: number;
  marked: number;
  total_deleted: number;
}

export async function getDeleteSettings(
  pipelineId: string,
  organizationId: string
): Promise<DeleteSettings> {
  const data = await apiFetch(`/delete-detection/pipelines/${pipelineId}/settings`, {
    headers: { 'X-Organization-Id': organizationId },
  });
  return validate(DeleteSettingsSchema, data);
}

export async function updateDeleteSettings(
  pipelineId: string,
  organizationId: string,
  settings: Partial<DeleteSettings>
): Promise<DeleteSettings> {
  const data = await apiFetch(`/delete-detection/pipelines/${pipelineId}/settings`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Organization-Id': organizationId,
    },
    body: JSON.stringify(settings),
  });
  return validate(DeleteSettingsSchema, data);
}

export async function getArchivedEntities(
  organizationId: string,
  params?: {
    entity_type?: string;
    dataset_id?: string;
    limit?: number;
    offset?: number;
  }
): Promise<{ items: ArchivedEntity[]; total: number; limit: number; offset: number }> {
  const query = buildQueryString(params || {});
  const data = await apiFetch(`/delete-detection/archived${query}`, {
    headers: { 'X-Organization-Id': organizationId },
  });
  return validate(z.object({ items: z.array(z.object({}).passthrough()), total: z.number(), limit: z.number(), offset: z.number() }).passthrough(), data) as unknown as { items: ArchivedEntity[]; total: number; limit: number; offset: number };
}

export async function restoreArchivedEntities(
  organizationId: string,
  entityKeys: string[]
): Promise<{ restored: number; skipped: number }> {
  const data = await apiFetch(`/delete-detection/archived/restore`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Organization-Id': organizationId,
    },
    body: JSON.stringify({ entity_keys: entityKeys }),
  });
  return validate(z.object({ restored: z.number(), skipped: z.number() }).passthrough(), data);
}

export async function getMarkedEntities(
  organizationId: string,
  params?: {
    entity_type?: string;
    dataset_id?: string;
    limit?: number;
    offset?: number;
  }
): Promise<{ items: MarkedEntity[]; total: number; limit: number; offset: number }> {
  const query = buildQueryString(params || {});
  const data = await apiFetch(`/delete-detection/marked${query}`, {
    headers: { 'X-Organization-Id': organizationId },
  });
  return validate(z.object({ items: z.array(z.object({}).passthrough()), total: z.number(), limit: z.number(), offset: z.number() }).passthrough(), data) as unknown as { items: MarkedEntity[]; total: number; limit: number; offset: number };
}

export async function clearMarkedEntities(
  organizationId: string,
  entityKeys: string[]
): Promise<{ cleared: number }> {
  const data = await apiFetch(`/delete-detection/marked/clear`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Organization-Id': organizationId,
    },
    body: JSON.stringify({ entity_keys: entityKeys }),
  });
  return validate(z.object({ cleared: z.number() }).passthrough(), data);
}

export async function getDeleteStats(
  organizationId: string,
  datasetId?: string
): Promise<DeleteStats> {
  const query = datasetId ? `?dataset_id=${datasetId}` : '';
  const data = await apiFetch(`/delete-detection/stats${query}`, {
    headers: { 'X-Organization-Id': organizationId },
  });
  return validate(DeleteStatsSchema, data);
}
