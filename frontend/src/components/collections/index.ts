/**
 * Collections Components
 *
 * Barrel export for all collection-related components.
 * Import from this file for cleaner imports:
 *
 * @example
 * import { ContactSelectorSlideOver, EntryLoanLinker } from '../../components/collections';
 */

// =============================================================================
// Slide-overs and Modals
// =============================================================================

export { ConstituentSelectorSlideOver, ContactSelectorSlideOver } from './ConstituentSelectorSlideOver';
export { ContactSelectorDisplay } from './ContactSelectorDisplay';
export { LocationPickerModal } from './LocationPickerModal';
export { RecordMovementSlideOver } from './RecordMovementSlideOver';
export { StatusAdvancementDialog } from './StatusAdvancementDialog';
export { AdvanceWithExceptionDialog } from './AdvanceWithExceptionDialog';
export { ChangeStatusDropdown } from './ChangeStatusDropdown';

// =============================================================================
// Department Selector
// =============================================================================

export { DepartmentSelector } from './DepartmentSelector';

// =============================================================================
// Object Entry Linkers
// =============================================================================

export { EntryAcquisitionLinker } from './EntryAcquisitionLinker';
export { EntryExitLinker } from './EntryExitLinker';
export { EntryLoanLinker } from './EntryLoanLinker';

// =============================================================================
// Object Linkers
// =============================================================================

export { AcquisitionObjectLinker } from './AcquisitionObjectLinker';
export { EventObjectLinker } from './EventObjectLinker';
export { ExhibitionObjectLinker } from './ExhibitionObjectLinker';
export { IncidentObjectLinker } from './IncidentObjectLinker';
export { ObjectEventLinker } from './ObjectEventLinker';
export { UseRequestObjectLinker } from './UseRequestObjectLinker';
export { ObjectSelector } from './ObjectSelector';

// =============================================================================
// Loan Linkers
// =============================================================================

export { LoanEntryLinker } from './LoanEntryLinker';
export { LoanExitLinker } from './LoanExitLinker';
export { LoanOutObjectLinker } from './LoanOutObjectLinker';

// =============================================================================
// Authority/Vocabulary Linkers
// =============================================================================

export { ClassificationLinker } from './ClassificationLinker';
export { ConstituentLinker } from './ConstituentLinker';
export { MaterialLinker } from './MaterialLinker';
export { PlaceAuthorityLinker } from './PlaceAuthorityLinker';
export { StylePeriodLinker } from './StylePeriodLinker';
export { SubjectLinker } from './SubjectLinker';
export { TechniqueLinker } from './TechniqueLinker';

// =============================================================================
// Object Field Components
// =============================================================================

export {
  TitlesField,
  ClassificationsField,
  MaterialsField,
  TechniquesField,
  MeasurementsField,
  SubjectsField,
  CreatorsField,
  InscriptionsField,
  MovementTimeline,
} from './ObjectFieldComponents';

// Re-export types and helpers from ObjectFieldComponents directory
export * from './ObjectFieldComponents/types';
export * from './ObjectFieldComponents/helpers';

// =============================================================================
// Object Managers
// =============================================================================

export { ObjectAuthoritiesManager } from './ObjectAuthoritiesManager';
export { ObjectCitationsManager } from './ObjectCitationsManager';
export { ObjectPartsManager } from './ObjectPartsManager';
export { ObjectRelationshipsManager } from './ObjectRelationshipsManager';
export { ObjectRightsManager } from './ObjectRightsManager';
export { OtherNumberTypesManager } from './OtherNumberTypesManager';

// =============================================================================
// Media Components
// =============================================================================

export { MediaLibraryLinker } from './MediaLibraryLinker';
export type { LinkedMediaItem } from './MediaLibraryLinker';
export { MediaManager } from './MediaManager';

// =============================================================================
// Condition Reports
// =============================================================================

export { ConditionReportLinker } from './ConditionReportLinker';

// =============================================================================
// Procedure Compliance Components
// =============================================================================

export { EntryRequirementsCard } from './EntryRequirementsCard';
export { ProcedureGuideCard } from './ProcedureGuideCard';
export { RequirementsPanel } from './RequirementsPanel';
export type { RequirementsPanelProps, RequirementsPanelRow } from './RequirementsPanel';
export { SectionCompletionBadge } from './SectionCompletionBadge';
export { ProcedureChecklist } from './ProcedureChecklist';
export { ProcedureComplianceCard } from './ProcedureComplianceCard';
export { ProcedureCompliancePanel } from './ProcedureCompliancePanel';
export { ProcedureHelpTooltip } from './ProcedureHelpTooltip';
export { ProcedureWorkflowGuide } from './ProcedureWorkflowGuide';
export { TermsAcceptancePanel } from './TermsAcceptancePanel';

// =============================================================================
// Navigation and Display Components
// =============================================================================

export { EventCollectionsImpact } from './EventCollectionsImpact';
export { PartsLocationSummary } from './PartsLocationSummary';
export { RelatedProcedures } from './RelatedProcedures';
export { RelationshipNavigationStrip } from './RelationshipNavigationStrip';

// =============================================================================
// Quick Actions
// =============================================================================

export {
  ConditionReportSlideOver,
  IncidentReportSlideOver,
  ConservationSlideOver,
  ValuationSlideOver,
  LoanRequestSlideOver,
  UseRequestSlideOver,
} from './ObjectQuickActionSlideOvers';
