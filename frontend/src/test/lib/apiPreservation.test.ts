import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as apiClient from '../../lib/apiClient';
import {
  getFormatRiskSummary,
  getAtRiskMedia,
  getReplicationSummary,
  getPreservationPolicies,
  getActionPlans,
  approveActionPlan,
  cancelActionPlan,
  getMediaPreservationEvents,
  getMediaReplicas,
  getMediaInfoPackages,
  getAIPManifest,
  createPreservationPolicy,
  updatePreservationPolicy,
  deactivatePreservationPolicy,
} from '../../lib/api/preservation';

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  getCsrfToken: vi.fn(),
  getFriendlyErrorMessage: vi.fn(),
  API_BASE_URL: '/api',
}));

describe('api/preservation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('getFormatRiskSummary', () => {
    it('GETs format risk summary', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ formats: [] });
      const result = await getFormatRiskSummary('org-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/preservation/format-risk-summary',
      );
      expect(result.formats).toEqual([]);
    });
  });

  describe('getAtRiskMedia', () => {
    it('GETs without query when no params given', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ items: [], total: 0 });
      await getAtRiskMedia('org-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/preservation/at-risk-media',
      );
    });

    it('serializes pagination params', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ items: [], total: 0 });
      await getAtRiskMedia('org-1', { limit: 10, offset: 20 });
      const url = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      expect(url).toContain('limit=10');
      expect(url).toContain('offset=20');
    });
  });

  describe('getReplicationSummary', () => {
    it('GETs replication summary', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await getReplicationSummary('org-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/preservation/replication-summary',
      );
    });
  });

  describe('getPreservationPolicies', () => {
    it('GETs policies', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ policies: [] });
      const result = await getPreservationPolicies('org-1');
      expect(result.policies).toEqual([]);
    });
  });

  describe('getActionPlans', () => {
    it('serializes status and action_type params', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ items: [], total: 0 });
      await getActionPlans('org-1', { status: 'pending', action_type: 'migrate_format' });
      const url = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      expect(url).toContain('status=pending');
      expect(url).toContain('action_type=migrate_format');
    });
  });

  describe('approveActionPlan', () => {
    it('POSTs to approve endpoint', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(undefined);
      await approveActionPlan('org-1', 'act-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/preservation/action-plans/act-1/approve',
        { method: 'POST' },
      );
    });
  });

  describe('cancelActionPlan', () => {
    it('POSTs to cancel endpoint', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(undefined);
      await cancelActionPlan('org-1', 'act-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/preservation/action-plans/act-1/cancel',
        { method: 'POST' },
      );
    });
  });

  describe('getMediaPreservationEvents', () => {
    it('GETs scoped events with pagination', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ items: [], total: 0 });
      await getMediaPreservationEvents('org-1', 'media-1', { limit: 5 });
      const url = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      expect(url).toContain('/organizations/org-1/media/media-1/preservation-events');
      expect(url).toContain('limit=5');
    });
  });

  describe('getMediaReplicas', () => {
    it('GETs replicas for media', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ replicas: [] });
      await getMediaReplicas('org-1', 'media-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/media/media-1/replicas',
      );
    });
  });

  describe('getMediaInfoPackages', () => {
    it('GETs information packages', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ information_packages: [] });
      await getMediaInfoPackages('org-1', 'media-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/media/media-1/information-packages',
      );
    });
  });

  describe('getAIPManifest', () => {
    it('GETs AIP manifest', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ a: 1 });
      await getAIPManifest('org-1', 'media-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/media/media-1/aip-manifest',
      );
    });
  });

  describe('createPreservationPolicy', () => {
    it('POSTs new policy with serialized body', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await createPreservationPolicy('org-1', { name: 'Retention', policy_type: 'retention' });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/preservation/policies',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'Retention', policy_type: 'retention' }),
        }),
      );
    });
  });

  describe('updatePreservationPolicy', () => {
    it('PUTs updates by policy id', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await updatePreservationPolicy('org-1', 'pol-1', { name: 'Renamed' });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/preservation/policies/pol-1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ name: 'Renamed' }),
        }),
      );
    });
  });

  describe('deactivatePreservationPolicy', () => {
    it('DELETEs policy', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ message: 'ok' });
      await deactivatePreservationPolicy('org-1', 'pol-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/preservation/policies/pol-1',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });
});
