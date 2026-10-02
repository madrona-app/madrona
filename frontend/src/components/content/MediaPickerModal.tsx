/**
 * MediaPickerModal — Browse and select media from the organization's library.
 *
 * SlideOver modal that fetches from the existing media list API,
 * shows a searchable thumbnail grid with pagination, and returns
 * the selected media_id to the caller.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, X, Check, ImageIcon } from 'lucide-react';
import { useAccessibleModal } from '../../hooks/useAccessibleModal';
import { apiFetch, buildQueryString } from '../../lib/api/_utils';
import { MadronaLoader } from '../ui/MadronaLoader';
import { ModalPortal } from '../ModalPortal';

interface MediaItem {
  media_id: string;
  original_filename: string;
  media_type: string;
  mime_type: string;
  file_size: number;
  alt_text: string | null;
}

interface MediaPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (mediaId: string) => void;
  organizationId: string;
  mediaType?: string;
}

const PAGE_SIZE = 24;

export function MediaPickerModal({
  isOpen,
  onClose,
  onSelect,
  organizationId,
  mediaType = 'image',
}: MediaPickerModalProps) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const { modalRef, titleId } = useAccessibleModal({
    isOpen,
    onClose,
    titlePrefix: 'media-picker',
  });

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setSelectedId(null);
      setPage(1);
      setTimeout(() => searchRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Fetch media
  const { data, isLoading } = useQuery({
    queryKey: ['media-picker', organizationId, debouncedSearch, page, mediaType],
    queryFn: () => {
      const params: Record<string, string | number> = {
        page_size: PAGE_SIZE,
        page: page,
      };
      if (mediaType) params.media_type = mediaType;
      if (debouncedSearch) params.search = debouncedSearch;
      const query = buildQueryString(params);
      return apiFetch(`/organizations/${organizationId}/media${query}`) as Promise<{
        items: MediaItem[];
        total: number;
      }>;
    },
    enabled: isOpen && !!organizationId,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const handleConfirm = useCallback(() => {
    if (selectedId) {
      onSelect(selectedId);
      onClose();
    }
  }, [selectedId, onSelect, onClose]);

  if (!isOpen) return null;

  return (
    <ModalPortal>
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-ink/30 transition-opacity"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-xl bg-parchment shadow-xl flex flex-col h-full"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-lichen">
          <h2 id={titleId} className="text-lg font-semibold text-ink">
            Media Library
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 text-archive hover:text-ink rounded transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b border-lichen">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-archive" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search media..."
              className="w-full pl-9 pr-3 py-2 border border-lichen rounded-lg text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            />
          </div>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <MadronaLoader variant="dots" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-archive">
              <ImageIcon size={32} className="mb-2 text-archive/40" />
              <p className="text-sm">No images found</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {items.map((item) => (
                <button
                  key={item.media_id}
                  onClick={() => setSelectedId(item.media_id)}
                  className={`relative aspect-square overflow-hidden rounded-lg border-2 transition-all ${
                    selectedId === item.media_id
                      ? 'border-bark ring-2 ring-bark/30'
                      : 'border-transparent hover:border-lichen'
                  }`}
                >
                  <img
                    src={`/api/media/${item.media_id}/thumbnail?size=200`}
                    alt={item.alt_text || item.original_filename}
                    className="w-full h-full object-cover bg-stone/30"
                    loading="lazy"
                  />
                  {selectedId === item.media_id && (
                    <div className="absolute top-1.5 right-1.5 w-6 h-6 bg-bark rounded-full flex items-center justify-center">
                      <Check size={14} className="text-parchment" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-4">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 text-sm border border-lichen rounded-lg text-ink hover:bg-stone/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <span className="text-sm text-archive">
                {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 text-sm border border-lichen rounded-lg text-ink hover:bg-stone/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-lichen flex items-center justify-between">
          <span className="text-xs text-archive">
            {total} {total === 1 ? 'item' : 'items'}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm border border-lichen rounded-lg text-ink hover:bg-stone/30 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!selectedId}
              className="px-4 py-2 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Select
            </button>
          </div>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
