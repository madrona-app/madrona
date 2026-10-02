/**
 * ProcedureRequirementsCard Component
 *
 * Generic rich compliance card for any procedure that uses
 * RequirementGroup[] with severity levels. Thin wrapper around RequirementsPanel.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { RequirementGroup } from '../../lib/procedureComplianceUtils';
import { computeProcedureCompliance } from '../../lib/procedureComplianceUtils';
import { usePageContext } from '../../contexts/PageContext';
import { AskGuideButton } from '../guide/AskGuideButton';
import { RequirementsPanel } from './RequirementsPanel';
import type { RequirementsPanelRow } from './RequirementsPanel';

interface ProcedureRequirementsCardProps {
  title: string;
  requirementGroups: RequirementGroup[];
  record: Record<string, unknown>;
  currentStatus: string;
  statusOrder: string[];
  targetStatus?: string;
  onSectionNavigate: (sectionId: string, fieldPath?: string) => void;
  defaultExpanded?: boolean;
  forceExpanded?: boolean;
  /** Override the "Ready for next step" message when all requirements are met */
  readyMessage?: string;
  /** When false, blocking requirements render as warnings (advisory mode) */
  enforcementEnabled?: boolean;
}

export function ProcedureRequirementsCard({
  title,
  requirementGroups,
  record,
  currentStatus,
  statusOrder,
  targetStatus,
  onSectionNavigate,
  defaultExpanded = false,
  forceExpanded = false,
  readyMessage = 'Ready for next step',
  enforcementEnabled = false,
}: ProcedureRequirementsCardProps) {
  const compliance = computeProcedureCompliance(
    requirementGroups,
    record,
    currentStatus,
    statusOrder,
    targetStatus
  );

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

  const statusMessage = isReady
    ? readyMessage
    : enforcementEnabled
      ? `Not ready: ${blockingMissing[0]?.requirement.label}${blockingCount > 1 ? ` (+${blockingCount - 1} more)` : ''}`
      : `Advisory: ${blockingMissing[0]?.requirement.label}${blockingCount > 1 ? ` (+${blockingCount - 1} more)` : ''}`;

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

  // Push workflow state into the page context so the Guide sees it on the
  // next chat turn. Every workflow page renders this card, so doing it here
  // avoids touching N individual workspace pages.
  //
  // CRITICAL: computeProcedureCompliance returns a new object on every
  // render, so `blockingMissing` is a new array reference even when the
  // content hasn't changed. Without a content-based guard this effect
  // would:
  //   1. fire every render
  //   2. update the PageContext provider state
  //   3. re-render every consumer of usePageContext (including this card)
  //   4. loop forever
  // We dedupe by building a stable primitive key and only pushing when
  // the content actually changes. The ref comparison breaks the cycle.
  const { setPageContext } = usePageContext();
  const lastPushedKeyRef = useRef<string | null>(null);
  // blockingMissing identity is unstable across renders — depend on a content
  // hash instead so topBlockerLabels itself stays stable when the underlying
  // labels don't change. The hash is hoisted to a named const rather than
  // computed inline in the dependency array: the hooks lint rule requires
  // dependencies to be simple expressions, and an inline .map().join() is an
  // error it will not let the exhaustive-deps disable below suppress.
  const blockerLabelsKey = blockingMissing.map((b) => b.requirement.label).join('|');
  const topBlockerLabels = useMemo(
    () => blockingMissing.slice(0, 3).map((b) => b.requirement.label),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [blockingCount, blockerLabelsKey],
  );
  useEffect(() => {
    const key = `${currentStatus}|${blockingCount}|${topBlockerLabels.join('|')}`;
    if (lastPushedKeyRef.current === key) return;
    lastPushedKeyRef.current = key;
    setPageContext({
      workflow: {
        status: currentStatus,
        blockingCount,
        topBlockers: topBlockerLabels,
      },
    });
  }, [currentStatus, blockingCount, topBlockerLabels, setPageContext]);

  // Guide hand-off: build a specific prompt that names the procedure,
  // current status, top blocker, and (if known) the target status. Guide
  // has PageContext + lookup_madrona_field + lookup_reference, so this is
  // enough for it to answer "why is this required and how do I resolve it?"
  // without any tool call beyond what it already does.
  // Read the entity type from PageContext so the prompt uses the form
  // registry key ("collection_object") rather than the card title
  // ("Cataloging"). Guide's tools look up requirements by entity type,
  // and passing the display title causes a registry miss.
  const { pageContext: { entity: pageEntity } } = usePageContext();

  const askGuidePrompt = useMemo(() => {
    if (blockingCount === 0) return null;
    const blockerLabel = blockingMissing[0]?.requirement.label ?? 'this requirement';
    const effectiveTarget = targetStatus
      ?? statusOrder[statusOrder.indexOf(currentStatus) + 1]
      ?? null;

    // Humanize snake_case keys for readability in the prompt while keeping
    // the raw key in parentheses so Guide's tools can still match it.
    // e.g. "Inventory Complete (inventory_complete)"
    const friendly = (key: string) => key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

    const targetClause = effectiveTarget
      ? ` to advance to '${friendly(effectiveTarget)}' (status key: ${effectiveTarget})`
      : ' to advance to the next workflow step';
    const entityDesc = pageEntity?.type
      ? `${friendly(pageEntity.type)} (${title})`
      : title;
    const statusDisplay = `'${friendly(currentStatus)}' (status key: ${currentStatus})`;
    return (
      `I'm on a ${entityDesc} record currently at status ${statusDisplay}. ` +
      `Why is '${blockerLabel}' required${targetClause}, and how should I resolve it? ` +
      `Explain the context briefly and tell me which field(s) to fill.`
    );
  }, [blockingCount, blockingMissing, title, currentStatus, targetStatus, statusOrder, pageEntity]);

  return (
    <RequirementsPanel
      title={title}
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
      defaultExpanded={defaultExpanded}
      forceExpanded={forceExpanded}
    />
  );
}
