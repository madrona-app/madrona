import { useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  History,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Filter,
  User,
  Calendar,
  X,
} from 'lucide-react';
import {
  getEntityAuditEvents,
  getEntityAuditEventDetail,
  type EntityAuditEvent,
} from '../../lib/api';
import { cn } from '../../lib/utils';
import { FieldDiffList } from '../../components/audit';
import { formatDateShort, formatTime as fmtTime } from '@/lib/formatters';

// ============================================================================
// Constants
// ============================================================================

const ENTITY_TYPE_LABELS: Record<string, string> = {
  collection_object: 'Collection Object',
  acquisition: 'Acquisition',
  audit_campaign: 'Audit Campaign',
  person_authority: 'Biography',
  citation: 'Citation',
  collections_review: 'Collections Review',
  condition_report: 'Condition Report',
  conservation_treatment: 'Conservation',
  contact: 'Contact',
  deaccession: 'Deaccession',
  documentation_plan: 'Documentation Plan',
  emergency_plan: 'Emergency Plan',
  incident_report: 'Incident Report',
  loan_in: 'Loan In',
  loan_out: 'Loan Out',
  movement: 'Movement',
  object_entry: 'Object Entry',
  object_exit: 'Object Exit',
  object_right: 'Right',
  reproduction_request: 'Reproduction Request',
  use_request: 'Use Request',
  valuation: 'Valuation',
  media: 'Media',
  exhibition: 'Exhibition',
  event: 'Event',
};

const CHANGE_TYPE_CONFIG: Record<string, { label: string; bgColor: string; textColor: string }> = {
  created: { label: 'Created', bgColor: 'bg-semantic-success', textColor: 'text-parchment' },
  updated: { label: 'Updated', bgColor: 'bg-semantic-warning', textColor: 'text-parchment' },
  deleted: { label: 'Deleted', bgColor: 'bg-semantic-error', textColor: 'text-parchment' },
};


// ============================================================================
// Event Row Component
// ============================================================================

