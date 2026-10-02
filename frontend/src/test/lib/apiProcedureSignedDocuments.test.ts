import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as apiClient from '../../lib/apiClient';
import {
  listSignedDocuments,
  createSignedDocument,
  updateSignedDocument,
  deleteSignedDocument,
} from '../../lib/api/procedure/signedDocuments';

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

describe('api/procedure/signedDocuments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('listSignedDocuments', () => {
    it('passes procedure_type and procedure_id', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        signed_documents: [],
        count: 0,
      });
      await listSignedDocuments('org-1', 'loan_in', 'l-1');
      const url = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      expect(url).toContain('/organizations/org-1/signed-documents');
      expect(url).toContain('procedure_type=loan_in');
      expect(url).toContain('procedure_id=l-1');
    });

    it('appends document_type when provided', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        signed_documents: [],
        count: 0,
      });
      await listSignedDocuments('org-1', 'acquisition', 'a-1', 'deed_of_gift');
      const url = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      expect(url).toContain('document_type=deed_of_gift');
    });
  });

  describe('createSignedDocument', () => {
    it('POSTs FormData with required fields', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      const file = new File(['x'], 'doc.pdf', { type: 'application/pdf' });
      await createSignedDocument('org-1', {
        procedureType: 'loan_in',
        procedureId: 'l-1',
        documentType: 'agreement',
        label: 'Signed',
        reference: 'REF-1',
        file,
      });
      const init = vi.mocked(apiClient.apiFetch).mock.calls[0][1] as RequestInit;
      expect(init.method).toBe('POST');
      const fd = init.body as FormData;
      expect(fd.get('procedure_type')).toBe('loan_in');
      expect(fd.get('procedure_id')).toBe('l-1');
      expect(fd.get('document_type')).toBe('agreement');
      expect(fd.get('label')).toBe('Signed');
      expect(fd.get('reference')).toBe('REF-1');
      expect(fd.get('file')).toBe(file);
    });

    it('omits optional fields when not provided', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await createSignedDocument('org-1', {
        procedureType: 'object_entry',
        procedureId: 'e-1',
        documentType: 'receipt',
      });
      const init = vi.mocked(apiClient.apiFetch).mock.calls[0][1] as RequestInit;
      const fd = init.body as FormData;
      expect(fd.get('label')).toBeNull();
      expect(fd.get('reference')).toBeNull();
      expect(fd.get('file')).toBeNull();
    });
  });

  describe('updateSignedDocument', () => {
    it('PATCHes label and reference', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await updateSignedDocument('org-1', 'sd-1', { label: 'New', reference: null });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/signed-documents/sd-1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ label: 'New', reference: null }),
        }),
      );
    });
  });

  describe('deleteSignedDocument', () => {
    it('DELETEs the signed document', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ success: true });
      await deleteSignedDocument('org-1', 'sd-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/signed-documents/sd-1',
        { method: 'DELETE' },
      );
    });
  });
});
