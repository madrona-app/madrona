import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getEntityHistory, type EntityHistoryEvent } from '../lib/api';
import { FieldDiffList } from './audit';
import { formatDateShort, formatTime } from '../lib/formatters';

// ============================================================================
// Event Type Badge Component
// ============================================================================

const EVENT_TYPE_CONFIG: Record<string, { bgColor: string; textColor: string }> = {
  Created: { bgColor: 'bg-semantic-success', textColor: 'text-parchment' },
  Updated: { bgColor: 'bg-semantic-warning', textColor: 'text-parchment' },
  Deleted: { bgColor: 'bg-semantic-error', textColor: 'text-parchment' },
};

function EventTypeBadge({ type }: { type: string }) {
  const config = EVENT_TYPE_CONFIG[type] || { bgColor: 'bg-stone', textColor: 'text-archive' };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-institutional text-xs font-medium ${config.bgColor} ${config.textColor}`}>
      {type}
    </span>
  );
}


// ============================================================================
// Event Card Component
// ============================================================================

interface EventCardProps {
  event: EntityHistoryEvent;
  organizationId: string;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

function EventCard({ event, organizationId, isExpanded, onToggleExpand }: EventCardProps) {
  // Build origin description
  let originDescription = 'System';
  if (event.origin_type === 'pipeline_run' && event.pipeline_name) {
    if (event.source_label) {
      originDescription = `${event.source_label} \u2192 ${event.pipeline_name}`;
    } else {
      originDescription = `Pipeline Run`;
    }
  } else if (event.origin_type === 'api') {
    originDescription = 'API Write';
  } else if (event.origin_type === 'manual') {
    originDescription = 'Manual Edit';
  }

  const hasFieldDiffs = event.field_diffs && event.field_diffs.length > 0;
  const canExpand = event.event_type === 'Updated' && hasFieldDiffs;

  return (
    <div className="bg-parchment border border-lichen rounded-lg shadow-sm">
      {/* Header row */}
      <div className="p-4">
        <div className="flex items-start justify-between">
          {/* Left side: badge and details */}
          <div className="flex items-start gap-3">
            <EventTypeBadge type={event.event_type} />
            <div>
              <div className="text-sm font-medium text-ink">
                {event.event_type} {event.origin_type === 'pipeline_run' ? '\u00B7 Pipeline Run' : ''}
              </div>
              <div className="text-sm text-archive mt-0.5">
                {originDescription}
              </div>
              {event.summary && event.event_type === 'Updated' && (
                <div className="text-xs text-archive mt-1">
                  {event.summary}
                </div>
              )}
            </div>
          </div>

          {/* Right side: timestamp and actions */}
          <div className="text-right">
            <div className="text-sm text-accessible-gray">
              {formatDateShort(event.occurred_at)} \u00B7 {formatTime(event.occurred_at)}
            </div>
            <div className="flex items-center justify-end gap-2 mt-2">
              {canExpand && (
                <button
                  onClick={onToggleExpand}
                  className="text-xs text-copper hover:text-archive underline"
                >
                  {isExpanded ? 'Hide changes' : 'View changes'}
                </button>
              )}
              {event.run_id && (
                <Link
                  to={`/organizations/${organizationId}/bridge/runs/${event.run_id}`}
                  className="text-xs text-copper hover:text-archive underline"
                >
                  View run
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Expanded diff section */}
      {isExpanded && hasFieldDiffs && (
        <div className="border-t border-lichen px-4 py-3 bg-stone">
          <FieldDiffList diffs={event.field_diffs} showRawButton />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Empty State Component
// ============================================================================

function EmptyState() {
  return (
    <div className="text-center py-12">
      <svg
        className="mx-auto h-12 w-12 text-archive"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <h3 className="mt-2 text-sm font-medium text-ink">No history</h3>
      <p className="mt-1 text-sm text-archive">
        This entity has no recorded change events yet.
      </p>
    </div>
  );
}

// ============================================================================
// Loading State Component
// ============================================================================

function LoadingState() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="bg-parchment border border-lichen rounded-lg p-4 animate-pulse">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              <div className="w-16 h-5 bg-lichen rounded" />
              <div className="space-y-2">
                <div className="w-32 h-4 bg-lichen rounded" />
                <div className="w-48 h-3 bg-lichen rounded" />
              </div>
            </div>
            <div className="w-32 h-4 bg-lichen rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Main EntityHistoryTab Component
// ============================================================================

interface EntityHistoryTabProps {
  entityKey: string;
  organizationId: string;
}

export function EntityHistoryTab({ entityKey, organizationId }: EntityHistoryTabProps) {
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());

  const {
    data,
    isLoading,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['entityHistory', entityKey, organizationId],
    queryFn: async ({ pageParam }) => {
      return getEntityHistory(entityKey, organizationId, {
        limit: 20,
        cursor: pageParam || undefined,
      });
    },
    getNextPageParam: (lastPage) => lastPage.next_cursor || undefined,
    initialPageParam: null as string | null,
  });

  const toggleExpand = (changeId: string) => {
    setExpandedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(changeId)) {
        next.delete(changeId);
      } else {
        next.add(changeId);
      }
      return next;
    });
  };

  // Flatten all pages into a single events array
  const events = data?.pages.flatMap((page) => page.items) || [];
  const totalCount = data?.pages[0]?.total || 0;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-baseline justify-between">
          <div>
            <h3 className="text-lg font-medium text-ink">Entity History</h3>
            <p className="text-sm text-archive">Change events for this record</p>
          </div>
        </div>
        <LoadingState />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-center py-12">
        <div className="text-semantic-error mb-2">Failed to load history</div>
        <div className="text-sm text-archive">{(error as Error)?.message || 'Unknown error'}</div>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-baseline justify-between">
          <div>
            <h3 className="text-lg font-medium text-ink">Entity History</h3>
            <p className="text-sm text-archive">Change events for this record</p>
          </div>
        </div>
        <EmptyState />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-baseline justify-between">
        <div>
          <h3 className="text-lg font-medium text-ink">Entity History</h3>
          <p className="text-sm text-archive">
            {totalCount} change event{totalCount !== 1 ? 's' : ''} for this record
          </p>
        </div>
      </div>

      {/* Timeline */}
      <div className="space-y-3">
        {events.map((event) => (
          <EventCard
            key={event.change_id}
            event={event}
            organizationId={organizationId}
            isExpanded={expandedEvents.has(event.change_id)}
            onToggleExpand={() => toggleExpand(event.change_id)}
          />
        ))}
      </div>

      {/* Load more button */}
      {hasNextPage && (
        <div className="text-center pt-4">
          <button
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="px-4 py-2 text-sm bg-parchment border border-lichen rounded-md text-ink hover:bg-stone disabled:opacity-50"
          >
            {isFetchingNextPage ? 'Loading more...' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}

export default EntityHistoryTab;
