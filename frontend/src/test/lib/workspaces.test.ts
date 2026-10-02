import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as apiClient from '../../lib/apiClient';
import {
  listWorkspaces,
  createWorkspace,
  getWorkspace,
  updateWorkspace,
  deleteWorkspace,
  addWorkspaceItems,
  removeWorkspaceItems,
  listWorkspaceShares,
  createWorkspaceShare,
  deleteWorkspaceShare,
  getActiveContext,
  setWorkspaceContext,
  setObjectContext,
  clearActiveContext,
  listBulkActions,
  previewBulkAction,
  validateBulkAction,
  executeBulkAction,
} from '../../lib/api';

// Mock the apiClient module
vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
  ApiError: class ApiError extends Error {},
  getFriendlyErrorMessage: vi.fn((msg) => msg),
  API_BASE_URL: 'http://test',
}));

const mockApiFetch = vi.mocked(apiClient.apiFetch);

describe('Workspace API Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const orgId = 'test-org-id';
  const workspaceId = 'test-workspace-id';

  describe('listWorkspaces', () => {
    it('calls the correct endpoint', async () => {
      const mockResponse = {
        items: [{ workspace_id: workspaceId, name: 'Test Workspace' }],
        total: 1,
        limit: 50,
        offset: 0,
      };
      mockApiFetch.mockResolvedValueOnce(mockResponse);

      const result = await listWorkspaces(orgId);

      expect(mockApiFetch).toHaveBeenCalledWith(
        `/organizations/${orgId}/workspaces`
      );
      expect(result).toEqual(mockResponse);
    });

    it('passes pagination parameters', async () => {
      const mockResponse = { items: [], total: 0, limit: 10, offset: 20 };
      mockApiFetch.mockResolvedValueOnce(mockResponse);

      await listWorkspaces(orgId, { limit: 10, offset: 20 });

      expect(mockApiFetch).toHaveBeenCalledWith(
        `/organizations/${orgId}/workspaces?limit=10&offset=20`
      );
    });
  });

  describe('createWorkspace', () => {
    it('sends POST with workspace data', async () => {
      const mockResponse = { workspace_id: workspaceId, name: 'New Workspace', created_at: '2026-04-01T00:00:00Z' };
      mockApiFetch.mockResolvedValueOnce(mockResponse);

      const result = await createWorkspace(orgId, {
        name: 'New Workspace',
        description: 'Test description',
        visibility: 'private',
      });

      expect(mockApiFetch).toHaveBeenCalledWith(
        `/organizations/${orgId}/workspaces`,
        {
          method: 'POST',
          body: JSON.stringify({
            name: 'New Workspace',
            description: 'Test description',
            visibility: 'private',
          }),
        }
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('getWorkspace', () => {
    it('fetches workspace by id', async () => {
      const mockResponse = {
        workspace_id: workspaceId,
        name: 'Test Workspace',
        items: [],
      };
      mockApiFetch.mockResolvedValueOnce(mockResponse);

      const result = await getWorkspace(orgId, workspaceId);

      expect(mockApiFetch).toHaveBeenCalledWith(
        `/organizations/${orgId}/workspaces/${workspaceId}`
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('updateWorkspace', () => {
    it('sends PATCH with updates', async () => {
      const mockResponse = { workspace_id: workspaceId, name: 'Updated Name', updated_at: '2026-04-01T00:00:00Z' };
      mockApiFetch.mockResolvedValueOnce(mockResponse);

      await updateWorkspace(orgId, workspaceId, { name: 'Updated Name' });

      expect(mockApiFetch).toHaveBeenCalledWith(
        `/organizations/${orgId}/workspaces/${workspaceId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ name: 'Updated Name' }),
        }
      );
    });
  });

  describe('deleteWorkspace', () => {
    it('sends DELETE request', async () => {
      mockApiFetch.mockResolvedValueOnce({ message: 'Workspace deleted' });

      await deleteWorkspace(orgId, workspaceId);

      expect(mockApiFetch).toHaveBeenCalledWith(
        `/organizations/${orgId}/workspaces/${workspaceId}`,
        { method: 'DELETE' }
      );
    });
  });

  describe('addWorkspaceItems', () => {
    it('sends POST with object ids', async () => {
      const objectIds = ['obj-1', 'obj-2'];
      mockApiFetch.mockResolvedValueOnce({ added: ['obj-1', 'obj-2'], skipped: [], added_count: 2 });

      await addWorkspaceItems(orgId, workspaceId, objectIds);

      expect(mockApiFetch).toHaveBeenCalledWith(
        `/organizations/${orgId}/workspaces/${workspaceId}/items`,
        {
          method: 'POST',
          body: JSON.stringify({ object_ids: objectIds }),
        }
      );
    });
  });

  describe('removeWorkspaceItems', () => {
    it('sends DELETE with object ids', async () => {
      const objectIds = ['obj-1'];
      mockApiFetch.mockResolvedValueOnce({ removed_count: 1 });

      await removeWorkspaceItems(orgId, workspaceId, objectIds);

      expect(mockApiFetch).toHaveBeenCalledWith(
        `/organizations/${orgId}/workspaces/${workspaceId}/items`,
        {
          method: 'DELETE',
          body: JSON.stringify({ object_ids: objectIds }),
        }
      );
    });
  });
});

describe('Workspace Sharing API Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const orgId = 'test-org-id';
  const workspaceId = 'test-workspace-id';

  describe('listWorkspaceShares', () => {
    it('fetches shares for workspace', async () => {
      const mockResponse = { shares: [] };
      mockApiFetch.mockResolvedValueOnce(mockResponse);

      const result = await listWorkspaceShares(orgId, workspaceId);

      expect(mockApiFetch).toHaveBeenCalledWith(
        `/organizations/${orgId}/workspaces/${workspaceId}/shares`
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('createWorkspaceShare', () => {
    it('sends POST with user and permission', async () => {
      const userId = 'user-123';
      mockApiFetch.mockResolvedValueOnce({ share_id: 'share-1' });

      await createWorkspaceShare(orgId, workspaceId, userId, 'edit');

      expect(mockApiFetch).toHaveBeenCalledWith(
        `/organizations/${orgId}/workspaces/${workspaceId}/shares`,
        {
          method: 'POST',
          body: JSON.stringify({ user_id: userId, permission: 'edit' }),
        }
      );
    });
  });

  describe('deleteWorkspaceShare', () => {
    it('sends DELETE for share', async () => {
      const shareId = 'share-1';
      mockApiFetch.mockResolvedValueOnce({ success: true });

      await deleteWorkspaceShare(orgId, workspaceId, shareId);

      expect(mockApiFetch).toHaveBeenCalledWith(
        `/organizations/${orgId}/workspaces/${workspaceId}/shares/${shareId}`,
        { method: 'DELETE' }
      );
    });
  });
});

describe('Active Context API Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const orgId = 'test-org-id';

  describe('getActiveContext', () => {
    it('fetches current context', async () => {
      const mockResponse = { context: { type: null } };
      mockApiFetch.mockResolvedValueOnce(mockResponse);

      const result = await getActiveContext(orgId);

      expect(mockApiFetch).toHaveBeenCalledWith(`/organizations/${orgId}/context`);
      expect(result).toEqual(mockResponse);
    });
  });

  describe('setWorkspaceContext', () => {
    it('sets workspace as context', async () => {
      const workspaceId = 'ws-123';
      mockApiFetch.mockResolvedValueOnce({ context: { type: 'workspace' } });

      await setWorkspaceContext(orgId, workspaceId);

      expect(mockApiFetch).toHaveBeenCalledWith(
        `/organizations/${orgId}/context/workspace/${workspaceId}`,
        { method: 'POST' }
      );
    });
  });

  describe('setObjectContext', () => {
    it('sets object as context', async () => {
      const objectId = 'obj-123';
      mockApiFetch.mockResolvedValueOnce({ context: { type: 'object' } });

      await setObjectContext(orgId, objectId);

      expect(mockApiFetch).toHaveBeenCalledWith(
        `/organizations/${orgId}/context/object/${objectId}`,
        { method: 'POST' }
      );
    });
  });

  describe('clearActiveContext', () => {
    it('clears the context', async () => {
      mockApiFetch.mockResolvedValueOnce({ message: 'Context cleared' });

      await clearActiveContext(orgId);

      expect(mockApiFetch).toHaveBeenCalledWith(`/organizations/${orgId}/context`, {
        method: 'DELETE',
      });
    });
  });
});

describe('Bulk Action API Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const orgId = 'test-org-id';
  const workspaceId = 'test-workspace-id';

  describe('listBulkActions', () => {
    it('fetches available actions', async () => {
      const mockResponse = {
        workspace_id: workspaceId,
        actions: [{ key: 'record_movement', label: 'Record Movement', description: 'Move objects to a new location' }],
      };
      mockApiFetch.mockResolvedValueOnce(mockResponse);

      const result = await listBulkActions(orgId, workspaceId);

      expect(mockApiFetch).toHaveBeenCalledWith(
        `/organizations/${orgId}/workspaces/${workspaceId}/actions`
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('previewBulkAction', () => {
    it('sends POST with action params', async () => {
      const actionParams = { to_location_id: 'loc-1', reason: 'storage' };
      mockApiFetch.mockResolvedValueOnce({ action: 'record_movement', workspace_id: workspaceId, objects: [], total_count: 0 });

      await previewBulkAction(orgId, workspaceId, 'record_movement', actionParams);

      expect(mockApiFetch).toHaveBeenCalledWith(
        `/organizations/${orgId}/workspaces/${workspaceId}/actions/record_movement/preview`,
        {
          method: 'POST',
          body: JSON.stringify({ action_params: actionParams }),
        }
      );
    });
  });

  describe('validateBulkAction', () => {
    it('sends POST with action params and object ids', async () => {
      const actionParams = { to_location_id: 'loc-1', reason: 'storage' };
      const objectIds = ['obj-1', 'obj-2'];
      mockApiFetch.mockResolvedValueOnce({ action: 'record_movement', action_valid: true, allowed_count: 2, blocked_count: 0, allowed: [], blocked: [] });

      await validateBulkAction(orgId, workspaceId, 'record_movement', actionParams, objectIds);

      expect(mockApiFetch).toHaveBeenCalledWith(
        `/organizations/${orgId}/workspaces/${workspaceId}/actions/record_movement/validate`,
        {
          method: 'POST',
          body: JSON.stringify({ action_params: actionParams, object_ids: objectIds }),
        }
      );
    });
  });

  describe('executeBulkAction', () => {
    it('sends POST with all parameters', async () => {
      const actionParams = { to_location_id: 'loc-1', reason: 'storage' };
      const objectIds = ['obj-1'];
      mockApiFetch.mockResolvedValueOnce({ action: 'record_movement', status: 'completed', success_count: 1, error_count: 0, total_count: 1, results: [] });

      await executeBulkAction(orgId, workspaceId, 'record_movement', actionParams, objectIds, true);

      expect(mockApiFetch).toHaveBeenCalledWith(
        `/organizations/${orgId}/workspaces/${workspaceId}/actions/record_movement/execute`,
        {
          method: 'POST',
          body: JSON.stringify({
            action_params: actionParams,
            object_ids: objectIds,
            skip_blocked: true,
          }),
        }
      );
    });
  });
});
