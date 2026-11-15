/**
 * The actions recorded against a procedure (an audit campaign's remedial
 * actions, an incident's preventive actions, a documentation plan's actions),
 * each with its change history. Actions are their own audited records
 * (compliance_action), so their changes are not on the parent's history.
 *
 * Takes the raw array from the record payload and keeps only entries that
 * carry an action_id; renders nothing when there are none or the user cannot
 * read their history.
 */
import { useId } from 'react';
import { RecordHistoryButton } from '../audit/RecordHistoryButton';
import { useCanViewRecordHistory } from '../audit/useCanViewRecordHistory';
import { toComplianceActions } from './complianceActions';

interface ComplianceActionsHistoryListProps {
  organizationId: string;
  /** The action array from the record (objects with action_id and title). */
  actions: unknown;
  title?: string;
  /** Heading level (default 3, inside a workspace section). */
  headingLevel?: 2 | 3 | 4;
}

export function ComplianceActionsHistoryList({
  organizationId,
  actions,
  title = 'Action history',
  headingLevel = 3,
}: ComplianceActionsHistoryListProps) {
  const headingId = useId();
  const canView = useCanViewRecordHistory('compliance_action');
  const items = toComplianceActions(actions);
  if (!canView || items.length === 0) return null;
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4';

  return (
    <section aria-labelledby={headingId} className="mt-4">
      <Heading id={headingId} className="text-sm font-medium text-ink mb-2">
        {title}
      </Heading>
      <ul className="divide-y divide-lichen border border-lichen rounded-lg">
        {items.map((a, i) => {
          const name = (a.title || '').trim() || `Action ${i + 1}`;
          return (
            <li key={a.action_id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm text-ink break-words">{name}</p>
                {a.status && <p className="text-xs text-archive">{a.status.replace(/_/g, ' ')}</p>}
              </div>
              <RecordHistoryButton
                organizationId={organizationId}
                entityType="compliance_action"
                entityId={a.action_id}
                recordName={name}
                className="shrink-0"
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
