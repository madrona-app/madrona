import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { Upload, History, ClipboardList, Calendar, Truck, Package, FileText, MessageSquare, Activity, ClipboardCheck } from 'lucide-react';
import { formatDateTime } from '@/lib/formatters';
import { useAuth } from '../../../hooks/useAuth';
import { usePermissions } from '../../../hooks/usePermissions';
import { ContactSelectorSlideOver } from '../../../components/collections/ConstituentSelectorSlideOver';
import {
  WorkspaceHeader,
  WorkspaceErrorBoundary,
  WorkspaceSection,
  SectionGroupDivider,
  RecordAuditHistory,
  ReadOnlyBanner,
  PendingApprovalBanner,
} from '../../../components/workspace';
import { cn } from '../../../lib/utils';
import { ProcedureRequirementsCard } from '../../../components/collections/ProcedureRequirementsCard';
import { StatusAdvancementDialog } from '../../../components/collections/StatusAdvancementDialog';
import { AdvanceWithExceptionDialog } from '../../../components/collections/AdvanceWithExceptionDialog';
import { useProcedureRequirements } from '../../../hooks/useProcedureRequirements';
import { canTransitionToProcedure } from '../../../lib/procedureComplianceUtils';
import { useWorkspacePage } from '../../../hooks/useWorkspacePage';
import type { WithFieldAccess } from '../../../lib/schemas/entities';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { CreateTaskSlideOver } from '../../../components/work/CreateTaskSlideOver';
import { GenerateReportSlideOver } from '../../../components/reports/GenerateReportSlideOver';
import { RecordDetailPageWrapper, SectionOrderProvider } from '../../../components/record-detail';
import { useLookupValues } from '../../../hooks/useLookupValues';

// Local imports
import { useLoanOutForm, useSectionManagement, useSectionData } from './hooks';
import { dispatchLoanOut } from '../../../lib/api';
import {
  LOAN_OUT_SECTION_GROUPS,
  STATUS_CONFIG,
} from './constants';
import type { FormData, StatusAdvancementDialogState, ExceptionDialogState } from './types';

// Section components
import { BorrowerSection } from './BorrowerSection';
import { LoanDetailsSection } from './LoanDetailsSection';
import { DatesSection } from './DatesSection';
import { InsuranceSection } from './InsuranceSection';
import { FacilitySection } from './FacilitySection';
import { ObjectsSection } from './ObjectsSection';
import { AgreementSection } from './AgreementSection';
import { NotesSection } from './NotesSection';
import { DiscussionSection } from './DiscussionSection';
import { AuthorizationSection } from '../../../components/collections/AuthorizationSection';
import { ClosingSection } from './ClosingSection';
import { MonitoringSection } from './MonitoringSection';
import { RenewalsSection } from './RenewalsSection';
import { WorkflowIndicator } from './WorkflowIndicator';
import { StatusBar } from './StatusBar';
import { DaysRemainingAlert, MissingInsuranceAlert } from './AlertBanners';
import { ShipmentLinker } from '../../../components/collections/ShipmentLinker';
import { MadronaLoader } from '../../../components/ui/MadronaLoader';
import { LoanOutDispatchDialog } from './LoanOutDispatchDialog';
import { LoanOutReturnDialog } from './LoanOutReturnDialog';

/**
 * Outer wrapper that provides section order context.
 */
export default function LoanOutWorkspacePage() {
  return (
    <SectionOrderProvider>
      <LoanOutWorkspacePageContent />
    </SectionOrderProvider>
  );
}

/**
 * Inner component with all the logic and hooks.
 */
