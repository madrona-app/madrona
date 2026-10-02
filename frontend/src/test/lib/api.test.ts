import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as apiClient from '../../lib/apiClient';
import {
  getRuns,
  getRun,
  createRun,
  deleteRun,
  executeRun,
  republishRun,
  getDatasets,
  createDataset,
  getPipelines,
  getPipeline,
  getConnectorInstances,
  getCurrentUser,
  getOrganizations,
  createOrganization,
  updateUserProfile,
  getPageDoc,
  createPageDoc,
  updatePageDoc,
  deletePageDoc,
  listPageKeys,
  listAllPageDocs,
  getTimezones,
  getConnectorDefinitions,
  getConnectorInstance,
  createConnectorInstance,
  updateConnectorInstance,
  deleteConnectorInstance,
  testConnectorConnection,
  getEntityTypes,
  getEntity,
  getRunChanges,
  searchEntities,
  getAutocomplete,
  findSimilarEntities,
  getReportsSummary,
  getDailyRuns,
  getDatasetsSummary,
  getEntityHistory,
  getRelationshipDefinitions,
  getRelationshipDefinition,
  createRelationshipDefinition,
  updateRelationshipDefinition,
  deleteRelationshipDefinition,
  evaluateRelationshipDefinition,
  previewRelationshipDefinition,
  getEntityRelationships,
  createEntityRelationship,
  deleteEntityRelationship,
  getRelationshipTypes,
  getRelationshipAnalytics,
  getOverviewPreferences,
  updateOverviewPreferences,
  bulkDeleteEmailEvents,
} from '../../lib/api';

// Mock the apiClient module
vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    code?: string;
    details?: Record<string, any>;
    constructor(message: string, status: number, code?: string, details?: Record<string, any>) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
      this.details = details;
    }
  },
  getFriendlyErrorMessage: vi.fn((e) => e.message),
}));

// Valid mock data matching Zod schemas
const validRun = {
  run_id: 'run-123',
  pipeline_id: 'pipe-1',
  target_connector_instance_id: null,
  status: 'success' as const,
  started_at: '2024-01-01T00:00:00Z',
  finished_at: '2024-01-01T00:05:00Z',
  duration_ms: 300000,
  counts: { processed: 100, created: 50, updated: 30, noop: 20, failed: 0 },
  error: null,
};

const validDataset = {
  dataset_id: 'ds-1',
  organization_id: 'org-1',
  name: 'Test Dataset',
  key: 'test-ds',
  description: 'Test description',
  source_type: 'api',
  schema: null,
  role: 'canonical',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  entity_count: 100,
};

const validPipeline = {
  pipeline_id: 'pipe-1',
  organization_id: 'org-1',
  name: 'Test Pipeline',
  status: 'active',
  sources: [],
  destinations: [],
  dataset_id: 'ds-1',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  delete_detection_enabled: false,
  delete_detection_method: null,
};

