import { useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatDateShort, formatDateTime } from '@/lib/formatters';
import { useAuth } from '../../../hooks/useAuth';
import { usePermissions } from '../../../hooks/usePermissions';
import {
  Archive,
  CheckCircle,
  Gift,
  Briefcase,
  User,
  DollarSign,
  Scale,
  Receipt,
  Package,
  Stamp,
  History,
  MessageSquare,
  Search,
  X,
  ShieldCheck,
  ClipboardList,
} from 'lucide-react';
import {
  WorkspaceHeader,
  WorkspaceErrorBoundary,
  WorkspaceSection,
  SectionGroupDivider,
  EditableField,
  EditableSelect,
  EditableCheckbox,
  RecordAuditHistory,
  ReadOnlyBanner,
  PendingApprovalBanner,
} from '../../../components/workspace';
import { ContactSelectorSlideOver } from '../../../components/collections/ConstituentSelectorSlideOver';
import { SignedDocumentSlot } from '../../../components/collections/SignedDocumentSlot';
import { useConstituentSelector } from '../../../hooks/useContactSelector';
import { getContact } from '../../../lib/api';
import { RecordDetailPageWrapper, SectionOrderProvider } from '../../../components/record-detail';
import { ProcedureRequirementsCard } from '../../../components/collections/ProcedureRequirementsCard';
import { StatusAdvancementDialog } from '../../../components/collections/StatusAdvancementDialog';
import { AdvanceWithExceptionDialog } from '../../../components/collections/AdvanceWithExceptionDialog';
import { ChangeStatusDropdown } from '../../../components/collections/ChangeStatusDropdown';
import { useProcedureRequirements } from '../../../hooks/useProcedureRequirements';
import { canTransitionToProcedure, computeProcedureCompliance } from '../../../lib/procedureComplianceUtils';
import type { RequirementResult } from '../../../lib/procedureComplianceUtils';
import { AcquisitionObjectLinker } from '../../../components/collections/AcquisitionObjectLinker';
import { AcquisitionEntryLinker } from '../../../components/collections/AcquisitionEntryLinker';
import { CreateTaskSlideOver } from '../../../components/work/CreateTaskSlideOver';
import { GenerateReportSlideOver } from '../../../components/reports/GenerateReportSlideOver';
import { RecordDiscussionTab } from '../../../components/RecordDiscussionTab';
import { useLookupValues } from '../../../hooks/useLookupValues';
import { useWorkspacePage } from '../../../hooks/useWorkspacePage';
import ConfirmDialog from '../../../components/ConfirmDialog';
import RollbackDialog from '../../../components/RollbackDialog';
import { cn } from '../../../lib/utils';

import { useAcquisitionForm, useSectionState } from './hooks';
import { STATUS_CONFIG, METHOD_ICONS, WORKFLOW_STEPS, getStepIndex } from './constants';
import {
  ACQUISITION_SECTION_GROUPS,
  ALL_SECTION_IDS,
} from './types';
import { MadronaLoader } from '../../../components/ui/MadronaLoader';

/**
 * Outer wrapper that provides section order context.
 */
export default function AcquisitionWorkspacePage() {
  return (
    <SectionOrderProvider>
      <AcquisitionWorkspacePageContent />
    </SectionOrderProvider>
  );
}