function LoanOutWorkspacePageContent() {
  const { orgId, loanId } = useParams<{ orgId: string; loanId?: string }>();
  const { requirementGroups, statusOrder, enforcementEnabled } = useProcedureRequirements('loan_out', orgId);
  const { user } = useAuth();

  // Lookup values (database-managed dropdowns)
  const { getLookup, getLabel } = useLookupValues({ context: 'loans_out' });

  // Dialog states
  const [showBorrowerSelector, setShowBorrowerSelector] = useState(false);
  const [showBorrowerContactSelector, setShowBorrowerContactSelector] = useState(false);
  const [showAuthorizerSelector, setShowAuthorizerSelector] = useState(false);
  const [showReportSlideOver, setShowReportSlideOver] = useState(false);

  // Status advancement dialog states
  const [statusAdvancementDialog, setStatusAdvancementDialog] = useState<StatusAdvancementDialogState>({
    isOpen: false, targetStatus: '', targetStatusLabel: '',
  });
  const [exceptionDialog, setExceptionDialog] = useState<ExceptionDialogState>({
    isOpen: false, targetStatus: '', targetStatusLabel: '', blockingRequirements: [],
  });
  const [showDispatchDialog, setShowDispatchDialog] = useState(false);
  const [showReturnDialog, setShowReturnDialog] = useState(false);

  // Form hook
  const isCreateMode = !loanId;
  const {
    formData,
    updateField,
    handleFieldBlur,
    saveStatus,
    lastSaved,
    hasUnsavedChanges,
    errorMessage,
    setErrorMessage,
    existingLoan,
    isLoading,
    error,
    borrowerContact,
    borrowerContactPerson,
    authorizerContact,
    performSave,
    statusMutation,
    deleteMutation,
  } = useLoanOutForm({ orgId, loanId, isCreateMode: isCreateMode });

  const queryClient = useQueryClient();

  // Dispatch uses a dedicated endpoint that auto-creates exits + movements
  const dispatchMutation = useMutation({
    mutationFn: () => dispatchLoanOut(orgId!, loanId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loan-out', orgId, loanId] });
      queryClient.invalidateQueries({ queryKey: ['loans-out', orgId] });
    },
  });

  // pending_approval records are read-only unless you're the requester or an approver
  const { hasPermission: checkPerm } = usePermissions();
  const isPendingApproval = existingLoan?.status === 'pending_approval';
  const isRequester = isPendingApproval && existingLoan?.created_by === user?.user_id;
  const isApprover = isPendingApproval && checkPerm('loans.approve');

  const wp = useWorkspacePage({
    entityType: 'loan_out',
    entityId: loanId,
    entityLabel: existingLoan?.loan_number ?? undefined,
    orgId,
    editPermission: 'loans.edit',
    restrictedFields: (existingLoan as WithFieldAccess | undefined)?._restricted_fields,
    canEdit: isPendingApproval ? (isRequester || isApprover) : undefined,
  });
  const { isEditing, setIsEditing, useNewLayout, canEdit, isRestricted, hasPermission: _hasPermission, dialogs } = wp;

  // Section management hook
  const {
    expandedSections,
    getSectionOrder,
    lowerAllSections,
    toggleSection,
    handleEnterEditMode,
  } = useSectionManagement();

  // Section data hook
  const { sectionIds, sectionData } = useSectionData(formData, existingLoan, isCreateMode);

  // Toggle mode (view <-> edit)
  const handleToggleMode = useCallback(() => {
    const newMode = !isEditing;
    setIsEditing(newMode);

    // Update URL without navigation
    if (!isCreateMode) {
      const basePath = `/organizations/${orgId}/collections/loans-out/${loanId}`;
      const newPath = newMode ? `${basePath}/edit` : basePath;
      window.history.replaceState(null, '', newPath);
    }

    // Lower raised section when exiting edit mode
    if (!newMode) {
      lowerAllSections();
    }

    // Save pending changes when exiting edit mode (mutation onSuccess handles invalidation)
    if (!newMode && hasUnsavedChanges && !isCreateMode) {
      performSave();
    }
  }, [isEditing, isCreateMode, orgId, loanId, hasUnsavedChanges, performSave, lowerAllSections]);

  // Wrap section toggle with editing state updates
  const handleSectionToggle = useCallback((sectionId: string) => {
    const shouldEnterEdit = toggleSection(sectionId, isEditing, canEdit, isCreateMode, orgId, loanId);
    if (shouldEnterEdit) {
      setIsEditing(true);
    }
  }, [toggleSection, isEditing, canEdit, isCreateMode, orgId, loanId]);

  // Wrap nav section click with editing state updates
  const handleNavSectionClick = useCallback((sectionId: string) => {
    const shouldEnterEdit = handleEnterEditMode(sectionId, isEditing, canEdit, isCreateMode, orgId, loanId);
    if (shouldEnterEdit) {
      setIsEditing(true);
    }
  }, [handleEnterEditMode, isEditing, canEdit, isCreateMode, orgId, loanId]);

  // Handle delete
  const handleDelete = () => {
    dialogs.setShowDeleteConfirm(true);
  };

  // Handle create save
  const handleCreateSave = useCallback(() => {
    if (!formData.borrower_id) {
      setErrorMessage('Borrower is required');
      return;
    }
    performSave();
  }, [formData.borrower_id, performSave, setErrorMessage]);

  // Validate status change for the StatusAdvancementDialog
  const validateStatusChange = useCallback((targetStatus: string) => {
    const record: Record<string, unknown> = { ...formData, ...existingLoan };
    const compliance = canTransitionToProcedure(
      requirementGroups, record,
      existingLoan?.status || 'requested', targetStatus, statusOrder, enforcementEnabled
    );
    return {
      valid: compliance.blockingRequirements.length === 0,
      errors: compliance.blockingRequirements.map(r => r.requirement.label),
      warnings: [] as string[],
    };
  }, [formData, existingLoan, requirementGroups, statusOrder, enforcementEnabled]);

  // Handle status advancement with pre-flight validation + cross-procedure dialogs
  const handleStatusAdvancement = useCallback((targetStatus: string, targetStatusLabel: string) => {
    // Special dialogs for key transitions
    if (targetStatus === 'in_transit') {
      setShowDispatchDialog(true);
      return;
    }
    if (targetStatus === 'returned') {
      setShowReturnDialog(true);
      return;
    }

    // Generic procedure validation for all other transitions
    const record: Record<string, unknown> = { ...formData, ...existingLoan };
    const { allowed } = canTransitionToProcedure(
      requirementGroups, record,
      existingLoan?.status || 'requested', targetStatus, statusOrder, enforcementEnabled
    );

    if (allowed) {
      statusMutation.mutate(targetStatus);
    } else {
      setStatusAdvancementDialog({ isOpen: true, targetStatus, targetStatusLabel });
    }
  }, [formData, existingLoan, requirementGroups, statusOrder, enforcementEnabled, statusMutation]);

  // Handle advancing with exception (admin bypass)
  const handleAdvanceWithException = useCallback((_reason: string, _bypassedRequirementIds: string[]) => {
    statusMutation.mutate(exceptionDialog.targetStatus);
    setExceptionDialog(prev => ({ ...prev, isOpen: false }));
  }, [statusMutation, exceptionDialog.targetStatus]);

  // Display values
  const displayNumber = isCreateMode ? '' : (existingLoan?.loan_number || '');
  const displayTitle = isCreateMode ? 'New Outgoing Loan' : 'Outgoing Loan';
  const displaySubtitle = !isCreateMode
    ? (existingLoan?.exhibition_title || borrowerContact?.name || undefined)
    : undefined;

  // Loading state
  if (!isCreateMode && isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <MadronaLoader label="Loading…" />
      </div>
    );
  }

  // Error state
  if (!isCreateMode && (error || !existingLoan)) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <div className="text-center py-12">
          <Upload size={48} className="mx-auto text-archive mb-4" />
          <h3 className="text-lg font-serif font-medium text-forest mb-2">
            Loan not found
          </h3>
          <p className="text-accessible-gray mb-4">
            {error ? (error as Error).message : 'The loan record could not be loaded.'}
          </p>
          <Link
            to={`/organizations/${orgId}/collections/loans-out`}
            className="text-bark hover:text-copper-dark"
          >
            Back to Loans Out
          </Link>
        </div>
      </div>
    );
  }

  const status = existingLoan?.status || 'requested';

  // Page content
  const pageContent = (
    <div className={cn(!useNewLayout && 'max-w-5xl mx-auto px-6 pb-12')}>
      {/* Header - only show old header when not using new layout */}
      {!useNewLayout && (
        <WorkspaceHeader
          backUrl={`/organizations/${orgId}/collections/loans-out`}
          backText="Back to Loans Out"
          title={displayTitle}
          objectNumber={displayNumber}
          isEditing={isEditing}
          saveStatus={saveStatus}
          lastSaved={lastSaved}
          hasUnsavedChanges={hasUnsavedChanges}
          showCreateButton={isCreateMode}
          createButtonText="Create Loan"
          onSave={isCreateMode ? handleCreateSave : undefined}
          onToggleMode={isCreateMode ? undefined : handleToggleMode}
        />
      )}

      {/* Edit mode indicator - only show when not using new layout */}

      {/* Workflow Progress Indicator (existing loans only) */}
      {!isCreateMode && existingLoan && (
        <WorkflowIndicator status={status} />
      )}

      {/* Compliance Card */}
      {!isCreateMode && existingLoan && (
                  <ProcedureRequirementsCard
            title="Loan Out Requirements"
            requirementGroups={requirementGroups}
            record={{
              ...(formData as unknown as Record<string, unknown>),
              objects: existingLoan?.objects || [],
              condition_report_out_id: existingLoan?.condition_report_out_id || null,
              actual_return_date: existingLoan?.actual_return_date || null,
            }}
            currentStatus={status}
            statusOrder={['requested', 'pending_approval', 'approved', 'agreement_sent', 'agreement_signed', 'in_transit', 'on_loan', 'return_scheduled', 'returned', 'closed', 'declined', 'cancelled']}
            onSectionNavigate={handleNavSectionClick}
          />
      )}

      {/* Alerts */}
      {!isCreateMode && existingLoan && (
        <>
          <DaysRemainingAlert existingLoan={existingLoan} />
          <MissingInsuranceAlert existingLoan={existingLoan} />
        </>
      )}

      {/* Status Bar (existing loans only) */}
      {!isCreateMode && existingLoan && (
        <StatusBar
          existingLoan={existingLoan}
          purposeLabel={getLabel('loan_purpose', formData.loan_purpose || '')}
          onStatusChange={(targetStatus) => {
            const label = STATUS_CONFIG[targetStatus]?.label || targetStatus;
            handleStatusAdvancement(targetStatus, label);
          }}
          isStatusPending={statusMutation.isPending}
        />
      )}

      {/* Read-only / pending approval indicators */}
      <ReadOnlyBanner visible={!isCreateMode && !canEdit} />
      <PendingApprovalBanner
        visible={!isCreateMode && status === 'pending_approval'}
        entityType="loan_out"
        entityId={loanId || ''}
        orgId={orgId || ''}
        onReviewed={() => window.location.reload()}
      />

      {/* Error message */}
      {errorMessage && (
        <div className="mb-4 p-4 bg-semantic-error/10 border border-semantic-error/30 rounded-lg">
          <p className="text-semantic-error">{errorMessage}</p>
        </div>
      )}

      {/* Sections — order matches LOAN_OUT_SECTION_GROUPS nav */}
      <div className="flex flex-col gap-4">

        {/* === OVERVIEW === */}
        {useNewLayout && <SectionGroupDivider label="Overview" icon={ClipboardList} />}

        <BorrowerSection
          formData={formData}
          borrowerContact={borrowerContact}
          borrowerContactPerson={borrowerContactPerson}
          isExpanded={expandedSections.borrower}
          isEditing={isEditing}
          order={getSectionOrder('borrower')}
          onToggle={() => handleSectionToggle('borrower')}
          onUpdateField={updateField as <K extends keyof FormData>(field: K, value: FormData[K]) => void}
          onFieldBlur={handleFieldBlur}
          onOpenSelector={() => setShowBorrowerSelector(true)}
          onOpenContactPersonSelector={() => setShowBorrowerContactSelector(true)}
          isRestricted={isRestricted}
        />

        <LoanDetailsSection
          formData={formData}
          isExpanded={expandedSections.details}
          isEditing={isEditing}
          order={getSectionOrder('details')}
          onToggle={() => handleSectionToggle('details')}
          onUpdateField={updateField as <K extends keyof FormData>(field: K, value: FormData[K]) => void}
          onFieldBlur={handleFieldBlur}
          loanPurposeOptions={getLookup('loan_purpose')}
          isRestricted={isRestricted}
          orgId={orgId!}
        />

        {/* === OBJECTS === */}
        {useNewLayout && <SectionGroupDivider label="Objects" icon={Package} />}

        {!isCreateMode && loanId && existingLoan && (
          <ObjectsSection
            orgId={orgId!}
            existingLoan={existingLoan}
            insuranceCurrency={formData.insurance_currency || 'USD'}
            isExpanded={expandedSections.objects}
            isEditing={isEditing}
            order={getSectionOrder('objects')}
            onToggle={() => handleSectionToggle('objects')}
          />
        )}

        {/* === DATES & AUTHORIZATION === */}
        {useNewLayout && <SectionGroupDivider label="Dates & Authorization" icon={Calendar} />}

        <DatesSection
          formData={formData}
          existingLoan={existingLoan}
          isCreateMode={isCreateMode}
          isExpanded={expandedSections.dates}
          isEditing={isEditing}
          order={getSectionOrder('dates')}
          onToggle={() => handleSectionToggle('dates')}
          onUpdateField={updateField as <K extends keyof FormData>(field: K, value: FormData[K]) => void}
          onFieldBlur={handleFieldBlur}
        />

        <AuthorizationSection
          authorizerId={formData.authorizer_id}
          authorizerContact={authorizerContact}
          authorizationDate={formData.authorization_date}
          authorizationNote={formData.authorization_note}
          isExpanded={expandedSections.authorization}
          isEditing={isEditing}
          order={getSectionOrder('authorization')}
          onToggle={() => handleSectionToggle('authorization')}
          onUpdateField={(field, value) => updateField(field as keyof FormData, value as FormData[keyof FormData])}
          onFieldBlur={handleFieldBlur}
          onOpenAuthorizerSelector={() => setShowAuthorizerSelector(true)}
        />

        {!isCreateMode && loanId && existingLoan && (
          <RenewalsSection
            organizationId={orgId!}
            loanId={loanId}
            existingLoan={existingLoan}
            isExpanded={expandedSections.renewals}
            isEditing={isEditing}
            order={getSectionOrder('renewals')}
            onToggle={() => handleSectionToggle('renewals')}
          />
        )}

        {/* === LOGISTICS === */}
        {useNewLayout && <SectionGroupDivider label="Logistics" icon={Truck} />}

        <InsuranceSection
          formData={formData}
          isExpanded={expandedSections.insurance}
          isEditing={isEditing}
          order={getSectionOrder('insurance')}
          onToggle={() => handleSectionToggle('insurance')}
          onUpdateField={updateField as <K extends keyof FormData>(field: K, value: FormData[K]) => void}
          onFieldBlur={handleFieldBlur}
          isRestricted={isRestricted}
        />

        <FacilitySection
          formData={formData}
          isExpanded={expandedSections.facility}
          isEditing={isEditing}
          order={getSectionOrder('facility')}
          onToggle={() => handleSectionToggle('facility')}
          onUpdateField={updateField as <K extends keyof FormData>(field: K, value: FormData[K]) => void}
          onFieldBlur={handleFieldBlur}
        />

        {!isCreateMode && loanId && (
          <WorkspaceSection
            id="shipments"
            title="Shipments"
            icon={<Truck size={18} />}
            isExpanded={expandedSections.shipments}
            onToggle={() => handleSectionToggle('shipments')}
            isEditing={isEditing}
            order={getSectionOrder('shipments')}
          >
            <ShipmentLinker
              organizationId={orgId!}
              procedureType="loan_out"
              procedureId={loanId}
              isEditing={isEditing}
            />
          </WorkspaceSection>
        )}

        {/* === DOCUMENTATION === */}
        {useNewLayout && <SectionGroupDivider label="Documentation" icon={FileText} />}

        <AgreementSection
          formData={formData}
          isExpanded={expandedSections.agreement}
          isEditing={isEditing}
          order={getSectionOrder('agreement')}
          onToggle={() => handleSectionToggle('agreement')}
          onUpdateField={updateField as <K extends keyof FormData>(field: K, value: FormData[K]) => void}
          onFieldBlur={handleFieldBlur}
          organizationId={orgId!}
          loanId={loanId}
        />

        <NotesSection
          formData={formData}
          isExpanded={expandedSections.notes}
          isEditing={isEditing}
          order={getSectionOrder('notes')}
          onToggle={() => handleSectionToggle('notes')}
          onUpdateField={updateField as <K extends keyof FormData>(field: K, value: FormData[K]) => void}
          onFieldBlur={handleFieldBlur}
        />

        {/* === MONITORING === */}
        {useNewLayout && !isCreateMode && <SectionGroupDivider label="Monitoring" icon={Activity} />}

        {!isCreateMode && loanId && existingLoan && (
          <MonitoringSection
            organizationId={orgId!}
            loanId={loanId}
            isExpanded={expandedSections.monitoring}
            isEditing={isEditing}
            order={getSectionOrder('monitoring')}
            onToggle={() => handleSectionToggle('monitoring')}
          />
        )}

        {/* === CLOSING === */}
        {useNewLayout && !isCreateMode && <SectionGroupDivider label="Closing" icon={ClipboardCheck} />}

        {!isCreateMode && existingLoan && (
          <ClosingSection
            formData={formData}
            isExpanded={expandedSections.closing}
            isEditing={isEditing}
            order={getSectionOrder('closing')}
            onToggle={() => handleSectionToggle('closing')}
            onUpdateField={updateField as <K extends keyof FormData>(field: K, value: FormData[K]) => void}
            onFieldBlur={handleFieldBlur}
          />
        )}

        {/* === COLLABORATION === */}
        {useNewLayout && !isCreateMode && <SectionGroupDivider label="Collaboration" icon={MessageSquare} />}

        {!isCreateMode && loanId && (
          <DiscussionSection
            loanId={loanId}
            organizationId={orgId!}
            isExpanded={expandedSections.discussion}
            isEditing={isEditing}
            order={getSectionOrder('discussion')}
            onToggle={() => handleSectionToggle('discussion')}
          />
        )}

        {/* === HISTORY: Change History === */}
        {!isCreateMode && orgId && loanId && (
          <WorkspaceSection
            id="history"
            title="Change History"
            icon={<History size={18} />}
            isExpanded={expandedSections.history}
            onToggle={() => handleSectionToggle('history')}
            isEditing={isEditing}
            order={getSectionOrder('history')}
          >
            <RecordAuditHistory
              organizationId={orgId}
              entityType="loan_out"
              entityId={loanId}
            />
          </WorkspaceSection>
        )}

      </div>

      {/* Footer metadata */}
      {!isCreateMode && existingLoan && (
        <div className="mt-8 pt-6 border-t border-lichen text-sm text-archive">
          <p>Created: {formatDateTime(existingLoan.created_at)}</p>
          {existingLoan.updated_at && (
            <p>Last updated: {formatDateTime(existingLoan.updated_at)}</p>
          )}
        </div>
      )}

      {/* Dialogs */}
      <ConfirmDialog
        isOpen={dialogs.showDeleteConfirm}
        onClose={() => dialogs.setShowDeleteConfirm(false)}
        onConfirm={() => {
          deleteMutation.mutate();
          dialogs.setShowDeleteConfirm(false);
        }}
        title="Delete Loan Record"
        message={<>Are you sure you want to delete <strong>{displayNumber || 'this loan record'}</strong>? This action cannot be undone.</>}
        confirmText="Delete"
        confirmStyle="danger"
      />

      {/* Status Advancement Dialogs */}
      <StatusAdvancementDialog
        isOpen={statusAdvancementDialog.isOpen}
        onClose={() => setStatusAdvancementDialog(prev => ({ ...prev, isOpen: false }))}
        onConfirm={() => {
          statusMutation.mutate(statusAdvancementDialog.targetStatus);
          setStatusAdvancementDialog(prev => ({ ...prev, isOpen: false }));
        }}
        currentStatus={existingLoan?.status || 'requested'}
        targetStatus={statusAdvancementDialog.targetStatus}
        targetStatusLabel={statusAdvancementDialog.targetStatusLabel}
        validation={validateStatusChange(statusAdvancementDialog.targetStatus)}
        isLoading={statusMutation.isPending}
        onAdvanceWithException={() => {
          const record: Record<string, unknown> = { ...formData, ...existingLoan };
          const { blockingRequirements } = canTransitionToProcedure(
            requirementGroups, record,
            existingLoan?.status || 'requested',
            statusAdvancementDialog.targetStatus,
            statusOrder, enforcementEnabled
          );
          setStatusAdvancementDialog(prev => ({ ...prev, isOpen: false }));
          setExceptionDialog({
            isOpen: true,
            targetStatus: statusAdvancementDialog.targetStatus,
            targetStatusLabel: statusAdvancementDialog.targetStatusLabel,
            blockingRequirements,
          });
        }}
      />

      <AdvanceWithExceptionDialog
        isOpen={exceptionDialog.isOpen}
        onClose={() => setExceptionDialog(prev => ({ ...prev, isOpen: false }))}
        onConfirm={handleAdvanceWithException}
        currentStatus={existingLoan?.status || 'requested'}
        targetStatus={exceptionDialog.targetStatus}
        targetStatusLabel={exceptionDialog.targetStatusLabel}
        blockingRequirements={exceptionDialog.blockingRequirements}
        isLoading={statusMutation.isPending}
      />

      {/* Cross-procedure dispatch dialog */}
      {existingLoan && (
        <LoanOutDispatchDialog
          isOpen={showDispatchDialog}
          onClose={() => setShowDispatchDialog(false)}
          onConfirm={() => {
            dispatchMutation.mutate();
            setShowDispatchDialog(false);
          }}
          loanObjects={existingLoan.objects || []}
          orgId={orgId!}
          loanId={loanId!}
          isLoading={dispatchMutation.isPending}
        />
      )}

      {/* Cross-procedure return dialog */}
      {existingLoan && (
        <LoanOutReturnDialog
          isOpen={showReturnDialog}
          onClose={() => setShowReturnDialog(false)}
          onConfirm={() => {
            statusMutation.mutate('returned');
            setShowReturnDialog(false);
          }}
          loanObjects={existingLoan.objects || []}
          orgId={orgId!}
          isLoading={statusMutation.isPending}
        />
      )}

      <ContactSelectorSlideOver
        isOpen={showBorrowerSelector}
        onClose={() => setShowBorrowerSelector(false)}
        onSelect={(contactId) => {
          updateField('borrower_id', contactId);
          setShowBorrowerSelector(false);
        }}
        organizationId={orgId!}
        title="Select Borrower"
        subtitle="Search for an existing contact or create a new one to use as the borrower."
      />

      <ContactSelectorSlideOver
        isOpen={showBorrowerContactSelector}
        onClose={() => setShowBorrowerContactSelector(false)}
        onSelect={(contactId) => {
          updateField('borrower_contact_id', contactId);
          setShowBorrowerContactSelector(false);
        }}
        organizationId={orgId!}
        title="Select Contact Person"
        subtitle="Search for a contact person at the borrowing institution."
      />

      <ContactSelectorSlideOver
        isOpen={showAuthorizerSelector}
        onClose={() => setShowAuthorizerSelector(false)}
        onSelect={(contactId) => {
          updateField('authorizer_id', contactId);
          setShowAuthorizerSelector(false);
        }}
        organizationId={orgId!}
        title="Select Authorizer"
        subtitle="Search for the person who authorized this loan."
      />

      <CreateTaskSlideOver
        isOpen={dialogs.showCreateTask}
        onClose={() => dialogs.setShowCreateTask(false)}
        orgId={orgId!}
        initialEntityType={!isCreateMode && loanId ? 'loan_out' : undefined}
        initialEntityId={!isCreateMode && loanId ? loanId : undefined}
        initialEntityLabel={!isCreateMode && loanId ? (displayNumber || displayTitle) : undefined}
      />

      <GenerateReportSlideOver
        isOpen={showReportSlideOver}
        onClose={() => setShowReportSlideOver(false)}
        contextType="record"
        contextParams={{ record_id: loanId || '', record_type: 'loans_out' }}
        recordType="loans_out"
      />
    </div>
  );

  // Wrap with RecordDetailPageWrapper for existing records (new layout)
  if (useNewLayout && existingLoan) {
    return (
      <WorkspaceErrorBoundary
        backUrl={`/organizations/${orgId}/collections/loans-out`}
        backLabel="Back to Loans Out"
      >
      <RecordDetailPageWrapper
        object={null}
        media={[]}
        sectionIds={sectionIds}
        sectionGroups={LOAN_OUT_SECTION_GROUPS}
        sectionData={sectionData}
        permissions={{
          canCreateTask: true,
          canViewHistory: true,
          canDelete: true,
          canGenerateReport: true,
        }}
        callbacks={{
          onDelete: handleDelete,
          onCreateTask: () => dialogs.setShowCreateTask(true),
          onGenerateReport: () => setShowReportSlideOver(true),
        }}
        isEditing={isEditing}
        onSectionNavigate={handleNavSectionClick}
        pageType="loan-out"
        enabled={true}
        showHeader={true}
        title={displayTitle}
        objectNumber={displayNumber}
        subtitle={displaySubtitle}
        backUrl={`/organizations/${orgId}/collections/loans-out`}
        backLabel="Back to Loans Out"
      >
        {pageContent}
      </RecordDetailPageWrapper>
      </WorkspaceErrorBoundary>
    );
  }

  return (
    <WorkspaceErrorBoundary
      backUrl={orgId ? `/organizations/${orgId}/collections/loans-out` : undefined}
      backLabel="Back to Loans Out"
    >
      {pageContent}
    </WorkspaceErrorBoundary>
  );
}
