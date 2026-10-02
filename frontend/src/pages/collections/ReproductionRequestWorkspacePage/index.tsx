import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useWorkspacePage } from '../../../hooks/useWorkspacePage';
import { formatCurrency, formatDateTime } from '@/lib/formatters';
import {
  Copy,
  User,
  Link as LinkIcon,
  Scale,
  DollarSign,
  Package,
  StickyNote,
  CheckCircle,
  XCircle,
  Clock,
  Camera,
  Truck,
  History,
} from 'lucide-react';
import {
  getReproductionRequest,
} from '../../../lib/api';
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
} from '../../../components/workspace';
import { RecordDetailPageWrapper, SectionOrderProvider } from '../../../components/record-detail';
import { CreateTaskSlideOver } from '../../../components/work/CreateTaskSlideOver';
import { ObjectSelector } from '../../../components/collections/ObjectSelector';
import { cn } from '../../../lib/utils';
import { useProcedureRequirements } from '../../../hooks/useProcedureRequirements';
import { ProcedureRequirementsCard } from '../../../components/collections/ProcedureRequirementsCard';
import ConfirmDialog from '../../../components/ConfirmDialog';

import { useFormState, useSectionState, useSectionSummaries, useHasContent } from './hooks';
import {
  REPRODUCTION_REQUEST_SECTION_GROUPS,
  ALL_SECTION_IDS,
  STATUS_CONFIG,
} from './types';
import { MadronaLoader } from '../../../components/ui/MadronaLoader';

/**
 * Outer wrapper that provides section order context.
 */
export default function ReproductionRequestWorkspacePage() {
  return (
    <SectionOrderProvider>
      <ReproductionRequestWorkspacePageContent />
    </SectionOrderProvider>
  );
}

