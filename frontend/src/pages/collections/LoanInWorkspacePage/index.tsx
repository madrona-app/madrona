import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Download, History, ClipboardList, Calendar, Truck, Package, FileText, Activity, ClipboardCheck } from 'lucide-react';
import { formatDateTime } from '@/lib/formatters';
import { useAuth } from '../../../hooks/useAuth';
import { usePermissions } from '../../../hooks/usePermissions';
import {
  WorkspaceHeader,
  WorkspaceErrorBoundary,
  WorkspaceSection,
  SectionGroupDivider,
  RecordAuditHistory,
  ReadOnlyBanner,
  PendingApprovalBanner,
} from '../../../components/workspace';
import { RecordDetailPageWrapper, SectionOrderProvider } from '../../../components/record-detail';
import { ProcedureRequirementsCard } from '../../../components/collections/ProcedureRequirementsCard';
import { useProcedureRequirements } from '../../../hooks/useProcedureRequirements';
import { cn } from '../../../lib/utils';
import { useWorkspacePage } from '../../../hooks/useWorkspacePage';
import type { WithFieldAccess } from '../../../lib/schemas/entities';
import { useLookupValues } from '../../../hooks/useLookupValues';

import RollbackDialog from '../../../components/RollbackDialog';
import { GenerateReportSlideOver } from '../../../components/reports/GenerateReportSlideOver';
import { useLoanInWorkspace } from './hooks';
import {
  LOAN_IN_SECTION_GROUPS,
  ALL_SECTION_IDS,
} from './types';

import { LenderSection } from './LenderSection';
import { LoanDetailsSection } from './LoanDetailsSection';
import { DatesSection } from './DatesSection';
import { LogisticsSection } from './LogisticsSection';
import { ObjectsSection } from './ObjectsSection';
import { DocumentationSection } from './DocumentationSection';
import { MonitoringSection } from './MonitoringSection';
import { ClosingSection } from './ClosingSection';
import { WorkflowProgressIndicator, DaysRemainingAlert, StatusBar } from './StatusSection';
import { LoanDialogs } from './Dialogs';
import { ContactSelectorSlideOver } from '../../../components/collections/ConstituentSelectorSlideOver';
import { ShipmentLinker } from '../../../components/collections/ShipmentLinker';
import { MadronaLoader } from '../../../components/ui/MadronaLoader';

/**
 * Outer wrapper that provides section order context.
 */
export default function LoanInWorkspacePage() {
  return (
    <SectionOrderProvider>
      <LoanInWorkspacePageContent />
    </SectionOrderProvider>
  );
}

/**
 * Inner component with all the logic and hooks.
 */
