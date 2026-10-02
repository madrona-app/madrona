import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as apiClient from '../../lib/apiClient';
import {
  getAuthorities,
  getAuthority,
  createAuthority,
  updateAuthority,
  deleteAuthority,
  mergeAuthorities,
  getAuthorityRelations,
  createAuthorityRelation,
  deleteAuthorityRelation,
  searchPersonAuthoritiesWithULAN,
  importULANRecord,
  searchSubjectsExternal,
  searchWikidataArtworks,
} from '../../lib/api/authorities';

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

const validAuthority = {
  authority_id: 'auth-1',
  organization_id: 'org-1',
  preferred_name: 'John Doe',
  status: 'active',
  is_verified: false,
};

describe('api/authorities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('getAuthorities', () => {
    it('builds query string', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        items: [],
        total: 0,
        limit: 0,
        offset: 0,
      });
      await getAuthorities('org-1', { search: 'doe', is_verified: true });
      const url = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      expect(url).toContain('search=doe');
      expect(url).toContain('is_verified=true');
    });
  });

  describe('getAuthority', () => {
    it('GETs single authority', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validAuthority);
      const result = await getAuthority('org-1', 'auth-1');
      expect(result.authority_id).toBe('auth-1');
    });
  });

  describe('createAuthority', () => {
    it('POSTs new authority', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validAuthority);
      await createAuthority('org-1', { preferred_name: 'John Doe' });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/authorities',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('updateAuthority', () => {
    it('PATCHes updates', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validAuthority);
      await updateAuthority('org-1', 'auth-1', { biography: 'bio' });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/authorities/auth-1',
        expect.objectContaining({ method: 'PATCH' }),
      );
    });
  });

  describe('deleteAuthority', () => {
    it('DELETEs', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ success: true });
      await deleteAuthority('org-1', 'auth-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/authorities/auth-1',
        { method: 'DELETE' },
      );
    });
  });

  describe('mergeAuthorities', () => {
    it('POSTs target_authority_id', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await mergeAuthorities('org-1', 'src', 'tgt');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/authorities/src/merge',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ target_authority_id: 'tgt' }),
        }),
      );
    });
  });

  describe('getAuthorityRelations', () => {
    it('GETs relations', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        outgoing_relations: [],
        incoming_relations: [],
      });
      await getAuthorityRelations('org-1', 'auth-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/authorities/auth-1/relations',
      );
    });
  });

  describe('createAuthorityRelation', () => {
    it('POSTs new relation', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        relation_id: 'r-1',
        source_authority_id: 'auth-1',
        related_authority_id: 'auth-2',
        relationship_type: 'colleague',
      });
      await createAuthorityRelation('org-1', 'auth-1', {
        related_authority_id: 'auth-2',
        relationship_type: 'colleague',
      });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/authorities/auth-1/relations',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('deleteAuthorityRelation', () => {
    it('DELETEs', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ success: true });
      await deleteAuthorityRelation('org-1', 'auth-1', 'r-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/authorities/auth-1/relations/r-1',
        { method: 'DELETE' },
      );
    });
  });

  describe('searchPersonAuthoritiesWithULAN', () => {
    it('passes default include_ulan=true and limit=20', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ query: 'x', results: [] });
      await searchPersonAuthoritiesWithULAN('org-1', 'leonardo');
      const url = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      expect(url).toContain('q=leonardo');
      expect(url).toContain('include_ulan=true');
      expect(url).toContain('limit=20');
    });

    it('respects custom options', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ query: 'x', results: [] });
      await searchPersonAuthoritiesWithULAN('org-1', 'q', { include_ulan: false, limit: 5 });
      const url = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      expect(url).toContain('include_ulan=false');
      expect(url).toContain('limit=5');
    });
  });

  describe('importULANRecord', () => {
    it('POSTs ulan_id', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await importULANRecord('org-1', '500001');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/person-authorities/import-ulan',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ ulan_id: '500001' }),
        }),
      );
    });
  });

  describe('searchSubjectsExternal', () => {
    it('returns suggestions array on success', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        suggestions: [{ id: '1', label: 'A', source: 'x' }],
      });
      const result = await searchSubjectsExternal('org-1', 'art');
      expect(result).toHaveLength(1);
    });

    it('returns empty array when API throws', async () => {
      vi.mocked(apiClient.apiFetch).mockRejectedValueOnce(new Error('fail'));
      const result = await searchSubjectsExternal('org-1', 'art');
      expect(result).toEqual([]);
    });

    it('returns empty when suggestions absent', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      const result = await searchSubjectsExternal('org-1', 'art');
      expect(result).toEqual([]);
    });
  });

  describe('searchWikidataArtworks', () => {
    it('passes query and default limit', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ query: 'x', results: [] });
      await searchWikidataArtworks('org-1', 'mona lisa');
      const url = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      expect(url).toContain('q=mona%20lisa');
      expect(url).toContain('limit=10');
    });

    it('respects custom limit', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ query: 'x', results: [] });
      await searchWikidataArtworks('org-1', 'q', 25);
      const url = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      expect(url).toContain('limit=25');
    });
  });
});
