/**
 * ObjectEntryWorkspacePage
 *
 * Main page component for viewing and editing Object Entry records.
 * This file coordinates the section components and manages page-level state.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { formatDateShort, formatDateTime } from '@/lib/formatters';
import {
  Package,
  CheckCircle,
  ArrowDownToLine,
  FileDown,
  Loader2,
  History,
  ClipboardList,
  FileText,
  Link2,
  MessageSquare,
  Truck,
} from 'lucide-react';
import ConfirmDialog from '../../../components/ConfirmDialog';
import {
  WorkspaceHeader,
  WorkspaceErrorBoundary,
  WorkspaceSection,
  SectionGroupDivider,
  RecordAuditHistory,
  ReadOnlyBanner,
} from '../../../components/workspace';
import { cn } from '../../../lib/utils';
import { useWorkspacePage } from '../../../hooks/useWorkspacePage';
import { useAuth } from '../../../hooks/useAuth';
import type { WithFieldAccess } from '../../../lib/schemas/entities';
import { useLookupValues } from '../../../hooks/useLookupValues';
import { CreateTaskSlideOver } from '../../../components/work/CreateTaskSlideOver';
import { GenerateReportSlideOver } from '../../../components/reports/GenerateReportSlideOver';
import { RecordDiscussionTab } from '../../../components/RecordDiscussionTab';
import { RecordDetailPageWrapper, useSectionOrder, SectionOrderProvider } from '../../../components/record-detail';
import { StatusAdvancementDialog } from '../../../components/collections/StatusAdvancementDialog';
import { EntryRequirementsCard } from '../../../components/collections/EntryRequirementsCard';
import { AdvanceWithExceptionDialog } from '../../../components/collections/AdvanceWithExceptionDialog';
import { ChangeStatusDropdown } from '../../../components/collections/ChangeStatusDropdown';
import { useProcedureRequirements } from '../../../hooks/useProcedureRequirements';
import { canTransitionToProcedure } from '../../../lib/procedureComplianceUtils';

// Section components
import { EntryInfoSection } from './EntryInfoSection';
import { DepositorSection } from './DepositorSection';
import { ObjectsSection } from './ObjectsSection';
import { DurationSection } from './DurationSection';
import { InsuranceSection } from './InsuranceSection';
import { AuthorizationSection } from './AuthorizationSection';
import { TermsSection } from './TermsSection';
import { NotesSection } from './NotesSection';
import { LinkedRecordsSection } from './LinkedRecordsSection';
import { ShipmentLinker } from '../../../components/collections/ShipmentLinker';

// Hooks and utilities
import {
  useEntryForm,
  useSectionState,
  useLinkedRecords,
  useEntryAllMedia,
  useEntryContacts,
  usePdfGeneration,
  useProcedureCompliance,

} from './hooks';
import {
  STATUS_CONFIG,
  WORKFLOW_STEPS,
  ENTRY_SECTION_GROUPS,
  ALL_SECTION_IDS,
  getExcludedSections,
} from './constants';
import type {
  StatusAdvancementDialogState,
  ExceptionDialogState,
  BlockingDialogState,
} from './types';
import { MadronaLoader } from '../../../components/ui/MadronaLoader';

/**
 * Outer wrapper that provides section order context.
 */
export default function ObjectEntryWorkspacePage() {
  return (
    <SectionOrderProvider>
      <ObjectEntryWorkspacePageContent />
    </SectionOrderProvider>
  );
}

/**
 * Inner component with all the logic and hooks.
 */
