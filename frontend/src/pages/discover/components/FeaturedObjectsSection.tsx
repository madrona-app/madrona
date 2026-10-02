import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'lucide-react';
import { getFeaturedObjects } from '../../../lib/api';
import type { DiscoverHit } from '../../../types/discover';
import { ResponsiveImage } from '../../../components/ui/ResponsiveImage';

interface FeaturedObjectsSectionProps {
  orgSlug: string;
}

function FeaturedCard({ hit, orgSlug }: { hit: DiscoverHit; orgSlug: string }) {
  return (
    <Link
      to={`/c/${orgSlug}/objects/${encodeURIComponent(hit.object_number || hit.object_id)}`}
      className="group block flex-shrink-0 w-56"
    >
      <div className="aspect-[3/4] bg-stone/30 rounded-lg overflow-hidden mb-2">
        {hit.thumbnail_url ? (
          <ResponsiveImage
            src={hit.thumbnail_url}
            srcset={hit.thumbnail_srcset}
            alt={hit.title || 'Featured object'}
            sizes="(max-width: 640px) 100vw, 224px"
            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Image className="w-10 h-10 text-archive/40" />
          </div>
        )}
      </div>
      <h3 className="text-sm font-medium text-ink group-hover:text-bark line-clamp-2 transition-colors">
        {hit.title || 'Untitled'}
      </h3>
      {hit.creators.length > 0 && (
        <p className="text-xs text-archive mt-0.5 truncate">{hit.creators.join(', ')}</p>
      )}
    </Link>
  );
}

export function FeaturedObjectsSection({ orgSlug }: FeaturedObjectsSectionProps) {
  const { data } = useQuery({
    queryKey: ['discover-featured', orgSlug],
    queryFn: () => getFeaturedObjects(orgSlug),
    enabled: !!orgSlug,
  });

  if (!data?.hits?.length) return null;

  return (
    <section className="border-b border-lichen">
      <div className="max-w-7xl mx-auto px-4 py-10">
        <h2 className="font-serif text-xl font-light text-ink mb-6">Featured</h2>
        <div className="flex gap-5 overflow-x-auto pb-4 -mx-4 px-4 scrollbar-thin">
          {data.hits.map((hit) => (
            <FeaturedCard key={hit.object_id} hit={hit} orgSlug={orgSlug} />
          ))}
        </div>
      </div>
    </section>
  );
}