function ReproductionRequestWorkspacePageContent() {
  const { orgId, requestId } = useParams<{ orgId: string; requestId?: string }>();

  // Fetch request data (disabled in create mode)
  const isCreateMode = !requestId;
  const { requirementGroups } = useProcedureRequirements('reproduction_request', orgId);

  const { data: existingRequest, isLoading, error } = useQuery({
    queryKey: ['reproduction-request', orgId, requestId],
    queryFn: () => getReproductionRequest(orgId!, requestId!),
    enabled: !isCreateMode && !!orgId && !!requestId,
  });

  const requestRecord = existingRequest as Record<string, unknown> | undefined;

  const wp = useWorkspacePage({
    entityType: 'reproduction_request',
    entityId: requestId,
    entityLabel: requestRecord ? ((requestRecord.request_number as string) || `Request ${requestId!.slice(0, 8)}`) : undefined,
    orgId,
    editPermission: 'reproduction_requests.edit',
  });
  const { isEditing, setIsEditing, useNewLayout, canEdit, hasPermission, dialogs } = wp;

  const form = useFormState({
    orgId,
    requestId,
    isCreateMode,
    request: requestRecord,
  });

  const {
    formData,
    updateField,
    hasUnsavedChanges,
    saveStatus,
    lastSaved,
    errorMessage,
    queryClient,
    triggerSave,
    handleCreate,
    deleteMutation,
    clearRightsMutation,
    statusMutation,
    deliverMutation,
    getLookup,
    getLabel,
  } = form;

  const sectionState = useSectionState({
    orgId,
    requestId,
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

  const sectionSummaries = useSectionSummaries(formData);
  const hasContent = useHasContent(formData);

  // Compute sectionData for nav completeness indicators
  const sectionData: Record<string, unknown> = {
    details: {
      request_number: formData.request_number,
      reproduction_type: formData.reproduction_type,
    },
    requester: {
      requester_name: formData.requester_name,
      requester_email: formData.requester_email,
    },
    linkedObject: {
      object_id: formData.object_id,
    },
    rights: {
      rights_cleared: formData.rights_cleared,
      rights_check_date: formData.rights_check_date,
    },
    fees: {
      fee_type: formData.fee_type,
      fee_amount: formData.fee_amount,
    },
    fulfillment: {
      delivery_method: formData.delivery_method,
      delivery_date: formData.delivery_date,
    },
    notes: {
      notes: formData.notes,
    },
    history: {},
  };

  // Format currency for display (uses centralized formatter)
  const formatCurrencyDisplay = (amount: number, currency = 'USD') => {
    return formatCurrency(amount, currency, 2);
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
  if (!isCreateMode && (error || !existingRequest)) {
    return (
      <div className="p-6 max-w-4xl mx-auto text-center py-12">
        <Copy size={48} className="mx-auto text-archive mb-4" />
        <h3 className="text-lg font-serif font-medium text-forest mb-2">
          Reproduction request not found
        </h3>
        <p className="text-accessible-gray mb-4">
          {error ? (error as Error).message : 'The reproduction request could not be loaded.'}
        </p>
      </div>
    );
  }

  const statusConfig = !isCreateMode && requestRecord
    ? STATUS_CONFIG[(requestRecord.status as string)] || STATUS_CONFIG.submitted
    : STATUS_CONFIG.submitted;
  const StatusIcon = statusConfig.icon;

  const displayNumber = isCreateMode ? '' : ((requestRecord?.request_number as string) || '');
  const displayTitle = isCreateMode
    ? 'New Reproduction Request'
    : ((requestRecord?.requester_name as string) || getLabel('reproduction_type', (requestRecord?.reproduction_type as string) || ''));

  const pageContent = (
    <div className={cn(!useNewLayout && 'p-6 max-w-4xl mx-auto')}>
      {/* Header - only in classic layout */}
      {!useNewLayout && (
        <WorkspaceHeader
          backUrl={`/organizations/${orgId}/collections/reproduction-requests`}
          backText="Back to Reproduction Requests"
          title={displayTitle}
          objectNumber={displayNumber}
          isEditing={isEditing}
          saveStatus={saveStatus}
          lastSaved={lastSaved}
          hasUnsavedChanges={hasUnsavedChanges}
          showCreateButton={isCreateMode}
          createButtonText="Create Request"
          onSave={isCreateMode ? handleCreate : undefined}
          onToggleMode={isCreateMode ? undefined : handleToggleMode}
        />
      )}

      {/* Edit mode indicator */}

      {/* Status Bar - only show in view/edit mode, not create mode */}
      {!isCreateMode && requestRecord && (
        <div className="flex items-center gap-4 mb-6 flex-wrap">
          <span className={cn('inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium', statusConfig.color)}>
            <StatusIcon size={16} />
            {statusConfig.label}
          </span>
          {Boolean(requestRecord.rights_cleared) && (
            <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-semantic-success/10 text-semantic-success rounded-full text-sm font-medium">
              <CheckCircle size={16} />
              Rights Cleared
            </span>
          )}
          {Boolean(requestRecord.fee_amount) && (
            <span className="text-sm text-archive">
              {formatCurrencyDisplay(requestRecord.fee_amount as number, (requestRecord.fee_currency as string) || undefined)}
              {requestRecord.fee_paid ? ' (Paid)' : ' (Unpaid)'}
            </span>
          )}

          {/* Status Actions */}
          <div className="flex-1" />
          {requestRecord.status === 'submitted' && (
            <button
              onClick={() => statusMutation.mutate('rights_review')}
              className="btn btn-secondary text-sm"
              disabled={statusMutation.isPending}
            >
              <Clock size={16} className="mr-1.5" />
              Start Rights Review
            </button>
          )}
          {requestRecord.status === 'rights_review' && !requestRecord.rights_cleared && (
            <button
              onClick={() => clearRightsMutation.mutate()}
              className="btn btn-secondary text-sm"
              disabled={clearRightsMutation.isPending}
            >
              <CheckCircle size={16} className="mr-1.5" />
              Clear Rights
            </button>
          )}
          {requestRecord.status === 'rights_review' && Boolean(requestRecord.rights_cleared) && (
            <>
              <button
                onClick={() => statusMutation.mutate('approved')}
                className="btn btn-primary text-sm"
                disabled={statusMutation.isPending}
              >
                <CheckCircle size={16} className="mr-1.5" />
                Approve
              </button>
              <button
                onClick={() => statusMutation.mutate('denied')}
                className="btn btn-danger text-sm"
                disabled={statusMutation.isPending}
              >
                <XCircle size={16} className="mr-1.5" />
                Deny
              </button>
            </>
          )}
          {requestRecord.status === 'approved' && (
            <button
              onClick={() => statusMutation.mutate('in_production')}
              className="btn btn-secondary text-sm"
              disabled={statusMutation.isPending}
            >
              <Camera size={16} className="mr-1.5" />
              Start Production
            </button>
          )}
          {requestRecord.status === 'in_production' && (
            <button
              onClick={() => deliverMutation.mutate()}
              className="btn btn-primary text-sm"
              disabled={deliverMutation.isPending}
            >
              <Truck size={16} className="mr-1.5" />
              Mark Delivered
            </button>
          )}
          {requestRecord.status === 'delivered' && (
            <button
              onClick={() => statusMutation.mutate('completed')}
              className="btn btn-primary text-sm"
              disabled={statusMutation.isPending}
            >
              <CheckCircle size={16} className="mr-1.5" />
              Complete
            </button>
          )}
        </div>
      )}

      {/* Error message */}
      {errorMessage && (
        <div className="mb-4 p-4 bg-semantic-error/10 border border-semantic-error/30 rounded-lg">
          <p className="text-semantic-error">{errorMessage}</p>
        </div>
      )}

      {/* Read-only indicator */}
      <ReadOnlyBanner visible={!isCreateMode && !canEdit} />

      {/* Procedure Compliance Card */}
      {!isCreateMode && requestRecord && (
                  <ProcedureRequirementsCard
            title="Reproduction Requirements"
            requirementGroups={requirementGroups}
            record={formData as unknown as Record<string, unknown>}
            currentStatus={(requestRecord.status as string) || 'submitted'}
            statusOrder={['submitted', 'rights_review', 'approved', 'denied', 'in_production', 'delivered', 'completed', 'cancelled']}
            onSectionNavigate={handleEnterEditMode}
          />
      )}

      {/* Sections */}
      <div className="flex flex-col gap-4">
        {/* === OVERVIEW GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Overview" icon={Copy} />}

        {/* Request Details */}
        <WorkspaceSection
          id="details"
          title="Request Details"
          icon={<Copy size={18} />}
          isExpanded={expandedSections.details}
          onToggle={() => toggleSection('details')}
          isEditing={isEditing}
          order={getSectionOrder('details')}
          isEmpty={!hasContent.details}
          summary={sectionSummaries.details}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableField
              label="Request Number"
              value={formData.request_number}
              isEditing={isEditing}
              onChange={(v) => updateField('request_number', v)}
              placeholder="e.g., REP-2026-001"
              required
            />
            <EditableSelect
              label="Reproduction Type"
              value={formData.reproduction_type}
              isEditing={isEditing}
              onChange={(v) => updateField('reproduction_type', v)}
              options={getLookup('reproduction_type')}
              required
            />
            <EditableSelect
              label="Purpose"
              value={formData.reproduction_purpose}
              isEditing={isEditing}
              onChange={(v) => updateField('reproduction_purpose', v)}
              options={getLookup('reproduction_purpose')}
              placeholder="Select purpose..."
            />
            <EditableField
              label="Quantity"
              value={formData.quantity}
              isEditing={isEditing}
              onChange={(v) => updateField('quantity', v)}
              type="number"
            />
            <EditableField
              label="Format Requested"
              value={formData.format_requested}
              isEditing={isEditing}
              onChange={(v) => updateField('format_requested', v)}
              placeholder="e.g., TIFF, JPEG, 300dpi"
            />
            <EditableField
              label="Dimensions"
              value={formData.dimensions_requested}
              isEditing={isEditing}
              onChange={(v) => updateField('dimensions_requested', v)}
              placeholder="e.g., 8x10 inches, 4000x3000px"
            />
            <EditableField
              label="Intended Use"
              value={formData.intended_use}
              isEditing={isEditing}
              onChange={(v) => updateField('intended_use', v)}
              multiline
              rows={3}
              placeholder="Describe how the reproduction will be used..."
              className="md:col-span-2"
            />
          </div>
        </WorkspaceSection>

        {/* Requester Information */}
        <WorkspaceSection
          id="requester"
          title="Requester Information"
          icon={<User size={18} />}
          isExpanded={expandedSections.requester}
          onToggle={() => toggleSection('requester')}
          isEditing={isEditing}
          order={getSectionOrder('requester')}
          isEmpty={!hasContent.requester}
          summary={sectionSummaries.requester}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableField
              label="Name"
              value={formData.requester_name}
              isEditing={isEditing}
              onChange={(v) => updateField('requester_name', v)}
              required
            />
            <EditableField
              label="Institution"
              value={formData.requester_institution}
              isEditing={isEditing}
              onChange={(v) => updateField('requester_institution', v)}
            />
            <EditableField
              label="Email"
              value={formData.requester_email}
              isEditing={isEditing}
              onChange={(v) => updateField('requester_email', v)}
              type="email"
            />
            <EditableField
              label="Phone"
              value={formData.requester_phone}
              isEditing={isEditing}
              onChange={(v) => updateField('requester_phone', v)}
            />
          </div>
        </WorkspaceSection>

        {/* === LINKED GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Linked Records" icon={LinkIcon} />}

        {/* Linked Object */}
        <WorkspaceSection
          id="linkedObject"
          title="Linked Object"
          icon={<LinkIcon size={18} />}
          isExpanded={expandedSections.linkedObject}
          onToggle={() => toggleSection('linkedObject')}
          isEditing={isEditing}
          order={getSectionOrder('linkedObject')}
          isEmpty={!hasContent.linkedObject}
          summary={sectionSummaries.linkedObject}
        >
          <ObjectSelector
            organizationId={orgId!}
            objectId={formData.object_id || null}
            onChange={(id) => updateField('object_id', id || '')}
            isEditing={isEditing}
            label="Linked Object"
          />
        </WorkspaceSection>

        {/* === COMPLIANCE GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Rights & Fees" icon={Scale} />}

        {/* Rights Clearance */}
        <WorkspaceSection
          id="rights"
          title="Rights Clearance"
          icon={<Scale size={18} />}
          isExpanded={expandedSections.rights}
          onToggle={() => toggleSection('rights')}
          isEditing={isEditing}
          order={getSectionOrder('rights')}
          isEmpty={!hasContent.rights}
          summary={sectionSummaries.rights}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableCheckbox
              label="Rights have been cleared"
              value={formData.rights_cleared}
              isEditing={isEditing}
              onChange={(v) => updateField('rights_cleared', v)}
            />
            <EditableField
              label="Rights Check Date"
              value={formData.rights_check_date}
              isEditing={isEditing}
              onChange={(v) => updateField('rights_check_date', v)}
              type="date"
            />
            <EditableField
              label="Rights Restrictions"
              value={formData.rights_restrictions}
              isEditing={isEditing}
              onChange={(v) => updateField('rights_restrictions', v)}
              multiline
              rows={2}
              placeholder="Any restrictions on use..."
              className="md:col-span-2"
            />
            <EditableField
              label="Required Credit Line"
              value={formData.credit_line_required}
              isEditing={isEditing}
              onChange={(v) => updateField('credit_line_required', v)}
              placeholder="Credit line that must accompany reproduction"
              className="md:col-span-2"
            />
          </div>
        </WorkspaceSection>

        {/* Fees */}
        <WorkspaceSection
          id="fees"
          title="Fees"
          icon={<DollarSign size={18} />}
          isExpanded={expandedSections.fees}
          onToggle={() => toggleSection('fees')}
          isEditing={isEditing}
          order={getSectionOrder('fees')}
          isEmpty={!hasContent.fees}
          summary={sectionSummaries.fees}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableSelect
              label="Fee Type"
              value={formData.fee_type}
              isEditing={isEditing}
              onChange={(v) => updateField('fee_type', v)}
              options={getLookup('fee_type')}
              placeholder="Select fee type..."
            />
            <EditableField
              label="Amount"
              value={formData.fee_amount}
              isEditing={isEditing}
              onChange={(v) => updateField('fee_amount', v)}
              type="number"
              placeholder="0.00"
            />
            <EditableSelect
              label="Currency"
              value={formData.fee_currency}
              isEditing={isEditing}
              onChange={(v) => updateField('fee_currency', v)}
              options={getLookup('currency')}
            />
            <EditableCheckbox
              label="Fee has been paid"
              value={formData.fee_paid}
              isEditing={isEditing}
              onChange={(v) => updateField('fee_paid', v)}
            />
            {formData.fee_paid && (
              <EditableField
                label="Payment Date"
                value={formData.payment_date}
                isEditing={isEditing}
                onChange={(v) => updateField('payment_date', v)}
                type="date"
              />
            )}
          </div>
        </WorkspaceSection>

        {/* === FULFILLMENT GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Fulfillment" icon={Package} />}

        {/* Fulfillment */}
        <WorkspaceSection
          id="fulfillment"
          title="Fulfillment"
          icon={<Package size={18} />}
          isExpanded={expandedSections.fulfillment}
          onToggle={() => toggleSection('fulfillment')}
          isEditing={isEditing}
          order={getSectionOrder('fulfillment')}
          isEmpty={!hasContent.fulfillment}
          summary={sectionSummaries.fulfillment}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableSelect
              label="Delivery Method"
              value={formData.delivery_method}
              isEditing={isEditing}
              onChange={(v) => updateField('delivery_method', v)}
              options={getLookup('delivery_method')}
              placeholder="Select method..."
            />
            <EditableField
              label="Delivery Date"
              value={formData.delivery_date}
              isEditing={isEditing}
              onChange={(v) => updateField('delivery_date', v)}
              type="date"
            />
            <EditableField
              label="Master File Reference"
              value={formData.master_file_reference}
              isEditing={isEditing}
              onChange={(v) => updateField('master_file_reference', v)}
              placeholder="Path or reference to master file"
              className="md:col-span-2"
            />
            <EditableCheckbox
              label="Quality approved"
              value={formData.quality_approved}
              isEditing={isEditing}
              onChange={(v) => updateField('quality_approved', v)}
            />
          </div>
        </WorkspaceSection>

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
          isEmpty={!hasContent.notes}
          summary={sectionSummaries.notes}
        >
          <EditableField
            label="Notes"
            value={formData.notes}
            isEditing={isEditing}
            onChange={(v) => updateField('notes', v)}
            multiline
            rows={4}
            placeholder="Additional notes about this request..."
          />
        </WorkspaceSection>

        {/* Change History */}
        {hasPermission('org.view_audit_logs') && !isCreateMode && orgId && requestId && (
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
              entityType="reproduction_request"
              entityId={requestId}
            />
          </WorkspaceSection>
        )}
      </div>

      {/* Footer metadata - only in view/edit mode, not create mode */}
      {!isCreateMode && requestRecord && (requestRecord.created_at as string) && (
        <div className="mt-8 pt-6 border-t border-lichen text-sm text-archive">
          <p>Created: {formatDateTime(requestRecord.created_at as string)}</p>
          {Boolean(requestRecord.updated_at) && (
            <p>Last updated: {formatDateTime(requestRecord.updated_at as string)}</p>
          )}
        </div>
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        isOpen={dialogs.showDeleteConfirm}
        onClose={() => dialogs.setShowDeleteConfirm(false)}
        onConfirm={() => {
          deleteMutation.mutate();
          dialogs.setShowDeleteConfirm(false);
        }}
        title="Delete Reproduction Request"
        message={<>Are you sure you want to delete <strong>{displayNumber || 'this reproduction request'}</strong>? This action cannot be undone.</>}
        confirmText="Delete"
        confirmStyle="danger"
      />

      {/* CreateTaskSlideOver */}
      {orgId && requestId && requestRecord && (
        <CreateTaskSlideOver
          isOpen={dialogs.showCreateTask}
          onClose={() => dialogs.setShowCreateTask(false)}
          orgId={orgId}
          initialEntityType={"reproduction_request" as React.ComponentProps<typeof CreateTaskSlideOver>['initialEntityType']}
          initialEntityId={requestId}
          initialEntityLabel={(requestRecord.request_number as string) || `Request ${requestId.slice(0, 8)}`}
        />
      )}
    </div>
  );

  // New layout with RecordDetailPageWrapper
  if (useNewLayout && requestRecord) {
    return (
      <WorkspaceErrorBoundary
        backUrl={`/organizations/${orgId}/collections/reproduction-requests`}
        backLabel="Back to Reproduction Requests"
      >
        <RecordDetailPageWrapper
          object={null}
          media={[]}
          sectionIds={ALL_SECTION_IDS}
          sectionGroups={REPRODUCTION_REQUEST_SECTION_GROUPS}
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
          pageType="reproduction-request"
          enabled={true}
          showHeader={true}
          title="Reproduction Request"
          objectNumber={(requestRecord.request_number as string) || undefined}
          subtitle={displayTitle}
          backUrl={`/organizations/${orgId}/collections/reproduction-requests`}
          backLabel="Back to Reproduction Requests"
        >
          {pageContent}
        </RecordDetailPageWrapper>
      </WorkspaceErrorBoundary>
    );
  }

  return (
    <WorkspaceErrorBoundary
      backUrl={orgId ? `/organizations/${orgId}/collections/reproduction-requests` : undefined}
      backLabel="Back to Reproduction Requests"
    >
      {pageContent}
    </WorkspaceErrorBoundary>
  );
}
