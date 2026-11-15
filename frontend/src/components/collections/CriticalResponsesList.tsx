/**
 * Critical responses (reviews, essays, letters ... about an object) recorded
 * for an object, read-only, each with its change history.
 *
 * Shown only to staff the history API answers for critical responses
 * (data.view + critical_responses.view); the list endpoint needs
 * critical_responses.view, which that implies.
 */
import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getObjectCriticalResponses } from '../../lib/api';
import type { CriticalResponse } from '../../lib/schemas';
import { RecordHistoryButton } from '../audit/RecordHistoryButton';
import { useCanViewRecordHistory } from '../audit/useCanViewRecordHistory';

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  essay: 'Essay',
  review: 'Review',
  catalog_entry: 'Catalog entry',
  diary: 'Diary',
  letter: 'Letter',
  lecture: 'Lecture',
  interview: 'Interview',
  article: 'Article',
  book: 'Book',
  other: 'Other',
};

const MAX_NAME = 80;

/** The name staff see for a response: its summary, else the start of its text. */
function criticalResponseName(r: CriticalResponse): string {
  const base = (r.comment_summary || r.comment_text || '').trim();
  if (!base) return DOCUMENT_TYPE_LABELS[r.document_type] ?? 'Response';
  return base.length > MAX_NAME ? `${base.slice(0, MAX_NAME)}…` : base;
}

interface CriticalResponsesListProps {
  organizationId: string;
  objectId: string;
  /** Heading level (default 3, inside a workspace section). */
  headingLevel?: 2 | 3 | 4;
}

export function CriticalResponsesList({ organizationId, objectId, headingLevel = 3 }: CriticalResponsesListProps) {
  const headingId = useId();
  const canView = useCanViewRecordHistory('critical_response');
  const { data, isLoading, isError } = useQuery({
    queryKey: ['critical-responses', organizationId, objectId],
    queryFn: () => getObjectCriticalResponses(organizationId, objectId),
    enabled: canView && !!organizationId && !!objectId,
  });

  if (!canView) return null;
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4';
  const responses = data?.critical_responses ?? [];

  return (
    <section aria-labelledby={headingId} className="mt-6 pt-4 border-t border-lichen">
      <Heading id={headingId} className="text-sm font-medium text-ink mb-2">
        Critical responses
      </Heading>
      {isLoading ? (
        <p className="text-sm text-archive">Loading critical responses…</p>
      ) : isError ? (
        <p role="alert" className="text-sm text-semantic-error">Could not load critical responses.</p>
      ) : responses.length === 0 ? (
        <p className="text-sm text-archive">No critical responses recorded.</p>
      ) : (
        <ul className="divide-y divide-lichen border border-lichen rounded-lg">
          {responses.map((r) => {
            const name = criticalResponseName(r);
            const meta = [
              DOCUMENT_TYPE_LABELS[r.document_type] ?? r.document_type,
              r.author_name,
              r.comment_date_display,
            ].filter(Boolean).join(', ');
            return (
              <li key={r.response_id} className="flex items-start justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm text-ink break-words">{name}</p>
                  {meta && <p className="text-xs text-archive">{meta}</p>}
                </div>
                <RecordHistoryButton
                  organizationId={organizationId}
                  entityType="critical_response"
                  entityId={r.response_id}
                  recordName={name}
                  className="shrink-0"
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
