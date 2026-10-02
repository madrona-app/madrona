import { useState } from 'react';
import Checkbox from '../../components/Checkbox';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ClipboardCheck,
  Check,
  Image,
  Video,
  FileAudio,
  FileText,
  Box,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { searchMedia, reviewMetadata } from '../../lib/api';
import type { MediaSearchHit } from '../../lib/schemas';
import { formatDateShort } from '@/lib/formatters';

const MEDIA_TYPE_ICONS = {
  image: Image,
  video: Video,
  audio: FileAudio,
  document: FileText,
  model_3d: Box,
};

export default function MetadataReviewPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

  // Fetch unreviewed media
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['metadata-review-queue', orgId],
    queryFn: () => searchMedia(orgId!, {
      limit: 100,
      metadata_reviewed: false,
    }),
    enabled: !!orgId,
  });

  const reviewMutation = useMutation({
    mutationFn: (mediaId: string) => reviewMetadata(orgId!, mediaId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['metadata-review-queue', orgId] });
    },
  });

  const bulkReviewMutation = useMutation({
    mutationFn: async (mediaIds: string[]) => {
      await Promise.all(mediaIds.map((id) => reviewMetadata(orgId!, id)));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['metadata-review-queue', orgId] });
      setSelectedItems(new Set());
    },
  });

  const items: MediaSearchHit[] = data?.hits || [];

  const toggleSelect = (mediaId: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(mediaId)) {
        next.delete(mediaId);
      } else {
        next.add(mediaId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedItems.size === items.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(items.map((m) => m.media_id)));
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-stone rounded w-48" />
          <div className="h-64 bg-stone rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">Metadata Review Queue</h1>
          <p className="text-archive">
            {items.length} media item{items.length !== 1 ? 's' : ''} pending metadata review
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedItems.size > 0 && (
            <button
              onClick={() => bulkReviewMutation.mutate(Array.from(selectedItems))}
              disabled={bulkReviewMutation.isPending}
              className="btn btn-primary flex items-center gap-2"
            >
              {bulkReviewMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Mark {selectedItems.size} as Reviewed
            </button>
          )}
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="btn btn-secondary flex items-center gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Queue */}
      {items.length === 0 ? (
        <div className="card p-12 text-center">
          <ClipboardCheck className="h-12 w-12 text-semantic-success mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-2">All Caught Up</h3>
          <p className="text-archive max-w-md mx-auto">
            All media metadata has been reviewed. New items will appear here
            when media is uploaded or modified.
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead className="bg-stone/50">
              <tr>
                <th className="w-8 p-3">
                  <Checkbox
                    checked={selectedItems.size === items.length && items.length > 0}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th className="text-left p-3 text-xs font-medium text-archive uppercase">Media</th>
                <th className="text-left p-3 text-xs font-medium text-archive uppercase">Type</th>
                <th className="text-left p-3 text-xs font-medium text-archive uppercase">Uploaded</th>
                <th className="text-left p-3 text-xs font-medium text-archive uppercase">Missing Fields</th>
                <th className="w-24 p-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lichen">
              {items.map((media) => {
                const Icon = MEDIA_TYPE_ICONS[media.media_type as keyof typeof MEDIA_TYPE_ICONS] || FileText;
                const missingFields: string[] = [];
                if (!media.title) missingFields.push('Title');
                if (!media.description) missingFields.push('Description');
                if (!media.copyright_status) missingFields.push('Copyright');
                if (!media.alt_text) missingFields.push('Alt text');

                return (
                  <tr key={media.media_id} className="hover:bg-stone/20 transition-colors">
                    <td className="p-3">
                      <Checkbox
                        checked={selectedItems.has(media.media_id)}
                        onChange={() => toggleSelect(media.media_id)}
                      />
                    </td>
                    <td className="p-3">
                      <Link
                        to={`/organizations/${orgId}/media/${media.media_id}`}
                        className="flex items-center gap-3 hover:text-bark transition-colors"
                      >
                        <div className="w-10 h-10 rounded bg-stone flex items-center justify-center overflow-hidden flex-shrink-0">
                          {media.thumbnail_url ? (
                            <img src={media.thumbnail_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <Icon size={16} className="text-archive" />
                          )}
                        </div>
                        <span className="text-sm font-medium truncate max-w-[200px]">
                          {media.title || media.filename || 'Untitled'}
                        </span>
                      </Link>
                    </td>
                    <td className="p-3">
                      <span className="text-xs text-archive capitalize">{media.media_type}</span>
                    </td>
                    <td className="p-3">
                      <span className="text-xs text-archive">
                        {media.created_at ? formatDateShort(media.created_at) : '-'}
                      </span>
                    </td>
                    <td className="p-3">
                      {missingFields.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {missingFields.map((f) => (
                            <span key={f} className="text-[10px] bg-semantic-warning/10 text-semantic-warning px-1.5 py-0.5 rounded">
                              {f}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-semantic-success">Complete</span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => reviewMutation.mutate(media.media_id)}
                        disabled={reviewMutation.isPending}
                        className="flex items-center gap-1 px-2 py-1 text-xs font-medium bg-bark text-parchment rounded hover:bg-bark/90 disabled:opacity-50 transition-colors ml-auto"
                      >
                        <Check size={12} />
                        Approve
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