function AcquisitionWorkspacePageContent() {
  const { orgId, acquisitionId } = useParams<{ orgId: string; acquisitionId?: string }>();
  const { requirementGroups, statusOrder, enforcementEnabled } = useProcedureRequirements('acquisition', orgId);
  const isCreateMode = !acquisitionId;
  const { getLookup, getLabel } = useLookupValues({ context: 'acquisitions' });

  const [showReportSlideOver, setShowReportSlideOver] = useState(false);

  const form = useAcquisitionForm(orgId, acquisitionId, isCreateMode);

  const {
    formData,
    updateField,
    hasUnsavedChanges,
    saveStatus,
    lastSaved,
    acquisition,
    isLoading,
    error,
    linkedEntry,
    queryClient,
    triggerSave,
    handleCreate,
    statusMutation,
    deleteMutation,
    rollbackMutation,
  } = form;

  // Source contact selector
  const sourceSelector = useConstituentSelector();

  const { data: sourceContact } = useQuery({
    queryKey: ['contact', orgId, formData.source_id],
    queryFn: () => getContact(orgId!, formData.source_id),
    enabled: !!orgId && !!formData.source_id,
  });


  // pending_approval records are read-only unless you're the requester or an approver
  const { user } = useAuth();
  const { hasPermission: checkPerm } = usePermissions();
  const isPendingApproval = acquisition?.status === 'pending_approval';
  const isRequester = isPendingApproval && acquisition?.created_by === user?.user_id;
  const isApprover = isPendingApproval && checkPerm('acquisitions.approve');

  const wp = useWorkspacePage({
    entityType: 'acquisition',
    entityId: acquisitionId,
    entityLabel: acquisition?.acquisition_number,
    orgId,
    editPermission: 'acquisitions.edit',
    restrictedFields: acquisition?._restricted_fields,
    canEdit: isPendingApproval ? (isRequester || isApprover) : undefined,
  });
  const { isEditing, setIsEditing, useNewLayout, canEdit, isRestricted, hasPermission, dialogs } = wp;

  // Status advancement dialog state
  const [statusDialog, setStatusDialog] = useState<{
    isOpen: boolean; targetStatus: string; targetStatusLabel: string;
  }>({ isOpen: false, targetStatus: '', targetStatusLabel: '' });

  const [exceptionDialog, setExceptionDialog] = useState<{
    isOpen: boolean; targetStatus: string; targetStatusLabel: string;
    blockingRequirements: RequirementResult[];
  }>({ isOpen: false, targetStatus: 'proposed', targetStatusLabel: '', blockingRequirements: [] });

  const [showRollbackConfirm, setShowRollbackConfirm] = useState<{
    isOpen: boolean; targetStatus: string; targetStatusLabel: string;
  }>({ isOpen: false, targetStatus: '', targetStatusLabel: '' });

  const handleStatusAdvancement = useCallback((targetStatus: string, targetStatusLabel: string) => {
    const record: Record<string, unknown> = {
      ...formData,
      acquisition_number: acquisition?.acquisition_number || '',
    };
    const { allowed } = canTransitionToProcedure(
      requirementGroups,
      record,
      acquisition?.status || 'proposed',
      targetStatus,
      statusOrder,
      enforcementEnabled
    );

    if (allowed) {
      statusMutation.mutate(targetStatus as 'proposed' | 'approved' | 'completed' | 'cancelled');
    } else {
      setStatusDialog({ isOpen: true, targetStatus, targetStatusLabel });
    }
  }, [formData, acquisition?.acquisition_number, acquisition?.status, requirementGroups, statusOrder, statusMutation]);

  const validateStatusChange = useCallback((targetStatus: string) => {
    const record: Record<string, unknown> = {
      ...formData,
      acquisition_number: acquisition?.acquisition_number || '',
    };
    const compliance = computeProcedureCompliance(
      requirementGroups,
      record,
      acquisition?.status || 'proposed',
      statusOrder,
      targetStatus
    );
    return {
      valid: compliance.blockingMissing.length === 0,
      errors: compliance.blockingMissing.map(r => `${r.requirement.label} is required`),
      warnings: compliance.recommendedMissing.map(r => `${r.requirement.label} is recommended`),
    };
  }, [formData, acquisition?.acquisition_number, acquisition?.status, requirementGroups, statusOrder]);

  const sectionState = useSectionState({
    orgId,
    acquisitionId,
    isCreateMode,
    isEditing,
    setIsEditing,
    canEdit,
    hasUnsavedChanges,
    performSave: triggerSave,
    queryClient,
  });

  const {
    expandedSections,
    getSectionOrder,
    toggleSection,
    handleToggleMode,
    handleEnterEditMode,
  } = sectionState;

  // Compute sectionData for nav completeness indicators
  const sectionData: Record<string, unknown> = {
    acquisition: {
      acquisition_method: formData.acquisition_method,
      acquisition_date: formData.acquisition_date,
      objects_count: formData.objects_count,
    },
    source: {
      source_id: formData.source_id,
      source_type: formData.source_type,
    },
    objects: acquisition?.acquisition_id ? { linked: true } : {},
    financial: {
      cost: formData.cost,
      funding_source: formData.funding_source,
      appraised_value: formData.appraised_value,
    },
    legal: {
      legal_status: formData.legal_status,
      credit_line: formData.credit_line,
      provenance_verified: formData.provenance_verified || undefined,
    },
    boardApproval: {
      board_approval_required: formData.board_approval_required || undefined,
      board_approval_date: formData.board_approval_date,
    },
    documentation: {
      deed_of_gift_date: formData.deed_of_gift_date,
      authorization_date: formData.authorization_date,
    },
    linkedEntry: linkedEntry ? { entry_id: acquisition?.entry_id } : {},
    accessioning: acquisition?.status === 'completed' || acquisition?.status === 'accessioned'
      ? { accession_number: formData.accession_number, completed: true }
      : {},
    discussion: {},
    history: {},
  };

  // Loading state
  if (!isCreateMode && isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <MadronaLoader label="Loading…" />
      </div>
    );
  }

  // Error state
  if (!isCreateMode && (error || !acquisition)) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <div className="text-center py-12">
          <Archive size={48} className="mx-auto text-archive mb-4" />
          <h3 className="text-lg font-serif font-medium text-forest mb-2">
            Acquisition not found
          </h3>
          <p className="text-accessible-gray mb-4">
            {error ? (error as Error).message : 'The acquisition record could not be loaded.'}
          </p>
          <Link
            to={`/organizations/${orgId}/collections/acquisitions`}
            className="text-bark hover:text-copper-dark"
          >
            Back to Acquisitions
          </Link>
        </div>
      </div>
    );
  }

  const statusConfig = !isCreateMode && acquisition ? STATUS_CONFIG[acquisition.status] || STATUS_CONFIG.proposed : STATUS_CONFIG.proposed;
  const StatusIcon = statusConfig.icon;
  const MethodIcon = !isCreateMode && acquisition ? METHOD_ICONS[acquisition.acquisition_method] || Gift : Gift;
  const status = acquisition?.status || 'proposed';

  const pageContent = (
    <div className={cn(!useNewLayout && 'max-w-5xl mx-auto px-6 pb-12')}>
      {/* Header - only in classic layout */}
      {!useNewLayout && (
        <WorkspaceHeader
          backUrl={`/organizations/${orgId}/collections/acquisitions`}
          backText="Back to Acquisitions"
          title={isCreateMode ? 'New Acquisition' : 'Acquisition'}
          objectNumber={isCreateMode ? '' : (acquisition?.acquisition_number || '')}
          creator={isCreateMode ? undefined : sourceContact?.name}
          date={!isCreateMode && acquisition?.acquisition_date ? formatDateShort(acquisition.acquisition_date) : undefined}
          isEditing={isEditing}
          onToggleMode={isCreateMode ? undefined : handleToggleMode}
          saveStatus={saveStatus}
          lastSaved={lastSaved}
          hasUnsavedChanges={hasUnsavedChanges}
          showCreateButton={isCreateMode}
          createButtonText="Create Acquisition"
          onSave={isCreateMode ? handleCreate : undefined}
        />
      )}

      {/* Edit mode indicator */}

      {/* Workflow Progress Indicator */}
      {!isCreateMode && acquisition && acquisition.status !== 'cancelled' && (
        <div className="mb-6 p-4 bg-stone/30 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-ink">Acquisition Workflow</span>
            <span className="text-xs text-archive">
              {status === 'proposed'
                ? 'Approve when ready to proceed'
                : status === 'approved'
                ? 'Complete when all requirements are met'
                : status === 'completed'
                ? 'Acquisition complete'
                : ''
              }
            </span>
          </div>
          <div className="flex items-center gap-2">
            {WORKFLOW_STEPS.map((step, index) => {
              const currentIndex = getStepIndex(status);
              const isComplete = index < currentIndex;
              const isCurrent = index === currentIndex;

              return (
                <div key={step.key} className="flex items-center flex-1">
                  <div className={cn(
                    'flex items-center justify-center w-8 h-8 rounded-full text-xs font-medium transition-colors',
                    isComplete
                      ? 'bg-forest text-parchment'
                      : isCurrent
                      ? index === WORKFLOW_STEPS.length - 1 && status === 'completed'
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
                    {step.label}
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

      {/* Compliance Card */}
      {!isCreateMode && acquisition && (
                  <ProcedureRequirementsCard
            title="Acquisition Requirements"
            requirementGroups={requirementGroups}
            record={formData as unknown as Record<string, unknown>}
            currentStatus={status}
            statusOrder={['proposed', 'approved', 'completed', 'cancelled']}
            onSectionNavigate={handleEnterEditMode}
          />
      )}

      {/* Status Bar */}
      {!isCreateMode && acquisition && (
        <div className="flex items-center gap-4 mb-6">
          <span className={cn('inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium', statusConfig.color)}>
            <StatusIcon size={16} />
            {statusConfig.label}
          </span>
          <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-stone rounded-full text-sm text-archive">
            <MethodIcon size={16} />
            {getLabel('acquisition_method', acquisition.acquisition_method)}
          </span>
          {acquisition.objects_count > 1 && (
            <span className="text-sm text-archive">
              {acquisition.objects_count} objects
            </span>
          )}

          {/* Status Actions */}
          <div className="flex-1" />
          {/* Primary forward action */}
          {acquisition.status === 'proposed' && (
            <button
              onClick={() => handleStatusAdvancement('approved', 'Approved')}
              className="btn btn-primary text-sm"
              disabled={statusMutation.isPending}
            >
              <CheckCircle size={16} className="mr-1.5" />
              Approve
            </button>
          )}
          {acquisition.status === 'approved' && (
            <button
              onClick={() => handleStatusAdvancement('completed', 'Completed')}
              className="btn btn-primary text-sm"
              disabled={statusMutation.isPending}
            >
              <CheckCircle size={16} className="mr-1.5" />
              Complete Acquisition
            </button>
          )}
          {/* Change Status dropdown — any status */}
          <ChangeStatusDropdown
            currentStatus={acquisition.status}
            allStatuses={[
              { key: 'proposed', label: 'Proposed' },
              { key: 'approved', label: 'Approved' },
              { key: 'completed', label: 'Completed' },
              { key: 'cancelled', label: 'Cancelled' },
            ]}
            statusConfig={STATUS_CONFIG}
            onStatusChange={(target) => {
              const targetLabel = { proposed: 'Proposed', approved: 'Approved', completed: 'Completed', cancelled: 'Cancelled' }[target] || target;
              if (target === 'approved' || target === 'completed') {
                handleStatusAdvancement(target, targetLabel);
              } else {
                setShowRollbackConfirm({ isOpen: true, targetStatus: target, targetStatusLabel: targetLabel });
              }
            }}
            isPending={statusMutation.isPending}
            sideStatuses={['cancelled']}
          />
        </div>
      )}

      {/* Read-only / pending approval indicators */}
      <ReadOnlyBanner visible={!isCreateMode && !canEdit} />
      <PendingApprovalBanner
        visible={!isCreateMode && acquisition?.status === 'pending_approval'}
        entityType="acquisition"
        entityId={acquisitionId || ''}
        orgId={orgId || ''}
        onReviewed={() => window.location.reload()}
      />

      {/* Sections */}
      <div className="flex flex-col gap-4">
        {/* === OVERVIEW GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Overview" icon={ClipboardList} />}

        {/* Acquisition Information */}
        <WorkspaceSection
          id="acquisition"
          title="Acquisition Information"
          icon={<Briefcase size={20} />}
          isExpanded={expandedSections.acquisition}
          onToggle={() => toggleSection('acquisition')}
          isEditing={isEditing}
          order={getSectionOrder('acquisition')}
        >
          <div className="grid grid-cols-2 gap-6">
            <EditableSelect
              value={formData.acquisition_method || ''}
              label="Acquisition Method"
              isEditing={isEditing}
              onChange={(v) => updateField('acquisition_method', v)}
              options={getLookup('acquisition_method')}
              required
            />
            <EditableField
              value={formData.acquisition_date || ''}
              label="Acquisition Date"
              isEditing={isEditing}
              onChange={(v) => updateField('acquisition_date', v)}
              type="date"
            />
            <EditableField
              value={formData.objects_count?.toString() || '1'}
              label="Number of Objects"
              isEditing={isEditing}
              onChange={(v) => updateField('objects_count', v)}
              type="number"
            />
            <EditableField
              value={formData.acquisition_reason || ''}
              label="Acquisition Reason"
              isEditing={isEditing}
              onChange={(v) => updateField('acquisition_reason', v)}
              multiline
              rows={2}
              placeholder="Why is this object being acquired?"
              className="col-span-2"
            />
          </div>
        </WorkspaceSection>

        {/* Source Information */}
        <WorkspaceSection
          id="source"
          title="Source Information"
          icon={<User size={20} />}
          isExpanded={expandedSections.source}
          onToggle={() => toggleSection('source')}
          isEditing={isEditing}
          order={getSectionOrder('source')}
        >
          <div className="grid grid-cols-2 gap-6">
            {/* Contact-linked source selector */}
            <div className="col-span-2">
              <dt className="text-sm font-medium text-archive mb-1">Source</dt>
              {isEditing ? (
                <div className="flex items-center gap-2">
                  {formData.source_id && sourceContact ? (
                    <>
                      <div className="flex-1 flex items-center gap-2 px-3 py-2 border border-lichen rounded-lg bg-parchment">
                        <User size={16} className="text-archive flex-shrink-0" />
                        <span className="text-sm text-ink">{sourceContact.name}</span>
                        {sourceContact.organization_name && (
                          <span className="text-xs text-archive">({sourceContact.organization_name})</span>
                        )}
                        <button
                          type="button"
                          onClick={() => updateField('source_id', '')}
                          className="ml-auto p-1 text-archive hover:text-semantic-error"
                        >
                          <X size={14} />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => sourceSelector.open()}
                        className="px-3 py-2 text-sm text-bark hover:text-copper-dark"
                      >
                        Change
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => sourceSelector.open()}
                      className="flex-1 flex items-center gap-2 px-3 py-2 border border-dashed border-lichen rounded-lg text-sm text-archive hover:border-bark hover:text-bark transition-colors"
                    >
                      <Search size={16} />
                      Search or create source...
                    </button>
                  )}
                </div>
              ) : (
                <dd className="text-ink">
                  {sourceContact ? (
                    <span>
                      {sourceContact.name}
                      {sourceContact.organization_name && (
                        <span className="text-archive ml-1">({sourceContact.organization_name})</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-archive">Not specified</span>
                  )}
                </dd>
              )}
            </div>
            <EditableSelect
              value={formData.source_type || ''}
              label="Source Type"
              isEditing={isEditing}
              onChange={(v) => updateField('source_type', v)}
              options={getLookup('source_type')}
              placeholder="Select type..."
            />
          </div>
        </WorkspaceSection>

        {/* === DETAILS GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Details" icon={DollarSign} />}

        {/* Financial Information */}
        <WorkspaceSection
          id="financial"
          title="Financial Information"
          icon={<DollarSign size={20} />}
          isExpanded={expandedSections.financial}
          onToggle={() => toggleSection('financial')}
          isEditing={isEditing}
          order={getSectionOrder('financial')}
        >
          <div className="grid grid-cols-2 gap-6">
            <EditableField
              value={formData.cost || ''}
              label="Cost/Value"
              isEditing={isEditing}
              onChange={(v) => updateField('cost', v)}
              type="number"
              placeholder="0.00"
              restricted={isRestricted('cost')}
            />
            <EditableSelect
              value={formData.cost_currency || 'USD'}
              label="Currency"
              isEditing={isEditing}
              onChange={(v) => updateField('cost_currency', v)}
              options={getLookup('currency')}
            />
            <EditableField
              value={formData.funding_source || ''}
              label="Funding Source"
              isEditing={isEditing}
              onChange={(v) => updateField('funding_source', v)}
              placeholder="Foundation, endowment, etc."
              restricted={isRestricted('funding_source')}
            />
            <EditableField
              value={formData.funding_account || ''}
              label="Funding Account"
              isEditing={isEditing}
              onChange={(v) => updateField('funding_account', v)}
              placeholder="Account number or fund code"
              restricted={isRestricted('funding_account')}
            />
          </div>
          <div className="mt-6">
            <EditableField
              value={formData.funding_note || ''}
              label="Funding Notes"
              isEditing={isEditing}
              onChange={(v) => updateField('funding_note', v)}
              multiline
              rows={2}
              placeholder="Additional funding details..."
              restricted={isRestricted('funding_note')}
            />
          </div>
          {/* Appraisal */}
          <div className="mt-6 pt-6 border-t border-lichen">
            <h4 className="text-sm font-medium text-ink mb-4">Appraisal</h4>
            <div className="grid grid-cols-2 gap-6">
              <EditableField
                value={formData.appraised_value || ''}
                label="Appraised Value"
                isEditing={isEditing}
                onChange={(v) => updateField('appraised_value', v)}
                type="number"
                placeholder="0.00"
                restricted={isRestricted('appraised_value')}
              />
              <EditableSelect
                value={formData.appraised_value_currency || 'USD'}
                label="Appraisal Currency"
                isEditing={isEditing}
                onChange={(v) => updateField('appraised_value_currency', v)}
                options={getLookup('currency')}
              />
              <EditableField
                value={formData.appraised_date || ''}
                label="Appraisal Date"
                isEditing={isEditing}
                onChange={(v) => updateField('appraised_date', v)}
                type="date"
              />
              <EditableField
                value={formData.appraiser_name || ''}
                label="Appraiser Name"
                isEditing={isEditing}
                onChange={(v) => updateField('appraiser_name', v)}
                placeholder="Name of the appraiser"
              />
            </div>
          </div>
        </WorkspaceSection>

        {/* Legal & Provenance */}
        <WorkspaceSection
          id="legal"
          title="Legal & Provenance"
          icon={<Scale size={20} />}
          isExpanded={expandedSections.legal}
          onToggle={() => toggleSection('legal')}
          isEditing={isEditing}
          order={getSectionOrder('legal')}
        >
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-6">
              <EditableSelect
                value={formData.legal_status || 'clear'}
                label="Legal Status"
                isEditing={isEditing}
                onChange={(v) => updateField('legal_status', v)}
                options={getLookup('legal_status')}
              />
              <EditableField
                value={formData.credit_line || ''}
                label="Credit Line"
                isEditing={isEditing}
                onChange={(v) => updateField('credit_line', v)}
                placeholder="e.g., Gift of John and Jane Smith, 2026"
              />
            </div>
            <EditableField
              value={formData.provisos || ''}
              label="Provisos"
              isEditing={isEditing}
              onChange={(v) => updateField('provisos', v)}
              multiline
              rows={3}
              placeholder="Any conditions attached to the acquisition..."
              restricted={isRestricted('provisos')}
            />
            <EditableField
              value={formData.donor_restrictions || ''}
              label="Donor Restrictions"
              isEditing={isEditing}
              onChange={(v) => updateField('donor_restrictions', v)}
              multiline
              rows={3}
              placeholder="Any restrictions imposed by the donor..."
            />
            {/* Acknowledgment */}
            <EditableField
              value={formData.acknowledgement_date || ''}
              label="Acknowledgment Date"
              isEditing={isEditing}
              onChange={(v) => updateField('acknowledgement_date', v)}
              type="date"
            />
            <EditableField
              value={formData.acknowledgement_reference || ''}
              label="Acknowledgment Reference"
              isEditing={isEditing}
              onChange={(v) => updateField('acknowledgement_reference', v)}
              placeholder="Reference number for acknowledgment"
            />
            <EditableField
              value={formData.transfer_of_title_number || ''}
              label="Transfer of Title Number"
              isEditing={isEditing}
              onChange={(v) => updateField('transfer_of_title_number', v)}
              placeholder="Document reference number"
            />
            <EditableCheckbox
              value={formData.provenance_verified ?? false}
              label="Provenance Verified"
              isEditing={isEditing}
              onChange={(v) => updateField('provenance_verified', v)}
              description="Confirm that provenance research has been completed."
            />
            <EditableField
              value={formData.provenance_note || ''}
              label="Provenance Note"
              isEditing={isEditing}
              onChange={(v) => updateField('provenance_note', v)}
              multiline
              rows={3}
              placeholder="Provenance research details..."
            />
            <EditableField
              value={formData.legal_note || ''}
              label="Legal Note"
              isEditing={isEditing}
              onChange={(v) => updateField('legal_note', v)}
              multiline
              rows={3}
              placeholder="Additional legal notes..."
              restricted={isRestricted('legal_note')}
            />
          </div>
        </WorkspaceSection>

        {/* Board Approval */}
        <WorkspaceSection
          id="boardApproval"
          title="Board Approval"
          icon={<ShieldCheck size={20} />}
          isExpanded={expandedSections.boardApproval}
          onToggle={() => toggleSection('boardApproval')}
          isEditing={isEditing}
          order={getSectionOrder('boardApproval')}
        >
          <div className="space-y-6">
            <EditableCheckbox
              value={formData.board_approval_required ?? false}
              label="Board Approval Required"
              isEditing={isEditing}
              onChange={(v) => updateField('board_approval_required', v)}
              description="Does this acquisition require board or committee approval?"
            />
            {formData.board_approval_required && (
              <div className="grid grid-cols-2 gap-6">
                <EditableField
                  value={formData.board_approval_date || ''}
                  label="Board Approval Date"
                  isEditing={isEditing}
                  onChange={(v) => updateField('board_approval_date', v)}
                  type="date"
                />
                <EditableField
                  value={formData.board_approval_reference || ''}
                  label="Board Approval Reference"
                  isEditing={isEditing}
                  onChange={(v) => updateField('board_approval_reference', v)}
                  placeholder="Resolution or meeting reference"
                />
              </div>
            )}
            <EditableField
              value={formData.board_note || ''}
              label="Board Note"
              isEditing={isEditing}
              onChange={(v) => updateField('board_note', v)}
              multiline
              rows={3}
              placeholder="Board discussion notes..."
            />
          </div>
        </WorkspaceSection>

        {/* Documentation */}
        <WorkspaceSection
          id="documentation"
          title="Documentation"
          icon={<Receipt size={20} />}
          isExpanded={expandedSections.documentation}
          onToggle={() => toggleSection('documentation')}
          isEditing={isEditing}
          order={getSectionOrder('documentation')}
        >
          <div className="grid grid-cols-2 gap-6">
            <EditableField
              value={formData.deed_of_gift_date || ''}
              label="Deed of Gift Date"
              isEditing={isEditing}
              onChange={(v) => updateField('deed_of_gift_date', v)}
              type="date"
            />
            <EditableField
              value={formData.deed_of_gift_reference || ''}
              label="Deed of Gift Reference"
              isEditing={isEditing}
              onChange={(v) => updateField('deed_of_gift_reference', v)}
              placeholder="Document reference number"
            />
            <EditableField
              value={formData.authorization_date || ''}
              label="Authorization Date"
              isEditing={isEditing}
              onChange={(v) => updateField('authorization_date', v)}
              type="date"
            />
            <EditableField
              value={formData.authorization_note || ''}
              label="Authorization Note"
              isEditing={isEditing}
              onChange={(v) => updateField('authorization_note', v)}
              placeholder="Committee or board approval details..."
              restricted={isRestricted('authorization_note')}
            />
          </div>
          <div className="mt-6">
            <EditableField
              value={formData.acquisition_note || ''}
              label="Acquisition Notes"
              isEditing={isEditing}
              onChange={(v) => updateField('acquisition_note', v)}
              multiline
              rows={3}
              placeholder="Additional notes..."
            />
          </div>
          <div className="mt-6">
            <EditableField
              value={formData.internal_note || ''}
              label="Internal Note"
              isEditing={isEditing}
              onChange={(v) => updateField('internal_note', v)}
              multiline
              rows={3}
              placeholder="Internal staff notes (not visible to public)..."
              restricted={isRestricted('internal_note')}
            />
          </div>
          {!isCreateMode && acquisition?.acquisition_id && orgId && (
            <div className="mt-6 pt-6 border-t border-lichen">
              <SignedDocumentSlot
                organizationId={orgId}
                procedureType="acquisition"
                procedureId={acquisition.acquisition_id}
                documentType="deed_of_gift"
                title="Signed transfer of title"
                helpText="Attach the signed deed of gift, bill of sale, or transfer document. A signature confirming transfer of title is required."
                isEditing={isEditing}
              />
            </div>
          )}
        </WorkspaceSection>

        {/* === LINKED GROUP === */}
        {useNewLayout && !isCreateMode && <SectionGroupDivider label="Linked" icon={Package} />}

        {/* Source Entry — bidirectional link per the collections standard */}
        {!isCreateMode && acquisition && (
          <WorkspaceSection
            id="linkedEntry"
            title="Source Entry"
            icon={<Package size={20} />}
            isExpanded={expandedSections.linkedEntry}
            onToggle={() => toggleSection('linkedEntry')}
            isEditing={isEditing}
            order={getSectionOrder('linkedEntry')}
            isEmpty={!linkedEntry}
          >
            <AcquisitionEntryLinker
              organizationId={orgId!}
              acquisitionId={acquisitionId!}
              linkedEntry={linkedEntry}
              isEditing={isEditing}
              onLinkChange={() => queryClient.invalidateQueries({ queryKey: ['acquisition', orgId, acquisitionId] })}
            />
          </WorkspaceSection>
        )}

        {/* Accessioning Status */}
        {!isCreateMode && acquisition && (
          <WorkspaceSection
            id="accessioning"
            title="Accessioning"
            icon={<Stamp size={20} />}
            badge={acquisition.accessioning_approved ? 'Approved' : acquisition.status === 'completed' ? 'Ready' : undefined}
            isExpanded={expandedSections.accessioning}
            onToggle={() => toggleSection('accessioning')}
            isEditing={isEditing && ['completed', 'accessioned'].includes(status)}
            order={getSectionOrder('accessioning')}
          >
            {/* Status banner */}
            {acquisition.status === 'completed' ? (
              <div className="bg-semantic-success/10 rounded-lg p-4 mb-6">
                <p className="text-sm text-semantic-success font-medium flex items-center gap-2">
                  <CheckCircle size={16} />
                  Acquisition completed - objects ready for accessioning
                </p>
                {acquisition.completed_date && (
                  <p className="text-xs text-semantic-success/80 mt-1">
                    Completed on {formatDateShort(acquisition.completed_date)}
                  </p>
                )}
              </div>
            ) : status === 'accessioned' ? (
              <div className="bg-semantic-success/10 rounded-lg p-4 mb-6">
                <p className="text-sm text-semantic-success font-medium flex items-center gap-2">
                  <CheckCircle size={16} />
                  Objects accessioned into permanent collection
                </p>
              </div>
            ) : acquisition.status === 'approved' ? (
              <div className="bg-forest/10 rounded-lg p-4">
                <p className="text-sm text-forest">
                  Acquisition approved. Complete the acquisition to proceed with accessioning.
                </p>
              </div>
            ) : (
              <div className="bg-stone/50 rounded-lg p-4">
                <p className="text-sm text-archive">
                  Complete the acquisition before accessioning objects into the permanent collection.
                </p>
              </div>
            )}

            {/* Editable accessioning fields — only when completed or accessioned */}
            {['completed', 'accessioned'].includes(status) && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-6">
                  <EditableField
                    value={formData.accession_number || ''}
                    label="Accession Number"
                    isEditing={isEditing}
                    onChange={(v) => updateField('accession_number', v)}
                    placeholder="e.g., 2026.001"
                  />
                  <EditableField
                    value={formData.accession_date || ''}
                    label="Accession Date"
                    isEditing={isEditing}
                    onChange={(v) => updateField('accession_date', v)}
                    type="date"
                  />
                </div>
                <EditableCheckbox
                  value={formData.accessioning_approved ?? false}
                  label="Accessioning Approved"
                  isEditing={isEditing}
                  onChange={(v) => updateField('accessioning_approved', v)}
                  description="Has the governing body approved accessioning?"
                />
                {formData.accessioning_approved && (
                  <EditableField
                    value={formData.accessioning_approved_date || ''}
                    label="Approval Date"
                    isEditing={isEditing}
                    onChange={(v) => updateField('accessioning_approved_date', v)}
                    type="date"
                  />
                )}
                <EditableField
                  value={formData.accessioning_resolution || ''}
                  label="Resolution Reference"
                  isEditing={isEditing}
                  onChange={(v) => updateField('accessioning_resolution', v)}
                  placeholder="Board resolution or committee reference"
                />
                <EditableField
                  value={formData.accessioning_note || ''}
                  label="Accessioning Note"
                  isEditing={isEditing}
                  onChange={(v) => updateField('accessioning_note', v)}
                  multiline
                  rows={3}
                  placeholder="Additional accessioning notes..."
                />
              </div>
            )}
          </WorkspaceSection>
        )}

        {/* Linked Objects — created during accessioning */}
        {!isCreateMode && acquisition && (
          <WorkspaceSection
            id="objects"
            title="Linked Objects"
            icon={<Package size={20} />}
            isExpanded={expandedSections.objects ?? true}
            onToggle={() => toggleSection('objects')}
            isEditing={isEditing}
            order={getSectionOrder('objects')}
          >
            {orgId && acquisition.acquisition_id && (
              <AcquisitionObjectLinker
                organizationId={orgId}
                acquisitionId={acquisition.acquisition_id}
                isEditing={isEditing}
              />
            )}
          </WorkspaceSection>
        )}

        {/* === COLLABORATION GROUP === */}
        {useNewLayout && !isCreateMode && <SectionGroupDivider label="Collaboration" icon={MessageSquare} />}

        {/* Discussion */}
        {!isCreateMode && acquisitionId && (
          <WorkspaceSection
            id="discussion"
            title="Discussion"
            icon={<MessageSquare size={20} />}
            isExpanded={expandedSections.discussion}
            onToggle={() => toggleSection('discussion')}
            isEditing={isEditing}
            order={getSectionOrder('discussion')}
          >
            <RecordDiscussionTab
              entityType="acquisition"
              entityId={acquisitionId}
              organizationId={orgId!}
            />
          </WorkspaceSection>
        )}

        {/* Change History */}
        {hasPermission('org.view_audit_logs') && !isCreateMode && orgId && acquisitionId && (
          <WorkspaceSection
            id="history"
            title="Change History"
            icon={<History size={20} />}
            isExpanded={expandedSections.history}
            onToggle={() => toggleSection('history')}
            isEditing={isEditing}
            order={getSectionOrder('history')}
          >
            <RecordAuditHistory
              organizationId={orgId}
              entityType="acquisition"
              entityId={acquisitionId}
            />
          </WorkspaceSection>
        )}
      </div>

      {/* Footer metadata */}
      {!isCreateMode && acquisition && (
        <div className="mt-8 pt-6 border-t border-lichen text-sm text-archive">
          <p>Created: {formatDateTime(acquisition.created_at)}</p>
          {acquisition.updated_at && (
            <p>Last updated: {formatDateTime(acquisition.updated_at)}</p>
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
        title="Delete Acquisition"
        message={<>Are you sure you want to delete <strong>{acquisition?.acquisition_number || 'this acquisition record'}</strong>? This action cannot be undone.</>}
        confirmText="Delete"
        confirmStyle="danger"
      />

      <RollbackDialog
        isOpen={showRollbackConfirm.isOpen}
        onClose={() => setShowRollbackConfirm(prev => ({ ...prev, isOpen: false }))}
        onConfirm={(reason) => {
          rollbackMutation.mutate({ targetStatus: showRollbackConfirm.targetStatus, reason });
          setShowRollbackConfirm(prev => ({ ...prev, isOpen: false }));
        }}
        entityLabel="Acquisition"
        targetStatusLabel={showRollbackConfirm.targetStatusLabel}
        isLoading={rollbackMutation.isPending}
      />

      <StatusAdvancementDialog
        isOpen={statusDialog.isOpen}
        onClose={() => setStatusDialog(prev => ({ ...prev, isOpen: false }))}
        onConfirm={() => {
          statusMutation.mutate(statusDialog.targetStatus as 'proposed' | 'approved' | 'completed' | 'cancelled');
          setStatusDialog(prev => ({ ...prev, isOpen: false }));
        }}
        currentStatus={acquisition?.status || 'proposed'}
        targetStatus={statusDialog.targetStatus}
        targetStatusLabel={statusDialog.targetStatusLabel}
        validation={validateStatusChange(statusDialog.targetStatus)}
        isLoading={statusMutation.isPending}
        onAdvanceWithException={() => {
          const record: Record<string, unknown> = {
            ...formData,
            acquisition_number: acquisition?.acquisition_number || '',
          };
          const { blockingRequirements } = canTransitionToProcedure(
            requirementGroups,
            record,
            acquisition?.status || 'proposed',
            statusDialog.targetStatus,
            statusOrder,
            enforcementEnabled
          );
          setStatusDialog(prev => ({ ...prev, isOpen: false }));
          setExceptionDialog({
            isOpen: true,
            targetStatus: statusDialog.targetStatus,
            targetStatusLabel: statusDialog.targetStatusLabel,
            blockingRequirements,
          });
        }}
      />

      <AdvanceWithExceptionDialog
        isOpen={exceptionDialog.isOpen}
        onClose={() => setExceptionDialog(prev => ({ ...prev, isOpen: false }))}
        onConfirm={(_reason: string, _bypassedIds: string[]) => {
          statusMutation.mutate(exceptionDialog.targetStatus as 'proposed' | 'approved' | 'completed' | 'cancelled');
          setExceptionDialog(prev => ({ ...prev, isOpen: false }));
        }}
        currentStatus={(acquisition?.status || 'proposed') as React.ComponentProps<typeof AdvanceWithExceptionDialog>['currentStatus']}
        targetStatus={exceptionDialog.targetStatus as React.ComponentProps<typeof AdvanceWithExceptionDialog>['targetStatus']}
        targetStatusLabel={exceptionDialog.targetStatusLabel}
        blockingRequirements={exceptionDialog.blockingRequirements}
        isLoading={statusMutation.isPending}
      />

      {orgId && acquisitionId && acquisition && (
        <CreateTaskSlideOver
          isOpen={dialogs.showCreateTask}
          onClose={() => dialogs.setShowCreateTask(false)}
          orgId={orgId}
          initialEntityType={"acquisition" as React.ComponentProps<typeof CreateTaskSlideOver>['initialEntityType']}
          initialEntityId={acquisitionId}
          initialEntityLabel={acquisition.acquisition_number || `Acquisition ${acquisitionId.slice(0, 8)}`}
        />
      )}

      <GenerateReportSlideOver
        isOpen={showReportSlideOver}
        onClose={() => setShowReportSlideOver(false)}
        contextType="record"
        contextParams={{ record_id: acquisitionId, record_type: 'acquisitions' }}
        recordType="acquisitions"
      />

      {orgId && (
        <ContactSelectorSlideOver
          isOpen={sourceSelector.isOpen}
          onClose={sourceSelector.close}
          onSelect={sourceSelector.createSelectHandler((id) => updateField('source_id', id))}
          organizationId={orgId}
          title="Select Source"
          subtitle="Search for a person or organization to use as the acquisition source."
        />
      )}
    </div>
  );

  // New layout with RecordDetailPageWrapper
  if (useNewLayout && acquisition) {
    return (
      <WorkspaceErrorBoundary
        backUrl={`/organizations/${orgId}/collections/acquisitions`}
        backLabel="Back to Acquisitions"
      >
        <RecordDetailPageWrapper
          object={null}
          media={[]}
          sectionIds={ALL_SECTION_IDS}
          sectionGroups={ACQUISITION_SECTION_GROUPS}
          sectionData={sectionData}
          permissions={{
            canCreateTask: true,
            canViewHistory: true,
            canDelete: canEdit,
            canGenerateReport: true,
          }}
          callbacks={{
            onDelete: () => dialogs.setShowDeleteConfirm(true),
            onCreateTask: () => dialogs.setShowCreateTask(true),
            onGenerateReport: () => setShowReportSlideOver(true),
          }}
          isEditing={isEditing}
          onSectionNavigate={handleEnterEditMode}
          pageType="acquisition"
          enabled={true}
          showHeader={true}
          title="Acquisition"
          objectNumber={acquisition.acquisition_number || ''}
          subtitle={getLabel('acquisition_method', acquisition.acquisition_method)}
          backUrl={`/organizations/${orgId}/collections/acquisitions`}
          backLabel="Back to Acquisitions"
        >
          {pageContent}
        </RecordDetailPageWrapper>
      </WorkspaceErrorBoundary>
    );
  }

  return (
    <WorkspaceErrorBoundary
      backUrl={orgId ? `/organizations/${orgId}/collections/acquisitions` : undefined}
      backLabel="Back to Acquisitions"
    >
      {pageContent}
    </WorkspaceErrorBoundary>
  );
}
