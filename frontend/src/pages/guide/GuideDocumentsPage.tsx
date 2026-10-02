/**
 * Guide document management page (platform version).
 *
 * Same functionality as the standalone Guide dashboard documents page,
 * but embedded in the Madrona platform layout. Uses the same API endpoints.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, FileText, Loader2, Trash2, Upload } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import ConfirmDialog from '../../components/ConfirmDialog';
import { CorpusGapsPanel } from '../../components/guide/CorpusGapsPanel';

interface GuideDoc {
  document_id: string;
  filename: string;
  file_size_bytes: number;
  mime_type: string;
  status: string;
  visibility: 'public' | 'internal';
  chunk_count: number;
  error_message: string | null;
  created_at: string;
}

const STATUS_STYLES: Record<string, string> = {
  uploaded: 'bg-semantic-info/10 text-semantic-info',
  processing: 'bg-semantic-warning/10 text-semantic-warning',
  ready: 'bg-semantic-success/10 text-semantic-success',
  error: 'bg-semantic-error/10 text-semantic-error',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function GuideDocumentsPage() {
  const [docs, setDocs] = useState<GuideDoc[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [uploadVisibility, setUploadVisibility] = useState<'public' | 'internal'>('internal');
  const [confirmState, setConfirmState] = useState<{action: () => void; title: string; message: string} | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploaderRef = useRef<HTMLDivElement>(null);
  const uploadBtnRef = useRef<HTMLButtonElement>(null);

  // "Cover this" from a Corpus gap → scroll to the uploader and draw the eye to it.
  const handleCoverGap = useCallback(() => {
    uploaderRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => uploadBtnRef.current?.focus(), 350);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch<{ documents: GuideDoc[] }>('/guide/documents');
      setDocs(res.documents);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError('');

    try {
      const form = new FormData();
      form.append('file', file);
      form.append('visibility', uploadVisibility);
      await apiFetch('/guide/documents/upload', { method: 'POST', body: form });
      refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setError(msg);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const handleToggleVisibility = async (doc: GuideDoc) => {
    const newVisibility = doc.visibility === 'public' ? 'internal' : 'public';
    try {
      await apiFetch(`/guide/documents/${doc.document_id}`, {
        method: 'PATCH',
        body: JSON.stringify({ visibility: newVisibility }),
      });
      setDocs((prev) =>
        prev.map((d) =>
          d.document_id === doc.document_id ? { ...d, visibility: newVisibility } : d,
        ),
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Update failed';
      setError(msg);
    }
  };

  const handleDelete = (id: string) => {
    setConfirmState({
      action: async () => {
        try {
          await apiFetch(`/guide/documents/${id}`, { method: 'DELETE' });
          setDocs((prev) => prev.filter((d) => d.document_id !== id));
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Delete failed';
          setError(msg);
        }
      },
      title: 'Delete Document',
      message: 'Delete this document and its processed chunks?',
    });
  };

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Guide Documents</h1>
          <p className="text-sm text-archive mt-1">
            Upload documents to enrich your AI assistant's knowledge base.
          </p>
        </div>
        <div ref={uploaderRef} className="flex items-center gap-3">
          <select
            value={uploadVisibility}
            onChange={(e) => setUploadVisibility(e.target.value as 'public' | 'internal')}
            className="rounded-md border border-lichen px-3 py-2 text-sm bg-parchment focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 outline-none"
          >
            <option value="internal">Upload as internal</option>
            <option value="public">Upload as public</option>
          </select>

          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.docx,.txt,.md"
            className="hidden"
            onChange={handleUpload}
          />
          <button
            ref={uploadBtnRef}
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
            className="btn-primary flex items-center gap-2 px-4 py-2 text-sm"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {uploading ? 'Uploading...' : 'Upload document'}
          </button>
        </div>
      </div>

      <p className="text-sm text-accessible-gray mb-4">
        <strong>Internal</strong> documents are only searchable by staff.{' '}
        <strong>Public</strong> documents are also searchable by visitors via the embedded widget.
        Documents default to internal.
      </p>

      <CorpusGapsPanel onCover={handleCoverGap} />

      {error && (
        <div className="bg-semantic-error/10 text-semantic-error text-sm rounded-md px-4 py-3 mb-4">
          {error}
        </div>
      )}

      {docs.length === 0 ? (
        <div className="border border-dashed border-lichen rounded-lg p-12 text-center">
          <FileText className="w-10 h-10 text-archive mx-auto mb-3" />
          <p className="text-archive text-sm">No documents yet.</p>
        </div>
      ) : (
        <div className="border border-lichen rounded-lg divide-y divide-lichen bg-parchment">
          {docs.map((doc) => (
            <div key={doc.document_id} className="flex items-center gap-4 px-5 py-4">
              <FileText className="w-5 h-5 text-archive flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink truncate">{doc.filename}</p>
                <p className="text-xs text-archive">
                  {formatBytes(doc.file_size_bytes)}
                  {doc.chunk_count > 0 && <> &middot; {doc.chunk_count} chunks</>}
                </p>
                {doc.error_message && (
                  <p className="text-xs text-semantic-error mt-1">{doc.error_message}</p>
                )}
              </div>

              <button
                onClick={() => handleToggleVisibility(doc)}
                className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full transition-colors ${
                  doc.visibility === 'public'
                    ? 'bg-semantic-success/10 text-semantic-success'
                    : 'bg-stone/50 text-archive'
                }`}
                title={
                  doc.visibility === 'public'
                    ? 'Visible to visitors — click to make internal'
                    : 'Internal only — click to make public'
                }
              >
                {doc.visibility === 'public' ? (
                  <Eye className="w-3 h-3" />
                ) : (
                  <EyeOff className="w-3 h-3" />
                )}
                {doc.visibility}
              </button>

              <span
                className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_STYLES[doc.status] || ''}`}
              >
                {doc.status === 'processing' && <Loader2 className="w-3 h-3 animate-spin inline mr-1" />}
                {doc.status}
              </span>

              <button
                onClick={() => handleDelete(doc.document_id)}
                className="text-archive hover:text-semantic-error transition-colors p-1"
                title="Delete document"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={() => { confirmState?.action(); setConfirmState(null); }}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        confirmText="Confirm"
        confirmStyle="danger"
      />
    </div>
  );
}
