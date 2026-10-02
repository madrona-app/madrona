import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as apiClient from '../../lib/apiClient';
import {
  getOrganizations,
  updateOrganization,
  getOrganizationUsers,
  getRoles,
  getOrganizationStorage,
  getStorageRegions,
  getTimezones,
  getCurrentUser,
  createOrganization,
  getEmailEvents,
  getEmailStats,
  deleteEmailEvent,
  bulkDeleteEmailEvents,
  getOverviewPreferences,
  updateOverviewPreferences,
} from '../../lib/api/admin';

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    code?: string;
    details?: Record<string, unknown>;
    constructor(message: string, status: number, code?: string, details?: Record<string, unknown>) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
      this.details = details;
    }
  },
  getCsrfToken: vi.fn(),
  getFriendlyErrorMessage: vi.fn((e: Error) => e.message),
  API_BASE_URL: '/api',
}));

const validOrg = {
  organization_id: 'org-1',
  name: 'Test Org',
  slug: 'test',
  timezone: 'UTC',
  created_at: '2026-01-01T00:00:00Z',
};

const validUser = {
  user_id: 'user-1',
  email: 'a@example.com',
  name: 'Alice',
  active_organization_id: 'org-1',
  permissions: ['data.view'],
  organizations: [
    {
      organization_id: 'org-1',
      name: 'Test Org',
      slug: 'test',
      timezone: 'UTC',
      role: 'member',
      role_label: 'Viewer',
    },
  ],
};

describe('api/admin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('getOrganizations', () => {
    it('fetches and returns array of organizations', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce([validOrg]);
      const result = await getOrganizations();
      expect(apiClient.apiFetch).toHaveBeenCalledWith('/organizations');
      expect(result).toHaveLength(1);
      expect(result[0].organization_id).toBe('org-1');
    });

    it('throws on schema mismatch', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce([{ bogus: 'data' }]);
      await expect(getOrganizations()).rejects.toThrow();
    });
  });

  describe('updateOrganization', () => {
    it('issues a PATCH with JSON body', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        ...validOrg,
        message: 'updated',
        updated_at: '2026-04-01T00:00:00Z',
      });
      await updateOrganization('org-1', { name: 'Renamed' });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ name: 'Renamed' }),
        }),
      );
    });
  });

  describe('getOrganizationUsers', () => {
    it('defaults to active status filter', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        organization_id: 'org-1',
        users: [],
        total: 0,
      });
      await getOrganizationUsers('org-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/users?status=active',
      );
    });

    it('passes status to query', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        organization_id: 'org-1',
        users: [],
        total: 0,
      });
      await getOrganizationUsers('org-1', 'deactivated');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/users?status=deactivated',
      );
    });
  });

  describe('getRoles', () => {
    it('fetches roles for organization', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ roles: [] });
      const result = await getRoles('org-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith('/organizations/org-1/roles');
      expect(result.roles).toEqual([]);
    });
  });

  describe('getOrganizationStorage', () => {
    it('fetches storage stats', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        usage: {
          used_bytes: 100,
          used_gb: 0.0001,
          limit_bytes: 1000,
          limit_gb: 0.001,
          remaining_bytes: 900,
          remaining_gb: 0.0009,
          usage_percent: 10,
        },
        region: 'us-east-1',
      });
      const result = await getOrganizationStorage('org-1');
      expect(result.region).toBe('us-east-1');
    });
  });

  describe('getStorageRegions', () => {
    it('fetches storage regions', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ regions: [] });
      await getStorageRegions();
      expect(apiClient.apiFetch).toHaveBeenCalledWith('/storage-regions');
    });
  });

  describe('getTimezones', () => {
    it('fetches without query when all=false', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ timezones: ['UTC'] });
      await getTimezones();
      expect(apiClient.apiFetch).toHaveBeenCalledWith('/timezones');
    });

    it('appends ?all=true when requested', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ timezones: ['UTC'] });
      await getTimezones(true);
      expect(apiClient.apiFetch).toHaveBeenCalledWith('/timezones?all=true');
    });
  });

  describe('getCurrentUser', () => {
    it('fetches /me', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validUser);
      const result = await getCurrentUser();
      expect(apiClient.apiFetch).toHaveBeenCalledWith('/me');
      expect(result.user_id).toBe('user-1');
    });
  });

  describe('createOrganization', () => {
    it('POSTs new organization', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validOrg);
      await createOrganization({ name: 'New', slug: 'new-slug' });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'New', slug: 'new-slug' }),
        }),
      );
    });
  });

  describe('getEmailEvents', () => {
    it('fetches with no params', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        items: [],
        total: 0,
        limit: 10,
        offset: 0,
      });
      await getEmailEvents();
      expect(apiClient.apiFetch).toHaveBeenCalledWith('/email-events');
    });

    it('appends query string for filters', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        items: [],
        total: 0,
        limit: 10,
        offset: 0,
      });
      await getEmailEvents({ event_type: 'bounce', limit: 5 });
      const callArg = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      expect(callArg).toContain('event_type=bounce');
      expect(callArg).toContain('limit=5');
    });
  });

  describe('getEmailStats', () => {
    it('fetches stats', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        last_30_days: { bounces: 0, complaints: 0, total_events: 0 },
        user_email_status: { active: 0, bounced: 0, complaint: 0, total: 0 },
      });
      await getEmailStats();
      expect(apiClient.apiFetch).toHaveBeenCalledWith('/email-events/stats');
    });
  });

  describe('deleteEmailEvent', () => {
    it('DELETEs event by ID', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ message: 'ok' });
      await deleteEmailEvent('evt-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/email-events/evt-1',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  describe('bulkDeleteEmailEvents', () => {
    it('POSTs to bulk-delete with body', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        message: 'ok',
        deleted_count: 5,
      });
      await bulkDeleteEmailEvents({ event_type: 'bounce', delete_all: true });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/email-events/bulk-delete',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ event_type: 'bounce', delete_all: true }),
        }),
      );
    });
  });

  describe('getOverviewPreferences', () => {
    it('fetches /me/overview-preferences', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        visible_dataset_ids: [],
      });
      await getOverviewPreferences();
      expect(apiClient.apiFetch).toHaveBeenCalledWith('/me/overview-preferences');
    });
  });

  describe('updateOverviewPreferences', () => {
    it('PUTs new preferences', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        visible_dataset_ids: ['ds-1'],
      });
      await updateOverviewPreferences({
        visible_dataset_ids: ['ds-1'],
        dataset_order: ['ds-1'],
      });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/me/overview-preferences',
        expect.objectContaining({ method: 'PUT' }),
      );
    });
  });
});
