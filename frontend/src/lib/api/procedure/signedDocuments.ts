/**
 * Signed Documents API
 *
 * Polymorphic signed-document attachments across Object Entry, Object Exit,
 * Acquisition, Loans In/Out, Deaccession, and Movement. See backend
 * `app.models.signed_documents.SignedDocument` for the schema.
 */
import { apiFetch } from '../_utils';

export type SignedDocumentProcedureType =
  | 'object_entry'
  | 'object_exit'
  | 'acquisition'
  | 'loan_in'
  | 'loan_out'
  | 'deaccession'
  | 'movement';

export interface SignedDocument {
  signed_document_id: string;
  organization_id: string;
  procedure_type: SignedDocumentProcedureType;
  procedure_id: string;
  document_type: string;
  label: string | null;
  media_id: string | null;
  media_filename: string | null;
  media_mime_type: string | null;
  media_url: string | null;
  reference: string | null;
  // E-sign (Phase 2)
  esign_provider: string | null;
  esign_envelope_id: string | null;
  esign_status: string | null;
  esign_recipients: unknown;
  esign_sent_at: string | null;
  esign_completed_at: string | null;
  created_at: string | null;
  created_by: string | null;
  updated_at: string | null;
  version: number;
}

export async function listSignedDocuments(
  organizationId: string,
  procedureType: SignedDocumentProcedureType,
  procedureId: string,
  documentType?: string,
): Promise<{ signed_documents: SignedDocument[]; count: number }> {
  const params = new URLSearchParams({
    procedure_type: procedureType,
    procedure_id: procedureId,
  });
  if (documentType) params.append('document_type', documentType);
  return await apiFetch(
    `/organizations/${organizationId}/signed-documents?${params.toString()}`,
  );
}

export async function createSignedDocument(
  organizationId: string,
  params: {
    procedureType: SignedDocumentProcedureType;
    procedureId: string;
    documentType: string;
    label?: string;
    reference?: string;
    file?: File;
  },
): Promise<SignedDocument> {
  const form = new FormData();
  form.append('procedure_type', params.procedureType);
  form.append('procedure_id', params.procedureId);
  form.append('document_type', params.documentType);
  if (params.label) form.append('label', params.label);
  if (params.reference) form.append('reference', params.reference);
  if (params.file) form.append('file', params.file);

  return await apiFetch(`/organizations/${organizationId}/signed-documents`, {
    method: 'POST',
    body: form,
    headers: {}, // let the browser set multipart boundary
  });
}

export async function updateSignedDocument(
  organizationId: string,
  signedDocumentId: string,
  updates: { label?: string; reference?: string | null; document_type?: string },
): Promise<SignedDocument> {
  return await apiFetch(
    `/organizations/${organizationId}/signed-documents/${signedDocumentId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(updates),
    },
  );
}

export async function deleteSignedDocument(
  organizationId: string,
  signedDocumentId: string,
): Promise<{ success: boolean }> {
  return await apiFetch(
    `/organizations/${organizationId}/signed-documents/${signedDocumentId}`,
    { method: 'DELETE' },
  );
}
