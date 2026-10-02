/**
 * SimilarMediaPanel — shows visually similar media using CLIP embeddings.
 * Displays in sidebar on MediaDetailPage.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { getSimilarMedia } from '../../lib/api/media-dam';

interface SimilarMediaPanelProps {
  organizationId: string;
  mediaId: string;
}

export function SimilarMediaPanel({
  organizationId,
  mediaId,
}: SimilarMediaPanelProps) {
  const { data, error } = useQuery({
    queryKey: ['similar-media', organizationId, mediaId],
    queryFn: () => getSimilarMedia(organizationId, mediaId, { top_k: 8, threshold: 0.76 }),
    enabled: !!organizationId && !!mediaId,
    staleTime: 60_000,
  });

  if (error || !data?.similar?.length) {
    return null;
  }

  return (
    <div className="bg-parchment border border-lichen rounded-lg p-4 sm:p-6 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles size={16} className="text-archive" />
        <h3 className="text-sm font-medium text-ink">Visually Similar</h3>
        <span className="text-xs text-archive">({data.total})</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {data.similar.map((item) => (
          <Link
            key={item.media_id}
            to={`/organizations/${organizationId}/media/${item.media_id}`}
            className="group relative aspect-square rounded-lg overflow-hidden bg-stone/20 hover:ring-2 hover:ring-bark transition-all"
          >
            {/* Similarity badge */}
            <div className="absolute top-1 right-1 z-10 bg-ink/70 text-parchment text-[10px] px-1.5 py-0.5 rounded-full">
              {Math.round(item.similarity * 100)}%
            </div>

            {(item.preview_url || item.thumbnail_url) ? (
              <img
                src={item.preview_url || item.thumbnail_url!}
                alt={item.title || `Similar media ${Math.round(item.similarity * 100)}% match`}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-xs text-archive">
                {item.title || item.media_id.slice(0, 6)}
              </div>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