function EventRow({ event, orgId }: { event: EntityAuditEvent; orgId: string }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const config = CHANGE_TYPE_CONFIG[event.change_type] || CHANGE_TYPE_CONFIG.updated;

  const { data: detailData, isLoading: isLoadingDetail } = useQuery({
    queryKey: ['entityAuditEventDetail', orgId, event.event_id],
    queryFn: () => getEntityAuditEventDetail(orgId, event.event_id),
    enabled: isExpanded && event.change_type === 'updated',
  });

  const fieldDiffs = detailData?.event?.field_diffs || [];
  const canExpand = event.change_type === 'updated' && (event.changed_fields?.length > 0);

  const formatDate = (dateString: string) => formatDateShort(dateString);

  const formatTime = (dateString: string) => fmtTime(dateString);

  return (
    <div className="border-b border-lichen last:border-0">
      {/* Row */}
      <div
        className={cn(
          'flex items-center gap-4 px-4 py-3 text-sm',
          canExpand && 'cursor-pointer hover:bg-stone/30',
        )}
        onClick={canExpand ? () => setIsExpanded(!isExpanded) : undefined}
      >
        {/* Timestamp */}
        <div className="w-36 shrink-0 text-archive">
          <div className="flex items-center gap-1">
            <Calendar size={12} />
            {formatDate(event.changed_at)}
          </div>
          <div className="text-xs">{formatTime(event.changed_at)}</div>
        </div>

        {/* User */}
        <div className="w-40 shrink-0 flex items-center gap-1.5 text-ink truncate">
          <User size={14} className="text-archive shrink-0" />
          <span className="truncate">
            {event.changed_by_name || event.changed_by_email || 'System'}
          </span>
        </div>

        {/* Entity Type */}
        <div className="w-36 shrink-0">
          <span className="text-archive">
            {ENTITY_TYPE_LABELS[event.entity_type] || event.entity_type}
          </span>
        </div>

        {/* Entity Name */}
        <div className="flex-1 min-w-0 truncate text-ink">
          {event.entity_display_key || event.entity_id.slice(0, 8)}
        </div>

        {/* Change Type Badge */}
        <div className="w-20 shrink-0">
          <span className={cn(
            'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
            config.bgColor,
            config.textColor,
          )}>
            {config.label}
          </span>
        </div>

        {/* Summary / field count */}
        <div className="w-32 shrink-0 text-xs text-archive truncate text-right">
          {event.summary
            ? event.summary
            : event.changed_fields?.length
            ? `${event.changed_fields.length} field${event.changed_fields.length !== 1 ? 's' : ''}`
            : ''}
        </div>

        {/* Expand icon */}
        <div className="w-6 shrink-0">
          {canExpand && (
            isExpanded ? <ChevronUp size={16} className="text-archive" /> : <ChevronDown size={16} className="text-archive" />
          )}
        </div>
      </div>

      {/* Expanded field diffs */}
      {isExpanded && canExpand && (
        <div className="px-4 pb-3">
          <div className="ml-36 pl-4 border-l-2 border-lichen bg-stone/20 rounded-r-lg p-3">
            {isLoadingDetail ? (
              <div className="animate-pulse space-y-2">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-6 bg-stone rounded w-2/3" />
                ))}
              </div>
            ) : fieldDiffs.length > 0 ? (
              <FieldDiffList diffs={fieldDiffs} showRawButton />
            ) : (
              <div className="text-xs text-archive">
                {event.changed_fields?.length
                  ? `Changed: ${event.changed_fields.join(', ')}`
                  : 'No field details available'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Page Component
// ============================================================================

export default function EntityAuditPage() {
  const { orgId } = useParams<{ orgId: string }>();

  // Filter state
  const [entityType, setEntityType] = useState('');
  const [changeType, setChangeType] = useState('');
  const [sinceDate, setSinceDate] = useState('');
  const [untilDate, setUntilDate] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 50;

  // Build query params
  const queryParams = {
    ...(entityType && { entity_type: entityType }),
    ...(changeType && { change_type: changeType }),
    ...(sinceDate && { since: new Date(sinceDate).toISOString() }),
    ...(untilDate && { until: new Date(untilDate + 'T23:59:59').toISOString() }),
    limit,
    offset,
  };

  const { data, isLoading, isError } = useQuery({
    queryKey: ['entityAuditEvents', orgId, queryParams],
    queryFn: () => getEntityAuditEvents(orgId!, queryParams),
    enabled: !!orgId,
  });

  const events = data?.items || [];
  const total = data?.total || 0;
  const hasMore = offset + limit < total;
  const hasPrev = offset > 0;

  const handleClearFilters = useCallback(() => {
    setEntityType('');
    setChangeType('');
    setSinceDate('');
    setUntilDate('');
    setOffset(0);
  }, []);

  const hasActiveFilters = entityType || changeType || sinceDate || untilDate;

  // Sort entity types for the dropdown
  const entityTypeOptions = Object.entries(ENTITY_TYPE_LABELS)
    .sort(([, a], [, b]) => a.localeCompare(b));

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <History size={24} className="text-bark" />
          <h1 className="text-2xl font-semibold text-ink">Change History</h1>
        </div>
        <p className="text-sm text-archive">
          Track all record changes across the organization. Filter by entity type, change type, or date range.
        </p>
      </div>

      {/* Filter Bar */}
      <div className="bg-parchment border border-lichen rounded-lg p-4 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Filter size={16} className="text-archive" />
          <span className="text-sm font-medium text-ink">Filters</span>
          {hasActiveFilters && (
            <button
              onClick={handleClearFilters}
              className="ml-auto flex items-center gap-1 text-xs text-bark hover:text-copper-dark"
            >
              <X size={14} />
              Clear filters
            </button>
          )}
        </div>
        <div className="grid grid-cols-4 gap-4">
          {/* Entity Type */}
          <div>
            <label className="block text-xs text-archive mb-1">Entity Type</label>
            <select
              value={entityType}
              onChange={(e) => { setEntityType(e.target.value); setOffset(0); }}
              className="w-full px-3 py-1.5 text-sm border border-lichen rounded-lg bg-parchment text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            >
              <option value="">All types</option>
              {entityTypeOptions.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          {/* Change Type */}
          <div>
            <label className="block text-xs text-archive mb-1">Change Type</label>
            <select
              value={changeType}
              onChange={(e) => { setChangeType(e.target.value); setOffset(0); }}
              className="w-full px-3 py-1.5 text-sm border border-lichen rounded-lg bg-parchment text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            >
              <option value="">All changes</option>
              <option value="created">Created</option>
              <option value="updated">Updated</option>
              <option value="deleted">Deleted</option>
            </select>
          </div>

          {/* Since Date */}
          <div>
            <label className="block text-xs text-archive mb-1">From Date</label>
            <input
              type="date"
              value={sinceDate}
              onChange={(e) => { setSinceDate(e.target.value); setOffset(0); }}
              className="w-full px-3 py-1.5 text-sm border border-lichen rounded-lg bg-parchment text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            />
          </div>

          {/* Until Date */}
          <div>
            <label className="block text-xs text-archive mb-1">To Date</label>
            <input
              type="date"
              value={untilDate}
              onChange={(e) => { setUntilDate(e.target.value); setOffset(0); }}
              className="w-full px-3 py-1.5 text-sm border border-lichen rounded-lg bg-parchment text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            />
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="bg-parchment border border-lichen rounded-lg overflow-hidden">
        {/* Table Header */}
        <div className="flex items-center gap-4 px-4 py-2.5 bg-stone/40 border-b border-lichen text-xs font-medium text-archive uppercase tracking-wide">
          <div className="w-36 shrink-0">Timestamp</div>
          <div className="w-40 shrink-0">User</div>
          <div className="w-36 shrink-0">Entity Type</div>
          <div className="flex-1 min-w-0">Entity</div>
          <div className="w-20 shrink-0">Change</div>
          <div className="w-32 shrink-0 text-right">Details</div>
          <div className="w-6 shrink-0" />
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="p-6">
            <div className="animate-pulse space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-center gap-4">
                  <div className="w-36 h-5 bg-stone rounded" />
                  <div className="w-40 h-5 bg-stone rounded" />
                  <div className="w-36 h-5 bg-stone rounded" />
                  <div className="flex-1 h-5 bg-stone rounded" />
                  <div className="w-20 h-5 bg-stone rounded" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {isError && (
          <div className="text-center py-12 text-semantic-error">
            Failed to load audit events. Please try again.
          </div>
        )}

        {/* Empty */}
        {!isLoading && !isError && events.length === 0 && (
          <div className="text-center py-12">
            <History className="mx-auto h-10 w-10 text-archive/50" />
            <h3 className="mt-2 text-sm font-medium text-ink">No events found</h3>
            <p className="mt-1 text-sm text-archive">
              {hasActiveFilters
                ? 'No events match the current filters. Try adjusting your criteria.'
                : 'No change events have been recorded yet.'}
            </p>
          </div>
        )}

        {/* Event Rows */}
        {!isLoading && !isError && events.length > 0 && (
          <div>
            {events.map((event) => (
              <EventRow key={event.event_id} event={event} orgId={orgId!} />
            ))}
          </div>
        )}

        {/* Pagination */}
        {(hasMore || hasPrev) && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-lichen bg-stone/20">
            <button
              onClick={() => setOffset(Math.max(0, offset - limit))}
              disabled={!hasPrev}
              className="flex items-center gap-1 px-3 py-1.5 text-sm border border-lichen rounded hover:bg-stone disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={16} />
              Previous
            </button>
            <span className="text-xs text-archive">
              {offset + 1}–{Math.min(offset + limit, total)} of {total} events
            </span>
            <button
              onClick={() => setOffset(offset + limit)}
              disabled={!hasMore}
              className="flex items-center gap-1 px-3 py-1.5 text-sm border border-lichen rounded hover:bg-stone disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
