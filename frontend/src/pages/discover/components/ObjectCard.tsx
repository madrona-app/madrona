import { Link } from 'react-router-dom';
import { Image } from 'lucide-react';
import type { DiscoverHit } from '../../../types/discover';
import { ResponsiveImage } from '../../../components/ui/ResponsiveImage';

interface ObjectCardProps {
  hit: DiscoverHit;
  orgSlug: string;
  viewMode: 'grid' | 'list';
}

export function ObjectCard({ hit, orgSlug, viewMode }: ObjectCardProps) {
  if (viewMode === 'list') {
    return (
      <Link
        to={`/c/${orgSlug}/objects/${encodeURIComponent(hit.object_number || hit.object_id)}`}
        className="flex gap-4 p-4 bg-parchment rounded-lg border border-lichen hover:border-bark/30 hover:shadow-sm transition-all group"
      >
        <div className="w-24 h-24 flex-shrink-0 bg-stone/30 rounded overflow-hidden">
          {hit.thumbnail_url ? (
            <ResponsiveImage
              src={hit.thumbnail_url}
              srcset={hit.thumbnail_srcset}
              alt={hit.title || 'Object'}
              sizes="96px"
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Image className="w-8 h-8 text-archive/40" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-ink group-hover:text-bark truncate">
            {hit.title || 'Untitled'}
          </h3>
          {hit.creators.length > 0 && (
            <p className="text-xs text-archive mt-0.5">{hit.creators.join(', ')}</p>
          )}
          {hit.creation_date_display && (
            <p className="text-xs text-archive">{hit.creation_date_display}</p>
          )}
          {hit.classification && (
            <p className="text-xs text-archive">{hit.classification}</p>
          )}
        </div>
      </Link>
    );
  }

  return (
    <Link
      to={`/c/${orgSlug}/objects/${encodeURIComponent(hit.object_number || hit.object_id)}`}
      className="group block"
    >
      <div className="aspect-[3/4] bg-stone/30 rounded-lg overflow-hidden mb-3">
        {hit.thumbnail_url ? (
          <ResponsiveImage
            src={hit.thumbnail_url}
            srcset={hit.thumbnail_srcset}
            alt={hit.title || 'Object'}
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Image className="w-12 h-12 text-archive/40" />
          </div>
        )}
      </div>
      <h3 className="text-sm font-medium text-ink group-hover:text-bark line-clamp-2">
        {hit.title || 'Untitled'}
      </h3>
      {hit.creators.length > 0 && (
        <p className="text-xs text-archive mt-0.5 truncate">{hit.creators.join(', ')}</p>
      )}
      {hit.creation_date_display && (
        <p className="text-xs text-archive">{hit.creation_date_display}</p>
      )}
    </Link>
  );
}
