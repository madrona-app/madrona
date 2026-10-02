/**
 * Workspaces, Tasks, Discussions & Notifications API
 *
 * Extracted from the monolithic api.ts into its own domain module.
 */
import { apiFetch, buildQueryString, validate } from './_utils';
import { z } from 'zod';

import type {
  WorkspaceDetail,
  WorkspacesListResponse,
  WorkspaceItem,
  WorkspaceShare,
  ActiveContext,
} from '../schemas';

import type {
  MediaWorkspace,
  MediaWorkspaceDetail,
  MediaWorkspaceItem,
  MediaWorkspaceShare,
  MediaActiveContext,
  MediaBulkActionConfig,
  MediaBulkActionPreviewResult,
  MediaBulkActionValidateResult,
  MediaBulkActionExecuteResult,
  MediaBulkActionRunStatus,
} from '../schemas';

import {
  TaskSchema,
  PaginatedTasksSchema,
  TaskEnumsSchema,
  WorkTasksResponseSchema,
  WorkTaskCountResponseSchema,
  NotificationsResponseSchema,
  RecordCommentsResponseSchema,
  RecordCommentSchema,
  type Task,
  type PaginatedTasks,
  type TaskEnums,
  type TaskStatus,
  type TaskPriority,
  type RelatedEntityType,
} from '../schemas';

// =============================================================================
// WORK MODULE - Tasks API
// =============================================================================

export interface WorkTask {
  id: string;
  type: string;
  title: string;
  record_type: string;
  record_id: string;
  record_number?: string;
  priority: 'urgent' | 'high' | 'normal' | 'low';
  due_date?: string;
  assigned_at?: string;
  status?: string;
  object_id?: string;
  accession_number?: string;
  object_title?: string;
  object_count?: number;
  // Task assignment
  assigned_to_user_id?: string | null;
  assigned_to_name?: string | null;
}

export interface AssignableUser {
  user_id: string;
  name: string;
  email: string;
}

export interface WorkTasksResponse {
  items: WorkTask[];
  total: number;
  counts: {
    urgent: number;
    high: number;
    normal: number;
    low: number;
  };
  page: {
    limit: number;
    offset: number;
    has_more: boolean;
  };
}

export interface WorkTaskCountResponse {
  count: number;
  urgent: number;
}

export async function getWorkTasks(
  organizationId: string,
  options?: {
    status?: string;
    priority?: string;
    record_type?: string;
    assigned_to?: string;  // 'me', 'unassigned', or user_id
    limit?: number;
    offset?: number;
  }
): Promise<WorkTasksResponse> {
  const params = new URLSearchParams();
  if (options?.status) params.append('status', options.status);
  if (options?.priority) params.append('priority', options.priority);
  if (options?.record_type) params.append('record_type', options.record_type);
  if (options?.assigned_to) params.append('assigned_to', options.assigned_to);
  if (options?.limit) params.append('limit', String(options.limit));
  if (options?.offset) params.append('offset', String(options.offset));

  const queryString = params.toString();
  const url = `/organizations/${organizationId}/work/tasks${queryString ? `?${queryString}` : ''}`;
  const data = await apiFetch(url);
  return validate(WorkTasksResponseSchema, data);
}

export async function getWorkTaskCount(
  organizationId: string,
  options?: {
    assigned_to?: string;  // 'me', 'unassigned', or user_id
  }
): Promise<WorkTaskCountResponse> {
  const params = new URLSearchParams();
  if (options?.assigned_to) params.append('assigned_to', options.assigned_to);
  const queryString = params.toString();
  const data = await apiFetch(`/organizations/${organizationId}/work/tasks/count${queryString ? `?${queryString}` : ''}`);
  return validate(WorkTaskCountResponseSchema, data);
}

