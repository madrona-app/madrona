import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'lucide-react';
import { getRelatedObjects } from '../../../lib/api';
import type { DiscoverRelatedHit } from '../../../types/discover';
import { ResponsiveImage } from '../../../components/ui/ResponsiveImage';

interface RelatedObjectsProps {
  orgSlug: string;
  objectId: string;
}

function RelatedCard({ hit, orgSlug }: { hit: DiscoverRelatedHit; orgSlug: string }) {
  return (
    <Link
      to={`/c/${orgSlug}/objects/${encodeURIComponent(hit.object_number || hit.object_id)}`}
      className="group block"
    >
      <div className="aspect-square bg-stone/30 rounded-lg overflow-hidden mb-2">
        {hit.thumbnail_url ? (
          <ResponsiveImage
            src={hit.thumbnail_url}
            srcset={hit.thumbnail_srcset}
            alt={hit.title || 'Related object'}
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Image className="w-8 h-8 text-archive/40" />
          </div>
        )}
      </div>
      <h4 className="text-sm font-medium text-ink group-hover:text-bark line-clamp-2 transition-colors">
        {hit.title || 'Untitled'}
      </h4>
      {hit.creators.length > 0 && (
        <p className="text-xs text-archive mt-0.5 truncate">{hit.creators.join(', ')}</p>
      )}
    </Link>
  );
}

export function RelatedObjects({ orgSlug, objectId }: RelatedObjectsProps) {
  const { data } = useQuery({
    queryKey: ['discover-related', orgSlug, objectId],
    queryFn: () => getRelatedObjects(orgSlug, objectId),
    enabled: !!orgSlug && !!objectId,
  });

  if (!data?.hits?.length) return null;

  return (
    <section className="border-t border-lichen">
      <div className="max-w-7xl mx-auto px-4 py-10">
        <h2 className="font-serif text-xl font-light text-ink mb-6">Related Objects</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 sm:gap-6">
          {data.hits.map((hit) => (
            <RelatedCard key={hit.object_id} hit={hit} orgSlug={orgSlug} />
          ))}
        </div>
      </div>
    </section>
  );
}
