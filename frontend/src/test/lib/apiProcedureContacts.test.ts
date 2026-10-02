import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as apiClient from '../../lib/apiClient';
import {
  getContacts,
  getContact,
  createContact,
  updateContact,
  deleteContact,
} from '../../lib/api/procedure/contacts';

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

describe('api/procedure/contacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('getContacts', () => {
    it('maps contact_type to constituent_type and search to q', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        items: [],
        total: 0,
        limit: 25,
        offset: 0,
      });
      await getContacts('org-1', { contact_type: 'person', search: 'alice' });
      const url = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      expect(url).toContain('constituent_type=person');
      expect(url).toContain('q=alice');
      expect(url).not.toContain('contact_type=');
      expect(url).not.toContain('search=');
    });

    it('maps constituent records to Contact shape', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        items: [
          {
            constituent_id: 'c-1',
            organization_id: 'org-1',
            constituent_type: 'organization',
            name: 'Smithsonian',
            created_at: '2026-01-01',
          },
        ],
        total: 1,
        limit: 50,
        offset: 0,
      });
      const result = await getContacts('org-1');
      expect(result.contacts[0].contact_id).toBe('c-1');
      expect(result.contacts[0].contact_type).toBe('organization');
      expect(result.contacts[0].is_active).toBe(true);
    });

    it('falls back to defaults when total/limit/offset missing', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        constituents: [],
      });
      const result = await getContacts('org-1');
      expect(result.total).toBe(0);
      expect(result.limit).toBe(50);
      expect(result.offset).toBe(0);
    });
  });

  describe('getContact', () => {
    it('GETs and maps a single contact', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        constituent_id: 'c-1',
        organization_id: 'org-1',
        constituent_type: 'person',
        name: 'Alice',
        created_at: '2026-01-01',
      });
      const result = await getContact('org-1', 'c-1');
      expect(result.contact_id).toBe('c-1');
      expect(result.contact_type).toBe('person');
    });
  });

  describe('createContact', () => {
    it('POSTs constituent_type and returns mapped Contact', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        constituent_id: 'c-2',
        organization_id: 'org-1',
        constituent_type: 'institution',
        name: 'Met',
        created_at: '2026-01-01',
      });
      await createContact('org-1', { contact_type: 'institution', name: 'Met' });
      const args = vi.mocked(apiClient.apiFetch).mock.calls[0];
      expect(args[0]).toBe('/organizations/org-1/collections/constituents');
      const init = args[1] as RequestInit;
      const body = JSON.parse(init.body as string);
      expect(body.constituent_type).toBe('institution');
      expect(body.contact_type).toBeUndefined();
      expect(body.name).toBe('Met');
    });
  });

  describe('updateContact', () => {
    it('PATCHes with mapped contact_type and returns mapped Contact', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        constituent_id: 'c-1',
        organization_id: 'org-1',
        constituent_type: 'person',
        name: 'Alice',
        created_at: '2026-01-01',
      });
      await updateContact('org-1', 'c-1', { contact_type: 'person' });
      const init = vi.mocked(apiClient.apiFetch).mock.calls[0][1] as RequestInit;
      expect(init.method).toBe('PATCH');
      const body = JSON.parse(init.body as string);
      expect(body.constituent_type).toBe('person');
      expect(body.contact_type).toBeUndefined();
    });
  });

  describe('deleteContact', () => {
    it('DELETEs the constituent', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ success: true });
      await deleteContact('org-1', 'c-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/constituents/c-1',
        { method: 'DELETE' },
      );
    });
  });
});
