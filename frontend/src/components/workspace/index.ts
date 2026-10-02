/**
 * Workspace Components
 *
 * Unified components for the Object Workspace - a single page
 * that supports both View and Edit modes seamlessly.
 */

export { EditableField, EditableSelect, EditableCheckbox, RestrictedFieldPlaceholder } from './EditableField';
export { EditablePlaceField } from './EditablePlaceField';
export { WorkspaceSection, SectionEmptyState } from './WorkspaceSection';
export { WorkspaceHeader, EditModeIndicator, ReadOnlyBanner } from './WorkspaceHeader';
export { PendingApprovalBanner } from './PendingApprovalBanner';
export { WorkspaceErrorFallback } from './WorkspaceErrorFallback';
export { withErrorBoundary, WorkspaceErrorBoundary } from './withErrorBoundary';
export { RecordAuditHistory } from './RecordAuditHistory';
export { SectionGroupDivider } from './SectionGroupDivider';
export { WorkspacePageShell } from './WorkspacePageShell';