function ObjectEntryWorkspacePageContent() {
  const { orgId, entryId } = useParams<{ orgId: string; entryId?: string }>();
  const isCreateMode = !entryId;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasAppAccess } = useAuth();
  const hasMediaApp = hasAppAccess('media');
  const { getLookup } = useLookupValues({ context: 'entries' });

  // Section order from context
  const [sectionOrder] = useSectionOrder();

  // procedure requirements from API
  const { requirementGroups, statusOrder, enforcementEnabled } = useProcedureRequirements('object_entry', orgId);

  // Form state and mutations
  const {
    formData,
    updateField,
    hasUnsavedChanges,
    saveStatus,
    lastSaved,
    entry,
    isLoading,
    error,
    triggerSave,
    handleCreate,
    deleteMutation,
    statusMutation,
  } = useEntryForm(orgId, entryId, isCreateMode);

  const wp = useWorkspacePage({
    entityType: 'object_entry',
    entityId: entryId,
    entityLabel: entry?.entry_number,
    orgId,
    editPermission: 'entries.edit',
    restrictedFields: (entry as WithFieldAccess | undefined)?._restricted_fields,
  });
  const { isEditing, setIsEditing, useNewLayout, canEdit, isRestricted, hasPermission, dialogs } = wp;

  // Section state
  const {
    expandedSections,
    setExpandedSections,
    getSectionOrder,
    lowerAllSections,
    raiseSection,
    toggleSection: toggleSectionBase,
    handleEnterEditMode: handleEnterEditModeBase,
  } = useSectionState(sectionOrder);

  // Enter edit mode helper
  const enterEditMode = useCallback(() => {
    if (!isEditing && !isCreateMode && canEdit) {
      setIsEditing(true);
      const basePath = `/organizations/${orgId}/collections/entries/${entryId}`;
      window.history.replaceState(null, '', `${basePath}/edit`);
    }
  }, [isEditing, isCreateMode, canEdit, orgId, entryId]);

  // Wrap toggleSection to enter edit mode when expanding or clicking an already-expanded section
  const toggleSection = useCallback((sectionId: string) => {
    if (expandedSections[sectionId] && !isEditing) {
      // Already expanded + not editing → enter edit mode, collapse others
      setExpandedSections(prev => {
        const newState: Record<string, boolean> = {};
        Object.keys(prev).forEach(key => { newState[key] = key === sectionId; });
        return newState;
      });
      raiseSection(sectionId);
      enterEditMode();
    } else {
      toggleSectionBase(sectionId);
      // Expanding a collapsed section should also enter edit mode
      if (!expandedSections[sectionId]) {
        enterEditMode();
      }
    }
  }, [expandedSections, isEditing, toggleSectionBase, raiseSection, setExpandedSections, enterEditMode]);

  // Wrap handleEnterEditMode to also enter edit mode (called from sidebar nav)
  const handleEnterEditMode = useCallback((sectionId: string) => {
    handleEnterEditModeBase(sectionId);
    enterEditMode();
  }, [handleEnterEditModeBase, enterEditMode]);

  // Linked records
  const { linkedAcquisition, linkedLoan, linkedExit } = useLinkedRecords(orgId, entryId, isCreateMode);

  // Aggregated media across items — powers the right-rail slideshow only.
  // Per-item CRUD happens inside each ItemDetailPanel in ObjectsSection.
  const { allMedia: entryMedia } = useEntryAllMedia(orgId, entryId, isCreateMode);

  // Contacts
  const { depositorContact } = useEntryContacts(orgId!, formData);

  // PDF generation
  const { generatePdfMutation } = usePdfGeneration(orgId, entryId, entry?.entry_number);

  // procedure compliance
  const { sectionCompletions, validateStatusChange, handleSectionNavigate } = useProcedureCompliance(
    formData,
    entry?.entry_number,
    entry?.status || 'pending',
    requirementGroups,
    statusOrder,
    entry?.items as Array<Record<string, unknown>> | undefined,
  );

  // Dialog states
  const [statusAdvancementDialog, setStatusAdvancementDialog] = useState<StatusAdvancementDialogState>({
    isOpen: false,
    targetStatus: '',
    targetStatusLabel: '',
  });
  const [exceptionDialog, setExceptionDialog] = useState<ExceptionDialogState>({
    isOpen: false,
    targetStatus: 'pending',
    targetStatusLabel: '',
    blockingRequirements: [],
  });
  const [blockingDialog, setBlockingDialog] = useState<BlockingDialogState>({
    isOpen: false,
    actionLabel: '',
    blockerLabel: '',
    sectionId: '',
    fieldPath: undefined,
  });
  const [requirementsCardExpanded, _setRequirementsCardExpanded] = useState(false);
  const [showReportSlideOver, setShowReportSlideOver] = useState(false);

  // Effective reason
  const effectiveReason = formData.reason || entry?.reason;

  // Check if entry is linked to its expected downstream record.
  // Procedure: any entry can result in a return (Object Exit), so a linked
  // exit always counts. Acquisition and Loan In also complete their paths.
  const hasLinkedRecord = useMemo(() => {
    if (linkedExit) return true;
    if (!effectiveReason) return false;
    if (effectiveReason === 'gift_offer' || effectiveReason === 'purchase_consideration') {
      return !!linkedAcquisition;
    }
    if (effectiveReason === 'loan_consideration') return !!linkedLoan;
    return false;
  }, [effectiveReason, linkedAcquisition, linkedLoan, linkedExit]);

  // Workflow step index
  const getStepIndex = (status: string, hasLinked: boolean) => {
    if (hasLinked) return 3;
    if (status === 'pending') return 0;
    if (status === 'received') return 1;
    if (status === 'processed') return 2;
    if (status === 'returned' || status === 'acquired') return 3;
    return 0;
  };

  // Handle status advancement
  const handleStatusAdvancement = useCallback((targetStatus: string, targetStatusLabel: string) => {
    const record: Record<string, unknown> = {
      ...formData,
      entry_number: entry?.entry_number || '',
    };
    const { allowed } = canTransitionToProcedure(
      requirementGroups,
      record,
      entry?.status || 'pending',
      targetStatus,
      statusOrder,
      enforcementEnabled
    );

    if (allowed) {
      statusMutation.mutate(targetStatus);
    } else {
      setStatusAdvancementDialog({
        isOpen: true,
        targetStatus,
        targetStatusLabel,
      });
    }
  }, [formData, entry?.entry_number, entry?.status, requirementGroups, statusOrder, statusMutation]);

  // Handle advancing with exception
  const handleAdvanceWithException = useCallback((_reason: string, _bypassedRequirementIds: string[]) => {
    statusMutation.mutate(exceptionDialog.targetStatus);
    setExceptionDialog(prev => ({ ...prev, isOpen: false }));
  }, [statusMutation, exceptionDialog.targetStatus]);

  // Navigate to section from requirements card
  const handleRequirementsSectionNavigate = useCallback((sectionId: string, fieldPath?: string) => {
    handleSectionNavigate(sectionId, fieldPath, setExpandedSections);
  }, [handleSectionNavigate, setExpandedSections]);

  // Toggle mode
  const handleToggleMode = useCallback(() => {
    const newMode = !isEditing;
    setIsEditing(newMode);

    const basePath = `/organizations/${orgId}/collections/entries/${entryId}`;
    const newPath = newMode ? `${basePath}/edit` : basePath;
    window.history.replaceState(null, '', newPath);

    if (!newMode) {
      lowerAllSections();
    }

    // Save pending changes when exiting edit mode (mutation onSuccess handles invalidation)
    if (!newMode && hasUnsavedChanges) {
      triggerSave();
    }
  }, [isEditing, orgId, entryId, hasUnsavedChanges, triggerSave, lowerAllSections]);

  // Handle delete
  const handleDelete = () => {
    dialogs.setShowDeleteConfirm(true);
  };

  // Handle create submission
  const handleCreateSubmit = useCallback(async () => {
    const result = await handleCreate();
    if (result?.entry_id) {
      navigate(`/organizations/${orgId}/collections/entries/${result.entry_id}`);
    }
  }, [handleCreate, navigate, orgId]);

  // Warn about unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // Build sectionData for nav indicators
  const sectionData = useMemo(() => ({
    entry: {
      entry_date: formData.entry_date,
      reason: formData.reason,
      receipt_reference: formData.receipt_reference,
    },
    depositor: {
      depositor_id: formData.depositor_id,
      current_owner_id: formData.current_owner_id,
    },
    objects: {
      objects_description: formData.objects_description,
    },
    location: {
      location_id: formData.location_id,
    },
    media: {
      count: entryMedia.length,
    },
    duration: {
      expected_duration: formData.expected_duration,
      expected_return_date: formData.expected_return_date,
    },
    insurance: {
      insurance_value: formData.insurance_value,
      insurance_currency: formData.insurance_currency,
      insurance_note: formData.insurance_note,
    },
    terms: {
      terms_accepted: formData.terms_accepted,
      terms_accepted_date: formData.terms_accepted_date,
    },
    notes: {
      entry_note: formData.entry_note,
      conditions: formData.conditions,
    },
    acquisition: linkedAcquisition ? { id: linkedAcquisition.acquisition_id } : null,
    loan_in: linkedLoan ? { id: linkedLoan.loan_in_id } : null,
    exit: linkedExit ? { id: linkedExit.exit_id } : null,
  }), [formData, entryMedia.length, linkedAcquisition, linkedLoan, linkedExit]);

  // Dynamic section IDs
  const sectionIds = useMemo(() => {
    const excluded = getExcludedSections(effectiveReason ?? '');
    return ALL_SECTION_IDS.filter(id => !excluded.includes(id));
  }, [effectiveReason]);

  // Loading state
  if (!isCreateMode && isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <MadronaLoader label="Loading…" />
      </div>
    );
  }

  // Error state
  if (!isCreateMode && (error || !entry)) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <div className="text-center py-12">
          <Package size={48} className="mx-auto text-archive mb-4" />
          <h3 className="text-lg font-serif font-medium text-forest mb-2">
            Entry not found
          </h3>
          <p className="text-accessible-gray mb-4">
            {error ? (error as Error).message : 'The entry record could not be loaded.'}
          </p>
          <Link
            to={`/organizations/${orgId}/collections/entries`}
            className="text-bark hover:text-copper-dark"
          >
            Back to Object Entries
          </Link>
        </div>
      </div>
    );
  }

  const statusConfig = !isCreateMode && entry ? STATUS_CONFIG[entry.status] || STATUS_CONFIG.pending : STATUS_CONFIG.pending;
  const StatusIcon = statusConfig.icon;
  const displayTitle = isCreateMode ? 'New Object Entry' : 'Object Entry';
  const displayNumber = isCreateMode ? '' : (entry?.entry_number || '');

  // Page content
  const pageContent = (
    <div className={cn(!useNewLayout && 'max-w-5xl mx-auto px-6 pb-12')}>
      {/* Header - only show old header when not using new layout */}
      {!useNewLayout && (
        <WorkspaceHeader
          backUrl={`/organizations/${orgId}/collections/entries`}
          backText="Back to Object Entries"
          title={displayTitle}
          objectNumber={displayNumber}
          creator={isCreateMode ? undefined : entry?.depositor_name}
          date={!isCreateMode && entry?.entry_date ? formatDateShort(entry.entry_date) : undefined}
          isEditing={isEditing}
          onToggleMode={isCreateMode ? undefined : handleToggleMode}
          saveStatus={saveStatus}
          lastSaved={lastSaved}
          hasUnsavedChanges={hasUnsavedChanges}
          showCreateButton={isCreateMode}
          createButtonText="Create Entry"
          onSave={isCreateMode ? handleCreateSubmit : undefined}
        />
      )}

      {/* Workflow Progress Indicator */}
      {!isCreateMode && entry && (
        <div className="mb-6 p-4 bg-stone/30 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-ink">Entry Workflow</span>
            <span className="text-xs text-archive">
              {(() => {
                const isAcquisitionReason =
                  effectiveReason === 'gift_offer' || effectiveReason === 'purchase_consideration';
                const isLoanReason = effectiveReason === 'loan_consideration';
                if (entry.status === 'processed' && !hasLinkedRecord) {
                  if (isAcquisitionReason) return 'Processed - link to acquisition below';
                  if (isLoanReason) return 'Processed - link to loan in below';
                  return 'Processed - link to exit below';
                }
                if (entry.status === 'received') return 'Mark as processed when examination is complete';
                if (entry.status === 'pending') return 'Mark as received when objects arrive';
                if (hasLinkedRecord) {
                  if (linkedAcquisition) return 'Linked to acquisition';
                  if (linkedLoan) return 'Linked to loan in';
                  if (linkedExit) return 'Linked to exit record';
                }
                return '';
              })()}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {WORKFLOW_STEPS.map((step, index) => {
              const currentIndex = getStepIndex(entry.status, hasLinkedRecord);
              const isComplete = index < currentIndex;
              const isCurrent = index === currentIndex;
              const isLinkedStep = step.key === 'linked';

              const getLinkedLabel = () => {
                if (linkedAcquisition) return 'Acquisition';
                if (linkedLoan) return 'Loan In';
                if (linkedExit) return 'Exit';
                return 'Linked';
              };

              return (
                <div key={step.key} className="flex items-center flex-1">
                  <div className={cn(
                    'flex items-center justify-center w-8 h-8 rounded-full text-xs font-medium transition-colors',
                    isComplete
                      ? 'bg-forest text-parchment'
                      : isCurrent
                      ? isLinkedStep && hasLinkedRecord
                        ? 'bg-semantic-success text-parchment'
                        : 'bg-copper text-parchment'
                      : 'bg-stone text-archive'
                  )}>
                    {isComplete ? (
                      <CheckCircle size={16} />
                    ) : (
                      index + 1
                    )}
                  </div>
                  <span className={cn(
                    'ml-2 text-xs font-medium hidden sm:inline',
                    isComplete || isCurrent ? 'text-ink' : 'text-archive'
                  )}>
                    {isLinkedStep && hasLinkedRecord ? getLinkedLabel() : step.label}
                  </span>
                  {index < WORKFLOW_STEPS.length - 1 && (
                    <div className={cn(
                      'flex-1 h-0.5 mx-2',
                      isComplete ? 'bg-forest' : 'bg-stone'
                    )} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Entry Requirements Card */}
      {!isCreateMode && entry && (
        <EntryRequirementsCard
          entry={{
            ...formData,
            entry_number: entry.entry_number || '',
            media_count: entryMedia.length,
          }}
          currentStatus={entry.status as string}
          requirementGroups={requirementGroups}
          statusOrder={statusOrder}
          onSectionNavigate={handleRequirementsSectionNavigate}
          forceExpanded={requirementsCardExpanded}
        />
      )}

      {/* Status Bar */}
      {!isCreateMode && entry && (
        <div className="flex items-center gap-4 mb-6">
          <span className={cn('inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium', statusConfig.color)}>
            <StatusIcon size={16} />
            {statusConfig.label}
          </span>
          {(entry.items?.length ?? 0) > 0 && (
            <span className="text-sm text-archive">
              {entry.items?.length} {entry.items?.length === 1 ? 'item' : 'items'}
            </span>
          )}
          <button
            onClick={() => generatePdfMutation.mutate()}
            className="btn btn-ghost text-sm"
            disabled={generatePdfMutation.isPending}
            title="Generate Receipt"
          >
            {generatePdfMutation.isPending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <FileDown size={16} />
            )}
          </button>

          <div className="flex-1" />
          {/* Primary forward action */}
          {entry.status === 'pending' && (
            <button
              onClick={() => handleStatusAdvancement('received', 'Received')}
              className="btn btn-primary text-sm"
              disabled={statusMutation.isPending}
            >
              <ArrowDownToLine size={16} className="mr-1.5" />
              Mark Received
            </button>
          )}
          {entry.status === 'received' && (
            <button
              onClick={() => handleStatusAdvancement('processed', 'Processed')}
              className="btn btn-primary text-sm"
              disabled={statusMutation.isPending}
            >
              <CheckCircle size={16} className="mr-1.5" />
              Mark Processed
            </button>
          )}
          {/* Change Status dropdown — any status */}
          <ChangeStatusDropdown
            currentStatus={entry.status}
            allStatuses={[
              { key: 'pending', label: 'Pending' },
              { key: 'received', label: 'Received' },
              { key: 'processing', label: 'Processing' },
              { key: 'processed', label: 'Processed' },
              { key: 'returned', label: 'Returned' },
              { key: 'acquired', label: 'Acquired' },
            ]}
            statusConfig={STATUS_CONFIG}
            onStatusChange={(target) => statusMutation.mutate(target)}
            isPending={statusMutation.isPending}
            sideStatuses={['returned']}
          />
        </div>
      )}

      {/* Read-only indicator */}
      <ReadOnlyBanner visible={!isCreateMode && !canEdit} />

      {/* Sections */}
      <div className="flex flex-col gap-4">
        {/* === OVERVIEW GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Overview" icon={ClipboardList} />}

        <EntryInfoSection
          formData={formData}
          updateField={updateField}
          isExpanded={expandedSections.entry}
          onToggle={() => toggleSection('entry')}
          isEditing={isEditing}
          isCreateMode={isCreateMode}
          getSectionOrder={getSectionOrder}
          sectionCompletion={sectionCompletions.entry}
          entryReasonOptions={getLookup('entry_reason')}
          orgId={orgId!}
        />

        <DepositorSection
          formData={formData}
          updateField={updateField}
          isExpanded={expandedSections.depositor}
          onToggle={() => toggleSection('depositor')}
          isEditing={isEditing}
          isCreateMode={isCreateMode}
          getSectionOrder={getSectionOrder}
          sectionCompletion={sectionCompletions.depositor}
          orgId={orgId!}
          isRestricted={isRestricted}
        />

        <ObjectsSection
          formData={formData}
          updateField={updateField}
          isExpanded={expandedSections.objects}
          onToggle={() => toggleSection('objects')}
          isEditing={isEditing}
          isCreateMode={isCreateMode}
          getSectionOrder={getSectionOrder}
          sectionCompletion={sectionCompletions.objects}
          orgId={orgId!}
          entryId={entryId}
          entry={entry}
          hasMediaApp={hasMediaApp}
        />

        {/* === DETAILS GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Details" icon={FileText} />}

        <DurationSection
          formData={formData}
          updateField={updateField}
          isExpanded={expandedSections.duration}
          onToggle={() => toggleSection('duration')}
          isEditing={isEditing}
          isCreateMode={isCreateMode}
          getSectionOrder={getSectionOrder}
          durationOptions={getLookup('entry_duration')}
          isRestricted={isRestricted}
        />

        <InsuranceSection
          formData={formData}
          updateField={updateField}
          isExpanded={expandedSections.insurance}
          onToggle={() => toggleSection('insurance')}
          isEditing={isEditing}
          isCreateMode={isCreateMode}
          getSectionOrder={getSectionOrder}
          currencyOptions={getLookup('currency')}
          isRestricted={isRestricted}
        />

        <AuthorizationSection
          formData={formData}
          updateField={updateField}
          isExpanded={expandedSections.authorization}
          onToggle={() => toggleSection('authorization')}
          isEditing={isEditing}
          isCreateMode={isCreateMode}
          getSectionOrder={getSectionOrder}
          orgId={orgId!}
        />

        <TermsSection
          formData={formData}
          updateField={updateField}
          isExpanded={expandedSections['terms-acceptance']}
          onToggle={() => toggleSection('terms-acceptance')}
          isEditing={isEditing}
          isCreateMode={isCreateMode}
          getSectionOrder={getSectionOrder}
          sectionCompletion={sectionCompletions['terms-acceptance']}
          orgId={orgId!}
          entryId={entryId}
          onGenerateReceipt={() => generatePdfMutation.mutate()}
          isGeneratingReceipt={generatePdfMutation.isPending}
        />

        <NotesSection
          formData={formData}
          updateField={updateField}
          isExpanded={expandedSections.notes}
          onToggle={() => toggleSection('notes')}
          isEditing={isEditing}
          isCreateMode={isCreateMode}
          getSectionOrder={getSectionOrder}
        />

        {!isCreateMode && entryId && (
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
              procedureType="object_entry"
              procedureId={entryId}
              isEditing={isEditing}
            />
          </WorkspaceSection>
        )}

        {/* === LINKED RECORDS GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Linked Records" icon={Link2} />}

        <LinkedRecordsSection
          orgId={orgId}
          entryId={entryId}
          effectiveReason={effectiveReason || ''}
          linkedAcquisition={linkedAcquisition}
          linkedLoan={linkedLoan}
          linkedExit={linkedExit}
          expandedSections={expandedSections}
          onToggle={toggleSection}
          isEditing={isEditing}
          isCreateMode={isCreateMode}
          getSectionOrder={getSectionOrder}
          depositorName={entry?.depositor_name ?? undefined}
          onLinkChange={() => queryClient.invalidateQueries({ queryKey: ['object-entry', orgId, entryId] })}
        />
      </div>

      {/* Discussion Section */}
      {!isCreateMode && orgId && entryId && (
        <div className="mt-4">
          <WorkspaceSection
            id="discussion"
            title="Discussion"
            icon={<MessageSquare size={18} />}
            isExpanded={expandedSections.discussion}
            onToggle={() => toggleSection('discussion')}
            isEditing={isEditing}
          >
            <RecordDiscussionTab
              entityType="object_entry"
              entityId={entryId}
              organizationId={orgId}
            />
          </WorkspaceSection>
        </div>
      )}

      {/* Change History Section - always last */}
      {hasPermission('org.view_audit_logs') && !isCreateMode && orgId && entryId && (
        <div className="mt-4">
          <WorkspaceSection
            id="history"
            title="Change History"
            icon={<History size={18} />}
            isExpanded={expandedSections.history}
            onToggle={() => toggleSection('history')}
            isEditing={isEditing}
          >
            <RecordAuditHistory
              organizationId={orgId}
              entityType="object_entry"
              entityId={entryId}
            />
          </WorkspaceSection>
        </div>
      )}

      {/* Footer metadata */}
      {!isCreateMode && entry && (
        <div className="mt-8 pt-6 border-t border-lichen text-sm text-archive">
          <p>Created: {formatDateTime(entry.created_at)}</p>
          {entry.updated_at && (
            <p>Last updated: {formatDateTime(entry.updated_at)}</p>
          )}
        </div>
      )}

      {/* Dialogs */}
      <ConfirmDialog
        isOpen={dialogs.showDeleteConfirm}
        onClose={() => dialogs.setShowDeleteConfirm(false)}
        onConfirm={() => deleteMutation.mutate()}
        title="Delete Entry Record"
        message={<>Are you sure you want to delete <strong>{displayNumber || 'this entry record'}</strong>? This action cannot be undone.</>}
        confirmText="Delete"
        confirmStyle="danger"
      />

      <StatusAdvancementDialog
        isOpen={statusAdvancementDialog.isOpen}
        onClose={() => setStatusAdvancementDialog(prev => ({ ...prev, isOpen: false }))}
        onConfirm={() => {
          statusMutation.mutate(statusAdvancementDialog.targetStatus);
          setStatusAdvancementDialog(prev => ({ ...prev, isOpen: false }));
        }}
        currentStatus={entry?.status || 'pending'}
        targetStatus={statusAdvancementDialog.targetStatus}
        targetStatusLabel={statusAdvancementDialog.targetStatusLabel}
        validation={validateStatusChange(statusAdvancementDialog.targetStatus)}
        isLoading={statusMutation.isPending}
        onAdvanceWithException={() => {
          const record: Record<string, unknown> = {
            ...formData,
            entry_number: entry?.entry_number || '',
          };
          const { blockingRequirements } = canTransitionToProcedure(
            requirementGroups,
            record,
            entry?.status || 'pending',
            statusAdvancementDialog.targetStatus,
            statusOrder,
            enforcementEnabled
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
        currentStatus={(entry?.status || 'pending') as any}
        targetStatus={exceptionDialog.targetStatus as any}
        targetStatusLabel={exceptionDialog.targetStatusLabel}
        blockingRequirements={exceptionDialog.blockingRequirements}
        isLoading={statusMutation.isPending}
      />

      <ConfirmDialog
        isOpen={blockingDialog.isOpen}
        onClose={() => setBlockingDialog(prev => ({ ...prev, isOpen: false }))}
        onConfirm={() => {
          setBlockingDialog(prev => ({ ...prev, isOpen: false }));
          setTimeout(() => {
            const reqCard = document.querySelector('[data-requirements-card]');
            if (reqCard) {
              reqCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          }, 100);
          setTimeout(() => {
            handleRequirementsSectionNavigate(blockingDialog.sectionId, blockingDialog.fieldPath);
          }, 300);
        }}
        title={`Cannot ${blockingDialog.actionLabel}`}
        message={`"${blockingDialog.blockerLabel}" must be completed before you can proceed with this action.`}
        confirmText="Go to Field"
        cancelText="Dismiss"
      />

      {orgId && entryId && entry && (
        <CreateTaskSlideOver
          isOpen={dialogs.showCreateTask}
          onClose={() => dialogs.setShowCreateTask(false)}
          orgId={orgId}
          initialEntityType={"object_entry" as React.ComponentProps<typeof CreateTaskSlideOver>['initialEntityType']}
          initialEntityId={entryId}
          initialEntityLabel={entry.entry_number || `Entry ${entryId.slice(0, 8)}`}
        />
      )}

      <GenerateReportSlideOver
        isOpen={showReportSlideOver}
        onClose={() => setShowReportSlideOver(false)}
        contextType="record"
        contextParams={{ record_id: entryId, record_type: 'object_entries' }}
        recordType="object_entries"
      />
    </div>
  );

  // Find primary image for the right rail
  const primaryImage = entryMedia.find(m => m.is_primary) || entryMedia[0];
  // Derive entry-level location display from the first item with a location set
  const firstItemWithLocation = entry?.items?.find(i => i.location_id);
  const entryLocationDisplay =
    firstItemWithLocation?.location_path || firstItemWithLocation?.location_name || null;

  if (useNewLayout && entry) {
    return (
      <WorkspaceErrorBoundary
        backUrl={`/organizations/${orgId}/collections/entries`}
        backLabel="Back to Object Entries"
      >
        <RecordDetailPageWrapper
          object={{
            object_id: entry.entry_id,
            // An entry has an entry number, not an object number. It reaches
            // the strip through the objectNumber prop below, labeled by
            // identifierLabel.
            object_number: null,
            object_type: 'Object Entry',
            object_status: entry.status,
            current_location_name: entryLocationDisplay,
            is_on_display: false,
            primary_image_url: primaryImage?.thumbnail_url || primaryImage?.preview_url || null,
          }}
          media={entryMedia.map(m => ({
            media_id: m.media_id,
            filename: m.filename,
            thumbnail_url: m.thumbnail_url ?? undefined,
            url: m.preview_url ?? undefined,
            is_primary: m.is_primary,
            download_access: m.download_access,
          }))}
          showRail={entryMedia.length > 0}
          sectionIds={sectionIds}
          sectionGroups={ENTRY_SECTION_GROUPS}
          sectionData={sectionData}
          permissions={{
            canCreateTask: true,
            canViewHistory: true,
            canDelete: true,
            canGenerateReport: true,
            canDownloadMedia: hasPermission('media.view'),
          }}
          callbacks={{
            onDelete: handleDelete,
            onCreateTask: () => dialogs.setShowCreateTask(true),
            onGenerateReport: () => setShowReportSlideOver(true),
          }}
          isEditing={isEditing}
          onSectionNavigate={handleEnterEditMode}
          pageType="object-entry"
          enabled={true}
          showHeader={true}
          title={displayTitle}
          objectNumber={displayNumber}
          identifierLabel="Entry #"
          // Rights attach to the objects inside an entry, not to the entry.
          showRights={false}
          subtitle={(() => {
            // Procedure: surface the linked Object Exit reference next to the
            // depositor when the entry is returned, so the Exit number is
            // visible at a glance without drilling into the linked records.
            const depositor =
              depositorContact?.name || entry.depositor_name || undefined;
            const exitNumber = (linkedExit as { exit_number?: string } | undefined)?.exit_number;
            const parts = [
              depositor ? `Depositor: ${depositor}` : undefined,
              exitNumber ? `Exit: ${exitNumber}` : undefined,
            ].filter(Boolean);
            return parts.length > 0 ? parts.join(' · ') : undefined;
          })()}
          backUrl={`/organizations/${orgId}/collections/entries`}
          backLabel="Back to Object Entries"
          lastSaved={lastSaved}
        >
          {pageContent}
        </RecordDetailPageWrapper>
      </WorkspaceErrorBoundary>
    );
  }

  return (
    <WorkspaceErrorBoundary
      backUrl={orgId ? `/organizations/${orgId}/collections/entries` : undefined}
      backLabel="Back to Object Entries"
    >
      {pageContent}
    </WorkspaceErrorBoundary>
  );
}