export async function assignWorkTask(
  organizationId: string,
  recordType: string,
  recordId: string,
  assignedToUserId: string | null
): Promise<{ success: boolean; assigned_to_user_id: string | null; assigned_to_name: string | null }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/work/tasks/${recordType}/${recordId}/assign`,
    {
      method: 'PATCH',
      body: JSON.stringify({ assigned_to_user_id: assignedToUserId }),
    }
  );
  return validate(z.object({ success: z.boolean(), assigned_to_user_id: z.string().nullable(), assigned_to_name: z.string().nullable() }).passthrough(), data);
}

export async function getAssignableUsers(
  organizationId: string
): Promise<{ users: AssignableUser[] }> {
  const data = await apiFetch(`/organizations/${organizationId}/work/assignees`);
  return validate(z.object({ users: z.array(z.object({ user_id: z.string(), name: z.string(), email: z.string() }).passthrough()) }).passthrough(), data);
}

// ============================================================================
// WORKSPACES (WORKING SETS) API
// ============================================================================

export interface UpdateWorkspaceParams {
  name?: string;
  description?: string;
  visibility?: 'private' | 'shared' | 'org';
  // Media workspaces: must be an item already in the workspace.
  // Collections workspaces: any org-owned media (typically the primary
  // image of one of the contained collection objects).
  cover_media_id?: string | null;
  dynamic_query?: Record<string, unknown>;  // For dynamic workspaces
}

export async function listWorkspaces(
  organizationId: string,
  options?: {
    filter?: 'all' | 'owned' | 'shared';
    type?: 'collections' | 'media';  // Filter by workspace type
    search?: string;
    limit?: number;
    offset?: number;
  }
): Promise<WorkspacesListResponse> {
  const params = new URLSearchParams();
  if (options?.filter) params.append('filter', options.filter);
  if (options?.type) params.append('type', options.type);
  if (options?.search) params.append('search', options.search);
  if (options?.limit) params.append('limit', String(options.limit));
  if (options?.offset) params.append('offset', String(options.offset));

  const queryString = params.toString();
  const url = `/organizations/${organizationId}/workspaces${queryString ? `?${queryString}` : ''}`;
  const data = await apiFetch(url);
  return validate(z.object({ items: z.array(z.object({}).passthrough()), total: z.number() }).passthrough(), data) as unknown as WorkspacesListResponse;
}

export async function getWorkspace(
  organizationId: string,
  workspaceId: string
): Promise<WorkspaceDetail> {
  const data = await apiFetch(`/organizations/${organizationId}/workspaces/${workspaceId}`);
  return validate(z.object({ workspace_id: z.string(), name: z.string() }).passthrough(), data) as unknown as WorkspaceDetail;
}

export interface CreateWorkspaceParams {
  name: string;
  description?: string;
  visibility?: 'private' | 'shared' | 'org';
  workspace_type?: 'collections' | 'media';
  object_ids?: string[];  // For collections type
  media_ids?: string[];   // For media type
  is_dynamic?: boolean;   // Dynamic (saved search) workspace
  dynamic_query?: Record<string, unknown>;  // Saved search query
}

export async function createWorkspace(
  organizationId: string,
  params: CreateWorkspaceParams
): Promise<{
  workspace_id: string;
  workspace_type: 'collections' | 'media';
  name: string;
  object_count?: number;
  asset_count?: number;
  created_at: string;
}> {
  const data = await apiFetch(`/organizations/${organizationId}/workspaces`, {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return validate(z.object({ workspace_id: z.string(), name: z.string(), created_at: z.string() }).passthrough(), data) as any;
}

export async function updateWorkspace(
  organizationId: string,
  workspaceId: string,
  params: UpdateWorkspaceParams
): Promise<{ workspace_id: string; name: string; description: string | null; visibility: string; updated_at: string }> {
  const data = await apiFetch(`/organizations/${organizationId}/workspaces/${workspaceId}`, {
    method: 'PATCH',
    body: JSON.stringify(params),
  });
  return validate(z.object({ workspace_id: z.string(), name: z.string(), updated_at: z.string() }).passthrough(), data) as any;
}

export async function deleteWorkspace(
  organizationId: string,
  workspaceId: string
): Promise<{ message: string }> {
  const data = await apiFetch(`/organizations/${organizationId}/workspaces/${workspaceId}`, {
    method: 'DELETE',
  });
  return validate(z.object({ message: z.string() }).passthrough(), data);
}

// Workspace Items

export async function listWorkspaceItems(
  organizationId: string,
  workspaceId: string,
  options?: { limit?: number; offset?: number }
): Promise<{ items: WorkspaceItem[]; total: number; limit: number; offset: number }> {
  const params = new URLSearchParams();
  if (options?.limit) params.append('limit', String(options.limit));
  if (options?.offset) params.append('offset', String(options.offset));

  const queryString = params.toString();
  const url = `/organizations/${organizationId}/workspaces/${workspaceId}/items${queryString ? `?${queryString}` : ''}`;
  const data = await apiFetch(url);
  return validate(z.object({ items: z.array(z.object({}).passthrough()), total: z.number(), limit: z.number(), offset: z.number() }).passthrough(), data) as unknown as { items: WorkspaceItem[]; total: number; limit: number; offset: number };
}

export async function addWorkspaceItems(
  organizationId: string,
  workspaceId: string,
  itemIds: string[],
  itemType: 'objects' | 'media' = 'objects'
): Promise<{ added: string[]; skipped: string[]; added_count: number }> {
  const body = itemType === 'media'
    ? { media_ids: itemIds }
    : { object_ids: itemIds };
  const data = await apiFetch(`/organizations/${organizationId}/workspaces/${workspaceId}/items`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return validate(z.object({ added: z.array(z.string()), skipped: z.array(z.string()), added_count: z.number() }).passthrough(), data);
}

export async function removeWorkspaceItems(
  organizationId: string,
  workspaceId: string,
  itemIds: string[],
  itemType: 'objects' | 'media' = 'objects'
): Promise<{ removed_count: number }> {
  const body = itemType === 'media'
    ? { media_ids: itemIds }
    : { object_ids: itemIds };
  const data = await apiFetch(`/organizations/${organizationId}/workspaces/${workspaceId}/items`, {
    method: 'DELETE',
    body: JSON.stringify(body),
  });
  return validate(z.object({ removed_count: z.number() }).passthrough(), data);
}

export async function reorderWorkspaceItems(
  organizationId: string,
  workspaceId: string,
  itemIds: string[],
  itemType: 'objects' | 'media' = 'objects'
): Promise<{ success: boolean }> {
  const body = itemType === 'media'
    ? { media_ids: itemIds }
    : { item_ids: itemIds };
  const data = await apiFetch(`/organizations/${organizationId}/workspaces/${workspaceId}/items/reorder`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return validate(z.object({ success: z.boolean() }).passthrough(), data);
}

// Pin an item to a dynamic workspace

export async function pinWorkspaceItem(
  organizationId: string,
  workspaceId: string,
  objectId: string
): Promise<{ workspace_item_id: string; object_id: string; already_pinned: boolean }> {
  const data = await apiFetch(`/organizations/${organizationId}/workspaces/${workspaceId}/items/${objectId}/pin`, {
    method: 'PATCH',
  });
  return validate(z.object({ workspace_item_id: z.string(), object_id: z.string(), already_pinned: z.boolean() }).passthrough(), data);
}

// Workspace Sharing

export async function listWorkspaceShares(
  organizationId: string,
  workspaceId: string
): Promise<{ shares: WorkspaceShare[] }> {
  const data = await apiFetch(`/organizations/${organizationId}/workspaces/${workspaceId}/shares`);
  return validate(z.object({ shares: z.array(z.object({}).passthrough()) }).passthrough(), data) as unknown as { shares: WorkspaceShare[] };
}

export async function createWorkspaceShare(
  organizationId: string,
  workspaceId: string,
  userId: string,
  permission: 'view' | 'edit' | 'execute' | 'admin'
): Promise<{ share_id: string; created?: boolean; updated?: boolean }> {
  const data = await apiFetch(`/organizations/${organizationId}/workspaces/${workspaceId}/shares`, {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, permission }),
  });
  return validate(z.object({ share_id: z.string() }).passthrough(), data);
}

export async function deleteWorkspaceShare(
  organizationId: string,
  workspaceId: string,
  shareId: string
): Promise<{ success: boolean }> {
  const data = await apiFetch(`/organizations/${organizationId}/workspaces/${workspaceId}/shares/${shareId}`, {
    method: 'DELETE',
  });
  return validate(z.object({ success: z.boolean() }).passthrough(), data);
}

// Active Context

export async function getActiveContext(
  organizationId: string
): Promise<{ context: ActiveContext | null }> {
  if (!organizationId) return { context: null };
  const data = await apiFetch(`/organizations/${organizationId}/context`);
  return validate(z.object({ context: z.object({}).passthrough().nullable() }).passthrough(), data) as unknown as { context: ActiveContext | null };
}

export async function setWorkspaceContext(
  organizationId: string,
  workspaceId: string
): Promise<{ context: ActiveContext }> {
  const data = await apiFetch(`/organizations/${organizationId}/context/workspace/${workspaceId}`, {
    method: 'POST',
  });
  return validate(z.object({ context: z.object({}).passthrough() }).passthrough(), data) as unknown as { context: ActiveContext };
}

export async function setObjectContext(
  organizationId: string,
  objectId: string
): Promise<{ context: ActiveContext }> {
  const data = await apiFetch(`/organizations/${organizationId}/context/object/${objectId}`, {
    method: 'POST',
  });
  return validate(z.object({ context: z.object({}).passthrough() }).passthrough(), data) as unknown as { context: ActiveContext };
}

export async function clearActiveContext(
  organizationId: string
): Promise<{ message: string }> {
  const data = await apiFetch(`/organizations/${organizationId}/context`, {
    method: 'DELETE',
  });
  return validate(z.object({ message: z.string() }).passthrough(), data);
}

// Workspace Bulk Actions

export interface BulkActionConfig {
  key: string;
  label: string;
  description: string;
  required_params: string[];
  optional_params: string[];
}

export interface BulkActionPreviewObject {
  object_id: string;
  accession_number: string | null;
  title: string | null;
  thumbnail_url: string | null;
  warnings: string[];
}

export interface BulkActionPreviewResult {
  action: string;
  action_label: string;
  workspace_id: string;
  workspace_name: string;
  objects: BulkActionPreviewObject[];
  total_count: number;
  has_warnings: boolean;
}

export interface BulkActionValidateResult {
  action: string;
  action_valid: boolean;
  allowed: { object_id: string; accession_number: string | null; title: string | null }[];
  blocked: { object_id: string; accession_number: string | null; title: string | null; reason: string }[];
  allowed_count: number;
  blocked_count: number;
}

export interface BulkActionResult {
  object_id: string;
  accession_number: string | null;
  status: 'success' | 'error' | 'skipped';
  record_id?: string;
  reference_number?: string;
  message?: string;
}

export interface BulkActionExecuteResult {
  action: string;
  status: 'completed' | 'failed';
  workspace_id: string;
  results: BulkActionResult[];
  success_count: number;
  error_count: number;
  total_count: number;
  error?: string;
}

export async function listBulkActions(
  organizationId: string,
  workspaceId: string
): Promise<{ workspace_id: string; actions: BulkActionConfig[] }> {
  const data = await apiFetch(`/organizations/${organizationId}/workspaces/${workspaceId}/actions`);
  return validate(z.object({ workspace_id: z.string(), actions: z.array(z.object({ key: z.string(), label: z.string(), description: z.string() }).passthrough()) }).passthrough(), data) as any;
}

export async function previewBulkAction(
  organizationId: string,
  workspaceId: string,
  action: string,
  actionParams: Record<string, unknown> = {}
): Promise<BulkActionPreviewResult> {
  const data = await apiFetch(`/organizations/${organizationId}/workspaces/${workspaceId}/actions/${action}/preview`, {
    method: 'POST',
    body: JSON.stringify({ action_params: actionParams }),
  });
  return validate(z.object({ action: z.string(), workspace_id: z.string(), total_count: z.number() }).passthrough(), data) as unknown as BulkActionPreviewResult;
}

export async function validateBulkAction(
  organizationId: string,
  workspaceId: string,
  action: string,
  actionParams: Record<string, unknown> = {},
  objectIds?: string[]
): Promise<BulkActionValidateResult> {
  const data = await apiFetch(`/organizations/${organizationId}/workspaces/${workspaceId}/actions/${action}/validate`, {
    method: 'POST',
    body: JSON.stringify({ action_params: actionParams, object_ids: objectIds }),
  });
  return validate(z.object({ action: z.string(), action_valid: z.boolean(), allowed_count: z.number(), blocked_count: z.number() }).passthrough(), data) as unknown as BulkActionValidateResult;
}

export async function executeBulkAction(
  organizationId: string,
  workspaceId: string,
  action: string,
  actionParams: Record<string, unknown> = {},
  objectIds?: string[],
  skipBlocked: boolean = false
): Promise<BulkActionExecuteResult> {
  const data = await apiFetch(`/organizations/${organizationId}/workspaces/${workspaceId}/actions/${action}/execute`, {
    method: 'POST',
    body: JSON.stringify({
      action_params: actionParams,
      object_ids: objectIds,
      skip_blocked: skipBlocked,
    }),
  });
  return validate(z.object({ action: z.string(), status: z.string(), success_count: z.number(), error_count: z.number(), total_count: z.number() }).passthrough(), data) as unknown as BulkActionExecuteResult;
}

// ============================================================================
// DAM WORKSPACES (WORKING SETS FOR ASSETS)
// ============================================================================

export interface CreateMediaWorkspaceParams {
  name: string;
  description?: string;
  visibility?: 'private' | 'shared' | 'org';
}

export interface UpdateMediaWorkspaceParams {
  name?: string;
  description?: string;
  visibility?: 'private' | 'shared' | 'org';
  cover_media_id?: string | null;
}

// DAM Workspace CRUD

export async function getMediaWorkspaces(
  organizationId: string,
  options?: { limit?: number; offset?: number; filter?: 'mine' | 'shared' | 'all' }
): Promise<{ items: MediaWorkspace[]; total: number; limit: number; offset: number }> {
  const params = new URLSearchParams();
  if (options?.limit) params.append('limit', String(options.limit));
  if (options?.offset) params.append('offset', String(options.offset));
  if (options?.filter) params.append('filter', options.filter);

  const queryString = params.toString();
  const url = `/organizations/${organizationId}/media/workspaces${queryString ? `?${queryString}` : ''}`;
  const data = await apiFetch(url);
  return validate(z.object({ items: z.array(z.object({}).passthrough()), total: z.number(), limit: z.number(), offset: z.number() }).passthrough(), data) as unknown as { items: MediaWorkspace[]; total: number; limit: number; offset: number };
}

export async function getMediaWorkspace(
  organizationId: string,
  workspaceId: string
): Promise<MediaWorkspaceDetail> {
  const data = await apiFetch(`/organizations/${organizationId}/media/workspaces/${workspaceId}`);
  return validate(z.object({ workspace_id: z.string(), name: z.string() }).passthrough(), data) as unknown as MediaWorkspaceDetail;
}

export async function createMediaWorkspace(
  organizationId: string,
  params: CreateMediaWorkspaceParams
): Promise<{ workspace_id: string; name: string; asset_count: number; created_at: string }> {
  const data = await apiFetch(`/organizations/${organizationId}/media/workspaces`, {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return validate(z.object({ workspace_id: z.string(), name: z.string(), asset_count: z.number(), created_at: z.string() }).passthrough(), data);
}

export async function updateMediaWorkspace(
  organizationId: string,
  workspaceId: string,
  params: UpdateMediaWorkspaceParams
): Promise<{ workspace_id: string; name: string; description: string | null; visibility: string; updated_at: string }> {
  const data = await apiFetch(`/organizations/${organizationId}/media/workspaces/${workspaceId}`, {
    method: 'PATCH',
    body: JSON.stringify(params),
  });
  return validate(z.object({ workspace_id: z.string(), name: z.string(), updated_at: z.string() }).passthrough(), data) as any;
}

export async function deleteMediaWorkspace(
  organizationId: string,
  workspaceId: string
): Promise<{ success: boolean }> {
  const data = await apiFetch(`/organizations/${organizationId}/media/workspaces/${workspaceId}`, {
    method: 'DELETE',
  });
  return validate(z.object({ success: z.boolean() }).passthrough(), data);
}

// DAM Workspace Items

export async function listMediaWorkspaceItems(
  organizationId: string,
  workspaceId: string,
  options?: { limit?: number; offset?: number }
): Promise<{ items: MediaWorkspaceItem[]; total: number; limit: number; offset: number }> {
  const params = new URLSearchParams();
  if (options?.limit) params.append('limit', String(options.limit));
  if (options?.offset) params.append('offset', String(options.offset));

  const queryString = params.toString();
  const url = `/organizations/${organizationId}/media/workspaces/${workspaceId}/items${queryString ? `?${queryString}` : ''}`;
  const data = await apiFetch(url);
  return validate(z.object({ items: z.array(z.object({}).passthrough()), total: z.number(), limit: z.number(), offset: z.number() }).passthrough(), data) as unknown as { items: MediaWorkspaceItem[]; total: number; limit: number; offset: number };
}

export async function addMediaWorkspaceItems(
  organizationId: string,
  workspaceId: string,
  mediaIds: string[]
): Promise<{ added: string[]; skipped: string[]; added_count: number }> {
  const data = await apiFetch(`/organizations/${organizationId}/media/workspaces/${workspaceId}/items`, {
    method: 'POST',
    body: JSON.stringify({ media_ids: mediaIds }),
  });
  return validate(z.object({ added: z.array(z.string()), skipped: z.array(z.string()), added_count: z.number() }).passthrough(), data);
}

export async function removeMediaWorkspaceItems(
  organizationId: string,
  workspaceId: string,
  mediaIds: string[]
): Promise<{ removed_count: number }> {
  const data = await apiFetch(`/organizations/${organizationId}/media/workspaces/${workspaceId}/items`, {
    method: 'DELETE',
    body: JSON.stringify({ media_ids: mediaIds }),
  });
  return validate(z.object({ removed_count: z.number() }).passthrough(), data);
}

export async function reorderMediaWorkspaceItems(
  organizationId: string,
  workspaceId: string,
  itemIds: string[]
): Promise<{ success: boolean }> {
  const data = await apiFetch(`/organizations/${organizationId}/media/workspaces/${workspaceId}/items/reorder`, {
    method: 'POST',
    body: JSON.stringify({ item_ids: itemIds }),
  });
  return validate(z.object({ success: z.boolean() }).passthrough(), data);
}

// DAM Workspace Sharing

export async function listMediaWorkspaceShares(
  organizationId: string,
  workspaceId: string
): Promise<{ shares: MediaWorkspaceShare[] }> {
  const data = await apiFetch(`/organizations/${organizationId}/media/workspaces/${workspaceId}/shares`);
  return validate(z.object({ shares: z.array(z.object({}).passthrough()) }).passthrough(), data) as unknown as { shares: MediaWorkspaceShare[] };
}

export async function createMediaWorkspaceShare(
  organizationId: string,
  workspaceId: string,
  userId: string,
  permission: 'view' | 'edit' | 'execute' | 'admin'
): Promise<{ share_id: string; created?: boolean; updated?: boolean }> {
  const data = await apiFetch(`/organizations/${organizationId}/media/workspaces/${workspaceId}/shares`, {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, permission }),
  });
  return validate(z.object({ share_id: z.string() }).passthrough(), data);
}

export async function deleteMediaWorkspaceShare(
  organizationId: string,
  workspaceId: string,
  shareId: string
): Promise<{ success: boolean }> {
  const data = await apiFetch(`/organizations/${organizationId}/media/workspaces/${workspaceId}/shares/${shareId}`, {
    method: 'DELETE',
  });
  return validate(z.object({ success: z.boolean() }).passthrough(), data);
}

// DAM Active Context

export async function getMediaActiveContext(
  organizationId: string
): Promise<{ context: MediaActiveContext | null }> {
  if (!organizationId) return { context: null };
  const data = await apiFetch(`/organizations/${organizationId}/dam/context`);
  return validate(z.object({ context: z.object({}).passthrough().nullable() }).passthrough(), data) as unknown as { context: MediaActiveContext | null };
}

export async function setMediaWorkspaceContext(
  organizationId: string,
  workspaceId: string
): Promise<{ context: MediaActiveContext }> {
  const data = await apiFetch(`/organizations/${organizationId}/dam/context/workspace/${workspaceId}`, {
    method: 'POST',
  });
  return validate(z.object({ context: z.object({}).passthrough() }).passthrough(), data) as unknown as { context: MediaActiveContext };
}

export async function setMediaAssetContext(
  organizationId: string,
  mediaId: string
): Promise<{ context: MediaActiveContext }> {
  const data = await apiFetch(`/organizations/${organizationId}/dam/context/asset/${mediaId}`, {
    method: 'POST',
  });
  return validate(z.object({ context: z.object({}).passthrough() }).passthrough(), data) as unknown as { context: MediaActiveContext };
}

export async function clearMediaActiveContext(
  organizationId: string
): Promise<{ success: boolean }> {
  const data = await apiFetch(`/organizations/${organizationId}/dam/context`, {
    method: 'DELETE',
  });
  return validate(z.object({ success: z.boolean() }).passthrough(), data);
}

// DAM Workspace Bulk Actions

export async function listMediaBulkActions(
  organizationId: string,
  workspaceId: string
): Promise<{ actions: MediaBulkActionConfig[] }> {
  const data = await apiFetch(`/organizations/${organizationId}/media/workspaces/${workspaceId}/actions`);
  return validate(z.object({ actions: z.array(z.object({}).passthrough()) }).passthrough(), data) as unknown as { actions: MediaBulkActionConfig[] };
}

export async function previewMediaBulkAction(
  organizationId: string,
  workspaceId: string,
  action: string,
  actionParams: Record<string, unknown> = {},
  mediaIds?: string[]
): Promise<MediaBulkActionPreviewResult> {
  const data = await apiFetch(`/organizations/${organizationId}/media/workspaces/${workspaceId}/actions/${action}/preview`, {
    method: 'POST',
    body: JSON.stringify({ action_params: actionParams, media_ids: mediaIds }),
  });
  return validate(z.object({ action: z.string(), total_count: z.number() }).passthrough(), data) as unknown as MediaBulkActionPreviewResult;
}

export async function validateMediaBulkAction(
  organizationId: string,
  workspaceId: string,
  action: string,
  actionParams: Record<string, unknown> = {},
  mediaIds?: string[]
): Promise<MediaBulkActionValidateResult> {
  const data = await apiFetch(`/organizations/${organizationId}/media/workspaces/${workspaceId}/actions/${action}/validate`, {
    method: 'POST',
    body: JSON.stringify({ action_params: actionParams, media_ids: mediaIds }),
  });
  return validate(z.object({ action: z.string(), action_valid: z.boolean() }).passthrough(), data) as unknown as MediaBulkActionValidateResult;
}

export async function executeMediaBulkAction(
  organizationId: string,
  workspaceId: string,
  action: string,
  actionParams: Record<string, unknown> = {},
  mediaIds?: string[],
  skipBlocked: boolean = false
): Promise<MediaBulkActionExecuteResult> {
  const data = await apiFetch(`/organizations/${organizationId}/media/workspaces/${workspaceId}/actions/${action}/execute`, {
    method: 'POST',
    body: JSON.stringify({
      action_params: actionParams,
      media_ids: mediaIds,
      skip_blocked: skipBlocked,
    }),
  });
  return validate(z.object({ action: z.string(), status: z.string() }).passthrough(), data) as unknown as MediaBulkActionExecuteResult;
}

export async function getMediaBulkActionRunStatus(
  organizationId: string,
  workspaceId: string,
  runId: string
): Promise<MediaBulkActionRunStatus> {
  const data = await apiFetch(`/organizations/${organizationId}/media/workspaces/${workspaceId}/actions/runs/${runId}`);
  return validate(z.object({ run_id: z.string(), status: z.string() }).passthrough(), data) as unknown as MediaBulkActionRunStatus;
}

// ============================================================================
// RECORD-BOUND DISCUSSIONS
// ============================================================================
// Institutional memory attached to records. This is NOT chat.
// Comments are append-only, immutable, and auditable.

export type DiscussionEntityType =
  | 'collection_object'
  | 'acquisition'
  | 'loan_in'
  | 'loan_out'
  | 'exhibition'
  | 'media'
  | 'media_rights'
  | 'contact'
  | 'constituent'
  | 'event'
  | 'object_entry'
  | 'object_exit';

export interface RecordComment {
  comment_id: string;
  entity_type: DiscussionEntityType;
  entity_id: string;
  author: {
    user_id: string;
    display_name: string | null;
    email: string | null;
  };
  content: string;
  kind: 'user' | 'system';
  created_at: string;
}

export interface RecordCommentsResponse {
  items: RecordComment[];
  total: number;
  has_more: boolean;
  limit: number;
  offset: number;
}

export async function listRecordComments(
  organizationId: string,
  entityType: DiscussionEntityType,
  entityId: string,
  options?: { limit?: number; offset?: number }
): Promise<RecordCommentsResponse> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', options.limit.toString());
  if (options?.offset) params.set('offset', options.offset.toString());
  const query = params.toString();
  const data = await apiFetch(
    `/organizations/${organizationId}/records/${entityType}/${entityId}/comments${query ? `?${query}` : ''}`
  );
  return validate(RecordCommentsResponseSchema, data) as any;
}

export async function createRecordComment(
  organizationId: string,
  entityType: DiscussionEntityType,
  entityId: string,
  content: string,
  kind: 'user' | 'system' = 'user'
): Promise<{ comment: RecordComment }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/records/${entityType}/${entityId}/comments`,
    {
      method: 'POST',
      body: JSON.stringify({ content, kind }),
    }
  );
  return validate(z.object({ comment: RecordCommentSchema }).passthrough(), data) as any;
}

