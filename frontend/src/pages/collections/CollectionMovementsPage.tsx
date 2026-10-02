import { useState, useEffect, useMemo } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRightLeft,
  Plus,
  ArrowRight,
  Filter,
  Clock,
  CheckCircle,
  XCircle,
  Search,
  AlertTriangle,
  X,
} from 'lucide-react';
import { getMovements, getCollectionObject } from '../../lib/api';
import { formatDateShort } from '@/lib/formatters';
import type { Movement } from '../../lib/schemas';
import { usePermissions } from '../../hooks/usePermissions';
import { cn } from '../../lib/utils';

// procedure-aligned reason labels
const MOVEMENT_REASON_LABELS: Record<string, string> = {
  exhibition: 'Exhibition',
  storage: 'Storage',
  conservation: 'Conservation',
  loan: 'Loan',
  photography: 'Photography',
  research: 'Research',
  inventory: 'Inventory',
  rearrangement: 'Rearrangement',
  environmental: 'Environmental',
  security: 'Security',
  access_request: 'Access Request',
  other: 'Other',
};

// Status configuration (aligned with backend: pending, in_transit, completed, cancelled)
const STATUS_CONFIG: Record<string, {
  label: string;
  className: string;
  icon: React.ReactNode;
}> = {
  pending: {
    label: 'Pending',
    className: 'text-semantic-info bg-semantic-info/10',
    icon: <Clock size={12} />,
  },
  in_transit: {
    label: 'In Transit',
    className: 'text-semantic-warning bg-semantic-warning/10',
    icon: <ArrowRightLeft size={12} />,
  },
  completed: {
    label: 'Completed',
    className: 'text-semantic-success bg-semantic-success/10',
    icon: <CheckCircle size={12} />,
  },
  cancelled: {
    label: 'Cancelled',
    className: 'text-archive bg-stone/30',
    icon: <XCircle size={12} />,
  },
  incomplete: {
    label: 'Incomplete',
    className: 'text-semantic-warning bg-semantic-warning/10',
    icon: <AlertTriangle size={12} />,
  },
};

// Missing fields filter options
const MISSING_FIELD_OPTIONS = [
  { value: 'missing_date', label: 'Missing date' },
  { value: 'missing_from_location', label: 'Missing from-location' },
  { value: 'missing_to_location', label: 'Missing to-location' },
  { value: 'missing_handler', label: 'Missing handler' },
  { value: 'missing_reason', label: 'Missing reason' },
];

/**
 * Determines compliance state of a movement record.
 * A movement cannot be "Completed" without required fields.
 */
function getMovementComplianceState(movement: Movement): {
  effectiveStatus: string;
  missingFields: string[];
  isComplete: boolean;
} {
  const missingFields: string[] = [];

  // Check required fields for completion
  if (!movement.movement_date) {
    missingFields.push('date');
  }
  if (!movement.to_location_id || !movement.to_location_name) {
    missingFields.push('to-location');
  }
  if (!movement.handler_name && !movement.moved_by_name) {
    missingFields.push('handler');
  }
  if (!movement.reason) {
    missingFields.push('reason');
  }

  const isComplete = missingFields.length === 0;

  // If marked as completed but missing fields, show as pending
  let effectiveStatus = movement.status;
  if (movement.status === 'completed' && !isComplete) {
    effectiveStatus = 'pending';
  }

  return { effectiveStatus, missingFields, isComplete };
}

/**
 * Formats a date for display.
 */
function formatDate(dateString: string | null | undefined): string {
  return formatDateShort(dateString);
}

