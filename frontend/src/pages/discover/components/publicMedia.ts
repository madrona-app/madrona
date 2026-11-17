import type { DiscoverMediaItem } from '../../../types/discover';

/** Discover API paths are relative (`/api/discover/...`); resolve against the API host. */
export function resolvePublicApiUrl(path: string): string {
  if (!path.startsWith('/api/')) return path;
  const base = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/api\/?$/, '');
  return `${base}${path}`;
}

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/msword': 'Word document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word document',
  'application/rtf': 'Rich text document',
  'text/plain': 'Plain text',
  'application/epub+zip': 'EPUB',
};

export function documentTypeLabel(mime: string | null | undefined): string {
  if (!mime) return 'Document';
  if (DOCUMENT_TYPE_LABELS[mime]) return DOCUMENT_TYPE_LABELS[mime];
  const sub = mime.split('/')[1];
  return sub ? `${sub.toUpperCase()} file` : 'Document';
}

export function formatDuration(seconds: number | null | undefined): string | null {
  if (!seconds || seconds <= 0) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (h) parts.push(`${h} hour${h === 1 ? '' : 's'}`);
  if (m) parts.push(`${m} minute${m === 1 ? '' : 's'}`);
  if (s && !h) parts.push(`${s} second${s === 1 ? '' : 's'}`);
  return parts.join(' ');
}

export function isImageMedia(item: Pick<DiscoverMediaItem, 'media_type'>): boolean {
  return !item.media_type || item.media_type === 'image';
}
