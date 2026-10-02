import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as apiClient from '../../lib/apiClient';
import {
  reindexCollections,
  getLocations,
  getMovements,
  getObjectParts,
  searchVocabulary,
  cacheVocabularyTerm,
  importGettyTerm,
  getAllLookups,
  getLookupCategory,
  createLookupValue,
  updateLookupValue,
  deleteLookupValue,
  toggleHideLookupValue,
  updateLookupSortOrder,
  getObjectClassifications,
  linkObjectClassification,
  unlinkObjectClassification,
  getCrate,
  createCrate,
  updateCrate,
  deleteCrate,
  getNagpraConsultationEvents,
  autocompleteCollections,
  deleteCollectionObject,
  deleteLocation,
  deleteMovement,
  deleteOtherNumberType,
  deleteObjectPart,
  deleteNagpraAction,
  deleteNagpraConsultationEvent,
} from '../../lib/api/collections';

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

describe('api/collections (passthrough endpoints)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('reindexCollections', () => {
    it('POSTs to reindex endpoint', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        success: true,
        total: 0,
        indexed: 0,
        errors: 0,
      });
      const result = await reindexCollections('org-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/search/reindex',
        { method: 'POST' },
      );
      expect(result.success).toBe(true);
    });
  });

  describe('autocompleteCollections', () => {
    it('GETs with q/field/limit defaults', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ suggestions: [] });
      await autocompleteCollections('org-1', 'pot');
      const url = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      expect(url).toContain('q=pot');
      expect(url).toContain('field=title');
      expect(url).toContain('limit=10');
    });

    it('respects field/limit overrides', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ suggestions: [] });
      await autocompleteCollections('org-1', 'q', 'creator', 25);
      const url = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      expect(url).toContain('field=creator');
      expect(url).toContain('limit=25');
    });
  });

  describe('getLocations', () => {
    it('GETs locations passthrough', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ locations: [] });
      const result = await getLocations('org-1', { is_active: true });
      const url = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      expect(url).toContain('is_active=true');
      expect(result.locations).toEqual([]);
    });
  });

  describe('deleteLocation', () => {
    it('DELETEs', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await deleteLocation('org-1', 'loc-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/locations/loc-1',
        { method: 'DELETE' },
      );
    });
  });

  describe('getMovements', () => {
    it('GETs movements with filter params', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ items: [], total: 0 });
      await getMovements('org-1', { object_id: 'obj-1', limit: 5 });
      const url = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      expect(url).toContain('object_id=obj-1');
      expect(url).toContain('limit=5');
    });
  });

  describe('deleteMovement', () => {
    it('DELETEs', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await deleteMovement('org-1', 'mv-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/movements/mv-1',
        { method: 'DELETE' },
      );
    });
  });

  describe('deleteCollectionObject', () => {
    it('DELETEs', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await deleteCollectionObject('org-1', 'obj-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/objects/obj-1',
        { method: 'DELETE' },
      );
    });
  });

  describe('deleteOtherNumberType', () => {
    it('DELETEs', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await deleteOtherNumberType('org-1', 'type-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/settings/other-number-types/type-1',
        { method: 'DELETE' },
      );
    });
  });

  describe('getObjectParts', () => {
    it('GETs parts passthrough', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ parts: [], total: 0 });
      await getObjectParts('org-1', 'obj-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/objects/obj-1/parts',
      );
    });
  });

  describe('deleteObjectPart', () => {
    it('DELETEs', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ success: true });
      await deleteObjectPart('org-1', 'obj-1', 'part-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/objects/obj-1/parts/part-1',
        { method: 'DELETE' },
      );
    });
  });

  describe('searchVocabulary', () => {
    it('maps frontend params to backend names', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ terms: [] });
      await searchVocabulary('org-1', {
        vocabulary_type: 'aat',
        query: 'wood',
        limit: 5,
        facet: 'materials',
      });
      const url = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      expect(url).toContain('q=wood');
      expect(url).toContain('vocabulary=aat');
      expect(url).toContain('limit=5');
      expect(url).toContain('facet=materials');
      expect(url).toContain('include_remote=true');
    });
  });

  describe('cacheVocabularyTerm', () => {
    it('POSTs term payload', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ term_id: 't-1' });
      await cacheVocabularyTerm('org-1', {
        vocabulary: 'aat',
        external_id: 'ext-1',
        preferred_term: 'Stone',
      });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/vocabulary/cache',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('importGettyTerm', () => {
    it('POSTs Getty term payload', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ status: 'queued' });
      await importGettyTerm('org-1', {
        vocabulary: 'aat',
        external_id: 'g-1',
        preferred_term: 'Brass',
      });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/vocabulary/import',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('getAllLookups', () => {
    it('GETs lookups with optional context filter', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce([]);
      await getAllLookups('org-1', { context: 'objects', include_hidden: true });
      const url = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      expect(url).toContain('context=objects');
      expect(url).toContain('include_hidden=true');
    });
  });

  describe('getLookupCategory', () => {
    it('GETs single category', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await getLookupCategory('org-1', 'classifications');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/lookups/classifications',
      );
    });
  });

  describe('createLookupValue', () => {
    it('POSTs lookup value', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await createLookupValue('org-1', 'classifications', {
        value_key: 'paint',
        label: 'Painting',
      });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/lookups/classifications',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('updateLookupValue', () => {
    it('PUTs lookup value updates', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await updateLookupValue('org-1', 'val-1', { label: 'New' });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/lookups/values/val-1',
        expect.objectContaining({ method: 'PUT' }),
      );
    });
  });

  describe('deleteLookupValue', () => {
    it('DELETEs', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await deleteLookupValue('org-1', 'val-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/lookups/values/val-1',
        { method: 'DELETE' },
      );
    });
  });

  describe('toggleHideLookupValue', () => {
    it('PUTs hidden flag', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await toggleHideLookupValue('org-1', 'val-1', true);
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/lookups/values/val-1/hide',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ hidden: true }),
        }),
      );
    });
  });

  describe('updateLookupSortOrder', () => {
    it('PUTs value_ids', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await updateLookupSortOrder('org-1', 'cat', ['v1', 'v2']);
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/lookups/cat/sort',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ value_ids: ['v1', 'v2'] }),
        }),
      );
    });
  });

  describe('getObjectClassifications', () => {
    it('GETs classifications passthrough', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await getObjectClassifications('org-1', 'obj-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/objects/obj-1/classifications',
      );
    });
  });

  describe('linkObjectClassification', () => {
    it('POSTs value_id', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await linkObjectClassification('org-1', 'obj-1', { value_id: 'v-1' });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/objects/obj-1/classifications',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('unlinkObjectClassification', () => {
    it('DELETEs link', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await unlinkObjectClassification('org-1', 'obj-1', 'link-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/objects/obj-1/classifications/link-1',
        { method: 'DELETE' },
      );
    });
  });

  describe('crates', () => {
    it('GETs a crate', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        crate_id: 'cr-1',
        organization_id: 'org-1',
      });
      await getCrate('org-1', 'cr-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/crates/cr-1',
      );
    });

    it('POSTs a new crate', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await createCrate('org-1', { crate_number: 'C-1' });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/crates',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('PATCHes crate updates', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await updateCrate('org-1', 'cr-1', { description: 'foo' });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/crates/cr-1',
        expect.objectContaining({ method: 'PATCH' }),
      );
    });

    it('DELETEs a crate', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await deleteCrate('org-1', 'cr-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/crates/cr-1',
        { method: 'DELETE' },
      );
    });
  });

  describe('NAGPRA actions', () => {
    it('DELETEs nagpra action', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await deleteNagpraAction('org-1', 'na-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/nagpra-actions/na-1',
        { method: 'DELETE' },
      );
    });

    it('GETs nagpra consultation events passthrough', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ events: [] });
      await getNagpraConsultationEvents('org-1', 'na-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/nagpra-actions/na-1/consultation-events',
      );
    });

    it('DELETEs consultation event', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await deleteNagpraConsultationEvent('org-1', 'na-1', 'evt-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/nagpra-actions/na-1/consultation-events/evt-1',
        { method: 'DELETE' },
      );
    });
  });
});
