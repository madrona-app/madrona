/**
 * EntryRequirementsCard Component
 *
 * Thin wrapper around RequirementsPanel for Object Entry procedure requirements.
 * Computes compliance from entry data and maps results to the generic panel interface.
 */

import { useCallback, useMemo } from 'react';
import type { RequirementGroup } from '../../lib/procedureComplianceUtils';
import { computeProcedureCompliance } from '../../lib/procedureComplianceUtils';
import { usePageContext } from '../../contexts/PageContext';
import { AskGuideButton } from '../guide/AskGuideButton';
import { RequirementsPanel } from './RequirementsPanel';
import type { RequirementsPanelRow } from './RequirementsPanel';

interface EntryRequirementsCardProps {
  entry: Record<string, unknown>;
  currentStatus: string;
  requirementGroups: RequirementGroup[];
  statusOrder: string[];
  /** Target action for blocking calculation (e.g., 'return', 'loan_in', 'acquisition') */
  targetAction?: 'return' | 'loan_in' | 'acquisition';
  onSectionNavigate: (sectionId: string, fieldPath?: string) => void;
  /** Called with context: { status, blockingGroup } */
  onViewGuidance?: (context?: { status: string; blockingGroupId?: string }) => void;
  defaultExpanded?: boolean;
  /** Force expand (used when gating outcome actions) */
  forceExpanded?: boolean;
}

// Map actions to the status they require
const ACTION_TO_STATUS: Record<string, string> = {
  return: 'returned',
  loan_in: 'processed',
  acquisition: 'processed',
};

// Map actions to human-readable labels
const ACTION_LABELS: Record<string, string> = {
  return: 'Return to Depositor',
  loan_in: 'Begin Loan In',
  acquisition: 'Begin Acquisition',
};

export function EntryRequirementsCard({
  entry,
  currentStatus,
  requirementGroups,
  statusOrder,
  targetAction,
  onSectionNavigate,
  onViewGuidance,
  defaultExpanded = false,
  forceExpanded = false,
}: EntryRequirementsCardProps) {
  const effectiveTargetStatus = targetAction
    ? ACTION_TO_STATUS[targetAction]
    : undefined;

  const compliance = computeProcedureCompliance(requirementGroups, entry, currentStatus, statusOrder, effectiveTargetStatus);

  const {
    requiredTotal,
    requiredComplete,
    percentComplete,
    blockingMissing,
    groups,
    nextBlockingField,
  } = compliance;

  const blockingCount = blockingMissing.length;
  const isReady = blockingCount === 0;

  const readyForLabel = targetAction
    ? ACTION_LABELS[targetAction]
    : currentStatus === 'processed'
      ? 'outcome (Return, Loan In, or Acquisition)'
      : 'next step';

  const statusMessage = isReady
    ? `Ready for ${readyForLabel}`
    : `Not ready: ${blockingMissing[0]?.requirement.label}${blockingCount > 1 ? ` (+${blockingCount - 1} more)` : ''}`;

  const firstBlockingGroupId = blockingMissing[0]?.requirement.groupId;

  // Map GroupResult[] → RequirementsPanelRow[]
  const rows: RequirementsPanelRow[] = useMemo(() =>
    groups.map((g) => {
      const hasBlocking = g.blockingMissing.length > 0;
      const primaryMissing = hasBlocking
        ? g.blockingMissing[0].requirement.label
        : g.missingLabels[0];
      return {
        id: g.group.id,
        label: g.group.label,
        completedCount: g.completedCount,
        totalCount: g.totalCount,
        hasBlocking,
        primaryMissing,
      };
    }),
    [groups],
  );

  // Map row click back to sectionId + first missing field
  const handleRowClick = useCallback((rowId: string) => {
    const groupResult = groups.find((g) => g.group.id === rowId);
    if (!groupResult) return;
    const firstMissingField = groupResult.results.find((r) => !r.satisfied)?.missingFields[0];
    onSectionNavigate(groupResult.group.sectionId, firstMissingField);
  }, [groups, onSectionNavigate]);

  const handleFixBlocker = useCallback(() => {
    if (nextBlockingField) {
      onSectionNavigate(nextBlockingField.sectionId, nextBlockingField.fieldPath);
    }
  }, [nextBlockingField, onSectionNavigate]);

  const handleViewGuidance = useCallback(() => {
    onViewGuidance?.({
      status: currentStatus,
      blockingGroupId: firstBlockingGroupId,
    });
  }, [onViewGuidance, currentStatus, firstBlockingGroupId]);

  // Ask Guide prompt — same pattern as ProcedureRequirementsCard.
  const { pageContext: { entity: pageEntity } } = usePageContext();
  const askGuidePrompt = useMemo(() => {
    if (blockingCount === 0) return null;
    const blockerLabel = blockingMissing[0]?.requirement.label ?? 'this requirement';
    const effectiveTarget = effectiveTargetStatus
      ?? statusOrder[statusOrder.indexOf(currentStatus) + 1]
      ?? null;
    const friendly = (key: string) => key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const targetClause = effectiveTarget
      ? ` to advance to '${friendly(effectiveTarget)}' (status key: ${effectiveTarget})`
      : ' to advance to the next workflow step';
    const entityDesc = pageEntity?.type
      ? `${friendly(pageEntity.type)} (Entry Requirements)`
      : 'Object Entry';
    const statusDisplay = `'${friendly(currentStatus)}' (status key: ${currentStatus})`;
    return (
      `I'm on a ${entityDesc} record currently at status ${statusDisplay}. ` +
      `Why is '${blockerLabel}' required${targetClause}, and how should I resolve it? ` +
      `Explain the context briefly and tell me which field(s) to fill.`
    );
  }, [blockingCount, blockingMissing, currentStatus, effectiveTargetStatus, statusOrder, pageEntity]);

  return (
    <RequirementsPanel
      title="Entry Requirements"
      completedCount={requiredComplete}
      totalCount={requiredTotal}
      percentComplete={percentComplete}
      isReady={isReady}
      statusMessage={statusMessage}
      statusIsPositive={isReady}
      rows={rows}
      onRowClick={handleRowClick}
      onFixBlocker={blockingCount > 0 ? handleFixBlocker : undefined}
      headerActionSlot={
        askGuidePrompt ? (
          <AskGuideButton
            prompt={askGuidePrompt}
            label="Ask Guide why"
            ariaLabel="Ask Guide why this requirement is blocking"
          />
        ) : undefined
      }
      onViewGuidance={onViewGuidance ? handleViewGuidance : undefined}
      defaultExpanded={defaultExpanded}
      forceExpanded={forceExpanded}
    />
  );
}

export default EntryRequirementsCard;
