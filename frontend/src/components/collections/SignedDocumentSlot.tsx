/**
 * SignedDocumentSlot — reusable signed-document attachment for procedures
 * procedures.
 *
 * Expects signed documents on seven procedures (Object Entry,
 * Object Exit, Acquisition, Loans In/Out, Deaccession, Movement). This
 * component is the single UI primitive for attaching them: upload a scan,
 * enter a text reference (for paper-only workflows), or in Phase 2 send
 * the document for e-signature.
 *
 * Multiple signed documents per procedure are supported — loans can have
 * amendments, deaccessions can have both a board resolution and a deed of
 * gift. The component lists every document of the given `documentType` on
 * the procedure, plus provides an "Add another" button.
 */

import { useMemo, useRef, useState } from 'react';
import {
  FileText,
  Upload,
  ExternalLink,
  Trash2,
  Plus,
  Loader2,
  PenLine,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createSignedDocument,
  deleteSignedDocument,
  listSignedDocuments,
  type SignedDocument,
  type SignedDocumentProcedureType,
} from '../../lib/api/procedure/signedDocuments';
import { formatDateShort } from '../../lib/formatters';
import ConfirmDialog from '../ConfirmDialog';

export interface SignedDocumentSlotProps {
  organizationId: string;
  procedureType: SignedDocumentProcedureType;
  procedureId: string;
  /** Document type identifier (e.g., 'entry_form', 'loan_agreement'). */
  documentType: string;
  /** Human label for the section heading. */
  title: string;
  /** Help text shown below the title. */
  helpText?: string;
  /** Whether the page is in edit mode; upload/delete are disabled otherwise. */
  isEditing: boolean;
  /**
   * Optional callback that generates the unsigned document (e.g., the
   * "Generate Receipt" PDF for Object Entry). If provided, a "Generate
   * unsigned document" button appears alongside the upload control to
   * streamline the print-and-scan workflow.
   */
  onGenerateUnsigned?: () => void;
  isGeneratingUnsigned?: boolean;
  /** Optional label for the generate button. Defaults to "Generate unsigned document". */
  generateUnsignedLabel?: string;
}