export async function getRecordCommentCount(
  organizationId: string,
  entityType: DiscussionEntityType,
  entityId: string
): Promise<{ count: number }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/records/${entityType}/${entityId}/comments/count`
  );
  return validate(z.object({ count: z.number() }).passthrough(), data);
}

export async function getRecordWatchStatus(
  organizationId: string,
  entityType: DiscussionEntityType,
  entityId: string
): Promise<{ watching: boolean; watch_id: string | null }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/records/${entityType}/${entityId}/watch`
  );
  return validate(z.object({ watching: z.boolean(), watch_id: z.string().nullable() }).passthrough(), data);
}

export async function watchRecord(
  organizationId: string,
  entityType: DiscussionEntityType,
  entityId: string
): Promise<{ watch_id: string; watching: boolean }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/records/${entityType}/${entityId}/watch`,
    { method: 'POST' }
  );
  return validate(z.object({ watch_id: z.string(), watching: z.boolean() }).passthrough(), data);
}

export async function unwatchRecord(
  organizationId: string,
  entityType: DiscussionEntityType,
  entityId: string
): Promise<{ watching: boolean }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/records/${entityType}/${entityId}/watch`,
    { method: 'DELETE' }
  );
  return validate(z.object({ watching: z.boolean() }).passthrough(), data);
}

