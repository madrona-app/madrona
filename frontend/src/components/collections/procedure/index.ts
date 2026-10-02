/**
 * Components Index
 *
 * Exports all procedure-related components for collections management.
 */

// Validation and completion components
export { SectionCompletionBadge, OverallCompletionBar } from '../SectionCompletionBadge';
export { StatusAdvancementDialog, StatusRequirementsTooltip } from '../StatusAdvancementDialog';
export { ProcedureCompliancePanel } from '../ProcedureCompliancePanel';
export { ProcedureComplianceCard } from '../ProcedureComplianceCard';
export { EntryRequirementsCard } from '../EntryRequirementsCard';
export { ProcedureGuideCard } from '../ProcedureGuideCard';
export { AdvanceWithExceptionDialog } from '../AdvanceWithExceptionDialog';

// Guidance components
export {
  ProcedureChecklist,
  OBJECT_ENTRY_PROCEDURE_STEPS,
  LOAN_IN_PROCEDURE_STEPS,
  OBJECT_EXIT_PROCEDURE_STEPS,
} from '../ProcedureChecklist';
export type { ProcedureProcedureStep } from '../ProcedureChecklist';

export { ProcedureWorkflowGuide } from '../ProcedureWorkflowGuide';

export {
  ProcedureHelpTooltip,
  ProcedureFieldLabel,
  PROCEDURE_FIELD_GUIDANCE,
} from '../ProcedureHelpTooltip';

// Terms acceptance component
export { TermsAcceptancePanel } from '../TermsAcceptancePanel';
export type { TermsAcceptanceData, TermsAcceptancePanelProps } from '../TermsAcceptancePanel';

// Validation utilities (re-export for convenience)
export {
  OBJECT_ENTRY_SECTIONS,
  LOAN_IN_SECTIONS,
  OBJECT_EXIT_SECTIONS,
  OBJECT_ENTRY_STATUS_REQUIREMENTS,
  LOAN_IN_STATUS_REQUIREMENTS,
  OBJECT_EXIT_STATUS_REQUIREMENTS,
  calculateSectionCompletion,
  calculateAllSectionCompletions,
  validateStatusTransition,
  getOverallCompletion,
} from '../../../lib/procedureValidation';
export type {
  FieldRequirement,
  SectionRequirements,
  ValidationResult,
  SectionCompletion,
} from '../../../lib/procedureValidation';

// Shared procedure compliance types
export type {
  RequirementSeverity,
  Requirement,
  RequirementGroup,
  RequirementResult,
  GroupResult,
  ComplianceResult,
} from '../../../lib/procedureComplianceUtils';

// Field highlight utilities
export { navigateToSection, highlightField, clearAllHighlights } from '../../../lib/fieldHighlight';
