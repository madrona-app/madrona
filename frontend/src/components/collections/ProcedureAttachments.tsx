/**
 * ProcedureAttachments — general file attachments on a procedure record
 * (purchase invoices, correspondence, braille-ready copies, photographs).
 *
 * Attachments share the polymorphic signed-documents store with
 * document_type 'attachment', so any procedure that supports signed documents
 * can carry them. Each attachment is a file with a required title and an
 * optional description. The backend decides which file types are accepted
 * (app/services/uploads.py ALLOWED_TYPES) and validates file content.
 *
 * Accessibility: native file input with a visible label; download links are
 * named with title, type and size; delete buttons name the attachment;
 * results are announced in a role="status" live region and errors in
 * role="alert"; focus moves to the new attachment after upload and to the
 * neighbouring attachment (or the list heading) after delete.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Download, Paperclip, Trash2, Upload, Loader2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ATTACHMENT_DOCUMENT_TYPE,
  createSignedDocument,
  deleteSignedDocument,
  listSignedDocuments,
  signedDocumentDownloadUrl,
  type SignedDocument,
  type SignedDocumentProcedureType,
} from '../../lib/api/procedure/signedDocuments';
import { formatDateShort } from '../../lib/formatters';
import { attachmentSizeLabel, attachmentTypeLabel } from '../../lib/attachmentLabels';
import ConfirmDialog from '../ConfirmDialog';

/** File types the backend accepts (see uploads.ALLOWED_TYPES). */
const ACCEPT =
  '.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.brf,.html,.htm,' +
  '.jpg,.jpeg,.png,.gif,.webp,.svg,.tif,.tiff,' +
  '.mp3,.wav,.ogg,.flac,.aac,.mp4,.webm,.mov,.avi';

function titleOf(doc: SignedDocument): string {
  return doc.label || doc.media_filename || 'Untitled attachment';
}

type PendingFocus = { kind: 'item'; id: string } | { kind: 'heading' } | null;

export interface ProcedureAttachmentsProps {
  organizationId: string;
  procedureType: SignedDocumentProcedureType;
  procedureId: string;
  /** True when the user may add and delete attachments right now. */
  canManage: boolean;
  /** Shown instead of the upload form when the user cannot manage. */
  readOnlyHint?: string;
  /** Text of the list heading. */
  headingLabel?: string;
}

