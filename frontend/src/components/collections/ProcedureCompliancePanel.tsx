/**
 * ProcedureCompliancePanel Component
 *
 * Thin wrapper around RequirementsPanel for procedure compliance display.
 * Computes section completions and maps them to the generic panel interface.
 */

import { useCallback, useMemo } from 'react';
import type { SectionRequirements } from '../../lib/procedureValidation';
import {
  calculateAllSectionCompletions,
  getOverallCompletion,
} from '../../lib/procedureValidation';
import { RequirementsPanel } from './RequirementsPanel';
import type { RequirementsPanelRow } from './RequirementsPanel';

interface ProcedureCompliancePanelProps {
  procedure: 'object_entry' | 'loan_in' | 'object_exit' | 'movement';
  sections: SectionRequirements[];
  record: Record<string, unknown>;
  currentStatus: string;
  onSectionClick?: (sectionId: string) => void;
  defaultExpanded?: boolean;
}

const PROCEDURE_LABELS: Record<string, string> = {
  object_entry: 'Entry',
  loan_in: 'Loan',
  object_exit: 'Exit',
  movement: 'Movement',
};

export function ProcedureCompliancePanel({
  procedure,
  sections,
  record,
  currentStatus: _currentStatus,
  onSectionClick,
  defaultExpanded = false,
}: ProcedureCompliancePanelProps) {
  const sectionCompletions = calculateAllSectionCompletions(sections, record);
  const overall = getOverallCompletion(procedure, record);

  const firstIncompleteSection = sectionCompletions.find((s) => !s.requiredComplete);
  const isReady = overall.requiredComplete;
  const blockingCount = sectionCompletions.filter((s) => !s.requiredComplete).length;

  const title = `${PROCEDURE_LABELS[procedure]} Requirements`;

  const statusMessage = isReady
    ? 'Ready for next step'
    : `Not ready: ${firstIncompleteSection?.title}${blockingCount > 1 ? ` (+${blockingCount - 1} more)` : ''}`;

  // Map SectionCompletion[] → RequirementsPanelRow[]
  const rows: RequirementsPanelRow[] = useMemo(() =>
    sectionCompletions.map((s) => {
      const hasBlocking = !s.requiredComplete && s.missingRequired.length > 0;
      return {
        id: s.sectionId,
        label: s.title,
        completedCount: s.completedCount,
        totalCount: s.totalCount,
        hasBlocking,
        primaryMissing: s.missingRequired[0],
      };
    }),
    [sectionCompletions],
  );

  const handleRowClick = useCallback((rowId: string) => {
    onSectionClick?.(rowId);
  }, [onSectionClick]);

  const handleFixBlocker = useCallback(() => {
    if (firstIncompleteSection) {
      onSectionClick?.(firstIncompleteSection.sectionId);
    }
  }, [firstIncompleteSection, onSectionClick]);

  return (
    <RequirementsPanel
      title={title}
      completedCount={overall.completedFields}
      totalCount={overall.totalFields}
      percentComplete={overall.percentage}
      isReady={isReady}
      statusMessage={statusMessage}
      statusIsPositive={isReady}
      rows={rows}
      onRowClick={handleRowClick}
      onFixBlocker={blockingCount > 0 ? handleFixBlocker : undefined}
      defaultExpanded={defaultExpanded}
    />
  );
}

export default ProcedureCompliancePanel;
