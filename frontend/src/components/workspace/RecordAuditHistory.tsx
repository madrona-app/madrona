import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History, ChevronDown, ChevronUp, User, Calendar } from 'lucide-react';
import { formatDateShort, formatTime } from '../../lib/formatters';
import { getRecordAuditHistory } from '../../lib/api';
import type { RecordAuditEvent, RecordAuditFieldDiff } from '../../lib/api';
import type { JsonValue } from '../../types/api';
import { FieldDiffList, buildFieldSummaryLine } from '../audit';

// ============================================================================
// Event Grouping — collapse consecutive autosave events into sessions
// ============================================================================

const GROUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

interface GroupedEvent {
  /** First event id (used as React key) */
  key: string;
  change_type: RecordAuditEvent['change_type'];
  /** Earliest timestamp in the group */
  changed_at: string;
  /** Latest timestamp (only set when group has > 1 event) */
  changed_at_end: string | null;
  changed_by: string | null;
  changed_by_name: string | null;
  changed_by_email: string | null;
  summary: string | null;
  /** Merged diffs across all events in the group */
  field_diffs: RecordAuditFieldDiff[];
  /** How many raw events were collapsed */
  event_count: number;
}

/**
 * Merge diffs across multiple events for the same field.
 * For each field keep the earliest old_value and the latest new_value.
 * If they end up equal the change was reverted — drop that diff entirely.
 */
function mergeDiffs(eventsList: RecordAuditEvent[]): RecordAuditFieldDiff[] {
  const fieldMap = new Map<string, { old_value: JsonValue; new_value: JsonValue }>();

  for (const event of eventsList) {
    if (!event.field_diffs) continue;
    for (const diff of event.field_diffs) {
      const existing = fieldMap.get(diff.field_name);
      if (existing) {
        // Keep earliest old, take latest new
        existing.new_value = diff.new_value;
      } else {
        fieldMap.set(diff.field_name, {
          old_value: diff.old_value,
          new_value: diff.new_value,
        });
      }
    }
  }

  const merged: RecordAuditFieldDiff[] = [];
  for (const [field_name, { old_value, new_value }] of fieldMap) {
    // Drop no-op diffs (value reverted to original)
    if (JSON.stringify(old_value) === JSON.stringify(new_value)) continue;
    merged.push({ field_name, old_value, new_value });
  }
  return merged;
}

/**
 * Group consecutive "updated" events from the same user within GROUP_WINDOW_MS.
 * Created/deleted events are never grouped.
 */
function groupEvents(events: RecordAuditEvent[]): GroupedEvent[] {
  const groups: GroupedEvent[] = [];
  let currentBatch: RecordAuditEvent[] = [];

  const flushBatch = () => {
    if (currentBatch.length === 0) return;
    const first = currentBatch[0];
    const last = currentBatch[currentBatch.length - 1];
    const mergedDiffs = mergeDiffs(currentBatch);
    groups.push({
      key: first.event_id,
      change_type: 'updated',
      // Events come newest-first, so first = latest, last = earliest
      changed_at: last.changed_at,
      changed_at_end: currentBatch.length > 1 ? first.changed_at : null,
      changed_by: first.changed_by,
      changed_by_name: first.changed_by_name,
      changed_by_email: first.changed_by_email,
      summary: mergedDiffs.length > 0
        ? `Updated ${mergedDiffs.length} field${mergedDiffs.length !== 1 ? 's' : ''}`
        : first.summary,
      field_diffs: mergedDiffs,
      event_count: currentBatch.length,
    });
    currentBatch = [];
  };

  for (const event of events) {
    // Only 'updated' events are grouped; all others (created, deleted, link_*) are standalone
    if (event.change_type !== 'updated') {
      flushBatch();
      groups.push({
        key: event.event_id,
        change_type: event.change_type,
        changed_at: event.changed_at,
        changed_at_end: null,
        changed_by: event.changed_by,
        changed_by_name: event.changed_by_name,
        changed_by_email: event.changed_by_email,
        summary: event.summary,
        field_diffs: event.field_diffs || [],
        event_count: 1,
      });
      continue;
    }

    // Check if this event belongs to the current batch
    if (currentBatch.length > 0) {
      const prev = currentBatch[currentBatch.length - 1];
      const sameUser = event.changed_by === prev.changed_by;
      // Events are newest-first, so prev is newer than event
      const timeDiff = new Date(prev.changed_at).getTime() - new Date(event.changed_at).getTime();
      if (sameUser && timeDiff <= GROUP_WINDOW_MS) {
        currentBatch.push(event);
        continue;
      }
    }

    // Start a new batch
    flushBatch();
    currentBatch.push(event);
  }

  flushBatch();
  return groups;
}


// ============================================================================
// Event Card
// ============================================================================

const CHANGE_TYPE_CONFIG: Record<string, { label: string; bgColor: string; textColor: string }> = {
  created: { label: 'Created', bgColor: 'bg-semantic-success', textColor: 'text-parchment' },
  updated: { label: 'Updated', bgColor: 'bg-semantic-warning', textColor: 'text-parchment' },
  deleted: { label: 'Deleted', bgColor: 'bg-semantic-error', textColor: 'text-parchment' },
  link_added: { label: 'Linked', bgColor: 'bg-semantic-info', textColor: 'text-parchment' },
  link_removed: { label: 'Unlinked', bgColor: 'bg-semantic-info', textColor: 'text-parchment' },
  link_updated: { label: 'Link Updated', bgColor: 'bg-semantic-info', textColor: 'text-parchment' },
};

