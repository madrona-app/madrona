/**
 * Upload queue store — module-level singleton, no React.
 *
 * Replaces the React context + provider pattern used previously. The
 * motivation: with a provider, every authed page mounted UploadProvider
 * (subscribing to toast context, running effects, holding state) and
 * rendered UploadProgressDrawer even when there were zero uploads — the
 * tree existed just in case. With a module store, the state lives once
 * per tab regardless of React tree, the drawer is mounted only when
 * there is actually something to show (via a gate in LayoutWrapper), and
 * the hook reads state through useSyncExternalStore so consumers
 * re-render only when the slices they subscribe to change.
 *
 * Toast notifications for upload completion are dispatched directly
 * through ToastContext's module-level registry (getGlobalShowToast)
 * instead of through a useToast subscription on a long-lived provider.
 */

import { useSyncExternalStore } from 'react';
import { getGlobalShowToast } from './ToastContext';

export interface UploadItem {
  id: string;
  file: File;
  organizationId: string;
  folderId?: string;
  useTus?: boolean;
  status: 'queued' | 'uploading' | 'processing' | 'completed' | 'failed';
  progress: number;
  error?: string;
  mediaId?: string;
}

export interface UploadStoreState {
  uploads: UploadItem[];
}

// ---------------------------------------------------------------------------
// Store internals
// ---------------------------------------------------------------------------

const MAX_CONCURRENT = 3;
const TUS_ENDPOINT = import.meta.env.VITE_TUS_ENDPOINT || '';

let state: UploadStoreState = { uploads: [] };
let activeCount = 0;
const processingIds = new Set<string>();
let toastShown = false;

const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function setUploads(updater: (prev: UploadItem[]) => UploadItem[]): void {
  state = { uploads: updater(state.uploads) };
  emit();
}

// ---------------------------------------------------------------------------
// TUS resumable upload (optional, for files >10 MB when endpoint configured)
// ---------------------------------------------------------------------------

async function tusUpload(
  file: File,
  endpoint: string,
  metadata: Record<string, string>,
  onProgress: (pct: number) => void,
): Promise<string> {
  const tus = await import('tus-js-client');
  return new Promise<string>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint,
      retryDelays: [0, 1000, 3000, 5000],
      metadata: {
        filename: file.name,
        filetype: file.type,
        ...metadata,
      },
      onProgress: (bytesUploaded: number, bytesTotal: number) => {
        onProgress(bytesUploaded / bytesTotal);
      },
      onSuccess: () => {
        const url = upload.url;
        const mediaId = url ? url.split('/').pop() || '' : '';
        resolve(mediaId);
      },
      onError: (error: Error) => {
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    });
    upload.start();
  });
}

// ---------------------------------------------------------------------------
// Queue processing
// ---------------------------------------------------------------------------

async function processItem(item: UploadItem): Promise<void> {
  processingIds.add(item.id);
  activeCount++;

  setUploads((prev) =>
    prev.map((u) => (u.id === item.id ? { ...u, status: 'uploading', progress: 0 } : u)),
  );

  try {
    let mediaId: string;
    const useTus = TUS_ENDPOINT && item.file.size > 10 * 1024 * 1024;

    if (useTus) {
      mediaId = await tusUpload(
        item.file,
        TUS_ENDPOINT,
        {
          organization_id: item.organizationId,
          ...(item.folderId ? { folder_id: item.folderId } : {}),
        },
        (progress) => {
          setUploads((prev) =>
            prev.map((u) =>
              u.id === item.id ? { ...u, progress: Math.round(progress * 100) } : u,
            ),
          );
        },
      );
    } else {
      // Lazy-load the media API so its schemas/zod graph stays off the
      // authed-shell boot path. Uploads are async anyway — an extra chunk
      // fetch on first upload is imperceptible.
      const { uploadMedia } = await import('../lib/api/media');
      const result = await uploadMedia(
        item.organizationId,
        item.file,
        { folder_id: item.folderId },
        (progress) => {
          setUploads((prev) =>
            prev.map((u) =>
              u.id === item.id ? { ...u, progress: Math.round(progress * 100) } : u,
            ),
          );
        },
      );
      mediaId = result.media_id;
    }

    setUploads((prev) =>
      prev.map((u) =>
        u.id === item.id ? { ...u, status: 'processing', progress: 100, mediaId } : u,
      ),
    );

    // Short delay before marking completed so "processing" is visible
    setTimeout(() => {
      setUploads((prev) =>
        prev.map((u) => (u.id === item.id ? { ...u, status: 'completed' } : u)),
      );
      maybeShowCompletionToast();
      processQueue();
    }, 500);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Upload failed';
    setUploads((prev) =>
      prev.map((u) =>
        u.id === item.id ? { ...u, status: 'failed', error: errorMessage } : u,
      ),
    );
    maybeShowCompletionToast();
  } finally {
    activeCount--;
    processingIds.delete(item.id);
    processQueue();
  }
}