export default function CollectionMovementsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [searchParams] = useSearchParams();
  const { hasPermission } = usePermissions();

  const objectIdFilter = searchParams.get('object_id');

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [reasonFilter, setReasonFilter] = useState<string>('');
  const [missingFieldFilter, setMissingFieldFilter] = useState<string>('');
  const [offset, setOffset] = useState(0);
  const limit = 20;

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Get movements
  const {
    data: movementsData,
    isLoading,
    isFetching,
    error,
  } = useQuery({
    queryKey: ['collection-movements', orgId, debouncedSearch, objectIdFilter, statusFilter, reasonFilter, offset],
    queryFn: () => getMovements(orgId!, {
      q: debouncedSearch || undefined,
      object_id: objectIdFilter || undefined,
      status: statusFilter || undefined,
      movement_type: reasonFilter || undefined,
      limit,
      offset,
    }),
    enabled: !!orgId,
    placeholderData: (prev) => prev,
  });

  // Client-side filter for missing fields (until backend supports it)
  const filteredMovements = useMemo(() => {
    if (!movementsData?.items) return [];
    if (!missingFieldFilter) return movementsData.items;

    return movementsData.items.filter(movement => {
      const { missingFields } = getMovementComplianceState(movement);
      switch (missingFieldFilter) {
        case 'missing_date':
          return missingFields.includes('date');
        case 'missing_from_location':
          return !movement.from_location_name;
        case 'missing_to_location':
          return missingFields.includes('to-location');
        case 'missing_handler':
          return missingFields.includes('handler');
        case 'missing_reason':
          return missingFields.includes('reason');
        default:
          return true;
      }
    });
  }, [movementsData?.items, missingFieldFilter]);

  // Get object info if filtering by object
  const { data: objectData } = useQuery({
    queryKey: ['collection-object', orgId, objectIdFilter],
    queryFn: () => getCollectionObject(orgId!, objectIdFilter!),
    enabled: !!orgId && !!objectIdFilter,
  });

  const clearFilters = () => {
    setStatusFilter('');
    setReasonFilter('');
    setMissingFieldFilter('');
    setOffset(0);
  };

  const activeFilterCount = [statusFilter, reasonFilter, missingFieldFilter].filter(Boolean).length;

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header Card */}
      <div className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="p-3 bg-bark/10 rounded-lg shrink-0">
              <ArrowRightLeft size={28} className="text-bark" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-ink">Movement Control</h1>
              {objectData && (
                <p className="text-sm text-archive mt-0.5">
                  Movements for{' '}
                  <Link
                    to={`/organizations/${orgId}/collections/objects/${objectIdFilter}`}
                    className="text-bark hover:text-copper-dark"
                  >
                    {objectData.titles?.find((t: any) => t.is_preferred)?.title || objectData.titles?.[0]?.title || objectData.object_name || 'Untitled'} ({objectData.object_number})
                  </Link>
                </p>
              )}
            </div>
          </div>
          {hasPermission('movements.create') && (
            <Link
              to={objectIdFilter
                ? `/organizations/${orgId}/collections/movements/create?object_id=${objectIdFilter}`
                : `/organizations/${orgId}/collections/movements/create`
              }
              className="btn btn-primary flex items-center gap-2 focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 shrink-0 sm:self-auto self-start no-underline"
            >
              <Plus size={18} />
              New Movement
            </Link>
          )}
        </div>
        <p className="text-sm text-archive leading-relaxed">
          Tracks where objects are stored, displayed, or in transit. Each record documents object identity, locations, dates, responsible persons, and movement reason for full audit compliance.
        </p>
      </div>

      {/* Search Hero Card */}
      <div className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-6 shadow-sm">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1 w-full">
            <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-archive" />
            <input
              type="text"
              placeholder="Search by object number…"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setOffset(0); }}
              className="input w-full pl-12 pr-4 py-3 text-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-4 top-1/2 -translate-y-1/2 text-archive hover:text-ink">
                <X size={18} />
              </button>
            )}
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 border rounded-lg transition-colors',
              showFilters || activeFilterCount > 0
                ? 'border-bark text-bark bg-bark/5'
                : 'border-lichen text-ink hover:bg-stone'
            )}
          >
            <Filter size={18} />
            <span>Filters</span>
            {activeFilterCount > 0 && (
              <span className="bg-bark text-parchment text-xs px-1.5 py-0.5 rounded-full">
                {activeFilterCount}
              </span>
            )}
          </button>

          {objectIdFilter && (
            <Link
              to={`/organizations/${orgId}/collections/movements`}
              className="text-sm text-bark hover:text-copper-dark hover:underline"
            >
              Show all movements
            </Link>
          )}
        </div>

        {showFilters && (
          <div className="mt-4 pt-4 border-t border-lichen">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-ink mb-1">
                  Status
                </label>
                <select
                  value={statusFilter}
                  onChange={(e) => { setStatusFilter(e.target.value); setOffset(0); }}
                  className="input w-full text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                >
                  <option value="">All Statuses</option>
                  <option value="pending">Pending</option>
                  <option value="in_transit">In Transit</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-ink mb-1">
                  Reason
                </label>
                <select
                  value={reasonFilter}
                  onChange={(e) => { setReasonFilter(e.target.value); setOffset(0); }}
                  className="input w-full text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                >
                  <option value="">All Reasons</option>
                  {Object.entries(MOVEMENT_REASON_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-ink mb-1">
                  Missing Fields
                </label>
                <select
                  value={missingFieldFilter}
                  onChange={(e) => { setMissingFieldFilter(e.target.value); setOffset(0); }}
                  className="input w-full text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                >
                  <option value="">Any</option>
                  {MISSING_FIELD_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {activeFilterCount > 0 && (
              <div className="mt-4 flex justify-end">
                <button
                  onClick={clearFilters}
                  className="text-sm text-bark hover:text-copper-dark hover:underline"
                >
                  Clear all filters
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Movements Table */}
      {error ? (
        <div className="text-center py-12 text-semantic-error">
          Error loading movements: {(error as Error).message}
        </div>
      ) : isLoading ? (
        <div className="card overflow-hidden">
          <div className="animate-pulse">
            <div className="h-12 bg-stone/50" />
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-16 border-t border-lichen bg-parchment" />
            ))}
          </div>
        </div>
      ) : filteredMovements.length === 0 ? (
        <div className="text-center py-12 card">
          <ArrowRightLeft size={48} className="mx-auto text-archive mb-4" />
          <h3 className="text-lg font-serif font-medium text-forest mb-2">
            No movements found
          </h3>
          <p className="text-accessible-gray mb-4">
            {activeFilterCount > 0
              ? 'Try adjusting your filters'
              : 'Record your first movement to track object locations'}
          </p>
          {hasPermission('movements.create') && !activeFilterCount && (
            <Link
              to={`/organizations/${orgId}/collections/movements/create`}
              className="btn btn-primary no-underline"
            >
              Record First Movement
            </Link>
          )}
        </div>
      ) : (
        <div className={`bg-parchment border border-lichen rounded-lg overflow-hidden transition-opacity duration-200 ${isFetching ? 'opacity-60' : 'opacity-100'}`}>
          <table className="w-full">
            <thead>
              <tr className="bg-stone/50 text-left text-sm font-medium text-ink">
                <th className="px-4 py-3">Object</th>
                <th className="px-4 py-3">From → To</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Handler</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lichen">
              {filteredMovements.map(movement => {
                const { effectiveStatus, missingFields } = getMovementComplianceState(movement);
                const statusConfig = STATUS_CONFIG[effectiveStatus] || STATUS_CONFIG.pending;
                const fromLocation = movement.from_location_path || movement.from_location_name || '—';
                const toLocation = movement.to_location_path || movement.to_location_name || '—';
                const handler = movement.handler_name || movement.moved_by_name || '—';
                const reasonLabel = movement.reason
                  ? MOVEMENT_REASON_LABELS[movement.reason] || movement.reason
                  : '—';

                return (
                  <tr
                    key={movement.movement_id}
                    className="hover:bg-stone/30 transition-colors cursor-pointer"
                    onClick={() => window.location.href = `/organizations/${orgId}/collections/movements/${movement.movement_id}`}
                  >
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium text-ink text-sm">
                          {movement.object_number || '—'}
                        </p>
                        <p className="text-xs text-archive truncate max-w-[200px]">
                          {movement.object_title || 'Untitled'}
                        </p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-sm">
                        <span className="text-archive truncate max-w-[100px]">{fromLocation}</span>
                        <ArrowRight size={14} className="text-archive shrink-0" />
                        <span className="text-ink truncate max-w-[100px]">{toLocation}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-ink">
                      {formatDate(movement.movement_date)}
                    </td>
                    <td className="px-4 py-3 text-sm text-ink">
                      {reasonLabel}
                    </td>
                    <td className="px-4 py-3 text-sm text-archive truncate max-w-[120px]">
                      {handler}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium',
                          statusConfig.className
                        )}>
                          {statusConfig.icon}
                          {statusConfig.label}
                        </span>
                        {missingFields.length > 0 && (
                          <span
                            className="text-semantic-warning"
                            title={`Missing: ${missingFields.join(', ')}`}
                          >
                            <AlertTriangle size={14} />
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {movementsData && movementsData.total > limit && (
        <div className="mt-6 flex items-center justify-between">
          <p className="text-sm text-accessible-gray">
            Showing {offset + 1} - {Math.min(offset + limit, movementsData.total)} of {movementsData.total}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setOffset(Math.max(0, offset - limit))}
              disabled={offset === 0}
              className="btn btn-tertiary text-sm"
            >
              Previous
            </button>
            <button
              onClick={() => setOffset(offset + limit)}
              disabled={offset + limit >= movementsData.total}
              className="btn btn-tertiary text-sm"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
