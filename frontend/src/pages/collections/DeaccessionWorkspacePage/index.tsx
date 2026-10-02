import { useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { formatDateTime } from '@/lib/formatters';
import { useAuth } from '../../../hooks/useAuth';
import { usePermissions } from '../../../hooks/usePermissions';
import {
  FileText,
  ArrowRightFromLine,
  Users,
  Gavel,
  Scale,
  DollarSign,
  Megaphone,
  StickyNote,
  Trash2,
  CheckCircle,
  Clock,
  Package,
  Search,
  X,
  User,
  History,
  Truck,
} from 'lucide-react';
import { ContactSelectorSlideOver } from '../../../components/collections/ConstituentSelectorSlideOver';
import { SignedDocumentSlot } from '../../../components/collections/SignedDocumentSlot';
import { ObjectSelector } from '../../../components/collections/ObjectSelector';
import { ProcedureRequirementsCard } from '../../../components/collections/ProcedureRequirementsCard';
import { StatusAdvancementDialog } from '../../../components/collections/StatusAdvancementDialog';
import { AdvanceWithExceptionDialog } from '../../../components/collections/AdvanceWithExceptionDialog';
import { ChangeStatusDropdown } from '../../../components/collections/ChangeStatusDropdown';
import { useProcedureRequirements } from '../../../hooks/useProcedureRequirements';
import { canTransitionToProcedure, computeProcedureCompliance } from '../../../lib/procedureComplianceUtils';
import type { RequirementResult } from '../../../lib/procedureComplianceUtils';
import {
  WorkspaceHeader,
  WorkspaceErrorBoundary,
  WorkspaceSection,
  EditableField,
  EditableSelect,
  EditableCheckbox,
  RecordAuditHistory,
  SectionGroupDivider,
  ReadOnlyBanner,
  PendingApprovalBanner,
} from '../../../components/workspace';
import { RecordDetailPageWrapper, SectionOrderProvider } from '../../../components/record-detail';
import { CreateTaskSlideOver } from '../../../components/work/CreateTaskSlideOver';
import { cn } from '../../../lib/utils';
import { useLookupValues } from '../../../hooks/useLookupValues';
import { useWorkspacePage } from '../../../hooks/useWorkspacePage';
import ConfirmDialog from '../../../components/ConfirmDialog';
import RollbackDialog from '../../../components/RollbackDialog';
import { ShipmentLinker } from '../../../components/collections/ShipmentLinker';

import { useDeaccessionForm, useSectionState } from './hooks';
import { STATUS_CONFIG, DEACCESSION_STATUS_ORDER } from './constants';
import type { DeaccessionStatus } from './types';
import {
  DEACCESSION_SECTION_GROUPS,
  ALL_SECTION_IDS,
} from './types';
import { MadronaLoader } from '../../../components/ui/MadronaLoader';

/**
 * Outer wrapper that provides section order context.
 */
export default function DeaccessionWorkspacePage() {
  return (
    <SectionOrderProvider>
      <DeaccessionWorkspacePageContent />
    </SectionOrderProvider>
  );
}

function DeaccessionWorkspacePageContent() {
  const { orgId, deaccessionId } = useParams<{ orgId: string; deaccessionId?: string }>();
  const { requirementGroups, statusOrder, enforcementEnabled } = useProcedureRequirements('deaccession', orgId);
  const isCreateMode = !deaccessionId;
  const { getLookup, getLabel } = useLookupValues({ context: 'deaccessions' });

  const [showAppraiserSelector, setShowAppraiserSelector] = useState(false);

  const form = useDeaccessionForm(orgId, deaccessionId, isCreateMode);

  const {
    formData,
    updateField,
    hasUnsavedChanges,
    saveStatus,
    lastSaved,
    errorMessage,
    deaccession,
    isLoading,
    error,
    appraiserContact,
    queryClient,
    triggerSave,
    handleCreate,
    statusMutation,
    rollbackMutation,
    deleteMutation,
  } = form;

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
      deaccession_number: deaccession?.deaccession_number || '',
    };
    const { allowed } = canTransitionToProcedure(
      requirementGroups,
      record,
      deaccession?.status || 'proposed',
      targetStatus,
      statusOrder,
      enforcementEnabled
    );

    if (allowed) {
      statusMutation.mutate(targetStatus as DeaccessionStatus);
    } else {
      setStatusDialog({ isOpen: true, targetStatus, targetStatusLabel });
    }
  }, [formData, deaccession?.deaccession_number, deaccession?.status, requirementGroups, statusOrder, statusMutation]);

  const validateStatusChange = useCallback((targetStatus: string) => {
    const record: Record<string, unknown> = {
      ...formData,
      deaccession_number: deaccession?.deaccession_number || '',
    };
    const compliance = computeProcedureCompliance(
      requirementGroups,
      record,
      deaccession?.status || 'proposed',
      statusOrder,
      targetStatus
    );
    return {
      valid: compliance.blockingMissing.length === 0,
      errors: compliance.blockingMissing.map(r => `${r.requirement.label} is required`),
      warnings: compliance.recommendedMissing.map(r => `${r.requirement.label} is recommended`),
    };
  }, [formData, deaccession?.deaccession_number, deaccession?.status, requirementGroups, statusOrder]);

  // pending_approval records are read-only unless you're the requester or an approver
  const { user } = useAuth();
  const { hasPermission: checkPerm } = usePermissions();
  const isPendingApproval = deaccession?.status === 'pending_approval';
  const isRequester = isPendingApproval && deaccession?.created_by === user?.user_id;
  const isApprover = isPendingApproval && checkPerm('deaccession.approve');

  const wp = useWorkspacePage({
    entityType: 'deaccession',
    entityId: deaccessionId,
    entityLabel: deaccession?.deaccession_number,
    orgId,
    editPermission: 'deaccession.edit',
    restrictedFields: deaccession?._restricted_fields,
    canEdit: isPendingApproval ? (isRequester || isApprover) : undefined,
  });
  const { isEditing, setIsEditing, useNewLayout, canEdit, isRestricted, hasPermission, dialogs } = wp;

  const sectionState = useSectionState({
    orgId,
    deaccessionId,
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
    linkedObject: { object_id: formData.object_id },
    info: {
      proposal_date: formData.proposal_date,
      reason: formData.reason,
    },
    disposal: {
      disposal_method: formData.disposal_method,
      recipient_name: formData.recipient_name,
    },
    committee: {
      committee_review_date: formData.committee_review_date,
      committee_recommendation: formData.committee_recommendation,
    },
    board: {
      board_approval_date: formData.board_approval_date,
      board_approval_reference: formData.board_approval_reference,
    },
    legal: {
      legal_review_date: formData.legal_review_date,
      provenance_review_complete: formData.provenance_review_complete,
    },
    valuation: {
      appraised_value: formData.appraised_value,
    },
    notice: {
      public_notice_required: formData.public_notice_required,
      public_notice_date: formData.public_notice_date,
    },
    notes: {
      deaccession_note: formData.deaccession_note,
    },
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
  if (!isCreateMode && (error || !deaccession)) {
    return (
      <div className="p-6 max-w-4xl mx-auto text-center py-12">
        <Trash2 size={48} className="mx-auto text-archive mb-4" />
        <h3 className="text-lg font-serif font-medium text-forest mb-2">
          Deaccession not found
        </h3>
        <p className="text-accessible-gray mb-4">
          {error ? (error as Error).message : 'The deaccession record could not be loaded.'}
        </p>
        <Link
          to={`/organizations/${orgId}/collections/deaccessions`}
          className="text-bark hover:text-copper-dark"
        >
          Back to Deaccessions
        </Link>
      </div>
    );
  }

  const statusConfig = !isCreateMode && deaccession ? STATUS_CONFIG[deaccession.status] || STATUS_CONFIG.proposed : STATUS_CONFIG.proposed;
  const StatusIcon = statusConfig.icon;
  const displayNumber = isCreateMode ? '' : (deaccession?.deaccession_number || '');
  const displayTitle = isCreateMode
    ? 'New Deaccession'
    : getLabel('deaccession_reason', deaccession?.reason || 'outside_scope');
  const status = deaccession?.status || 'proposed';

  const pageContent = (
    <div className={cn(!useNewLayout && 'p-6 max-w-4xl mx-auto')}>
      {/* Header - only in classic layout */}
      {!useNewLayout && (
        <WorkspaceHeader
          backUrl={`/organizations/${orgId}/collections/deaccessions`}
          backText="Back to Deaccessions"
          title={displayTitle}
          objectNumber={displayNumber}
          isEditing={isEditing}
          saveStatus={saveStatus}
          lastSaved={lastSaved}
          hasUnsavedChanges={hasUnsavedChanges}
          showCreateButton={isCreateMode}
          createButtonText="Create Deaccession"
          onSave={isCreateMode ? handleCreate : undefined}
          onToggleMode={isCreateMode ? undefined : handleToggleMode}
        />
      )}

      {/* Edit mode indicator */}

      {/* Compliance Card */}
      {!isCreateMode && deaccession && (
                  <ProcedureRequirementsCard
            title="Deaccession Requirements"
            requirementGroups={requirementGroups}
            record={formData as unknown as Record<string, unknown>}
            currentStatus={status}
            statusOrder={DEACCESSION_STATUS_ORDER}
            onSectionNavigate={handleEnterEditMode}
          />
      )}

      {/* Status Bar */}
      {!isCreateMode && deaccession && (
        <div className="flex items-center gap-4 mb-6">
          <span className={cn('inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium', statusConfig.color)}>
            <StatusIcon size={16} />
            {statusConfig.label}
          </span>
          {deaccession.disposal_method && (
            <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-stone rounded-full text-sm text-archive">
              <ArrowRightFromLine size={16} />
              {getLabel('disposal_method', deaccession.disposal_method)}
            </span>
          )}

          {/* Status Actions */}
          <div className="flex-1" />
          {/* Primary forward action */}
          {deaccession.status === 'proposed' && (
            <button
              onClick={() => handleStatusAdvancement('under_review', 'Under Review')}
              className="btn btn-primary text-sm"
              disabled={statusMutation.isPending}
            >
              <FileText size={16} className="mr-1.5" />
              Start Review
            </button>
          )}
          {deaccession.status === 'under_review' && (
            <button
              onClick={() => handleStatusAdvancement('committee_reviewed', 'Committee Reviewed')}
              className="btn btn-primary text-sm"
              disabled={statusMutation.isPending}
            >
              <Users size={16} className="mr-1.5" />
              Committee Reviewed
            </button>
          )}
          {deaccession.status === 'committee_reviewed' && (
            <button
              onClick={() => handleStatusAdvancement('pending_board', 'Pending Board')}
              className="btn btn-primary text-sm"
              disabled={statusMutation.isPending}
            >
              <Gavel size={16} className="mr-1.5" />
              Submit to Board
            </button>
          )}
          {deaccession.status === 'pending_board' && (
            <button
              onClick={() => handleStatusAdvancement('approved', 'Approved')}
              className="btn btn-primary text-sm"
              disabled={statusMutation.isPending}
            >
              <CheckCircle size={16} className="mr-1.5" />
              Approve
            </button>
          )}
          {deaccession.status === 'approved' && (
            <button
              onClick={() => handleStatusAdvancement('in_progress', 'In Progress')}
              className="btn btn-primary text-sm"
              disabled={statusMutation.isPending}
            >
              <Clock size={16} className="mr-1.5" />
              Start Disposal
            </button>
          )}
          {deaccession.status === 'in_progress' && (
            <button
              onClick={() => handleStatusAdvancement('completed', 'Completed')}
              className="btn btn-primary text-sm"
              disabled={statusMutation.isPending}
            >
              <CheckCircle size={16} className="mr-1.5" />
              Complete
            </button>
          )}
          {/* Change Status dropdown — any status */}
          <ChangeStatusDropdown
            currentStatus={deaccession.status}
            allStatuses={[
              { key: 'proposed', label: 'Proposed' },
              { key: 'under_review', label: 'Under Review' },
              { key: 'committee_reviewed', label: 'Committee Reviewed' },
              { key: 'pending_board', label: 'Pending Board' },
              { key: 'approved', label: 'Approved' },
              { key: 'in_progress', label: 'In Progress' },
              { key: 'completed', label: 'Completed' },
              { key: 'cancelled', label: 'Cancelled' },
              { key: 'rejected', label: 'Rejected' },
            ]}
            statusConfig={STATUS_CONFIG}
            onStatusChange={(target) => statusMutation.mutate(target as DeaccessionStatus)}
            isPending={statusMutation.isPending}
            sideStatuses={['cancelled', 'rejected']}
          />
        </div>
      )}

      {/* Warning */}
      {isCreateMode && (
        <div className="mb-4 p-4 bg-semantic-warning/10 border border-semantic-warning/30 rounded-lg">
          <p className="text-sm text-semantic-warning">
            <strong>Important:</strong> Deaccessioning is an irreversible process. Ensure all required approvals and documentation are in place before proceeding.
          </p>
        </div>
      )}

      {/* Error message */}
      {errorMessage && (
        <div className="mb-4 p-4 bg-semantic-error/10 border border-semantic-error/30 rounded-lg">
          <p className="text-semantic-error">{errorMessage}</p>
        </div>
      )}

      {/* Read-only / pending approval indicators */}
      <ReadOnlyBanner visible={!isCreateMode && !canEdit} />
      <PendingApprovalBanner
        visible={!isCreateMode && deaccession?.status === 'pending_approval'}
        entityType="deaccession"
        entityId={deaccessionId || ''}
        orgId={orgId || ''}
        onReviewed={() => window.location.reload()}
      />

      {/* Sections */}
      <div className="flex flex-col gap-4">
        {/* === OVERVIEW GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Overview" icon={FileText} />}

        {/* Linked Object */}
        <WorkspaceSection
          id="linkedObject"
          title="Collection Object"
          icon={<Package size={18} />}
          isExpanded={expandedSections.linkedObject}
          onToggle={() => toggleSection('linkedObject')}
          isEditing={isEditing}
          order={getSectionOrder('linkedObject')}
        >
          <ObjectSelector
            organizationId={orgId!}
            objectId={formData.object_id || null}
            onChange={(id) => updateField('object_id', id || '')}
            isEditing={isEditing && isCreateMode}
            label="Object"
          />
          {isEditing && isCreateMode && (
            <p className="text-xs text-archive mt-2">
              <span className="text-semantic-error">*</span> Required
            </p>
          )}
        </WorkspaceSection>

        {/* Deaccession Information */}
        <WorkspaceSection
          id="info"
          title="Deaccession Information"
          icon={<FileText size={18} />}
          isExpanded={expandedSections.info}
          onToggle={() => toggleSection('info')}
          isEditing={isEditing}
          order={getSectionOrder('info')}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableField
              label="Proposal Date"
              value={formData.proposal_date}
              isEditing={isEditing}
              onChange={(v) => updateField('proposal_date', v)}
              type="date"
            />
            <EditableSelect
              label="Reason"
              value={formData.reason}
              isEditing={isEditing}
              onChange={(v) => updateField('reason', v)}
              options={getLookup('deaccession_reason')}
              required
            />
            <EditableField
              label="Reason Detail"
              value={formData.reason_detail}
              isEditing={isEditing}
              onChange={(v) => updateField('reason_detail', v)}
              multiline
              rows={2}
              className="md:col-span-2"
              restricted={isRestricted('reason_detail')}
            />
          </div>
        </WorkspaceSection>

        {/* Disposal Method */}
        <WorkspaceSection
          id="disposal"
          title="Disposal Method"
          icon={<ArrowRightFromLine size={18} />}
          isExpanded={expandedSections.disposal}
          onToggle={() => toggleSection('disposal')}
          isEditing={isEditing}
          order={getSectionOrder('disposal')}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableSelect
              label="Disposal Method"
              value={formData.disposal_method}
              isEditing={isEditing}
              onChange={(v) => updateField('disposal_method', v)}
              options={getLookup('disposal_method')}
              placeholder="Select method..."
            />
            <EditableField
              label="Recipient Name"
              value={formData.recipient_name}
              isEditing={isEditing}
              onChange={(v) => updateField('recipient_name', v)}
              restricted={isRestricted('recipient_contact')}
            />
            <EditableField
              label="Disposal Method Detail"
              value={formData.disposal_method_detail}
              isEditing={isEditing}
              onChange={(v) => updateField('disposal_method_detail', v)}
              multiline
              rows={2}
              className="md:col-span-2"
            />
          </div>
        </WorkspaceSection>

        {/* === GOVERNANCE GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Governance" icon={Gavel} />}

        {/* Committee Review */}
        <WorkspaceSection
          id="committee"
          title="Committee Review"
          icon={<Users size={18} />}
          isExpanded={expandedSections.committee}
          onToggle={() => toggleSection('committee')}
          isEditing={isEditing}
          order={getSectionOrder('committee')}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableField
              label="Review Date"
              value={formData.committee_review_date}
              isEditing={isEditing}
              onChange={(v) => updateField('committee_review_date', v)}
              type="date"
            />
            <EditableSelect
              label="Recommendation"
              value={formData.committee_recommendation}
              isEditing={isEditing}
              onChange={(v) => updateField('committee_recommendation', v)}
              options={getLookup('committee_recommendation')}
              placeholder="Select recommendation..."
            />
            <EditableField
              label="Committee Note"
              value={formData.committee_note}
              isEditing={isEditing}
              onChange={(v) => updateField('committee_note', v)}
              multiline
              rows={2}
              className="md:col-span-2"
              restricted={isRestricted('committee_note')}
            />
          </div>
        </WorkspaceSection>

        {/* Board Approval */}
        <WorkspaceSection
          id="board"
          title="Board Approval"
          icon={<Gavel size={18} />}
          isExpanded={expandedSections.board}
          onToggle={() => toggleSection('board')}
          isEditing={isEditing}
          order={getSectionOrder('board')}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableCheckbox
              label="Board Approval Required"
              value={formData.board_approval_required}
              isEditing={isEditing}
              onChange={(v) => updateField('board_approval_required', v)}
            />
            <EditableField
              label="Approval Date"
              value={formData.board_approval_date}
              isEditing={isEditing}
              onChange={(v) => updateField('board_approval_date', v)}
              type="date"
            />
            <EditableField
              label="Approval Reference"
              value={formData.board_approval_reference}
              isEditing={isEditing}
              onChange={(v) => updateField('board_approval_reference', v)}
            />
            <EditableField
              label="Board Note"
              value={formData.board_note}
              isEditing={isEditing}
              onChange={(v) => updateField('board_note', v)}
              multiline
              rows={2}
              className="md:col-span-2"
              restricted={isRestricted('board_note')}
            />
          </div>
          {!isCreateMode && deaccession?.deaccession_id && orgId && (
            <div className="mt-6 pt-6 border-t border-lichen">
              <SignedDocumentSlot
                organizationId={orgId}
                procedureType="deaccession"
                procedureId={deaccession.deaccession_id}
                documentType="disposal_decision"
                title="Signed disposal decision"
                helpText="Attach the signed board resolution, disposal decision, or deed of gift (out). The signature of the person with overall responsibility for the decision to dispose is required."
                isEditing={isEditing}
              />
            </div>
          )}
        </WorkspaceSection>

        {/* === DETAILS GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Details" icon={Scale} />}

        {/* Legal & Provenance */}
        <WorkspaceSection
          id="legal"
          title="Legal & Provenance Review"
          icon={<Scale size={18} />}
          isExpanded={expandedSections.legal}
          onToggle={() => toggleSection('legal')}
          isEditing={isEditing}
          order={getSectionOrder('legal')}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableField
              label="Legal Review Date"
              value={formData.legal_review_date}
              isEditing={isEditing}
              onChange={(v) => updateField('legal_review_date', v)}
              type="date"
            />
            <EditableCheckbox
              label="Provenance Review Complete"
              value={formData.provenance_review_complete}
              isEditing={isEditing}
              onChange={(v) => updateField('provenance_review_complete', v)}
            />
            <EditableField
              label="Legal Review Note"
              value={formData.legal_review_note}
              isEditing={isEditing}
              onChange={(v) => updateField('legal_review_note', v)}
              multiline
              rows={2}
              restricted={isRestricted('legal_review_note')}
            />
            <EditableField
              label="Provenance Review Note"
              value={formData.provenance_review_note}
              isEditing={isEditing}
              onChange={(v) => updateField('provenance_review_note', v)}
              multiline
              rows={2}
              restricted={isRestricted('provenance_review_note')}
            />
          </div>
        </WorkspaceSection>

        {/* Valuation */}
        <WorkspaceSection
          id="valuation"
          title="Valuation"
          icon={<DollarSign size={18} />}
          isExpanded={expandedSections.valuation}
          onToggle={() => toggleSection('valuation')}
          isEditing={isEditing}
          order={getSectionOrder('valuation')}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableField
              label="Appraised Value"
              value={formData.appraised_value}
              isEditing={isEditing}
              onChange={(v) => updateField('appraised_value', v)}
              type="number"
              placeholder="0.00"
              restricted={isRestricted('appraised_value')}
            />
            <EditableSelect
              label="Currency"
              value={formData.appraised_value_currency}
              isEditing={isEditing}
              onChange={(v) => updateField('appraised_value_currency', v)}
              options={getLookup('currency')}
            />
            <EditableField
              label="Appraisal Date"
              value={formData.appraised_date}
              isEditing={isEditing}
              onChange={(v) => updateField('appraised_date', v)}
              type="date"
            />
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">
                Appraiser
              </label>
              {isEditing ? (
                <div className="flex items-center gap-2">
                  {formData.appraiser_id && appraiserContact ? (
                    <div className="flex-1 flex items-center gap-2 px-3 py-2 border border-lichen rounded-lg bg-parchment">
                      <User size={16} className="text-archive flex-shrink-0" />
                      <span className="text-sm text-ink">{appraiserContact.name}</span>
                      {appraiserContact.organization_name && (
                        <span className="text-xs text-archive">({appraiserContact.organization_name})</span>
                      )}
                      <button
                        type="button"
                        onClick={() => updateField('appraiser_id', '')}
                        className="ml-auto p-1 text-archive hover:text-semantic-error"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowAppraiserSelector(true)}
                      className="flex-1 flex items-center gap-2 px-3 py-2 border border-dashed border-lichen rounded-lg text-sm text-archive hover:border-bark hover:text-bark transition-colors"
                    >
                      <Search size={16} />
                      Search or create appraiser...
                    </button>
                  )}
                  {formData.appraiser_id && (
                    <button
                      type="button"
                      onClick={() => setShowAppraiserSelector(true)}
                      className="px-3 py-2 text-sm text-bark hover:text-copper-dark"
                    >
                      Change
                    </button>
                  )}
                </div>
              ) : (
                <div className="text-sm text-ink">
                  {appraiserContact ? (
                    <span>
                      {appraiserContact.name}
                      {appraiserContact.organization_name && (
                        <span className="text-archive ml-1">({appraiserContact.organization_name})</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-archive">Not specified</span>
                  )}
                </div>
              )}
            </div>
            {formData.disposal_method === 'sale' && (
              <>
                <EditableField
                  label="Sale Price"
                  value={formData.sale_price}
                  isEditing={isEditing}
                  onChange={(v) => updateField('sale_price', v)}
                  type="number"
                  placeholder="0.00"
                  restricted={isRestricted('sale_price')}
                />
                <EditableSelect
                  label="Sale Currency"
                  value={formData.sale_currency}
                  isEditing={isEditing}
                  onChange={(v) => updateField('sale_currency', v)}
                  options={getLookup('currency')}
                />
                <EditableField
                  label="Proceeds Usage"
                  value={formData.proceeds_usage}
                  isEditing={isEditing}
                  onChange={(v) => updateField('proceeds_usage', v)}
                  multiline
                  rows={2}
                  className="md:col-span-2"
                />
              </>
            )}
          </div>
        </WorkspaceSection>

        {/* Public Notice */}
        <WorkspaceSection
          id="notice"
          title="Public Notice"
          icon={<Megaphone size={18} />}
          isExpanded={expandedSections.notice}
          onToggle={() => toggleSection('notice')}
          isEditing={isEditing}
          order={getSectionOrder('notice')}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableCheckbox
              label="Public Notice Required"
              value={formData.public_notice_required}
              isEditing={isEditing}
              onChange={(v) => updateField('public_notice_required', v)}
            />
            <EditableField
              label="Notice Date"
              value={formData.public_notice_date}
              isEditing={isEditing}
              onChange={(v) => updateField('public_notice_date', v)}
              type="date"
            />
            <EditableField
              label="Notice Reference"
              value={formData.public_notice_reference}
              isEditing={isEditing}
              onChange={(v) => updateField('public_notice_reference', v)}
              className="md:col-span-2"
            />
          </div>
        </WorkspaceSection>

        {!isCreateMode && deaccessionId && (
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
              procedureType="deaccession"
              procedureId={deaccessionId}
              isEditing={isEditing}
            />
          </WorkspaceSection>
        )}

        {/* === ADMIN GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Admin" icon={History} />}

        {/* Notes */}
        <WorkspaceSection
          id="notes"
          title="Additional Notes"
          icon={<StickyNote size={18} />}
          isExpanded={expandedSections.notes}
          onToggle={() => toggleSection('notes')}
          isEditing={isEditing}
          order={getSectionOrder('notes')}
        >
          <EditableField
            label="Deaccession Notes"
            value={formData.deaccession_note}
            isEditing={isEditing}
            onChange={(v) => updateField('deaccession_note', v)}
            multiline
            rows={4}
            placeholder="Any additional notes..."
          />
        </WorkspaceSection>

        {/* Change History */}
        {hasPermission('org.view_audit_logs') && !isCreateMode && orgId && deaccessionId && (
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
              entityType="deaccession"
              entityId={deaccessionId}
            />
          </WorkspaceSection>
        )}
      </div>

      {/* Footer metadata */}
      {!isCreateMode && deaccession && (
        <div className="mt-8 pt-6 border-t border-lichen text-sm text-archive">
          <p>Created: {formatDateTime(deaccession.created_at)}</p>
          {deaccession.updated_at && (
            <p>Last updated: {formatDateTime(deaccession.updated_at)}</p>
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
        title="Delete Deaccession"
        message={<>Are you sure you want to delete <strong>{displayNumber || 'this deaccession record'}</strong>? This action cannot be undone.</>}
        confirmText="Delete"
        confirmStyle="danger"
      />

      <ContactSelectorSlideOver
        isOpen={showAppraiserSelector}
        onClose={() => setShowAppraiserSelector(false)}
        onSelect={(contactId) => {
          updateField('appraiser_id', contactId);
          setShowAppraiserSelector(false);
        }}
        organizationId={orgId!}
        title="Select Appraiser"
        subtitle="Search for an existing contact or create a new one to use as the appraiser."
      />

      {orgId && deaccessionId && deaccession && (
        <CreateTaskSlideOver
          isOpen={dialogs.showCreateTask}
          onClose={() => dialogs.setShowCreateTask(false)}
          orgId={orgId}
          initialEntityType={"deaccession" as React.ComponentProps<typeof CreateTaskSlideOver>['initialEntityType']}
          initialEntityId={deaccessionId}
          initialEntityLabel={deaccession.deaccession_number || `Deaccession ${deaccessionId.slice(0, 8)}`}
        />
      )}

      {/* Status Advancement Dialog */}
      <StatusAdvancementDialog
        isOpen={statusDialog.isOpen}
        onClose={() => setStatusDialog(prev => ({ ...prev, isOpen: false }))}
        onConfirm={() => {
          statusMutation.mutate(statusDialog.targetStatus as DeaccessionStatus);
          setStatusDialog(prev => ({ ...prev, isOpen: false }));
        }}
        currentStatus={deaccession?.status || 'proposed'}
        targetStatus={statusDialog.targetStatus}
        targetStatusLabel={statusDialog.targetStatusLabel}
        validation={validateStatusChange(statusDialog.targetStatus)}
        isLoading={statusMutation.isPending}
        onAdvanceWithException={() => {
          const record: Record<string, unknown> = {
            ...formData,
            deaccession_number: deaccession?.deaccession_number || '',
          };
          const { blockingRequirements } = canTransitionToProcedure(
            requirementGroups,
            record,
            deaccession?.status || 'proposed',
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

      {/* Advance With Exception Dialog */}
      <AdvanceWithExceptionDialog
        isOpen={exceptionDialog.isOpen}
        onClose={() => setExceptionDialog(prev => ({ ...prev, isOpen: false }))}
        onConfirm={(_reason: string, _bypassedIds: string[]) => {
          statusMutation.mutate(exceptionDialog.targetStatus as DeaccessionStatus);
          setExceptionDialog(prev => ({ ...prev, isOpen: false }));
        }}
        currentStatus={(deaccession?.status || 'proposed') as React.ComponentProps<typeof AdvanceWithExceptionDialog>['currentStatus']}
        targetStatus={exceptionDialog.targetStatus as React.ComponentProps<typeof AdvanceWithExceptionDialog>['targetStatus']}
        targetStatusLabel={exceptionDialog.targetStatusLabel}
        blockingRequirements={exceptionDialog.blockingRequirements}
        isLoading={statusMutation.isPending}
      />

      {/* Rollback Confirmation Dialog */}
      <RollbackDialog
        isOpen={showRollbackConfirm.isOpen}
        onClose={() => setShowRollbackConfirm(prev => ({ ...prev, isOpen: false }))}
        onConfirm={(reason) => {
          rollbackMutation.mutate({ targetStatus: showRollbackConfirm.targetStatus, reason });
          setShowRollbackConfirm(prev => ({ ...prev, isOpen: false }));
        }}
        entityLabel="Deaccession"
        targetStatusLabel={showRollbackConfirm.targetStatusLabel}
        isLoading={rollbackMutation.isPending}
      />
    </div>
  );

  // New layout with RecordDetailPageWrapper
  if (useNewLayout && deaccession) {
    return (
      <WorkspaceErrorBoundary
        backUrl={`/organizations/${orgId}/collections/deaccessions`}
        backLabel="Back to Deaccessions"
      >
        <RecordDetailPageWrapper
          object={null}
          media={[]}
          sectionIds={ALL_SECTION_IDS}
          sectionGroups={DEACCESSION_SECTION_GROUPS}
          sectionData={sectionData}
          permissions={{
            canCreateTask: true,
            canViewHistory: true,
            canDelete: canEdit,
          }}
          callbacks={{
            onDelete: () => dialogs.setShowDeleteConfirm(true),
            onCreateTask: () => dialogs.setShowCreateTask(true),
          }}
          isEditing={isEditing}
          onSectionNavigate={handleEnterEditMode}
          pageType="deaccession"
          enabled={true}
          showHeader={true}
          title="Deaccession"
          objectNumber={deaccession.deaccession_number || undefined}
          subtitle={getLabel('deaccession_reason', deaccession.reason)}
          backUrl={`/organizations/${orgId}/collections/deaccessions`}
          backLabel="Back to Deaccessions"
        >
          {pageContent}
        </RecordDetailPageWrapper>
      </WorkspaceErrorBoundary>
    );
  }

  return (
    <WorkspaceErrorBoundary
      backUrl={orgId ? `/organizations/${orgId}/collections/deaccessions` : undefined}
      backLabel="Back to Deaccessions"
    >
      {pageContent}
    </WorkspaceErrorBoundary>
  );
}