export function SignedDocumentSlot({
  organizationId,
  procedureType,
  procedureId,
  documentType,
  title,
  helpText,
  isEditing,
  onGenerateUnsigned,
  isGeneratingUnsigned,
  generateUnsignedLabel = 'Generate unsigned document',
}: SignedDocumentSlotProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [referenceInput, setReferenceInput] = useState('');
  const [labelInput, setLabelInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const queryKey = useMemo(
    () => ['signed-documents', organizationId, procedureType, procedureId, documentType],
    [organizationId, procedureType, procedureId, documentType],
  );

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => listSignedDocuments(organizationId, procedureType, procedureId, documentType),
    enabled: !!organizationId && !!procedureId,
  });

  const documents: SignedDocument[] = data?.signed_documents || [];

  const uploadMutation = useMutation({
    mutationFn: (file: File) =>
      createSignedDocument(organizationId, {
        procedureType,
        procedureId,
        documentType,
        label: labelInput.trim() || undefined,
        file,
      }),
    onSuccess: () => {
      setLabelInput('');
      setError(null);
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (err: Error) => setError(err.message || 'Failed to upload signed document.'),
  });

  const createReferenceMutation = useMutation({
    mutationFn: () =>
      createSignedDocument(organizationId, {
        procedureType,
        procedureId,
        documentType,
        label: labelInput.trim() || undefined,
        reference: referenceInput.trim(),
      }),
    onSuccess: () => {
      setReferenceInput('');
      setLabelInput('');
      setError(null);
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (err: Error) => setError(err.message || 'Failed to save reference.'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSignedDocument(organizationId, id),
    onSuccess: () => {
      setConfirmDelete(null);
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/tiff'];
    if (!allowed.includes(file.type)) {
      setError('Please upload a PDF or image file (PDF, JPEG, PNG, GIF, TIFF).');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError('File size must be less than 20MB.');
      return;
    }
    setError(null);
    try {
      await uploadMutation.mutateAsync(file);
    } catch {
      /* error state already set in onError */
    }
    // Reset input so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const isBusy = uploadMutation.isPending || createReferenceMutation.isPending;

  return (
    <div className="space-y-4">
      {/* Heading */}
      <div>
        <h4 className="text-sm font-medium text-ink flex items-center gap-2">
          <PenLine size={16} className="text-archive" />
          {title}
          {documents.length > 0 && (
            <span className="text-xs text-archive">({documents.length})</span>
          )}
        </h4>
        {helpText && <p className="text-xs text-archive mt-0.5">{helpText}</p>}
      </div>

      {error && (
        <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-sm text-semantic-error">
          {error}
        </div>
      )}

      {/* List of attached documents */}
      {isLoading ? (
        <div className="text-xs text-archive italic py-2">Loading…</div>
      ) : documents.length === 0 ? (
        <div className="text-xs text-archive italic py-2 border border-dashed border-lichen rounded-lg px-3">
          No signed document attached yet.
        </div>
      ) : (
        <ul className="space-y-2">
          {documents.map((doc, idx) => (
            <li
              key={doc.signed_document_id}
              className="flex items-start justify-between gap-3 p-3 bg-parchment border border-lichen rounded-lg"
            >
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <FileText size={16} className="text-archive flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-ink truncate">
                      {doc.label || doc.media_filename || doc.reference || doc.document_type}
                    </span>
                    {idx === 0 && (
                      <span className="text-[10px] uppercase tracking-wide text-bark bg-bark/10 rounded px-1.5 py-0.5">
                        Current
                      </span>
                    )}
                  </div>
                  {doc.media_filename && (
                    <p className="text-xs text-archive truncate">{doc.media_filename}</p>
                  )}
                  {doc.reference && !doc.media_id && (
                    <p className="text-xs text-archive italic">Reference: {doc.reference}</p>
                  )}
                  {doc.created_at && (
                    <p className="text-xs text-archive mt-0.5">
                      Attached {formatDateShort(doc.created_at)}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {doc.media_url && (
                  <a
                    href={doc.media_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 text-archive hover:text-bark rounded"
                    title="Open signed document"
                  >
                    <ExternalLink size={14} />
                  </a>
                )}
                {isEditing && (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(doc.signed_document_id)}
                    className="p-1.5 text-archive hover:text-semantic-error rounded"
                    title="Remove signed document"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Add new document controls (edit mode only) */}
      {isEditing && (
        <div className="space-y-3 pt-3 border-t border-lichen">
          <div className="text-xs font-medium text-archive flex items-center gap-1">
            <Plus size={12} />
            {documents.length === 0 ? 'Attach signed document' : 'Attach another'}
          </div>

          <input
            type="text"
            value={labelInput}
            onChange={(e) => setLabelInput(e.target.value)}
            placeholder="Label (optional — e.g. 'Loan amendment 2')"
            disabled={isBusy}
            className="w-full px-3 py-2 text-sm border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
          />

          <div className="flex flex-wrap items-center gap-2">
            {onGenerateUnsigned && (
              <button
                type="button"
                onClick={onGenerateUnsigned}
                disabled={isGeneratingUnsigned || isBusy}
                className="btn btn-secondary text-sm flex items-center gap-2"
              >
                {isGeneratingUnsigned ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Generating…
                  </>
                ) : (
                  <>
                    <FileText size={14} />
                    {generateUnsignedLabel}
                  </>
                )}
              </button>
            )}

            <label
              className={`btn btn-primary text-sm flex items-center gap-2 cursor-pointer ${
                isBusy ? 'opacity-50 pointer-events-none' : ''
              }`}
            >
              {uploadMutation.isPending ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Uploading…
                </>
              ) : (
                <>
                  <Upload size={14} />
                  Upload signed file
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept="application/pdf,image/jpeg,image/png,image/gif,image/tiff"
                onChange={handleFileSelect}
                disabled={isBusy}
              />
            </label>
          </div>

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="text-xs text-archive block mb-1">
                …or reference a paper document
              </label>
              <input
                type="text"
                value={referenceInput}
                onChange={(e) => setReferenceInput(e.target.value)}
                placeholder="e.g. 'Signed form in file F-2026-0041'"
                disabled={isBusy}
                className="w-full px-3 py-2 text-sm border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
              />
            </div>
            <button
              type="button"
              onClick={() => createReferenceMutation.mutate()}
              disabled={isBusy || !referenceInput.trim()}
              className="btn btn-secondary text-sm whitespace-nowrap"
            >
              {createReferenceMutation.isPending ? 'Saving…' : 'Save reference'}
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={!!confirmDelete}
        title="Remove signed document?"
        message="The reference to this signed document will be removed from this record. The underlying file in media storage is preserved."
        confirmText="Remove"
        cancelText="Cancel"
        confirmStyle="danger"
        onConfirm={() => {
          if (confirmDelete) deleteMutation.mutate(confirmDelete);
        }}
        onClose={() => setConfirmDelete(null)}
      />
    </div>
  );
}

export default SignedDocumentSlot;
