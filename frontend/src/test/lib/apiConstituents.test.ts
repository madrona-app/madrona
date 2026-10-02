import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as apiClient from '../../lib/apiClient';
import {
  getConstituents,
  createConstituent,
  getConstituent,
  updateConstituent,
  deleteConstituent,
  searchConstituents,
  searchUlan,
  searchViaf,
  searchWikidata,
  searchLoc,
  getUlanRecord,
  importUlan,
  getObjectConstituents,
  addObjectConstituent,
  updateObjectConstituent,
  removeObjectConstituent,
  getConstituentXrefs,
  createConstituentXref,
  updateConstituentXref,
  deleteConstituentXref,
  getConstituentRelations,
  createConstituentRelation,
  deleteConstituentRelation,
  mergeConstituents,
  verifyConstituent,
  getConstituentEnums,
} from '../../lib/api/constituents';

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
  ApiError: class ApiError extends Error {},
  API_BASE_URL: '/api',
  getCsrfToken: vi.fn(),
  getFriendlyErrorMessage: vi.fn(),
}));

const apiFetchMock = vi.mocked(apiClient.apiFetch);

function lastUrl(): string {
  return apiFetchMock.mock.calls[apiFetchMock.mock.calls.length - 1][0] as string;
}

function lastOpts() {
  return apiFetchMock.mock.calls[apiFetchMock.mock.calls.length - 1][1];
}

