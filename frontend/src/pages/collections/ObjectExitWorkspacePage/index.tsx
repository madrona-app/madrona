import { useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { formatDateShort, formatDateTime } from '@/lib/formatters';
import {
  LogOut,
  User,
  Calendar,
  CheckCircle,
  Truck,
  Package,
  FileText,
  Send,
  ShieldCheck,
  ExternalLink,
  FileDown,
  History,
  MessageSquare,
} from 'lucide-react';
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
  RecordAuditHistory,
  SectionGroupDivider,
  ReadOnlyBanner,
  PendingApprovalBanner,
} from '../../../components/workspace';
import { RecordDetailPageWrapper, SectionOrderProvider } from '../../../components/record-detail';
import { CreateTaskSlideOver } from '../../../components/work/CreateTaskSlideOver';
import { GenerateReportSlideOver } from '../../../components/reports/GenerateReportSlideOver';
import { RecordDiscussionTab } from '../../../components/RecordDiscussionTab';
import { MadronaLoader } from '../../../components/ui/MadronaLoader';
import { cn } from '../../../lib/utils';
import { useWorkspacePage } from '../../../hooks/useWorkspacePage';
import { useLookupValues } from '../../../hooks/useLookupValues';
import ConfirmDialog from '../../../components/ConfirmDialog';
import RollbackDialog from '../../../components/RollbackDialog';
import { ShipmentLinker } from '../../../components/collections/ShipmentLinker';
import { SignedDocumentSlot } from '../../../components/collections/SignedDocumentSlot';

import { useExitForm, useSectionState } from './hooks';
import { STATUS_CONFIG, WORKFLOW_STEPS } from './constants';
import {
  EXIT_SECTION_GROUPS,
  ALL_SECTION_IDS,
} from './types';

/**
 * Outer wrapper that provides section order context.
 */
export default function ObjectExitWorkspacePage() {
  return (
    <SectionOrderProvider>
      <ObjectExitWorkspacePageContent />
    </SectionOrderProvider>
  );
}