const validConnector = {
  connector_instance_id: 'conn-1',
  organization_id: 'org-1',
  connector_definition_id: 'def-1',
  name: 'Test Connector',
  direction: 'source',
  config: {},
  status: 'active',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const validUser = {
  user_id: 'user-1',
  email: 'test@example.com',
  name: 'Test User',
  timezone: 'America/New_York',
  active_organization_id: 'org-1',
  permissions: ['data.view'],
  role_label: 'Viewer',
  organizations: [{
    organization_id: 'org-1',
    name: 'Test Org',
    slug: 'test-org',
    timezone: 'America/New_York',
    role: 'member',
    role_label: 'Viewer',
  }],
};

const validOrganization = {
  organization_id: 'org-1',
  name: 'Test Org',
  slug: 'test-org',
  timezone: 'America/New_York',
  created_at: '2024-01-01T00:00:00Z',
};

describe('API Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Runs API', () => {
    describe('getRuns', () => {
      it('fetches runs for organization', async () => {
        const mockResponse = {
          items: [
            { ...validRun, run_id: 'run-1' },
            { ...validRun, run_id: 'run-2', status: 'running' as const },
          ],
          total: 2,
          limit: 10,
          offset: 0,
          
        };

        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockResponse);

        const result = await getRuns({ organization_id: 'org-1' });

        expect(apiClient.apiFetch).toHaveBeenCalledWith('/organizations/org-1/runs');
        expect(result.items).toHaveLength(2);
      });

      it('includes query params for filtering', async () => {
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
          items: [],
          total: 0,
          limit: 5,
          offset: 10,
          
        });

        await getRuns({
          organization_id: 'org-1',
          pipeline_id: 'pipe-1',
          status: 'success',
          limit: 5,
          offset: 10,
        });

        expect(apiClient.apiFetch).toHaveBeenCalledWith(
          expect.stringMatching(/\/organizations\/org-1\/runs\?.*pipeline_id=pipe-1/)
        );
        expect(apiClient.apiFetch).toHaveBeenCalledWith(
          expect.stringMatching(/status=success/)
        );
      });

      it('throws error if organization_id is missing', async () => {
        await expect(getRuns({})).rejects.toThrow('organization_id is required');
      });
    });

    describe('getRun', () => {
      it('fetches single run by ID', async () => {
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validRun);

        const result = await getRun('run-123', 'org-1');

        expect(apiClient.apiFetch).toHaveBeenCalledWith('/organizations/org-1/runs/run-123');
        expect(result.run_id).toBe('run-123');
      });
    });

    describe('createRun', () => {
      it('creates a new run', async () => {
        const newRun = { ...validRun, run_id: 'new-run', status: 'pending' as const };

        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(newRun);

        const result = await createRun('pipe-1', 'org-1');

        expect(apiClient.apiFetch).toHaveBeenCalledWith(
          '/organizations/org-1/runs',
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('pipe-1'),
          })
        );
        expect(result.run_id).toBe('new-run');
      });

      it('passes force_full_sync option', async () => {
        const pendingRun = { ...validRun, run_id: 'run-1', status: 'pending' as const };
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(pendingRun);

        await createRun('pipe-1', 'org-1', { force_full_sync: true });

        expect(apiClient.apiFetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            body: expect.stringContaining('force_full_sync'),
          })
        );
      });
    });

    describe('deleteRun', () => {
      it('deletes a run', async () => {
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(undefined);

        await deleteRun('run-123', 'org-1');

        expect(apiClient.apiFetch).toHaveBeenCalledWith(
          '/organizations/org-1/runs/run-123',
          { method: 'DELETE' }
        );
      });
    });
  });

  describe('Datasets API', () => {
    describe('getDatasets', () => {
      // GET /datasets returns the shared list envelope (schemas/runs.py
      // DatasetListResponse). These mocks used to be `{ datasets: [...] }` and
      // a bare array, so they stayed green while every real call threw.
      it('fetches datasets for organization', async () => {
        const mockDatasets = {
          items: [
            { ...validDataset, dataset_id: 'ds-1', name: 'Dataset 1' },
            { ...validDataset, dataset_id: 'ds-2', name: 'Dataset 2' },
          ],
          total: 2,
          limit: 100,
          offset: 0,
        };

        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockDatasets);

        const result = await getDatasets('org-1');

        expect(apiClient.apiFetch).toHaveBeenCalledWith('/datasets?organization_id=org-1');
        expect(result.map((d) => d.dataset_id)).toEqual(['ds-1', 'ds-2']);
      });

      it('returns an empty list for an organization with no datasets', async () => {
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ items: [], total: 0, limit: 100, offset: 0 });

        await expect(getDatasets('org-1')).resolves.toEqual([]);
      });
    });

    describe('createDataset', () => {
      it('creates a new dataset', async () => {
        const newDataset = { ...validDataset, dataset_id: 'new-ds', name: 'New Dataset', key: 'new-ds' };

        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(newDataset);

        const result = await createDataset({
          organization_id: 'org-1',
          name: 'New Dataset',
          key: 'new-ds',
          source_type: 'api',
        });

        expect(apiClient.apiFetch).toHaveBeenCalledWith(
          '/datasets',
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('New Dataset'),
          })
        );
        expect(result.name).toBe('New Dataset');
      });
    });
  });

  describe('Pipelines API', () => {
    describe('getPipelines', () => {
      it('fetches pipelines for organization', async () => {
        const mockPipelines = [
          { ...validPipeline, pipeline_id: 'pipe-1', name: 'Pipeline 1' },
          { ...validPipeline, pipeline_id: 'pipe-2', name: 'Pipeline 2' },
        ];

        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockPipelines);

        const result = await getPipelines('org-1');

        expect(apiClient.apiFetch).toHaveBeenCalledWith('/pipelines?organization_id=org-1');
        expect(result).toHaveLength(2);
      });

      it('fetches all pipelines without organization filter', async () => {
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce([]);

        await getPipelines();

        expect(apiClient.apiFetch).toHaveBeenCalledWith('/pipelines');
      });
    });

    describe('getPipeline', () => {
      it('fetches single pipeline by ID', async () => {
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validPipeline);

        const result = await getPipeline('pipe-1', 'org-1');

        expect(apiClient.apiFetch).toHaveBeenCalledWith('/organizations/org-1/pipelines/pipe-1');
        expect(result.pipeline_id).toBe('pipe-1');
      });
    });
  });

  describe('Connectors API', () => {
    describe('getConnectorInstances', () => {
      it('fetches connector instances for organization', async () => {
        const mockConnectors = [
          { ...validConnector, connector_instance_id: 'conn-1', name: 'Connector 1' },
        ];

        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockConnectors);

        const result = await getConnectorInstances('org-1');

        expect(apiClient.apiFetch).toHaveBeenCalledWith('/connector-instances?organization_id=org-1');
        expect(result).toHaveLength(1);
      });

      it('fetches all connector instances without filter', async () => {
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce([]);

        await getConnectorInstances();

        expect(apiClient.apiFetch).toHaveBeenCalledWith('/connector-instances');
      });
    });

    describe('getConnectorInstance', () => {
      it('fetches single connector instance by ID', async () => {
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validConnector);

        const result = await getConnectorInstance('conn-1');

        expect(apiClient.apiFetch).toHaveBeenCalledWith('/connector-instances/conn-1');
        expect(result.connector_instance_id).toBe('conn-1');
      });
    });

    describe('createConnectorInstance', () => {
      it('creates a new connector instance', async () => {
        const newConnector = { ...validConnector, connector_instance_id: 'new-conn' };
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(newConnector);

        const result = await createConnectorInstance({
          organization_id: 'org-1',
          connector_definition_id: 'def-1',
          name: 'New Connector',
          config: {},
        });

        expect(apiClient.apiFetch).toHaveBeenCalledWith(
          '/connector-instances',
          expect.objectContaining({ method: 'POST' })
        );
        expect(result.connector_instance_id).toBe('new-conn');
      });
    });

    describe('updateConnectorInstance', () => {
      it('updates a connector instance', async () => {
        const updatedConnector = { ...validConnector, name: 'Updated Name' };
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(updatedConnector);

        const result = await updateConnectorInstance('conn-1', { name: 'Updated Name' });

        expect(apiClient.apiFetch).toHaveBeenCalledWith(
          '/connector-instances/conn-1',
          expect.objectContaining({ method: 'PATCH' })
        );
        expect(result.name).toBe('Updated Name');
      });
    });

    describe('deleteConnectorInstance', () => {
      it('deletes a connector instance', async () => {
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(undefined);

        await deleteConnectorInstance('conn-1');

        expect(apiClient.apiFetch).toHaveBeenCalledWith(
          '/connector-instances/conn-1',
          { method: 'DELETE' }
        );
      });
    });

    describe('getConnectorDefinitions', () => {
      it('calls the correct endpoint', async () => {
        // The response validation is complex, so just verify endpoint is called
        vi.mocked(apiClient.apiFetch).mockRejectedValueOnce(new Error('Network error'));

        try {
          await getConnectorDefinitions();
        } catch {
          // Expected to fail without valid response
        }

        expect(apiClient.apiFetch).toHaveBeenCalledWith('/connector-definitions');
      });
    });
  });

  describe('Timezones API', () => {
    describe('getTimezones', () => {
      it('fetches timezones', async () => {
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
          timezones: ['America/New_York', 'Europe/London', 'Asia/Tokyo'],
        });

        const result = await getTimezones();

        // When all=false, no query string is added
        expect(apiClient.apiFetch).toHaveBeenCalledWith('/timezones');
        expect(result.timezones).toContain('America/New_York');
      });

      it('fetches all timezones when flag is true', async () => {
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
          timezones: ['UTC', 'America/New_York'],
        });

        await getTimezones(true);

        expect(apiClient.apiFetch).toHaveBeenCalledWith('/timezones?all=true');
      });
    });
  });

  describe('User/Auth API', () => {
    describe('getCurrentUser', () => {
      it('fetches current user', async () => {
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validUser);

        const result = await getCurrentUser();

        expect(apiClient.apiFetch).toHaveBeenCalledWith('/me');
        expect(result.email).toBe('test@example.com');
      });
    });

    describe('getOrganizations', () => {
      it('fetches organizations', async () => {
        const mockOrgs = [
          { ...validOrganization, organization_id: 'org-1', name: 'Org 1' },
          { ...validOrganization, organization_id: 'org-2', name: 'Org 2' },
        ];

        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockOrgs);

        const result = await getOrganizations();

        expect(apiClient.apiFetch).toHaveBeenCalledWith('/organizations');
        expect(result).toHaveLength(2);
      });
    });
  });

  describe('Query string building', () => {
    it('excludes undefined and null values', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        items: [],
        total: 0,
        limit: 10,
        offset: 0,
        
      });

      await getRuns({
        organization_id: 'org-1',
        pipeline_id: undefined,
        status: null as unknown as string,
        limit: 10,
      });

      const calledUrl = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      expect(calledUrl).not.toContain('pipeline_id');
      expect(calledUrl).toContain('limit=10');
    });
  });

  describe('User Profile API', () => {
    describe('updateUserProfile', () => {
      it('updates user profile', async () => {
        const mockResponse = {
          user_id: 'user-1',
          email: 'test@example.com',
          name: 'Updated Name',
          timezone: 'America/Los_Angeles',
          message: 'Profile updated',
        };

        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockResponse);

        const result = await updateUserProfile({
          display_name: 'Updated Name',
          timezone: 'America/Los_Angeles',
        });

        expect(apiClient.apiFetch).toHaveBeenCalledWith(
          '/me',
          expect.objectContaining({
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
          })
        );
        expect(result.name).toBe('Updated Name');
      });
    });
  });

  describe('Page Docs API', () => {
    const validPageDoc = {
      doc_id: 'doc-1',
      organization_id: 'org-1',
      page_key: 'dashboard',
      title: 'Dashboard Help',
      summary: 'Help for the dashboard',
      body_markdown: '# Dashboard\nThis is help text.',
      audience: 'all' as const,
      created_by: 'user-1',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    };

    describe('getPageDoc', () => {
      it('fetches page doc by key', async () => {
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ doc: validPageDoc });

        const result = await getPageDoc('dashboard');

        expect(apiClient.apiFetch).toHaveBeenCalledWith('/docs?pageKey=dashboard');
        expect(result?.title).toBe('Dashboard Help');
      });

      it('returns null when doc not found', async () => {
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ doc: null });

        const result = await getPageDoc('nonexistent');

        expect(result).toBeNull();
      });
    });

    describe('createPageDoc', () => {
      it('creates a new page doc', async () => {
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ doc: validPageDoc });

        const result = await createPageDoc({
          page_key: 'dashboard',
          title: 'Dashboard Help',
          body_markdown: '# Dashboard',
        });

        expect(apiClient.apiFetch).toHaveBeenCalledWith(
          '/docs',
          expect.objectContaining({
            method: 'POST',
          })
        );
        expect(result.title).toBe('Dashboard Help');
      });
    });

    describe('updatePageDoc', () => {
      it('updates an existing page doc', async () => {
        const updatedDoc = { ...validPageDoc, title: 'Updated Title' };
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ doc: updatedDoc });

        const result = await updatePageDoc('doc-1', { title: 'Updated Title' });

        expect(apiClient.apiFetch).toHaveBeenCalledWith(
          '/docs/doc-1',
          expect.objectContaining({
            method: 'PUT',
          })
        );
        expect(result.title).toBe('Updated Title');
      });
    });

    describe('deletePageDoc', () => {
      it('deletes a page doc', async () => {
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
          success: true,
          deleted_page_key: 'dashboard',
        });

        const result = await deletePageDoc('doc-1');

        expect(apiClient.apiFetch).toHaveBeenCalledWith(
          '/docs/doc-1',
          { method: 'DELETE' }
        );
        expect(result.success).toBe(true);
      });
    });

    describe('listPageKeys', () => {
      it('lists all page keys', async () => {
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
          page_keys: ['dashboard', 'settings', 'reports'],
        });

        const result = await listPageKeys();

        expect(apiClient.apiFetch).toHaveBeenCalledWith('/docs/keys');
        expect(result).toContain('dashboard');
      });
    });

    describe('listAllPageDocs', () => {
      it('lists all page docs', async () => {
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
          docs: [validPageDoc, { ...validPageDoc, doc_id: 'doc-2', page_key: 'settings' }],
        });

        const result = await listAllPageDocs();

        expect(apiClient.apiFetch).toHaveBeenCalledWith('/docs/all');
        expect(result).toHaveLength(2);
      });
    });
  });

  describe('Extended Runs API', () => {
    describe('executeRun', () => {
      it('calls execute endpoint', async () => {
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validRun);

        const result = await executeRun('run-123', 'org-1');

        expect(apiClient.apiFetch).toHaveBeenCalledWith(
          '/organizations/org-1/runs/run-123/execute',
          { method: 'POST' }
        );
        expect(result.run_id).toBe('run-123');
      });
    });

    describe('republishRun', () => {
      it('calls republish endpoint', async () => {
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validRun);

        const result = await republishRun('run-123', 'org-1');

        expect(apiClient.apiFetch).toHaveBeenCalledWith(
          '/organizations/org-1/runs/run-123/republish',
          { method: 'POST' }
        );
        expect(result.run_id).toBe('run-123');
      });
    });

    describe('getRunChanges', () => {
      it('calls changes endpoint', async () => {
        // Mock rejection to avoid schema validation
        vi.mocked(apiClient.apiFetch).mockRejectedValueOnce(new Error('Test'));

        try {
          await getRunChanges('run-123', 'org-1', { limit: 50 });
        } catch {
          // Expected
        }

        expect(apiClient.apiFetch).toHaveBeenCalledWith(
          expect.stringContaining('/organizations/org-1/runs/run-123/changes')
        );
      });
    });
  });

  describe('Organizations Extended API', () => {
    describe('createOrganization', () => {
      it('calls create organization endpoint', async () => {
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validOrganization);

        const result = await createOrganization({ name: 'New Org', slug: 'new-org' });

        expect(apiClient.apiFetch).toHaveBeenCalledWith(
          '/organizations',
          expect.objectContaining({
            method: 'POST',
          })
        );
        expect(result.name).toBe('Test Org');
      });
    });

  });

  describe('Entities API', () => {
    describe('getEntityTypes', () => {
      it('calls entity-types endpoint', async () => {
        // Mock rejection to avoid schema validation
        vi.mocked(apiClient.apiFetch).mockRejectedValueOnce(new Error('Test'));

        try {
          await getEntityTypes('org-1');
        } catch {
          // Expected
        }

        expect(apiClient.apiFetch).toHaveBeenCalledWith('/entity-types?organization_id=org-1');
      });
    });

    describe('getEntity', () => {
      it('calls entity endpoint with key', async () => {
        // Mock rejection to avoid schema validation
        vi.mocked(apiClient.apiFetch).mockRejectedValueOnce(new Error('Test'));

        try {
          await getEntity('key-123', 'org-1');
        } catch {
          // Expected
        }

        expect(apiClient.apiFetch).toHaveBeenCalledWith('/entities/key-123?organization_id=org-1');
      });
    });
  });

  describe('Connector Connection Test API', () => {
    describe('testConnectorConnection', () => {
      it('calls test endpoint', async () => {
        const mockResult = {
          success: true,
          message: 'Connection successful',
        };
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockResult);

        const result = await testConnectorConnection('conn-1');

        expect(apiClient.apiFetch).toHaveBeenCalledWith(
          '/connector-instances/conn-1/test',
          { method: 'POST' }
        );
        expect(result.success).toBe(true);
      });

      it('handles connection failure response', async () => {
        const mockResult = {
          success: false,
          message: 'Connection failed: invalid credentials',
          error: 'auth_error',
        };
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockResult);

        const result = await testConnectorConnection('conn-1');

        expect(result.success).toBe(false);
        expect(result.message).toContain('Connection failed');
      });
    });
  });

  describe('Search API', () => {
    describe('searchEntities', () => {
      it('calls search endpoint with POST', async () => {
        const mockResponse = {
          hits: [],
          total: 0,
          took_ms: 10,
        };
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockResponse);

        const result = await searchEntities('org-1', { limit: 20 });

        expect(apiClient.apiFetch).toHaveBeenCalledWith(
          '/search?organization_id=org-1',
          expect.objectContaining({ method: 'POST' })
        );
        expect(result.total).toBe(0);
      });
    });

    describe('getAutocomplete', () => {
      it('calls autocomplete endpoint', async () => {
        const mockResponse = {
          suggestions: ['test1', 'test2'],
        };
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockResponse);

        const result = await getAutocomplete('org-1', 'test', 'title', 10);

        expect(apiClient.apiFetch).toHaveBeenCalledWith(
          expect.stringContaining('/search/autocomplete')
        );
        expect(result.suggestions).toHaveLength(2);
      });
    });

    describe('findSimilarEntities', () => {
      it('calls similar endpoint', async () => {
        const mockResponse = {
          similar: [],
        };
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockResponse);

        const result = await findSimilarEntities('org-1', 'entity-key-123', 10);

        expect(apiClient.apiFetch).toHaveBeenCalledWith(
          expect.stringContaining('/search/similar/entity-key-123')
        );
        expect(result.similar).toEqual([]);
      });
    });
  });

  describe('Reports API', () => {
    describe('getReportsSummary', () => {
      it('calls reports summary endpoint', async () => {
        const mockResponse = {
          total_runs: 100,
          successful_runs: 95,
          failed_runs: 5,
          success_rate: 95.0,
          total_entities: 10000,
          active_pipelines: 5,
          avg_duration_ms: 30000,
          period_days: 30,
        };
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockResponse);

        const result = await getReportsSummary('org-1', 30);

        expect(apiClient.apiFetch).toHaveBeenCalledWith(
          expect.stringContaining('/organizations/org-1/reports/summary')
        );
        expect(result.total_runs).toBe(100);
      });
    });

    describe('getDailyRuns', () => {
      it('calls daily runs endpoint', async () => {
        const mockResponse = {
          days: [
            { date: '2024-01-01', total: 10, success: 8, failed: 2, entities: 500 },
          ],
        };
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockResponse);

        const result = await getDailyRuns('org-1', 7);

        expect(apiClient.apiFetch).toHaveBeenCalledWith(
          expect.stringContaining('/organizations/org-1/reports/runs/daily')
        );
        expect(result.days).toHaveLength(1);
      });
    });

    describe('getDatasetsSummary', () => {
      it('calls datasets summary endpoint', async () => {
        const mockResponse = {
          datasets: [
            {
              dataset_id: 'ds-1',
              name: 'Test Dataset',
              entity_count: 100,
              last_run_at: '2024-01-01',
              runs_total: 10,
              runs_successful: 9,
              success_rate: 90.0,
            },
          ],
        };
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockResponse);

        const result = await getDatasetsSummary('org-1');

        expect(apiClient.apiFetch).toHaveBeenCalledWith(
          '/organizations/org-1/reports/datasets/summary'
        );
        expect(result.datasets).toHaveLength(1);
      });
    });
  });

  describe('Entity History API', () => {
    describe('getEntityHistory', () => {
      it('calls entity history endpoint', async () => {
        const mockResponse = {
          entity_key: 'ent-123',
          items: [],
          next_cursor: null,
          has_more: false,
          total: 0,
        };
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockResponse);

        const result = await getEntityHistory('ent-123', 'org-1');

        expect(apiClient.apiFetch).toHaveBeenCalledWith(
          expect.stringContaining('/entities/ent-123/history')
        );
        expect(result.entity_key).toBe('ent-123');
      });

      it('passes limit and cursor params', async () => {
        const mockResponse = {
          entity_key: 'ent-123',
          items: [],
          next_cursor: null,
          has_more: false,
          total: 0,
        };
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockResponse);

        await getEntityHistory('ent-123', 'org-1', { limit: 50, cursor: 'abc' });

        const calledUrl = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
        expect(calledUrl).toContain('limit=50');
        expect(calledUrl).toContain('cursor=abc');
      });
    });
  });

  describe('Relationship Definitions API', () => {
    const buildDefinition = (overrides: Record<string, unknown> = {}) => ({
      definition_id: 'rd-1',
      organization_id: 'org-1',
      name: 'Created By',
      relationship_type: 'created_by',
      source_field_path: 'created_by_id',
      target_field_path: 'user_id',
      enabled: true,
      created_at: '2026-01-01T00:00:00Z',
      ...overrides,
    });

    describe('getRelationshipDefinitions', () => {
      it('fetches relationship definitions list', async () => {
        const mockResponse = {
          items: [buildDefinition()],
          limit: 50,
          offset: 0,
          total: 1,
        };
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockResponse);

        const result = await getRelationshipDefinitions();

        expect(apiClient.apiFetch).toHaveBeenCalledWith('/relationship-definitions');
        expect(result.items).toHaveLength(1);
      });

      it('passes query params', async () => {
        const mockResponse = { items: [], limit: 10, offset: 0, total: 0 };
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockResponse);

        await getRelationshipDefinitions({ dataset_id: 'ds-1', limit: 10 });

        const calledUrl = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
        expect(calledUrl).toContain('dataset_id=ds-1');
        expect(calledUrl).toContain('limit=10');
      });
    });

    describe('getRelationshipDefinition', () => {
      it('fetches a single relationship definition', async () => {
        const mockResponse = { definition: buildDefinition() };
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockResponse);

        const result = await getRelationshipDefinition('rd-1');

        expect(apiClient.apiFetch).toHaveBeenCalledWith('/relationship-definitions/rd-1');
        expect(result.definition.definition_id).toBe('rd-1');
      });
    });

    describe('createRelationshipDefinition', () => {
      it('creates a new relationship definition', async () => {
        const mockResponse = {
          definition: buildDefinition({ definition_id: 'rd-new', name: 'New Relation', relationship_type: 'related_to' }),
        };
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockResponse);

        const result = await createRelationshipDefinition({
          name: 'New Relation',
          relationship_type: 'related_to',
          source_entity_type: 'Object',
          target_entity_type: 'Person',
          source_field_path: 'created_by_id',
          target_field_path: 'user_id',
        });

        expect(apiClient.apiFetch).toHaveBeenCalledWith(
          '/relationship-definitions',
          expect.objectContaining({ method: 'POST' })
        );
        expect(result.definition.name).toBe('New Relation');
      });
    });

    describe('updateRelationshipDefinition', () => {
      it('updates a relationship definition', async () => {
        const mockResponse = { definition: buildDefinition({ name: 'Updated Relation' }) };
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockResponse);

        const result = await updateRelationshipDefinition('rd-1', { name: 'Updated Relation' });

        expect(apiClient.apiFetch).toHaveBeenCalledWith(
          '/relationship-definitions/rd-1',
          expect.objectContaining({ method: 'PUT' })
        );
        expect(result.definition.name).toBe('Updated Relation');
      });
    });

    describe('deleteRelationshipDefinition', () => {
      it('deletes a relationship definition', async () => {
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(undefined);

        await deleteRelationshipDefinition('rd-1');

        expect(apiClient.apiFetch).toHaveBeenCalledWith(
          '/relationship-definitions/rd-1',
          { method: 'DELETE' }
        );
      });
    });

    describe('evaluateRelationshipDefinition', () => {
      it('evaluates a relationship definition', async () => {
        const mockResponse = { created: 10, skipped: 2, errors: [] };
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockResponse);

        const result = await evaluateRelationshipDefinition('rd-1');

        expect(apiClient.apiFetch).toHaveBeenCalledWith(
          '/relationship-definitions/rd-1/evaluate',
          expect.objectContaining({ method: 'POST' })
        );
        expect(result.created).toBe(10);
      });

      it('passes skip_existing option', async () => {
        const mockResponse = { created: 5, skipped: 5, errors: [] };
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockResponse);

        await evaluateRelationshipDefinition('rd-1', { skip_existing: true });

        expect(apiClient.apiFetch).toHaveBeenCalledWith(
          '/relationship-definitions/rd-1/evaluate',
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('skip_existing'),
          })
        );
      });
    });

    describe('previewRelationshipDefinition', () => {
      it('previews a relationship definition', async () => {
        const mockResponse = { items: [],  has_more: false };
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockResponse);

        const result = await previewRelationshipDefinition('rd-1');

        expect(apiClient.apiFetch).toHaveBeenCalledWith(
          '/relationship-definitions/rd-1/preview',
          expect.objectContaining({ method: 'POST' })
        );
        expect(result.items).toHaveLength(0);
      });
    });
  });

  describe('Entity Relationships API', () => {
    describe('getEntityRelationships', () => {
      it('fetches relationships for an entity', async () => {
        const mockResponse = {
          items: [],
          limit: 50,
          offset: 0,
          
          total: 0,
        };
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockResponse);

        const result = await getEntityRelationships('entity-key-123');

        expect(apiClient.apiFetch).toHaveBeenCalledWith(
          '/entities/entity-key-123/relationships'
        );
        expect(result.items).toEqual([]);
      });

      it('passes direction and type params', async () => {
        const mockResponse = {
          items: [],
          limit: 50,
          offset: 0,
          
          total: 0,
        };
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockResponse);

        await getEntityRelationships('entity-key-123', 'org-1', {
          direction: 'outgoing',
          relationship_type: 'created_by',
        });

        const calledUrl = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
        expect(calledUrl).toContain('direction=outgoing');
        expect(calledUrl).toContain('relationship_type=created_by');
      });
    });

    describe('createEntityRelationship', () => {
      it('creates a relationship between entities', async () => {
        const mockResponse = {
          relationship: {
            relationship_id: 'rel-123',
            organization_id: 'org-1',
            source_entity_key: 'ent-1',
            target_entity_key: 'ent-2',
            relationship_type: 'created_by',
            created_at: '2026-01-01T00:00:00Z',
          },
        };
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockResponse);

        const result = await createEntityRelationship({
          source_entity_key: 'ent-1',
          target_entity_key: 'ent-2',
          relationship_type: 'created_by',
        });

        expect(apiClient.apiFetch).toHaveBeenCalledWith(
          '/relationships',
          expect.objectContaining({ method: 'POST' })
        );
        expect(result.relationship.relationship_id).toBe('rel-123');
      });
    });

    describe('deleteEntityRelationship', () => {
      it('deletes a relationship', async () => {
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(undefined);

        await deleteEntityRelationship('rel-123');

        expect(apiClient.apiFetch).toHaveBeenCalledWith(
          '/relationships/rel-123',
          { method: 'DELETE' }
        );
      });
    });

    describe('getRelationshipTypes', () => {
      it('fetches relationship types', async () => {
        const mockResponse = {
          organization_id: 'org-1',
          relationship_types: [
            { type: 'created_by', count: 100 },
            { type: 'part_of', count: 50 },
          ],
          total_relationships: 150,
        };
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockResponse);

        const result = await getRelationshipTypes('org-1');

        expect(apiClient.apiFetch).toHaveBeenCalledWith('/relationship-types?organization_id=org-1');
        expect(result.relationship_types).toHaveLength(2);
      });
    });

    describe('getRelationshipAnalytics', () => {
      it('fetches relationship analytics', async () => {
        const mockResponse = {
          organization_id: 'org-1',
          total_relationships: 1000,
          by_type: [],
          by_source: [],
          top_entities: [],
          recent_relationships: [],
        };
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockResponse);

        const result = await getRelationshipAnalytics('org-1');

        expect(apiClient.apiFetch).toHaveBeenCalledWith('/relationships/analytics?organization_id=org-1');
        expect(result.total_relationships).toBe(1000);
      });
    });
  });

  describe('Overview Preferences API', () => {
    describe('getOverviewPreferences', () => {
      it('fetches overview preferences', async () => {
        const mockResponse = {
          visible_dataset_ids: ['ds-1', 'ds-2'],
          dataset_order: ['ds-1', 'ds-2'],
          updated_at: '2024-01-01T00:00:00Z',
        };
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockResponse);

        const result = await getOverviewPreferences();

        expect(apiClient.apiFetch).toHaveBeenCalledWith('/me/overview-preferences');
        expect(result.visible_dataset_ids).toEqual(['ds-1', 'ds-2']);
      });
    });

    describe('updateOverviewPreferences', () => {
      it('updates overview preferences', async () => {
        const mockResponse = {
          visible_dataset_ids: ['ds-1'],
          dataset_order: ['ds-1'],
          updated_at: '2024-01-02T00:00:00Z',
        };
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockResponse);

        const result = await updateOverviewPreferences({
          visible_dataset_ids: ['ds-1'],
          dataset_order: ['ds-1'],
        });

        expect(apiClient.apiFetch).toHaveBeenCalledWith(
          '/me/overview-preferences',
          expect.objectContaining({ method: 'PUT' })
        );
        expect(result.visible_dataset_ids).toEqual(['ds-1']);
      });
    });
  });

  describe('Email Events API', () => {
    describe('bulkDeleteEmailEvents', () => {
      it('bulk deletes email events', async () => {
        const mockResponse = { message: 'Deleted', deleted_count: 50 };
        vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockResponse);

        const result = await bulkDeleteEmailEvents({ event_type: 'bounce' });

        expect(apiClient.apiFetch).toHaveBeenCalledWith(
          '/email-events/bulk-delete',
          expect.objectContaining({ method: 'POST' })
        );
        expect(result.deleted_count).toBe(50);
      });
    });
  });
});
