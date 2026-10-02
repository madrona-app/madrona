import { AlertTriangle, Search } from 'lucide-react';
import { ApiError } from '../../../lib/apiClient';
import type { DiscoverHit } from '../../../types/discover';
import { ObjectCard } from './ObjectCard';
import { MadronaLoader } from '../../../components/ui/MadronaLoader';
import { formatNumber } from '@/lib/formatters';

interface ResultsGridProps {
  hits: DiscoverHit[];
  total: number;
  isLoading: boolean;
  error?: Error | null;
  viewMode: 'grid' | 'list';
  orgSlug: string;
}

export function ResultsGrid({ hits, total, isLoading, error, viewMode, orgSlug }: ResultsGridProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <MadronaLoader />
      </div>
    );
  }

  if (error) {
    const isRateLimit = error instanceof ApiError && error.status === 429;
    return (
      <div className="text-center py-20">
        <AlertTriangle className="w-12 h-12 text-semantic-warning mx-auto mb-4" />
        <h3 className="text-lg text-ink mb-1">
          {isRateLimit ? 'Too many requests' : 'Something went wrong'}
        </h3>
        <p className="text-sm text-archive max-w-md mx-auto">
          {isRateLimit
            ? 'You\u2019re browsing too quickly. Please wait a moment and try again.'
            : 'We couldn\u2019t load the collection right now. Please try again later.'}
        </p>
      </div>
    );
  }

  if (hits.length === 0) {
    return (
      <div className="text-center py-12">
        <Search className="w-12 h-12 text-archive/50 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-ink mb-2">No results found</h3>
        <p className="text-sm text-archive">Try adjusting your search or filters to find what you're looking for.</p>
      </div>
    );
  }

  return (
    <>
      <p className="text-sm text-archive mb-4">
        Showing {hits.length} of {formatNumber(total)} results
      </p>
      <div
        className={
          viewMode === 'grid'
            ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6'
            : 'flex flex-col gap-3'
        }
      >
        {hits.map((hit) => (
          <ObjectCard key={hit.object_id} hit={hit} orgSlug={orgSlug} viewMode={viewMode} />
        ))}
      </div>
    </>
  );
}
