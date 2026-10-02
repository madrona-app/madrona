import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Globe, Loader2, X } from 'lucide-react';
import { uploadFromUrl } from '../../lib/api/media-dam';
import { useToast } from '../../contexts/ToastContext';
import { ModalPortal } from '../ModalPortal';

interface UploadFromUrlModalProps {
  organizationId: string;
  folderId?: string;
  onClose: () => void;
}

export function UploadFromUrlModal({ organizationId, folderId, onClose }: UploadFromUrlModalProps) {
  const { showToast } = useToast();
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');

  const mutation = useMutation({
    mutationFn: () => uploadFromUrl(organizationId, url, title || undefined, folderId),
    onSuccess: () => {
      showToast({ title: 'Upload queued from URL', type: 'success' });
      onClose();
    },
    onError: (error: Error) => {
      showToast({ title: `Upload failed: ${error.message}`, type: 'error' });
    },
  });

  const isValidUrl = url.startsWith('http://') || url.startsWith('https://');

  return (
    <ModalPortal>
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div role="presentation" className="fixed inset-0 bg-ink/50" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-labelledby="upload-url-title" className="relative bg-parchment rounded-lg shadow-xl w-full max-w-md p-6 z-10 border border-lichen">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Globe size={20} className="text-bark" />
            <h2 id="upload-url-title" className="text-lg font-semibold text-ink">Upload from URL</h2>
          </div>
          <button onClick={onClose} className="text-archive hover:text-ink" aria-label="Close upload dialog">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-archive mb-1">URL</label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/image.jpg"
              className="input w-full"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-archive mb-1">Title (optional)</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Custom title for this media"
              className="input w-full"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !isValidUrl}
            className="btn btn-primary flex items-center gap-2"
          >
            {mutation.isPending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Globe size={16} />
            )}
            {mutation.isPending ? 'Uploading...' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