describe('api/constituents', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockResolvedValue({} as never);
  });

  describe('CRUD', () => {
    it('getConstituents includes search params in querystring', async () => {
      await getConstituents('org-1', {
        q: 'monet',
        constituent_type: 'person',
        limit: 5,
        offset: 10,
      });
      const url = lastUrl();
      expect(url.startsWith('/organizations/org-1/collections/constituents')).toBe(true);
      expect(url).toContain('q=monet');
      expect(url).toContain('constituent_type=person');
      expect(url).toContain('limit=5');
      expect(url).toContain('offset=10');
    });

    it('getConstituents handles missing params', async () => {
      await getConstituents('org-1');
      // Should not throw and should hit the constituents endpoint
      expect(lastUrl()).toContain('/organizations/org-1/collections/constituents');
    });

    it('createConstituent POSTs JSON body', async () => {
      await createConstituent('org-1', { display_name: 'Picasso' });
      expect(lastUrl()).toBe('/organizations/org-1/collections/constituents');
      expect(lastOpts()?.method).toBe('POST');
      expect(JSON.parse(lastOpts()?.body as string)).toEqual({ display_name: 'Picasso' });
    });

    it('getConstituent fetches by id', async () => {
      await getConstituent('org-1', 'c-1');
      expect(lastUrl()).toBe('/organizations/org-1/collections/constituents/c-1');
    });

    it('updateConstituent uses PATCH', async () => {
      await updateConstituent('org-1', 'c-1', { display_name: 'Renoir' });
      expect(lastUrl()).toBe('/organizations/org-1/collections/constituents/c-1');
      expect(lastOpts()?.method).toBe('PATCH');
    });

    it('deleteConstituent uses DELETE', async () => {
      await deleteConstituent('org-1', 'c-1');
      expect(lastUrl()).toBe('/organizations/org-1/collections/constituents/c-1');
      expect(lastOpts()?.method).toBe('DELETE');
    });
  });

  describe('search', () => {
    it('searchConstituents includes q and limit in url', async () => {
      await searchConstituents('org-1', { q: 'foo', limit: 25, include_ulan: true });
      const url = lastUrl();
      expect(url).toContain('/organizations/org-1/collections/constituents/search');
      expect(url).toContain('q=foo');
      expect(url).toContain('limit=25');
      expect(url).toContain('include_ulan=true');
    });

    it('searchUlan hits the ulan-search endpoint', async () => {
      await searchUlan('org-1', { q: 'monet' });
      expect(lastUrl()).toContain('/organizations/org-1/collections/constituents/ulan-search');
    });

    it('searchViaf hits the viaf-search endpoint', async () => {
      await searchViaf('org-1', { q: 'monet' });
      expect(lastUrl()).toContain('viaf-search');
    });

    it('searchWikidata hits the wikidata-search endpoint', async () => {
      await searchWikidata('org-1', { q: 'monet' });
      expect(lastUrl()).toContain('wikidata-search');
    });

    it('searchLoc hits the loc-search endpoint', async () => {
      await searchLoc('org-1', { q: 'monet' });
      expect(lastUrl()).toContain('loc-search');
    });

    it('getUlanRecord embeds the ulan id in the path', async () => {
      await getUlanRecord('org-1', 'ULAN-123');
      expect(lastUrl()).toBe('/organizations/org-1/collections/constituents/ulan/ULAN-123');
    });

    it('importUlan POSTs ulan_id', async () => {
      await importUlan('org-1', { ulan_id: 'U-1' });
      expect(lastUrl()).toBe('/organizations/org-1/collections/constituents/import-ulan');
      expect(lastOpts()?.method).toBe('POST');
      expect(JSON.parse(lastOpts()?.body as string)).toEqual({ ulan_id: 'U-1' });
    });
  });

  describe('object constituents', () => {
    it('getObjectConstituents returns the constituents array', async () => {
      apiFetchMock.mockResolvedValueOnce({ constituents: [{ id: 'x' }] });
      const result = await getObjectConstituents('org-1', 'obj-1');
      expect(result).toEqual([{ id: 'x' }]);
    });

    it('getObjectConstituents falls back to [] when missing', async () => {
      apiFetchMock.mockResolvedValueOnce({});
      const result = await getObjectConstituents('org-1', 'obj-1');
      expect(result).toEqual([]);
    });

    it('addObjectConstituent POSTs to the object xrefs endpoint', async () => {
      await addObjectConstituent('org-1', 'obj-1', { role: 'creator' } as never);
      expect(lastUrl()).toBe(
        '/organizations/org-1/collections/objects/obj-1/constituents',
      );
      expect(lastOpts()?.method).toBe('POST');
    });

    it('updateObjectConstituent uses PUT to the xref id', async () => {
      await updateObjectConstituent('org-1', 'obj-1', 'xref-1', {
        role: 'curator',
      } as never);
      expect(lastUrl()).toBe(
        '/organizations/org-1/collections/objects/obj-1/constituents/xref-1',
      );
      expect(lastOpts()?.method).toBe('PUT');
    });

    it('removeObjectConstituent uses DELETE to the xref id', async () => {
      await removeObjectConstituent('org-1', 'obj-1', 'xref-1');
      expect(lastOpts()?.method).toBe('DELETE');
    });
  });

  describe('generic xrefs', () => {
    it('getConstituentXrefs returns xrefs array', async () => {
      apiFetchMock.mockResolvedValueOnce({ xrefs: [{ id: 'x' }] });
      const result = await getConstituentXrefs('org-1', {
        entity_type: 'object',
        entity_id: 'obj-1',
      });
      expect(result).toEqual([{ id: 'x' }]);
      expect(lastUrl()).toContain('entity_type=object');
      expect(lastUrl()).toContain('entity_id=obj-1');
    });

    it('getConstituentXrefs falls back to [] when missing', async () => {
      apiFetchMock.mockResolvedValueOnce({});
      const result = await getConstituentXrefs('org-1', {
        entity_type: 'loan',
        entity_id: 'l-1',
      });
      expect(result).toEqual([]);
    });

    it('createConstituentXref POSTs to xrefs endpoint', async () => {
      await createConstituentXref('org-1', { role: 'lender' } as never);
      expect(lastUrl()).toBe('/organizations/org-1/collections/constituent-xrefs');
      expect(lastOpts()?.method).toBe('POST');
    });

    it('updateConstituentXref uses PATCH', async () => {
      await updateConstituentXref('org-1', 'xr-1', { role: 'borrower' } as never);
      expect(lastOpts()?.method).toBe('PATCH');
    });

    it('deleteConstituentXref uses DELETE', async () => {
      await deleteConstituentXref('org-1', 'xr-1');
      expect(lastOpts()?.method).toBe('DELETE');
    });
  });

  describe('relations', () => {
    it('getConstituentRelations returns the relations array', async () => {
      apiFetchMock.mockResolvedValueOnce({ relations: [{ id: 'r' }] });
      const result = await getConstituentRelations('org-1', 'c-1');
      expect(result).toEqual([{ id: 'r' }]);
    });

    it('getConstituentRelations falls back to [] when missing', async () => {
      apiFetchMock.mockResolvedValueOnce({});
      const result = await getConstituentRelations('org-1', 'c-1');
      expect(result).toEqual([]);
    });

    it('createConstituentRelation POSTs to nested relations endpoint', async () => {
      await createConstituentRelation('org-1', 'c-1', {
        relation_type: 'parent',
      } as never);
      expect(lastUrl()).toBe(
        '/organizations/org-1/collections/constituents/c-1/relations',
      );
      expect(lastOpts()?.method).toBe('POST');
    });

    it('deleteConstituentRelation uses DELETE on nested relation id', async () => {
      await deleteConstituentRelation('org-1', 'c-1', 'r-1');
      expect(lastUrl()).toBe(
        '/organizations/org-1/collections/constituents/c-1/relations/r-1',
      );
      expect(lastOpts()?.method).toBe('DELETE');
    });
  });

  describe('actions', () => {
    it('mergeConstituents POSTs the secondary_id under primary path', async () => {
      await mergeConstituents('org-1', 'primary-1', { secondary_id: 'sec-1' });
      expect(lastUrl()).toBe(
        '/organizations/org-1/collections/constituents/primary-1/merge',
      );
      expect(JSON.parse(lastOpts()?.body as string)).toEqual({
        secondary_id: 'sec-1',
      });
    });

    it('verifyConstituent POSTs to the verify endpoint with no body', async () => {
      await verifyConstituent('org-1', 'c-1');
      expect(lastUrl()).toBe(
        '/organizations/org-1/collections/constituents/c-1/verify',
      );
      expect(lastOpts()?.method).toBe('POST');
    });

    it('getConstituentEnums hits the enums endpoint', async () => {
      await getConstituentEnums('org-1');
      expect(lastUrl()).toBe('/organizations/org-1/collections/constituents/enums');
    });
  });
});