export async function exportRecordComments(
  organizationId: string,
  entityType: DiscussionEntityType,
  entityId: string
): Promise<{
  record: { entity_type: string; entity_id: string; organization_id: string };
  comments: Array<{
    author_name: string;
    author_email: string | null;
    content: string;
    kind: string;
    created_at: string;
  }>;
  total_count: number;
  exported_at: string;
  exported_by: string;
}> {
  const data = await apiFetch(
    `/organizations/${organizationId}/records/${entityType}/${entityId}/comments/export`
  );
  return validate(z.object({ record: z.object({}).passthrough(), comments: z.array(z.object({}).passthrough()), total_count: z.number(), exported_at: z.string(), exported_by: z.string() }).passthrough(), data) as any;
}

// ============================================================================
// NOTIFICATIONS
// ============================================================================

export interface Notification {
  notification_id: string;
  notification_type: string;
  title: string;
  message: string | null;
  entity_type: string | null;
  entity_id: string | null;
  actor: {
    user_id: string;
    display_name: string | null;
  } | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

export interface NotificationsResponse {
  items: Notification[];
  unread_count: number;
  total: number;
  has_more: boolean;
  limit: number;
  offset: number;
}

export async function getNotifications(
  organizationId: string,
  options?: { limit?: number; offset?: number; unread_only?: boolean }
): Promise<NotificationsResponse> {
  const params = new URLSearchParams();
  if (options?.limit) params.append('limit', String(options.limit));
  if (options?.offset) params.append('offset', String(options.offset));
  if (options?.unread_only) params.append('unread_only', 'true');

  const query = params.toString();
  const data = await apiFetch(
    `/organizations/${organizationId}/notifications${query ? `?${query}` : ''}`
  );
  return validate(NotificationsResponseSchema, data) as any;
}

export async function getUnreadNotificationCount(
  organizationId: string
): Promise<{ unread_count: number }> {
  const data = await apiFetch(`/organizations/${organizationId}/notifications/unread-count`);
  return validate(z.object({ unread_count: z.number() }).passthrough(), data);
}

export async function markNotificationAsRead(
  organizationId: string,
  notificationId: string
): Promise<{ success: boolean }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/notifications/${notificationId}/read`,
    { method: 'POST' }
  );
  return validate(z.object({ success: z.boolean() }).passthrough(), data);
}

export async function markAllNotificationsAsRead(
  organizationId: string
): Promise<{ success: boolean; marked_count: number }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/notifications/read-all`,
    { method: 'POST' }
  );
  return validate(z.object({ success: z.boolean(), marked_count: z.number() }).passthrough(), data);
}