function processQueue(): void {
  if (activeCount >= MAX_CONCURRENT) return;
  const next = state.uploads.find(
    (u) => u.status === 'queued' && !processingIds.has(u.id),
  );
  if (next) {
    // Fire and forget — processItem manages its own state.
    void processItem(next);
  }
}

function maybeShowCompletionToast(): void {
  const uploads = state.uploads;
  const stillActive = uploads.some(
    (u) => u.status === 'uploading' || u.status === 'queued' || u.status === 'processing',
  );
  if (stillActive) {
    // Reset the "shown" flag when new uploads are in flight
    toastShown = false;
    return;
  }
  if (uploads.length === 0 || toastShown) return;

  const completed = uploads.filter((u) => u.status === 'completed').length;
  const failed = uploads.filter((u) => u.status === 'failed').length;
  const showToast = getGlobalShowToast();
  if (!showToast) return;

  toastShown = true;
  if (failed === 0 && completed > 0) {
    showToast({
      title: `${completed} file${completed !== 1 ? 's' : ''} uploaded`,
      type: 'success',
    });
  } else if (completed === 0 && failed > 0) {
    showToast({
      title: `${failed} upload${failed !== 1 ? 's' : ''} failed`,
      type: 'error',
    });
  } else if (completed > 0 && failed > 0) {
    showToast({
      title: `${completed} uploaded, ${failed} failed`,
      type: 'warning',
    });
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function addFiles(files: FileList | File[], organizationId: string, folderId?: string): void {
  const fileArray = Array.from(files);
  const newItems: UploadItem[] = fileArray.map((file) => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    file,
    organizationId,
    folderId,
    status: 'queued',
    progress: 0,
  }));
  toastShown = false;
  setUploads((prev) => [...prev, ...newItems]);
  processQueue();
}

function retryUpload(id: string): void {
  setUploads((prev) =>
    prev.map((u) =>
      u.id === id ? { ...u, status: 'queued', progress: 0, error: undefined } : u,
    ),
  );
  processQueue();
}

function removeUpload(id: string): void {
  setUploads((prev) => prev.filter((u) => u.id !== id));
}

function clearCompleted(): void {
  setUploads((prev) => prev.filter((u) => u.status !== 'completed'));
}

function cancelAll(): void {
  setUploads((prev) => prev.filter((u) => u.status === 'completed' || u.status === 'failed'));
}

export const uploadStore = {
  getState: () => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  addFiles,
  retryUpload,
  removeUpload,
  clearCompleted,
  cancelAll,
};

// ---------------------------------------------------------------------------
// React hook — thin useSyncExternalStore wrapper with derived counts.
// Previously lived in contexts/UploadContext.tsx; folded in here after the
// provider was deleted, so the hook sits next to the state it reads.
// ---------------------------------------------------------------------------

export interface UseUploadValue {
  uploads: UploadItem[];
  isUploading: boolean;
  queuedCount: number;
  completedCount: number;
  failedCount: number;
  addFiles: typeof addFiles;
  retryUpload: typeof retryUpload;
  removeUpload: typeof removeUpload;
  clearCompleted: typeof clearCompleted;
  cancelAll: typeof cancelAll;
}

export function useUpload(): UseUploadValue {
  const { uploads } = useSyncExternalStore(
    uploadStore.subscribe,
    uploadStore.getState,
    uploadStore.getState,
  );

  const isUploading = uploads.some(
    (u) => u.status === 'uploading' || u.status === 'queued' || u.status === 'processing',
  );
  const queuedCount = uploads.filter((u) => u.status === 'queued').length;
  const completedCount = uploads.filter((u) => u.status === 'completed').length;
  const failedCount = uploads.filter((u) => u.status === 'failed').length;

  return {
    uploads,
    isUploading,
    queuedCount,
    completedCount,
    failedCount,
    addFiles,
    retryUpload,
    removeUpload,
    clearCompleted,
    cancelAll,
  };
}