function ObjectExitWorkspacePageContent() {
  const { orgId, exitId } = useParams<{ orgId: string; exitId?: string }>();
  const { requirementGroups, statusOrder, enforcementEnabled } = useProcedureRequirements('object_exit', orgId);
  const isCreateMode = !exitId;
  const { getLookup, getLabel } = useLookupValues({ context: 'exits' });

  const [showReportSlideOver, setShowReportSlideOver] = useState(false);

  const form = useExitForm(orgId, exitId, isCreateMode);

  const {
    formData,
    updateField,
    hasUnsavedChanges,
    saveStatus,
    lastSaved,
    exit,
    isLoading,
    error,
    linkedEntry,
    queryClient,
    triggerSave,
    handleCreate,
    statusMutation,
    rollbackMutation,
    deleteMutation,
    generatePdfMutation,
  } = form;

  // Status advancement dialog state
  const [statusDialog, setStatusDialog] = useState<{
    isOpen: boolean; targetStatus: string; targetStatusLabel: string;
  }>({ isOpen: false, targetStatus: '', targetStatusLabel: '' });

  const [exceptionDialog, setExceptionDialog] = useState<{
    isOpen: boolean; targetStatus: string; targetStatusLabel: string;
    blockingRequirements: RequirementResult[];
  }>({ isOpen: false, targetStatus: 'pending', targetStatusLabel: '', blockingRequirements: [] });

  const [showRollbackConfirm, setShowRollbackConfirm] = useState<{
    isOpen: boolean; targetStatus: string; targetStatusLabel: string;
  }>({ isOpen: false, targetStatus: '', targetStatusLabel: '' });

  const handleStatusAdvancement = useCallback((targetStatus: string, targetStatusLabel: string) => {
    const record: Record<string, unknown> = {
      ...formData,
      exit_number: exit?.exit_number || '',
    };
    const { allowed } = canTransitionToProcedure(
      requirementGroups,
      record,
      exit?.status || 'pending',
      targetStatus,
      statusOrder,
      enforcementEnabled
    );

    if (allowed) {
      statusMutation.mutate(targetStatus as 'pending' | 'preparing' | 'dispatched' | 'in_transit' | 'acknowledged' | 'cancelled');
    } else {
      setStatusDialog({ isOpen: true, targetStatus, targetStatusLabel });
    }
  }, [formData, exit?.exit_number, exit?.status, requirementGroups, statusOrder, statusMutation]);

  const validateStatusChange = useCallback((targetStatus: string) => {
    const record: Record<string, unknown> = {
      ...formData,
      exit_number: exit?.exit_number || '',
    };
    const compliance = computeProcedureCompliance(
      requirementGroups,
      record,
      exit?.status || 'pending',
      statusOrder,
      targetStatus
    );
    return {
      valid: compliance.blockingMissing.length === 0,
      errors: compliance.blockingMissing.map(r => `${r.requirement.label} is required`),
      warnings: compliance.recommendedMissing.map(r => `${r.requirement.label} is recommended`),
    };
  }, [formData, exit?.exit_number, exit?.status, requirementGroups, statusOrder]);

  const wp = useWorkspacePage({
    entityType: 'object_exit',
    entityId: exitId,
    entityLabel: exit?.exit_number,
    orgId,
    editPermission: 'exits.edit',
    restrictedFields: exit?._restricted_fields,

  });
  const { isEditing, setIsEditing, useNewLayout, canEdit, isRestricted, hasPermission, dialogs } = wp;

  const sectionState = useSectionState({
    orgId,
    exitId,
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
    exit: {
      exit_date: formData.exit_date,
      exit_reason: formData.exit_reason,
    },
    recipient: {
      recipient_name: formData.recipient_name,
    },
    condition: {
      condition_at_exit: formData.condition_at_exit,
    },
    authorization: {
      authorization_date: formData.authorization_date,
    },
    receipt: {
      receipt_reference: formData.receipt_reference,
    },
    notes: {
      exit_note: formData.exit_note,
    },
    entry: linkedEntry ? { entry_id: exit?.entry_id } : {},
    discussion: {},
    history: {},
  };

  // Helper for workflow step index
  const getStepIndex = (status: string) => {
    if (status === 'pending') return 0;
    if (status === 'preparing') return 1;
    if (status === 'dispatched' || status === 'in_transit') return 2;
    if (status === 'acknowledged') return 3;
    if (status === 'cancelled') return -1;
    return 0;
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
  if (!isCreateMode && (error || !exit)) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <div className="text-center py-12">
          <LogOut size={48} className="mx-auto text-archive mb-4" />
          <h3 className="text-lg font-serif font-medium text-forest mb-2">
            Exit not found
          </h3>
          <p className="text-accessible-gray mb-4">
            {error ? (error as Error).message : 'The exit record could not be loaded.'}
          </p>
          <Link
            to={`/organizations/${orgId}/collections/exits`}
            className="text-bark hover:text-copper-dark"
          >
            Back to Object Exits
          </Link>
        </div>
      </div>
    );
  }

  const statusConfig = !isCreateMode && exit ? STATUS_CONFIG[exit.status] || STATUS_CONFIG.pending : STATUS_CONFIG.pending;
  const StatusIcon = statusConfig.icon;
  const reasonLabel = !isCreateMode && exit ? getLabel('exit_reason', exit.exit_reason) : undefined;
  const currentStepIndex = !isCreateMode && exit ? getStepIndex(exit.status) : 0;
  const status = exit?.status || 'pending';

  const pageContent = (
    <div className={cn(!useNewLayout && 'max-w-5xl mx-auto px-6 pb-12')}>
      {/* Header - only in classic layout */}
      {!useNewLayout && (
        <WorkspaceHeader
          backUrl={`/organizations/${orgId}/collections/exits`}
          backText="Back to Object Exits"
          title={isCreateMode ? 'New Object Exit' : exit?.exit_number || ''}
          objectNumber={isCreateMode ? undefined : reasonLabel}
          creator={isCreateMode ? undefined : exit?.recipient_name}
          date={!isCreateMode && exit?.exit_date ? formatDateShort(exit.exit_date) : undefined}
          isEditing={isEditing}
          onToggleMode={isCreateMode ? undefined : handleToggleMode}
          saveStatus={saveStatus}
          lastSaved={lastSaved}
          hasUnsavedChanges={hasUnsavedChanges}
          showCreateButton={isCreateMode}
          createButtonText="Create Object Exit"
          onSave={isCreateMode ? handleCreate : undefined}
        />
      )}

      {/* Edit mode indicator */}

      {/* Workflow Progress Indicator */}
      {!isCreateMode && exit && exit.status !== 'cancelled' && (
        <div className="mb-6 p-4 bg-stone/30 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-ink">Exit Workflow</span>
            <span className="text-xs text-archive">
              {exit.status === 'pending'
                ? 'Start preparing when ready'
                : exit.status === 'preparing'
                ? 'Mark dispatched when shipped'
                : exit.status === 'dispatched' || exit.status === 'in_transit'
                ? 'Mark acknowledged when received'
                : exit.status === 'acknowledged'
                ? 'Exit complete'
                : ''
              }
            </span>
          </div>
          <div className="flex items-center gap-2">
            {WORKFLOW_STEPS.map((step, index) => {
              const isComplete = index < currentStepIndex;
              const isCurrent = index === currentStepIndex;

              return (
                <div key={step.key} className="flex items-center flex-1">
                  <div className={cn(
                    'flex items-center justify-center w-8 h-8 rounded-full text-xs font-medium transition-colors',
                    isComplete
                      ? 'bg-forest text-parchment'
                      : isCurrent
                      ? 'bg-copper text-parchment'
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
      {!isCreateMode && exit && (
                  <ProcedureRequirementsCard
            title="Object Exit Requirements"
            requirementGroups={requirementGroups}
            record={formData as unknown as Record<string, unknown>}
            currentStatus={status}
            statusOrder={statusOrder}
            onSectionNavigate={handleEnterEditMode}
          />
      )}

      {/* Status Bar */}
      {!isCreateMode && exit && (
        <div className="flex items-center gap-4 mb-6">
          <span className={cn('inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium', statusConfig.color)}>
            <StatusIcon size={16} />
            {statusConfig.label}
          </span>

          {/* Status Actions */}
          <div className="flex-1" />
          {/* Primary forward action */}
          {exit.status === 'pending' && (
            <button
              onClick={() => handleStatusAdvancement('preparing', 'Preparing')}
              className="btn btn-primary text-sm"
              disabled={statusMutation.isPending}
            >
              <Package size={16} className="mr-1.5" />
              Start Preparing
            </button>
          )}
          {exit.status === 'preparing' && (
            <button
              onClick={() => handleStatusAdvancement('dispatched', 'Dispatched')}
              className="btn btn-primary text-sm"
              disabled={statusMutation.isPending}
            >
              <Send size={16} className="mr-1.5" />
              Mark Dispatched
            </button>
          )}
          {exit.status === 'dispatched' && (
            <button
              onClick={() => handleStatusAdvancement('in_transit', 'In Transit')}
              className="btn btn-primary text-sm"
              disabled={statusMutation.isPending}
            >
              <Truck size={16} className="mr-1.5" />
              Mark In Transit
            </button>
          )}
          {exit.status === 'in_transit' && (
            <button
              onClick={() => handleStatusAdvancement('acknowledged', 'Acknowledged')}
              className="btn btn-primary text-sm"
              disabled={statusMutation.isPending}
            >
              <CheckCircle size={16} className="mr-1.5" />
              Mark Acknowledged
            </button>
          )}
          {/* Change Status dropdown — any status */}
          <ChangeStatusDropdown
            currentStatus={exit.status}
            allStatuses={[
              { key: 'pending', label: 'Pending' },
              { key: 'preparing', label: 'Preparing' },
              { key: 'dispatched', label: 'Dispatched' },
              { key: 'in_transit', label: 'In Transit' },
              { key: 'acknowledged', label: 'Acknowledged' },
              { key: 'cancelled', label: 'Cancelled' },
            ]}
            statusConfig={STATUS_CONFIG}
            onStatusChange={(target) => statusMutation.mutate(target as 'pending' | 'preparing' | 'dispatched' | 'in_transit' | 'acknowledged' | 'cancelled')}
            isPending={statusMutation.isPending}
            sideStatuses={['cancelled']}
          />
          <button
            onClick={() => generatePdfMutation.mutate()}
            className="btn btn-secondary text-sm"
            disabled={generatePdfMutation.isPending}
            title="Generate Packing List"
          >
            {generatePdfMutation.isPending ? (
              <MadronaLoader variant="dots" dotSize={6} />
            ) : (
              <FileDown size={16} />
            )}
          </button>
        </div>
      )}

      {/* Read-only indicator */}
      <ReadOnlyBanner visible={!isCreateMode && !canEdit} />
      <PendingApprovalBanner
        visible={!isCreateMode && status === 'pending_approval'}
        entityType="object_exit"
        entityId={exitId || ''}
        orgId={orgId || ''}
        onReviewed={() => window.location.reload()}
      />

      {/* Sections */}
      <div className="flex flex-col gap-4">
        {/* === OVERVIEW GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Overview" icon={Calendar} />}

        {/* Exit Information */}
        <WorkspaceSection
          id="exit"
          title="Exit Information"
          icon={<Calendar size={20} />}
          isExpanded={expandedSections.exit}
          onToggle={() => toggleSection('exit')}
          isEditing={isEditing}
          order={getSectionOrder('exit')}
        >
          <div className="grid grid-cols-2 gap-6">
            <EditableField
              value={formData.exit_date || ''}
              label="Exit Date"
              isEditing={isEditing}
              onChange={(v) => updateField('exit_date', v)}
              type="date"
              required
            />
            <EditableSelect
              value={formData.exit_reason || ''}
              label="Exit Reason"
              isEditing={isEditing}
              onChange={(v) => updateField('exit_reason', v)}
              options={getLookup('exit_reason')}
              required
            />
            <EditableSelect
              value={formData.exit_method || ''}
              label="Exit Method"
              isEditing={isEditing}
              onChange={(v) => updateField('exit_method', v)}
              options={getLookup('shipping_method')}
              placeholder="Select method..."
            />
          </div>
        </WorkspaceSection>

        {/* Recipient Information */}
        <WorkspaceSection
          id="recipient"
          title="Recipient Information"
          icon={<User size={20} />}
          isExpanded={expandedSections.recipient}
          onToggle={() => toggleSection('recipient')}
          isEditing={isEditing}
          order={getSectionOrder('recipient')}
        >
          <div className="grid grid-cols-2 gap-6">
            <EditableField
              value={formData.recipient_name || ''}
              label="Recipient Name"
              isEditing={isEditing}
              onChange={(v) => updateField('recipient_name', v)}
              placeholder="Name of person or organization"
              restricted={isRestricted('recipient_contact')}
            />
          </div>
          {!isRestricted('recipient_contact') && !isCreateMode && exit && exit.recipient_id && !isEditing && (
            <div className="mt-4 pt-4 border-t border-lichen">
              <Link
                to={`/organizations/${orgId}/collections/contacts/${exit.recipient_id}`}
                className="text-sm text-bark hover:text-copper-dark"
              >
                View Contact Record →
              </Link>
            </div>
          )}
        </WorkspaceSection>

        {/* === DETAILS GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Details" icon={Truck} />}

        {/* Condition */}
        <WorkspaceSection
          id="condition"
          title="Condition at Exit"
          icon={<ShieldCheck size={20} />}
          isExpanded={expandedSections.condition}
          onToggle={() => toggleSection('condition')}
          isEditing={isEditing}
          order={getSectionOrder('condition')}
        >
          <div className="grid grid-cols-2 gap-6">
            <EditableSelect
              value={formData.condition_at_exit || ''}
              label="Condition"
              isEditing={isEditing}
              onChange={(v) => updateField('condition_at_exit', v)}
              options={getLookup('condition')}
              placeholder="Select condition..."
            />
          </div>
          {!isCreateMode && exit && exit.condition_report_id && !isEditing && (
            <div className="mt-4 pt-4 border-t border-lichen">
              <Link
                to={`/organizations/${orgId}/collections/condition-reports/${exit.condition_report_id}`}
                className="text-sm text-bark hover:text-copper-dark"
              >
                View Condition Report →
              </Link>
            </div>
          )}
        </WorkspaceSection>

        {/* Authorization */}
        <WorkspaceSection
          id="authorization"
          title="Authorization"
          icon={<ShieldCheck size={20} />}
          isExpanded={expandedSections.authorization}
          onToggle={() => toggleSection('authorization')}
          isEditing={isEditing}
          order={getSectionOrder('authorization')}
        >
          <div className="grid grid-cols-2 gap-6">
            <EditableField
              value={formData.authorization_date || ''}
              label="Authorization Date"
              isEditing={isEditing}
              onChange={(v) => updateField('authorization_date', v)}
              type="date"
            />
          </div>
          <div className="mt-6">
            <EditableField
              value={formData.authorization_note || ''}
              label="Authorization Note"
              isEditing={isEditing}
              onChange={(v) => updateField('authorization_note', v)}
              multiline
              rows={2}
              placeholder="Notes about authorization..."
              restricted={isRestricted('authorization_note')}
            />
          </div>
          {!isCreateMode && exitId && orgId && (
            <div className="mt-6 pt-6 border-t border-lichen">
              <SignedDocumentSlot
                organizationId={orgId}
                procedureType="object_exit"
                procedureId={exitId}
                documentType="exit_form"
                title="Signed exit form"
                helpText="Attach the signed exit form. The signature of the person receiving the exiting objects is required."
                isEditing={isEditing}
              />
            </div>
          )}
        </WorkspaceSection>

        {!isCreateMode && exitId && (
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
              procedureType="object_exit"
              procedureId={exitId}
              isEditing={isEditing}
            />
          </WorkspaceSection>
        )}

        {/* === OUTCOME GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Outcome" icon={CheckCircle} />}

        {/* Receipt Acknowledgment */}
        <WorkspaceSection
          id="receipt"
          title="Receipt Acknowledgment"
          icon={<CheckCircle size={20} />}
          isExpanded={expandedSections.receipt}
          onToggle={() => toggleSection('receipt')}
          isEditing={isEditing}
          order={getSectionOrder('receipt')}
        >
          {!isCreateMode && exit && (
            <div className="flex items-center gap-3 mb-4">
              {exit.receipt_acknowledged ? (
                <CheckCircle size={20} className="text-semantic-success" />
              ) : (
                <div className="w-5 h-5 border-2 border-archive rounded-full" />
              )}
              <span className={cn(
                'font-medium',
                exit.receipt_acknowledged ? 'text-semantic-success' : 'text-archive'
              )}>
                {exit.receipt_acknowledged ? 'Receipt Acknowledged' : 'Pending Acknowledgment'}
              </span>
              {exit.receipt_acknowledged_date && (
                <span className="text-sm text-archive">
                  on {formatDateShort(exit.receipt_acknowledged_date)}
                </span>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-6">
            <EditableField
              value={formData.receipt_reference || ''}
              label="Receipt Reference"
              isEditing={isEditing}
              onChange={(v) => updateField('receipt_reference', v)}
              placeholder="Reference number"
            />
          </div>
          <div className="mt-6">
            <EditableField
              value={formData.receipt_note || ''}
              label="Receipt Note"
              isEditing={isEditing}
              onChange={(v) => updateField('receipt_note', v)}
              multiline
              rows={2}
              placeholder="Notes about receipt..."
            />
          </div>
        </WorkspaceSection>

        {/* Notes */}
        <WorkspaceSection
          id="notes"
          title="Notes"
          icon={<FileText size={20} />}
          isExpanded={expandedSections.notes}
          onToggle={() => toggleSection('notes')}
          isEditing={isEditing}
          order={getSectionOrder('notes')}
        >
          <EditableField
            value={formData.exit_note || ''}
            label="Exit Notes"
            isEditing={isEditing}
            onChange={(v) => updateField('exit_note', v)}
            multiline
            rows={4}
            placeholder="General notes about this exit..."
            restricted={isRestricted('exit_note')}
          />
          <div className="mt-6">
            <EditableField
              value={formData.internal_note || ''}
              label="Internal Notes"
              isEditing={isEditing}
              onChange={(v) => updateField('internal_note', v)}
              multiline
              rows={3}
              placeholder="Internal notes (not shared externally)..."
            />
          </div>
        </WorkspaceSection>

        {/* === LINKED GROUP === */}
        {useNewLayout && !isCreateMode && linkedEntry && <SectionGroupDivider label="Linked" icon={ExternalLink} />}

        {/* Linked Entry */}
        {!isCreateMode && linkedEntry && (
          <WorkspaceSection
            id="entry"
            title="Source Entry"
            icon={<ExternalLink size={20} />}
            isExpanded={true}
            onToggle={() => {}}
            isEditing={isEditing}
            order={getSectionOrder('entry')}
          >
            <Link
              to={`/organizations/${orgId}/collections/entries/${linkedEntry.entry_id}`}
              className="block p-4 bg-forest/5 border border-forest/20 rounded-lg hover:border-forest/40 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-forest">{linkedEntry.entry_number}</p>
                  <p className="text-sm text-accessible-gray mt-1">
                    {linkedEntry.depositor_name && `From ${linkedEntry.depositor_name}`}
                    {linkedEntry.entry_date && ` · Entered ${formatDateShort(linkedEntry.entry_date)}`}
                  </p>
                </div>
                <ExternalLink size={16} className="text-archive" />
              </div>
            </Link>
          </WorkspaceSection>
        )}

        {/* === ADMIN GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Admin" icon={History} />}

        {/* Discussion */}
        {!isCreateMode && orgId && exitId && (
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
              entityType="object_exit"
              entityId={exitId}
              organizationId={orgId}
            />
          </WorkspaceSection>
        )}

        {/* Change History */}
        {hasPermission('org.view_audit_logs') && !isCreateMode && orgId && exitId && (
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
              entityType="object_exit"
              entityId={exitId}
            />
          </WorkspaceSection>
        )}
      </div>

      {/* Footer metadata */}
      {!isCreateMode && exit && (
        <div className="mt-8 pt-6 border-t border-lichen text-sm text-archive">
          {exit.created_at && <p>Created: {formatDateTime(exit.created_at)}</p>}
          {exit.updated_at && (
            <p>Last updated: {formatDateTime(exit.updated_at)}</p>
          )}
        </div>
      )}

      {/* Dialogs */}
      <ConfirmDialog
        isOpen={dialogs.showDeleteConfirm}
        onClose={() => dialogs.setShowDeleteConfirm(false)}
        onConfirm={() => deleteMutation.mutate()}
        title="Delete Exit Record"
        message={<>Are you sure you want to delete <strong>{exit?.exit_number || 'this exit record'}</strong>? This action cannot be undone.</>}
        confirmText="Delete"
        confirmStyle="danger"
      />

      {orgId && exitId && exit && (
        <CreateTaskSlideOver
          isOpen={dialogs.showCreateTask}
          onClose={() => dialogs.setShowCreateTask(false)}
          orgId={orgId}
          initialEntityType={"object_exit" as React.ComponentProps<typeof CreateTaskSlideOver>['initialEntityType']}
          initialEntityId={exitId}
          initialEntityLabel={exit.exit_number || `Exit ${exitId.slice(0, 8)}`}
        />
      )}

      <GenerateReportSlideOver
        isOpen={showReportSlideOver}
        onClose={() => setShowReportSlideOver(false)}
        contextType="record"
        contextParams={{ record_id: exitId, record_type: 'object_exits' }}
        recordType="object_exits"
      />

      {/* Status Advancement Dialog */}
      <StatusAdvancementDialog
        isOpen={statusDialog.isOpen}
        onClose={() => setStatusDialog(prev => ({ ...prev, isOpen: false }))}
        onConfirm={() => {
          statusMutation.mutate(statusDialog.targetStatus as 'pending' | 'preparing' | 'dispatched' | 'in_transit' | 'acknowledged' | 'cancelled');
          setStatusDialog(prev => ({ ...prev, isOpen: false }));
        }}
        currentStatus={exit?.status || 'pending'}
        targetStatus={statusDialog.targetStatus}
        targetStatusLabel={statusDialog.targetStatusLabel}
        validation={validateStatusChange(statusDialog.targetStatus)}
        isLoading={statusMutation.isPending}
        onAdvanceWithException={() => {
          const record: Record<string, unknown> = {
            ...formData,
            exit_number: exit?.exit_number || '',
          };
          const { blockingRequirements } = canTransitionToProcedure(
            requirementGroups,
            record,
            exit?.status || 'pending',
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
          statusMutation.mutate(exceptionDialog.targetStatus as 'pending' | 'preparing' | 'dispatched' | 'in_transit' | 'acknowledged' | 'cancelled');
          setExceptionDialog(prev => ({ ...prev, isOpen: false }));
        }}
        currentStatus={(exit?.status || 'pending') as React.ComponentProps<typeof AdvanceWithExceptionDialog>['currentStatus']}
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
        entityLabel="Exit"
        targetStatusLabel={showRollbackConfirm.targetStatusLabel}
        isLoading={rollbackMutation.isPending}
      />
    </div>
  );

  // New layout with RecordDetailPageWrapper
  if (useNewLayout && exit) {
    return (
      <WorkspaceErrorBoundary
        backUrl={`/organizations/${orgId}/collections/exits`}
        backLabel="Back to Object Exits"
      >
        <RecordDetailPageWrapper
          object={null}
          media={[]}
          sectionIds={ALL_SECTION_IDS}
          sectionGroups={EXIT_SECTION_GROUPS}
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
          pageType="object-exit"
          enabled={true}
          showHeader={true}
          title="Object Exit"
          objectNumber={exit.exit_number || undefined}
          subtitle={reasonLabel}
          backUrl={`/organizations/${orgId}/collections/exits`}
          backLabel="Back to Object Exits"
        >
          {pageContent}
        </RecordDetailPageWrapper>
      </WorkspaceErrorBoundary>
    );
  }

  return (
    <WorkspaceErrorBoundary
      backUrl={orgId ? `/organizations/${orgId}/collections/exits` : undefined}
      backLabel="Back to Object Exits"
    >
      {pageContent}
    </WorkspaceErrorBoundary>
  );
}