export async function deleteNotification(
  organizationId: string,
  notificationId: string
): Promise<{ success: boolean }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/notifications/${notificationId}`,
    { method: 'DELETE' }
  );
  return validate(z.object({ success: z.boolean() }).passthrough(), data);
}

// ============================================================================
// TASKS (My Tasks feature)
// ============================================================================

export type { Task, PaginatedTasks, TaskEnums, TaskStatus, TaskPriority, RelatedEntityType };

export interface ListTasksParams {
  assignedToMe?: boolean;
  assignedUserId?: string;
  status?: string[];
  priority?: string[];
  includeCompleted?: boolean;
  dueBefore?: string;
  dueAfter?: string;
  appContext?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  limit?: number;
  offset?: number;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigned_user_id?: string;
  due_date?: string;
  app_context?: string;
  related_entity_type?: string;
  related_entity_id?: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigned_user_id?: string | null;
  due_date?: string | null;
  related_entity_type?: string | null;
  related_entity_id?: string | null;
}

export async function listTasks(
  organizationId: string,
  params?: ListTasksParams
): Promise<PaginatedTasks> {
  const queryParams: Record<string, string> = {};

  if (params?.assignedToMe) queryParams.assigned_to_me = 'true';
  if (params?.assignedUserId) queryParams.assigned_user_id = params.assignedUserId;
  if (params?.status?.length) queryParams.status = params.status.join(',');
  if (params?.priority?.length) queryParams.priority = params.priority.join(',');
  if (params?.includeCompleted) queryParams.include_completed = 'true';
  if (params?.dueBefore) queryParams.due_before = params.dueBefore;
  if (params?.dueAfter) queryParams.due_after = params.dueAfter;
  if (params?.appContext) queryParams.app_context = params.appContext;
  if (params?.relatedEntityType) queryParams.related_entity_type = params.relatedEntityType;
  if (params?.relatedEntityId) queryParams.related_entity_id = params.relatedEntityId;
  if (params?.limit) queryParams.limit = String(params.limit);
  if (params?.offset) queryParams.offset = String(params.offset);

  const query = buildQueryString(queryParams);
  const data = await apiFetch(`/organizations/${organizationId}/tasks${query}`);
  return validate(PaginatedTasksSchema, data);
}

export async function getTask(
  organizationId: string,
  taskId: string
): Promise<Task> {
  const data = await apiFetch(`/organizations/${organizationId}/tasks/${taskId}`);
  return validate(z.object({ task: TaskSchema }), data).task;
}

export async function createTask(
  organizationId: string,
  input: CreateTaskInput
): Promise<Task> {
  const data = await apiFetch(`/organizations/${organizationId}/tasks`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return validate(z.object({ task: TaskSchema }), data).task;
}

export async function updateTask(
  organizationId: string,
  taskId: string,
  input: UpdateTaskInput
): Promise<Task> {
  const data = await apiFetch(`/organizations/${organizationId}/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return validate(z.object({ task: TaskSchema }), data).task;
}

export async function deleteTask(
  organizationId: string,
  taskId: string
): Promise<void> {
  await apiFetch(`/organizations/${organizationId}/tasks/${taskId}`, {
    method: 'DELETE',
  });
}

export async function getTaskEnums(
  organizationId: string
): Promise<TaskEnums> {
  const data = await apiFetch(`/organizations/${organizationId}/tasks/enums`);
  return validate(TaskEnumsSchema, data);
}
