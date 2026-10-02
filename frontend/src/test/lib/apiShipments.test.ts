import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as apiClient from '../../lib/apiClient';
import {
  listCrates,
  addShipmentItem,
  updateShipmentItem,
  removeShipmentItem,
  addShipmentLeg,
  updateShipmentLeg,
  removeShipmentLeg,
  addShipmentReference,
  removeShipmentReference,
  addShipmentDocument,
  removeShipmentDocument,
} from '../../lib/api/shipments';

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

describe('api/shipments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('listCrates', () => {
    it('issues GET to crates endpoint with empty query when no params', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ crates: [] });
      await listCrates('org-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/crates?',
      );
    });

    it('encodes q, active, and limit', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ crates: [] });
      await listCrates('org-1', { q: 'box', active: 'yes', limit: 5 });
      const url = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      expect(url).toContain('q=box');
      expect(url).toContain('active=yes');
      expect(url).toContain('limit=5');
    });
  });

  describe('addShipmentItem', () => {
    it('POSTs item with body', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await addShipmentItem('org-1', 'ship-1', { object_id: 'obj-1' });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/shipments/ship-1/items',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ object_id: 'obj-1' }),
        }),
      );
    });
  });

  describe('updateShipmentItem', () => {
    it('PATCHes the item', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await updateShipmentItem('org-1', 'ship-1', 'item-1', { status: 'packed' });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/shipments/ship-1/items/item-1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ status: 'packed' }),
        }),
      );
    });
  });

  describe('removeShipmentItem', () => {
    it('DELETEs the item', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await removeShipmentItem('org-1', 'ship-1', 'item-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/shipments/ship-1/items/item-1',
        { method: 'DELETE' },
      );
    });
  });

  describe('addShipmentLeg', () => {
    it('POSTs to legs endpoint', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await addShipmentLeg('org-1', 'ship-1', { carrier_name: 'UPS' });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/shipments/ship-1/legs',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ carrier_name: 'UPS' }),
        }),
      );
    });
  });

  describe('updateShipmentLeg', () => {
    it('PATCHes the leg', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await updateShipmentLeg('org-1', 'ship-1', 'leg-1', { status: 'in_transit' });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/shipments/ship-1/legs/leg-1',
        expect.objectContaining({ method: 'PATCH' }),
      );
    });
  });

  describe('removeShipmentLeg', () => {
    it('DELETEs the leg', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await removeShipmentLeg('org-1', 'ship-1', 'leg-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/shipments/ship-1/legs/leg-1',
        { method: 'DELETE' },
      );
    });
  });

  describe('addShipmentReference', () => {
    it('POSTs to references', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await addShipmentReference('org-1', 'ship-1', {
        procedure_type: 'loan_in',
        procedure_id: 'l-1',
      });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/shipments/ship-1/references',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('removeShipmentReference', () => {
    it('DELETEs the reference', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await removeShipmentReference('org-1', 'ship-1', 'ref-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/shipments/ship-1/references/ref-1',
        { method: 'DELETE' },
      );
    });
  });

  describe('addShipmentDocument', () => {
    it('POSTs to documents', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await addShipmentDocument('org-1', 'ship-1', { media_id: 'media-1', label: 'BOL' });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/shipments/ship-1/documents',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ media_id: 'media-1', label: 'BOL' }),
        }),
      );
    });
  });

  describe('removeShipmentDocument', () => {
    it('DELETEs the document', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await removeShipmentDocument('org-1', 'ship-1', 'doc-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/shipments/ship-1/documents/doc-1',
        { method: 'DELETE' },
      );
    });
  });
});