function LoanInWorkspacePageContent() {
  const { orgId: routeOrgId } = useParams<{ orgId: string }>();
  const { requirementGroups } = useProcedureRequirements('loan_in', routeOrgId);
  const workspace = useLoanInWorkspace();
  const { getLookup, getLabel } = useLookupValues({ context: 'loans_in' });

  const {
    orgId,
    loanId,
    isCreateMode,
    isEditing,
    canEdit,
    useNewLayout,
    entryId,
    loan,
    isLoading,
    error,
    formData,
    lenderContact,
    lenderContactPerson,
    authorizerContact,
    linkedExhibition,
    exhibitionSearchResults,
    loanMedia,
    entryLocations,
    hasUnsavedChanges,
    saveStatus,
    lastSaved,
    errorMessage,
    setErrorMessage,
    expandedSections,
    sectionCompletions,
    sectionData,
    daysRemaining,
    displayTitle,
    displayNumber,
    showDeleteConfirm,
    setShowDeleteConfirm,
    showLenderSelector,
    setShowLenderSelector,
    showAuthorizerSelector,
    setShowAuthorizerSelector,
    showExhibitionSelector,
    setShowExhibitionSelector,
    exhibitionSearch,
    setExhibitionSearch,
    showCreateTask,
    setShowCreateTask,
    statusAdvancementDialog,
    setStatusAdvancementDialog,
    statusMutation,
    rollbackMutation,
    deleteMutation,
    updateField,
    toggleSection,
    handleToggleMode,
    handleEnterEditMode,
    handleDelete,
    handleCreateSave,
    handleStatusAdvancement,
    validateStatusChange,
    getSectionOrder,
  } = workspace;

  // pending_approval records are read-only unless you're the requester or an approver
  const { user } = useAuth();
  const { hasPermission: checkPerm } = usePermissions();
  const isPendingApproval = loan?.status === 'pending_approval';
  const isRequester = isPendingApproval && (loan as Record<string, unknown>)?.created_by === user?.user_id;
  const isApprover = isPendingApproval && checkPerm('loans.approve');
  const effectiveCanEdit = isPendingApproval ? ((isRequester || isApprover) && canEdit) : canEdit;

  const wp = useWorkspacePage({
    entityType: 'loan_in',
    entityId: loanId,
    entityLabel: loan?.loan_number,
    orgId,
    editPermission: 'loans.edit',
    restrictedFields: (workspace.loan as WithFieldAccess | undefined)?._restricted_fields,
    canEdit: effectiveCanEdit,
  });
  const { isRestricted, hasPermission } = wp;

  const [showReportSlideOver, setShowReportSlideOver] = useState(false);
  const [showLenderContactSelector, setShowLenderContactSelector] = useState(false);
  const [showRollbackConfirm, setShowRollbackConfirm] = useState<{
    isOpen: boolean; targetStatus: string; targetStatusLabel: string;
  }>({ isOpen: false, targetStatus: '', targetStatusLabel: '' });

  // Loading state
  if (!isCreateMode && isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <MadronaLoader label="Loading…" />
      </div>
    );
  }

  // Error state
  if (!isCreateMode && (error || !loan)) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <div className="text-center py-12">
          <Download size={48} className="mx-auto text-archive mb-4" />
          <h3 className="text-lg font-serif font-medium text-forest mb-2">
            Loan not found
          </h3>
          <p className="text-accessible-gray mb-4">
            {error ? (error as Error).message : 'The loan record could not be loaded.'}
          </p>
          <Link
            to={`/organizations/${orgId}/collections/loans-in`}
            className="text-bark hover:text-copper-dark"
          >
            Back to Loans In
          </Link>
        </div>
      </div>
    );
  }

  const status = loan?.status || 'requested';

  // Page content (same for both layouts)
  const pageContent = (
    <div className={cn(!useNewLayout && 'max-w-5xl mx-auto px-6 pb-12')}>
      {/* Header - only show old header when not using new layout */}
      {!useNewLayout && (
        <WorkspaceHeader
          backUrl={`/organizations/${orgId}/collections/loans-in`}
          backText="Back to Loans In"
          title={displayTitle}
          objectNumber={displayNumber}
          isEditing={isEditing}
          onToggleMode={isCreateMode ? undefined : handleToggleMode}
          saveStatus={saveStatus}
          lastSaved={lastSaved}
          hasUnsavedChanges={hasUnsavedChanges}
          showCreateButton={isCreateMode}
          createButtonText="Create Loan"
          onSave={isCreateMode ? handleCreateSave : undefined}
        />
      )}

      {/* Edit mode indicator - only show when not using new layout */}

      {/* Create validation error banner */}
      {errorMessage && (
        <div className="mb-4 bg-semantic-error/10 border border-semantic-error/30 rounded-lg px-4 py-3 flex items-center justify-between">
          <p className="text-sm text-semantic-error">{errorMessage}</p>
          <button
            onClick={() => setErrorMessage(null)}
            className="text-semantic-error hover:text-semantic-error/80 text-sm ml-4"
            aria-label="Dismiss error"
          >
            &times;
          </button>
        </div>
      )}

      {/* Object Entry Link Notice (create mode) */}
      {isCreateMode && entryId && (
        <div className="mb-6 bg-forest/5 border border-forest/20 rounded-lg p-4">
          <p className="text-sm text-forest">
            <strong>Creating from Object Entry:</strong> This loan will be linked to an object entry record.
          </p>
          <Link
            to={`/organizations/${orgId}/collections/entries/${entryId}`}
            className="text-sm text-bark hover:text-copper-dark mt-2 inline-block"
          >
            View Object Entry
          </Link>
        </div>
      )}

      {/* Workflow Progress Indicator (existing loans only) */}
      {!isCreateMode && loan && <WorkflowProgressIndicator loan={loan} />}

      {/* Loan Requirements/Compliance Panel */}
      {!isCreateMode && loan && (
                  <ProcedureRequirementsCard
            title="Loan In Requirements"
            requirementGroups={requirementGroups}
            record={{
              ...(formData as unknown as Record<string, unknown>),
              objects: loan?.objects || [],
            }}
            currentStatus={status}
            statusOrder={['requested', 'pending_approval', 'approved', 'agreement_sent', 'agreement_signed', 'in_transit', 'received', 'on_loan', 'return_initiated', 'returned', 'closed', 'cancelled', 'overdue']}
            onSectionNavigate={handleEnterEditMode}
          />
      )}

      {/* Days Remaining Alert */}
      {!isCreateMode && (
        <DaysRemainingAlert daysRemaining={daysRemaining} status={status} />
      )}

      {/* Status Bar (existing loans only) */}
      {!isCreateMode && loan && orgId && loanId && (
        <StatusBar
          orgId={orgId}
          loanId={loanId}
          loan={loan}
          formData={formData}
          daysRemaining={daysRemaining}
          statusMutation={statusMutation}
          deleteMutation={deleteMutation}
          handleStatusAdvancement={handleStatusAdvancement}
          handleDelete={handleDelete}
          purposeLabel={getLabel('loan_purpose', formData.loan_purpose || '')}
          hasPermission={hasPermission}
          rollbackMutation={rollbackMutation}
          onRollback={(targetStatus, targetStatusLabel) =>
            setShowRollbackConfirm({ isOpen: true, targetStatus, targetStatusLabel })
          }
        />
      )}

      {/* Read-only / pending approval indicators */}
      <ReadOnlyBanner visible={!isCreateMode && !canEdit} />
      <PendingApprovalBanner
        visible={!isCreateMode && status === 'pending_approval'}
        entityType="loan_in"
        entityId={loanId || ''}
        orgId={orgId || ''}
        onReviewed={() => window.location.reload()}
      />

      {/* Sections */}
      <div className="flex flex-col gap-4">
        {/* === OVERVIEW GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Overview" icon={ClipboardList} />}

        {/* Lender and Authorization Sections */}
        <LenderSection
          formData={formData}
          isEditing={isEditing}
          isCreateMode={isCreateMode}
          lenderContact={lenderContact}
          lenderContactPerson={lenderContactPerson}
          authorizerContact={authorizerContact}
          expandedSections={expandedSections}
          sectionCompletions={sectionCompletions}
          updateField={updateField}
          toggleSection={toggleSection}
          getSectionOrder={getSectionOrder}
          setShowLenderSelector={setShowLenderSelector}
          setShowLenderContactSelector={setShowLenderContactSelector}
          setShowAuthorizerSelector={setShowAuthorizerSelector}
          isRestricted={isRestricted}
        />

        {/* Loan Details Section */}
        <LoanDetailsSection
          formData={formData}
          isEditing={isEditing}
          isCreateMode={isCreateMode}
          expandedSections={expandedSections}
          sectionCompletions={sectionCompletions}
          linkedExhibition={linkedExhibition}
          exhibitionSearchResults={exhibitionSearchResults}
          showExhibitionSelector={showExhibitionSelector}
          exhibitionSearch={exhibitionSearch}
          updateField={updateField}
          toggleSection={toggleSection}
          getSectionOrder={getSectionOrder}
          setShowExhibitionSelector={setShowExhibitionSelector}
          setExhibitionSearch={setExhibitionSearch}
          loanPurposeOptions={getLookup('loan_purpose')}
          isRestricted={isRestricted}
          orgId={orgId!}
        />

        {/* === DATES GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Dates" icon={Calendar} />}

        {/* Dates Section */}
        <DatesSection
          formData={formData}
          isEditing={isEditing}
          isCreateMode={isCreateMode}
          loan={loan}
          expandedSections={expandedSections}
          sectionCompletions={sectionCompletions}
          updateField={updateField}
          toggleSection={toggleSection}
          getSectionOrder={getSectionOrder}
        />

        {/* === LOGISTICS GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Logistics" icon={Truck} />}

        {/* Logistics Sections (Insurance, Facility, Shipping) */}
        <LogisticsSection
          formData={formData}
          isEditing={isEditing}
          expandedSections={expandedSections}
          updateField={updateField}
          toggleSection={toggleSection}
          getSectionOrder={getSectionOrder}
          currencyOptions={getLookup('currency')}
          isRestricted={isRestricted}
        />

        {!isCreateMode && loanId && (
          <WorkspaceSection
            id="shipments"
            title="Shipments"
            icon={<Truck size={18} />}
            isExpanded={expandedSections.shipments}
            onToggle={() => toggleSection('shipments')}
            isEditing={isEditing}
            order={getSectionOrder('shipments')}
          >
            <ShipmentLinker
              organizationId={orgId!}
              procedureType="loan_in"
              procedureId={loanId}
              isEditing={isEditing}
            />
          </WorkspaceSection>
        )}

        {/* === OBJECTS GROUP === */}
        {useNewLayout && !isCreateMode && <SectionGroupDivider label="Objects" icon={Package} />}

        {/* Objects Sections (Loan Objects, Exits, Condition Reports, Renewals) */}
        {!isCreateMode && orgId && loanId && (
          <ObjectsSection
            orgId={orgId}
            loanId={loanId}
            formData={formData}
            loan={loan}
            isEditing={isEditing}
            isCreateMode={isCreateMode}
            expandedSections={expandedSections}
            lenderContact={lenderContact}
            updateField={updateField}
            toggleSection={toggleSection}
            getSectionOrder={getSectionOrder}
          />
        )}

        {/* === DOCUMENTATION GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Documentation" icon={FileText} />}

        {/* Documentation Sections (Agreement, Document Location, Contact, Notes, Discussion) */}
        <DocumentationSection
          orgId={orgId!}
          loanId={loanId}
          formData={formData}
          isEditing={isEditing}
          isCreateMode={isCreateMode}
          expandedSections={expandedSections}
          updateField={updateField}
          toggleSection={toggleSection}
          getSectionOrder={getSectionOrder}
        />

        {/* === MONITORING GROUP === */}
        {useNewLayout && !isCreateMode && <SectionGroupDivider label="Monitoring" icon={Activity} />}

        {!isCreateMode && orgId && loanId && (
          <MonitoringSection
            organizationId={orgId}
            loanId={loanId}
            isExpanded={expandedSections.monitoring}
            isEditing={isEditing}
            order={getSectionOrder('monitoring')}
            onToggle={() => toggleSection('monitoring')}
          />
        )}

        {/* === CLOSING GROUP === */}
        {useNewLayout && !isCreateMode && <SectionGroupDivider label="Closing" icon={ClipboardCheck} />}

        {!isCreateMode && (
          <ClosingSection
            formData={formData}
            isExpanded={expandedSections.closing}
            isEditing={isEditing}
            order={getSectionOrder('closing')}
            onToggle={() => toggleSection('closing')}
            onUpdateField={updateField}
          />
        )}

        {/* Change History Section - always last */}
        {hasPermission('org.view_audit_logs') && !isCreateMode && orgId && loanId && (
          <WorkspaceSection
            id="history"
            title="Change History"
            icon={<History size={18} />}
            isExpanded={expandedSections.history}
            onToggle={() => toggleSection('history')}
            isEditing={isEditing}
            order={getSectionOrder('history')}
          >
            <RecordAuditHistory
              organizationId={orgId}
              entityType="loan_in"
              entityId={loanId}
            />
          </WorkspaceSection>
        )}

      </div>

      {/* Footer metadata */}
      {!isCreateMode && loan && (
        <div className="mt-8 pt-6 border-t border-lichen text-sm text-archive">
          <p>Created: {formatDateTime(loan.created_at)}</p>
          {loan.updated_at && (
            <p>Last updated: {formatDateTime(loan.updated_at)}</p>
          )}
        </div>
      )}

      {/* Rollback Confirmation Dialog */}
      <RollbackDialog
        isOpen={showRollbackConfirm.isOpen}
        onClose={() => setShowRollbackConfirm(prev => ({ ...prev, isOpen: false }))}
        onConfirm={(reason) => {
          rollbackMutation.mutate({ targetStatus: showRollbackConfirm.targetStatus, reason });
          setShowRollbackConfirm(prev => ({ ...prev, isOpen: false }));
        }}
        entityLabel="Loan"
        targetStatusLabel={showRollbackConfirm.targetStatusLabel}
        isLoading={rollbackMutation.isPending}
      />

      {/* Lender Contact Person Selector */}
      <ContactSelectorSlideOver
        isOpen={showLenderContactSelector}
        onClose={() => setShowLenderContactSelector(false)}
        onSelect={(contactId) => {
          updateField('lender_contact_id', contactId);
          setShowLenderContactSelector(false);
        }}
        organizationId={orgId!}
        title="Select Lender Contact Person"
        subtitle="Search for the contact person at the lending institution."
      />

      {/* Dialogs */}
      <LoanDialogs
        orgId={orgId!}
        loanId={loanId}
        loan={loan}
        formData={formData}
        showDeleteConfirm={showDeleteConfirm}
        setShowDeleteConfirm={setShowDeleteConfirm}
        showLenderSelector={showLenderSelector}
        setShowLenderSelector={setShowLenderSelector}
        showAuthorizerSelector={showAuthorizerSelector}
        setShowAuthorizerSelector={setShowAuthorizerSelector}
        showCreateTask={showCreateTask}
        setShowCreateTask={setShowCreateTask}
        statusAdvancementDialog={statusAdvancementDialog}
        setStatusAdvancementDialog={setStatusAdvancementDialog}
        statusMutation={statusMutation}
        deleteMutation={deleteMutation}
        updateField={updateField}
        validateStatusChange={validateStatusChange}
      />

      <GenerateReportSlideOver
        isOpen={showReportSlideOver}
        onClose={() => setShowReportSlideOver(false)}
        contextType="record"
        contextParams={{ record_id: loanId, record_type: 'loans_in' }}
        recordType="loans_in"
      />
    </div>
  );

  // Return with new layout wrapper for existing loans
  if (useNewLayout && loan) {
    return (
      <WorkspaceErrorBoundary
        backUrl={`/organizations/${orgId}/collections/loans-in`}
        backLabel="Back to Loans In"
      >
      <RecordDetailPageWrapper
        object={null}
        media={loanMedia}
        showRail={false}
        sectionIds={ALL_SECTION_IDS}
        sectionGroups={LOAN_IN_SECTION_GROUPS}
        sectionData={sectionData}
        permissions={{
          canCreateTask: true,
          canViewHistory: true,
          canDelete: true,
          canGenerateReport: true,
        }}
        callbacks={{
          onDelete: handleDelete,
          onCreateTask: () => setShowCreateTask(true),
          onGenerateReport: () => setShowReportSlideOver(true),
        }}
        isEditing={isEditing}
        onSectionNavigate={handleEnterEditMode}
        entryLocations={entryLocations}
        pageType="loan-in"
        enabled={true}
        showHeader={true}
        title={displayTitle}
        objectNumber={displayNumber}
        subtitle={lenderContact?.name ? `Lender: ${lenderContact.name}` : undefined}
        backUrl={`/organizations/${orgId}/collections/loans-in`}
        backLabel="Back to Loans In"
        lastSaved={lastSaved}
      >
        {pageContent}
      </RecordDetailPageWrapper>
      </WorkspaceErrorBoundary>
    );
  }

  return (
    <WorkspaceErrorBoundary
      backUrl={orgId ? `/organizations/${orgId}/collections/loans-in` : undefined}
      backLabel="Back to Loans In"
    >
      {pageContent}
    </WorkspaceErrorBoundary>
  );
}