function EventCard({ event }: { event: GroupedEvent }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const config = CHANGE_TYPE_CONFIG[event.change_type] || CHANGE_TYPE_CONFIG.updated;

  const hasDiffs = event.field_diffs.length > 0;
  const canExpand = hasDiffs;

  const fmtDate = (dateString: string) => formatDateShort(dateString);
  const fmtTime = (dateString: string) => formatTime(dateString);

  const timeDisplay = event.changed_at_end
    ? `${fmtTime(event.changed_at)}\u2013${fmtTime(event.changed_at_end)}`
    : fmtTime(event.changed_at);

  return (
    <div className="bg-parchment border border-lichen rounded-lg">
      {/* Header */}
      <div className="p-3">
        <div className="flex items-start justify-between gap-3">
          {/* Left: Badge and summary */}
          <div className="flex items-start gap-2 min-w-0">
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${config.bgColor} ${config.textColor} shrink-0`}>
              {config.label}
            </span>
            <div className="min-w-0">
              {event.summary && (
                <p className="text-sm text-ink truncate">{event.summary}</p>
              )}
              <div className="flex items-center gap-2 mt-1 text-xs text-archive">
                <span className="flex items-center gap-1">
                  <User size={12} />
                  {event.changed_by_name || event.changed_by_email || 'System'}
                </span>
                {event.event_count > 1 && (
                  <span className="text-archive/60">
                    {event.event_count} edits
                  </span>
                )}
              </div>
              {/* One-line field summary when collapsed */}
              {canExpand && !isExpanded && (
                <p className="mt-0.5 text-xs text-archive/70 truncate">
                  {buildFieldSummaryLine(event.field_diffs)}
                </p>
              )}
            </div>
          </div>

          {/* Right: Date and expand button */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-right text-xs text-archive">
              <div className="flex items-center gap-1">
                <Calendar size={12} />
                {fmtDate(event.changed_at)}
              </div>
              <div>{timeDisplay}</div>
            </div>
            {canExpand && (
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                aria-expanded={isExpanded}
                aria-label={isExpanded ? 'Hide changed fields' : 'Show changed fields'}
                className="p-1 text-archive hover:text-ink rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-1"
              >
                {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Expanded diffs */}
      {isExpanded && hasDiffs && (
        <div className="border-t border-lichen px-3 py-2 bg-stone/30">
          <FieldDiffList diffs={event.field_diffs} showRawButton />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Loading and Empty States
// ============================================================================

function LoadingState() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="bg-parchment border border-lichen rounded-lg p-3 animate-pulse">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-2">
              <div className="w-16 h-5 bg-stone rounded" />
              <div className="space-y-2">
                <div className="w-32 h-4 bg-stone rounded" />
                <div className="w-24 h-3 bg-stone rounded" />
              </div>
            </div>
            <div className="w-20 h-4 bg-stone rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-8">
      <History className="mx-auto h-10 w-10 text-archive/50" />
      <h3 className="mt-2 text-sm font-medium text-ink">No history</h3>
      <p className="mt-1 text-sm text-archive">
        No changes have been recorded for this record yet.
      </p>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

interface RecordAuditHistoryProps {
  organizationId: string;
  entityType: string;
  entityId: string;
  title?: string;
  className?: string;
}

export function RecordAuditHistory({
  organizationId,
  entityType,
  entityId,
  title = 'Change History',
  className = '',
}: RecordAuditHistoryProps) {
  const [offset, setOffset] = useState(0);
  const limit = 20;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['recordAuditHistory', organizationId, entityType, entityId, offset],
    queryFn: () => getRecordAuditHistory(organizationId, entityType, entityId, {
      limit,
      offset,
      include_diffs: true,
    }),
    enabled: !!organizationId && !!entityType && !!entityId,
  });

  const rawEvents = data?.items || [];
  const total = data?.total || 0;
  const hasMore = offset + limit < total;
  const hasPrev = offset > 0;

  const grouped = useMemo(() => groupEvents(rawEvents), [rawEvents]);

  if (isLoading) {
    return (
      <div className={className}>
        <h3 className="text-sm font-medium text-ink mb-3">{title}</h3>
        <LoadingState />
      </div>
    );
  }

  if (isError) {
    return (
      <div className={className}>
        <h3 className="text-sm font-medium text-ink mb-3">{title}</h3>
        <div className="text-center py-6 text-semantic-error">
          Failed to load history: {(error as Error)?.message || 'Unknown error'}
        </div>
      </div>
    );
  }

  if (rawEvents.length === 0 && offset === 0) {
    return (
      <div className={className}>
        <h3 className="text-sm font-medium text-ink mb-3">{title}</h3>
        <EmptyState />
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-ink">{title}</h3>
        <span className="text-xs text-archive">
          {total} event{total !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="space-y-2">
        {grouped.map((event) => (
          <EventCard key={event.key} event={event} />
        ))}
      </div>

      {/* Pagination */}
      {(hasMore || hasPrev) && (
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-lichen">
          <button
            onClick={() => setOffset(Math.max(0, offset - limit))}
            disabled={!hasPrev}
            className="px-3 py-1.5 text-sm border border-lichen rounded hover:bg-stone disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <span className="text-xs text-archive">
            {offset + 1}-{Math.min(offset + limit, total)} of {total}
          </span>
          <button
            onClick={() => setOffset(offset + limit)}
            disabled={!hasMore}
            className="px-3 py-1.5 text-sm border border-lichen rounded hover:bg-stone disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

export default RecordAuditHistory;