export function ProcedureAttachments({
  organizationId,
  procedureType,
  procedureId,
  canManage,
  readOnlyHint,
  headingLabel = 'Attached files',
}: ProcedureAttachmentsProps) {
  const uid = useId();
  const ids = {
    heading: `${uid}-heading`,
    formHeading: `${uid}-form-heading`,
    file: `${uid}-file`,
    fileHint: `${uid}-file-hint`,
    fileError: `${uid}-file-error`,
    title: `${uid}-title`,
    titleError: `${uid}-title-error`,
    description: `${uid}-description`,
  };
  const queryClient = useQueryClient();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const linkRefs = useRef(new Map<string, HTMLAnchorElement>());

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<SignedDocument | null>(null);
  // Where to move focus once the list has re-rendered after a change.
  const pendingFocus = useRef<PendingFocus>(null);

  const queryKey = useMemo(
    () => ['signed-documents', organizationId, procedureType, procedureId, ATTACHMENT_DOCUMENT_TYPE],
    [organizationId, procedureType, procedureId],
  );

  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () =>
      listSignedDocuments(organizationId, procedureType, procedureId, ATTACHMENT_DOCUMENT_TYPE),
    enabled: !!organizationId && !!procedureId,
  });
  const attachments: SignedDocument[] = useMemo(() => data?.signed_documents ?? [], [data]);

  // Move focus once the list reflects the change (after refetch).
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    if (target.kind === 'heading') {
      headingRef.current?.focus();
      pendingFocus.current = null;
      return;
    }
    const el = linkRefs.current.get(target.id);
    if (el) {
      el.focus();
      pendingFocus.current = null;
    }
  }, [attachments]);

  const uploadMutation = useMutation({
    mutationFn: (vars: { file: File; title: string; description: string }) =>
      createSignedDocument(organizationId, {
        procedureType,
        procedureId,
        documentType: ATTACHMENT_DOCUMENT_TYPE,
        label: vars.title,
        description: vars.description || undefined,
        file: vars.file,
      }),
    onSuccess: async (doc, vars) => {
      setFile(null);
      setTitle('');
      setDescription('');
      setError(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      // Set before the refetch so the effect sees it on the re-render.
      pendingFocus.current = { kind: 'item', id: doc.signed_document_id };
      await queryClient.invalidateQueries({ queryKey });
      setStatus(`Uploaded ${vars.title}.`);
    },
    onError: (err: Error, vars) => {
      setStatus('');
      setError(`Could not upload ${vars.title}: ${err.message || 'upload failed.'}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (doc: SignedDocument) => deleteSignedDocument(organizationId, doc.signed_document_id),
    onSuccess: async (_res, doc) => {
      const idx = attachments.findIndex((a) => a.signed_document_id === doc.signed_document_id);
      const remaining = attachments.filter((a) => a.signed_document_id !== doc.signed_document_id);
      const next = remaining[idx] ?? remaining[idx - 1];
      setError(null);
      pendingFocus.current = next
        ? { kind: 'item', id: next.signed_document_id }
        : { kind: 'heading' };
      await queryClient.invalidateQueries({ queryKey });
      setStatus(`Deleted ${titleOf(doc)}.`);
    },
    onError: (err: Error, doc) => {
      setStatus('');
      setError(`Could not delete ${titleOf(doc)}: ${err.message || 'delete failed.'}`);
      headingRef.current?.focus();
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0] ?? null;
    setFile(picked);
    setFileError(null);
    // Suggest the file name as the title when none has been typed.
    if (picked && !title.trim()) {
      const base = picked.name.replace(/\.[^.]+$/, '');
      setTitle(base);
      setTitleError(null);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmedTitle = title.trim();
    const nextFileError = file ? null : 'Choose a file to attach.';
    const nextTitleError = trimmedTitle ? null : 'Enter a title for the attachment.';
    setFileError(nextFileError);
    setTitleError(nextTitleError);
    if (nextFileError) {
      fileInputRef.current?.focus();
      return;
    }
    if (nextTitleError) {
      document.getElementById(ids.title)?.focus();
      return;
    }
    setError(null);
    setStatus(`Uploading ${trimmedTitle}…`);
    uploadMutation.mutate({ file: file!, title: trimmedTitle, description: description.trim() });
  };

  const isUploading = uploadMutation.isPending;

  return (
    <div className="space-y-4">
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {status}
      </div>

      <h3
        id={ids.heading}
        ref={headingRef}
        tabIndex={-1}
        className="text-sm font-medium text-ink flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 rounded"
      >
        <Paperclip size={16} className="text-archive" aria-hidden="true" />
        {headingLabel}
        {!isLoading && <span className="text-xs text-archive">({attachments.length})</span>}
      </h3>

      {error && (
        <div
          role="alert"
          className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-sm text-semantic-error"
        >
          {error}
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-archive">Loading attachments…</p>
      ) : isError ? (
        <p className="text-sm text-semantic-error">Attachments could not be loaded.</p>
      ) : attachments.length === 0 ? (
        <p className="text-sm text-archive border border-dashed border-lichen rounded-lg px-3 py-2">
          No attachments yet.
        </p>
      ) : (
        <ul aria-labelledby={ids.heading} className="space-y-2">
          {attachments.map((doc) => {
            const name = titleOf(doc);
            const typeLabel = attachmentTypeLabel(doc);
            const size = attachmentSizeLabel(doc.media_file_size);
            const meta = size ? `${typeLabel}, ${size}` : typeLabel;
            return (
              <li
                key={doc.signed_document_id}
                className="flex flex-wrap items-start justify-between gap-3 p-3 bg-parchment border border-lichen rounded-lg"
              >
                <div className="min-w-0 flex-1">
                  {doc.media_id ? (
                    <a
                      ref={(el) => {
                        if (el) linkRefs.current.set(doc.signed_document_id, el);
                        else linkRefs.current.delete(doc.signed_document_id);
                      }}
                      href={signedDocumentDownloadUrl(organizationId, doc.signed_document_id)}
                      className="inline-flex items-center gap-2 text-sm font-medium text-bark hover:text-copper-dark underline underline-offset-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                    >
                      <Download size={14} aria-hidden="true" />
                      <span>
                        Download {name} ({meta})
                      </span>
                    </a>
                  ) : (
                    <span className="text-sm font-medium text-ink">{name} (no file)</span>
                  )}
                  {doc.description && (
                    <p className="text-sm text-ink mt-1 whitespace-pre-line">{doc.description}</p>
                  )}
                  <p className="text-xs text-accessible-gray mt-1">
                    {doc.media_filename && <>File name: {doc.media_filename}. </>}
                    {doc.created_at && <>Added {formatDateShort(doc.created_at)}.</>}
                  </p>
                </div>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(doc)}
                    disabled={deleteMutation.isPending}
                    aria-label={`Delete attachment ${name}`}
                    className="btn btn-tertiary text-sm min-h-[44px] min-w-[44px] inline-flex items-center gap-1 text-semantic-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    Delete
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canManage ? (
        <form
          onSubmit={handleSubmit}
          aria-labelledby={ids.formHeading}
          noValidate
          className="space-y-3 pt-4 border-t border-lichen"
        >
          <h3 id={ids.formHeading} className="text-sm font-medium text-ink">
            Add an attachment
          </h3>

          <div>
            <label htmlFor={ids.file} className="block text-sm font-medium text-ink mb-1">
              File
            </label>
            <input
              ref={fileInputRef}
              id={ids.file}
              type="file"
              accept={ACCEPT}
              onChange={handleFileChange}
              disabled={isUploading}
              aria-required="true"
              aria-invalid={fileError ? true : undefined}
              aria-describedby={fileError ? `${ids.fileHint} ${ids.fileError}` : ids.fileHint}
              className="block w-full text-sm text-ink file:mr-3 file:min-h-[44px] file:px-3 file:py-2 file:rounded-lg file:border file:border-forest file:bg-parchment file:text-forest file:font-medium hover:file:bg-stone rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            />
            <p id={ids.fileHint} className="text-xs text-accessible-gray mt-1">
              PDF, braille-ready (BRF), Word, Excel, text, CSV, HTML, images, audio or video.
            </p>
            {fileError && (
              <p id={ids.fileError} className="text-xs text-semantic-error mt-1">
                {fileError}
              </p>
            )}
          </div>

          <div>
            <label htmlFor={ids.title} className="block text-sm font-medium text-ink mb-1">
              Title
            </label>
            <input
              id={ids.title}
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (titleError) setTitleError(null);
              }}
              maxLength={255}
              disabled={isUploading}
              aria-required="true"
              aria-invalid={titleError ? true : undefined}
              aria-describedby={titleError ? ids.titleError : undefined}
              className="w-full px-3 py-2 text-sm border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            />
            {titleError && (
              <p id={ids.titleError} className="text-xs text-semantic-error mt-1">
                {titleError}
              </p>
            )}
          </div>

          <div>
            <label htmlFor={ids.description} className="block text-sm font-medium text-ink mb-1">
              Description (optional)
            </label>
            <textarea
              id={ids.description}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              disabled={isUploading}
              className="w-full px-3 py-2 text-sm border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            />
          </div>

          <button
            type="submit"
            disabled={isUploading}
            className="btn btn-primary text-sm min-h-[44px] inline-flex items-center gap-2"
          >
            {isUploading ? (
              <>
                <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                Uploading…
              </>
            ) : (
              <>
                <Upload size={14} aria-hidden="true" />
                Upload attachment
              </>
            )}
          </button>
        </form>
      ) : (
        readOnlyHint && <p className="text-sm text-accessible-gray">{readOnlyHint}</p>
      )}

      <ConfirmDialog
        isOpen={!!confirmDelete}
        title={confirmDelete ? `Delete ${titleOf(confirmDelete)}?` : 'Delete attachment?'}
        message="The attachment will be removed from this record. The file itself stays in media storage."
        confirmText="Delete attachment"
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

export default ProcedureAttachments;
