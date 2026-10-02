import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useWorkspacePage } from '../../../hooks/useWorkspacePage';
import { formatDateTime } from '@/lib/formatters';
import {
  User,
  FileText,
  Calendar,
  Folder,
  Image,
  Building2,
  DollarSign,
  CheckSquare,
  Package,
  CheckCircle,
  XCircle,
  Clock,
  Trash2,
  History,
} from 'lucide-react';
import { getUseRequest } from '../../../lib/api';
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
import { UseRequestObjectLinker } from '../../../components/collections/UseRequestObjectLinker';
import { CreateTaskSlideOver } from '../../../components/work/CreateTaskSlideOver';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { cn } from '../../../lib/utils';

import { useFormState, useSectionState, useSectionSummaries, useHasContent } from './hooks';
import {
  USE_REQUEST_SECTION_GROUPS,
  ALL_SECTION_IDS,
} from './types';
import { MadronaLoader } from '../../../components/ui/MadronaLoader';

const STATUS_STYLES: Record<string, string> = {
  submitted: 'bg-semantic-info/10 text-semantic-info',
  under_review: 'bg-semantic-info/10 text-semantic-info',
  approved: 'bg-semantic-success/10 text-semantic-success',
  denied: 'bg-semantic-error/10 text-semantic-error',
  in_progress: 'bg-forest/10 text-forest',
  completed: 'bg-stone text-archive',
  cancelled: 'bg-stone text-archive',
  withdrawn: 'bg-stone text-archive',
};

/**
 * Outer wrapper that provides section order context.
 */
export default function UseRequestWorkspacePage() {
  return (
    <SectionOrderProvider>
      <UseRequestWorkspacePageContent />
    </SectionOrderProvider>
  );
}

function UseRequestWorkspacePageContent() {
  const { orgId, requestId } = useParams<{ orgId: string; requestId?: string }>();

  // Fetch request data (disabled in create mode)
  const isCreateMode = !requestId;
  const { data: request, isLoading, error } = useQuery({
    queryKey: ['use-request', orgId, requestId],
    queryFn: () => getUseRequest(orgId!, requestId!),
    enabled: !isCreateMode && !!orgId && !!requestId,
  });

  const requestRecord = request as Record<string, unknown> | undefined;

  const wp = useWorkspacePage({
    entityType: 'use_request',
    entityId: requestId,
    entityLabel: requestRecord ? ((requestRecord.request_number as string) || `Use Request ${requestId!.slice(0, 8)}`) : undefined,
    orgId,
    editPermission: 'use_requests.edit',
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
    approveMutation,
    denyMutation,
    completeMutation,
    startReviewMutation,
    startProgressMutation,
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
    requester: {
      requester_name: formData.requester_name,
      requester_email: formData.requester_email,
    },
    details: {
      use_type: formData.use_type,
      use_purpose: formData.use_purpose,
    },
    objects: {},
    access: {
      access_date_start: formData.access_date_start,
      access_date_end: formData.access_date_end,
    },
    project: {
      project_title: formData.project_title,
    },
    reproduction: {
      reproduction_type: formData.reproduction_type,
    },
    exhibition: {
      exhibition_title: formData.exhibition_title,
    },
    fees: {
      fee_quoted: formData.fee_quoted,
    },
    approval: {
      approval_conditions: formData.approval_conditions,
    },
    history: {},
  };

  const currentStatus = (requestRecord?.status as string) || 'submitted';
  const displayNumber = formData.request_number || (requestRecord?.request_number as string) || '';
  const displayTitle = isCreateMode
    ? 'New Use Request'
    : (formData.project_title || (requestRecord?.project_title as string) || (requestRecord?.requester_name as string) || 'Use Request');

  // Loading state
  if (!isCreateMode && isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <MadronaLoader label="Loading…" />
      </div>
    );
  }

  // Error state
  if (!isCreateMode && (error || !request)) {
    return (
      <div className="p-6 max-w-4xl mx-auto text-center py-12">
        <FileText size={48} className="mx-auto text-archive mb-4" />
        <h3 className="text-lg font-serif font-medium text-forest mb-2">
          Use request not found
        </h3>
        <p className="text-accessible-gray mb-4">
          {error ? (error as Error).message : 'The use request record could not be loaded.'}
        </p>
      </div>
    );
  }

  const pageContent = (
    <div className={cn(!useNewLayout && 'p-6 max-w-4xl mx-auto')}>
      {/* Header - only in classic layout */}
      {!useNewLayout && (
        <WorkspaceHeader
          backUrl={`/organizations/${orgId}/collections/use-requests`}
          backText="Back to Use Requests"
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
          statusBadge={!isCreateMode && requestRecord ? (
            <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLES[currentStatus]}`}>
              {currentStatus.replace('_', ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
            </span>
          ) : undefined}
          typeBadge={!isCreateMode && requestRecord ? (
            <span className="text-xs px-2 py-0.5 bg-stone rounded-full text-archive uppercase tracking-wide">
              {getLabel('use_type', requestRecord.use_type as string)}
            </span>
          ) : undefined}
          actions={!isCreateMode && !isEditing ? (
            <div className="flex gap-2">
              {currentStatus === 'submitted' && (
                <button
                  onClick={() => startReviewMutation.mutate()}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm border border-lichen rounded-lg text-ink hover:bg-stone transition-colors"
                  disabled={startReviewMutation.isPending}
                >
                  <Clock size={14} />
                  Start Review
                </button>
              )}
              {currentStatus === 'under_review' && (
                <>
                  <button
                    onClick={() => approveMutation.mutate()}
                    className="btn btn-primary text-sm flex items-center gap-2"
                    disabled={approveMutation.isPending}
                  >
                    <CheckCircle size={14} />
                    Approve
                  </button>
                  <button
                    onClick={() => denyMutation.mutate()}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm border border-semantic-error/30 rounded-lg text-semantic-error hover:bg-semantic-error/10 transition-colors"
                    disabled={denyMutation.isPending}
                  >
                    <XCircle size={14} />
                    Deny
                  </button>
                </>
              )}
              {currentStatus === 'approved' && (
                <button
                  onClick={() => startProgressMutation.mutate()}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm border border-lichen rounded-lg text-ink hover:bg-stone transition-colors"
                  disabled={startProgressMutation.isPending}
                >
                  <Clock size={14} />
                  Start Fulfillment
                </button>
              )}
              {currentStatus === 'in_progress' && (
                <button
                  onClick={() => completeMutation.mutate()}
                  className="btn btn-primary text-sm flex items-center gap-2"
                  disabled={completeMutation.isPending}
                >
                  <CheckCircle size={14} />
                  Complete
                </button>
              )}
              <button
                onClick={() => dialogs.setShowDeleteConfirm(true)}
                className="flex items-center gap-2 px-3 py-1.5 text-sm border border-semantic-error/30 rounded-lg text-semantic-error hover:bg-semantic-error/10 transition-colors"
                disabled={deleteMutation.isPending}
              >
                <Trash2 size={14} />
                Delete
              </button>
            </div>
          ) : undefined}
        />
      )}

      {/* Edit mode indicator */}

      {/* Status bar - only in view/edit mode, not create mode */}
      {!isCreateMode && requestRecord && (
        <div className="flex items-center gap-4 mb-6">
          <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm ${STATUS_STYLES[currentStatus]}`}>
            {currentStatus.replace('_', ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
          </span>
          <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-stone rounded-full text-sm text-archive">
            {getLabel('use_type', requestRecord.use_type as string)}
          </span>
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

      {/* Sections */}
      <div className="flex flex-col gap-4">
        {/* === OVERVIEW GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Overview" icon={User} />}

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
              label="Title"
              value={formData.requester_title}
              isEditing={isEditing}
              onChange={(v) => updateField('requester_title', v)}
            />
            <EditableField
              label="Institution"
              value={formData.requester_institution}
              isEditing={isEditing}
              onChange={(v) => updateField('requester_institution', v)}
              className="md:col-span-2"
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

        {/* Request Details */}
        <WorkspaceSection
          id="details"
          title="Request Details"
          icon={<FileText size={18} />}
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
              isEditing={false}
              onChange={() => {}}
              placeholder={isCreateMode ? 'Auto-generated' : ''}
            />
            <EditableField
              label="Request Date"
              value={formData.request_date}
              isEditing={isEditing}
              onChange={(v) => updateField('request_date', v)}
              type="date"
            />
            <EditableSelect
              label="Use Type"
              value={formData.use_type}
              isEditing={isEditing}
              onChange={(v) => updateField('use_type', v)}
              options={getLookup('use_type')}
              required
            />
            <EditableField
              label="Purpose"
              value={formData.use_purpose}
              isEditing={isEditing}
              onChange={(v) => updateField('use_purpose', v)}
              placeholder="Brief description of purpose"
              className="md:col-span-2"
              required
            />
            <EditableField
              label="Description"
              value={formData.use_description}
              isEditing={isEditing}
              onChange={(v) => updateField('use_description', v)}
              multiline
              rows={3}
              placeholder="Detailed description of the use request..."
              className="md:col-span-2"
            />
          </div>
        </WorkspaceSection>

        {/* === LINKED GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Linked Records" icon={Package} />}

        {/* Requested Objects - only show for existing requests */}
        {!isCreateMode && (
          <WorkspaceSection
            id="objects"
            title="Requested Objects"
            icon={<Package size={18} />}
            isExpanded={expandedSections.objects}
            onToggle={() => toggleSection('objects')}
            isEditing={isEditing}
            order={getSectionOrder('objects')}
            isEmpty={!hasContent.objects}
            summary={sectionSummaries.objects}
          >
            <UseRequestObjectLinker
              organizationId={orgId!}
              requestId={requestId!}
              isEditing={isEditing}
            />
          </WorkspaceSection>
        )}

        {/* === SCHEDULING GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Scheduling" icon={Calendar} />}

        {/* Access Period */}
        <WorkspaceSection
          id="access"
          title="Access Period"
          icon={<Calendar size={18} />}
          isExpanded={expandedSections.access}
          onToggle={() => toggleSection('access')}
          isEditing={isEditing}
          order={getSectionOrder('access')}
          isEmpty={!hasContent.access}
          summary={sectionSummaries.access}
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <EditableField
              label="Start Date"
              value={formData.access_date_start}
              isEditing={isEditing}
              onChange={(v) => updateField('access_date_start', v)}
              type="date"
            />
            <EditableField
              label="End Date"
              value={formData.access_date_end}
              isEditing={isEditing}
              onChange={(v) => updateField('access_date_end', v)}
              type="date"
            />
            <EditableField
              label="Location Required"
              value={formData.location_required}
              isEditing={isEditing}
              onChange={(v) => updateField('location_required', v)}
              placeholder="e.g., Reading Room"
            />
          </div>
        </WorkspaceSection>

        {/* Project Details */}
        <WorkspaceSection
          id="project"
          title="Project Details"
          icon={<Folder size={18} />}
          isExpanded={expandedSections.project}
          onToggle={() => toggleSection('project')}
          isEditing={isEditing}
          order={getSectionOrder('project')}
          isEmpty={!hasContent.project}
          summary={sectionSummaries.project}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableField
              label="Project Title"
              value={formData.project_title}
              isEditing={isEditing}
              onChange={(v) => updateField('project_title', v)}
            />
            <EditableField
              label="Deadline"
              value={formData.project_deadline}
              isEditing={isEditing}
              onChange={(v) => updateField('project_deadline', v)}
              type="date"
            />
            <EditableField
              label="Project Description"
              value={formData.project_description}
              isEditing={isEditing}
              onChange={(v) => updateField('project_description', v)}
              multiline
              rows={3}
              className="md:col-span-2"
            />
          </div>
        </WorkspaceSection>

        {/* === FULFILLMENT GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Fulfillment" icon={Image} />}

        {/* Reproduction Details */}
        {formData.use_type === 'reproduction' && (
          <WorkspaceSection
            id="reproduction"
            title="Reproduction Details"
            icon={<Image size={18} />}
            isExpanded={expandedSections.reproduction}
            onToggle={() => toggleSection('reproduction')}
            isEditing={isEditing}
            order={getSectionOrder('reproduction')}
            isEmpty={!hasContent.reproduction}
            summary={sectionSummaries.reproduction}
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <EditableSelect
                label="Reproduction Type"
                value={formData.reproduction_type}
                isEditing={isEditing}
                onChange={(v) => updateField('reproduction_type', v)}
                options={getLookup('reproduction_type')}
                placeholder="Select type..."
              />
              <EditableField
                label="Format"
                value={formData.reproduction_format}
                isEditing={isEditing}
                onChange={(v) => updateField('reproduction_format', v)}
                placeholder="e.g., JPEG, TIFF"
              />
              <EditableField
                label="Quantity"
                value={formData.reproduction_quantity}
                isEditing={isEditing}
                onChange={(v) => updateField('reproduction_quantity', v)}
                type="number"
              />
              <EditableField
                label="Intended Use"
                value={formData.intended_use}
                isEditing={isEditing}
                onChange={(v) => updateField('intended_use', v)}
                placeholder="How will the reproduction be used?"
                className="md:col-span-3"
              />
              <EditableField
                label="Publication Details"
                value={formData.publication_details}
                isEditing={isEditing}
                onChange={(v) => updateField('publication_details', v)}
                placeholder="If for publication, provide details"
                className="md:col-span-3"
              />
              <EditableField
                label="Credit Line"
                value={formData.credit_line}
                isEditing={isEditing}
                onChange={(v) => updateField('credit_line', v)}
                placeholder="Required credit line"
                className="md:col-span-3"
              />
            </div>
          </WorkspaceSection>
        )}

        {/* Exhibition Details */}
        {formData.use_type === 'exhibition' && (
          <WorkspaceSection
            id="exhibition"
            title="Exhibition Details"
            icon={<Building2 size={18} />}
            isExpanded={expandedSections.exhibition}
            onToggle={() => toggleSection('exhibition')}
            isEditing={isEditing}
            order={getSectionOrder('exhibition')}
            isEmpty={!hasContent.exhibition}
            summary={sectionSummaries.exhibition}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <EditableField
                label="Exhibition Title"
                value={formData.exhibition_title}
                isEditing={isEditing}
                onChange={(v) => updateField('exhibition_title', v)}
                className="md:col-span-2"
              />
              <EditableField
                label="Venue"
                value={formData.exhibition_venue}
                isEditing={isEditing}
                onChange={(v) => updateField('exhibition_venue', v)}
              />
              <EditableField
                label="Dates"
                value={formData.exhibition_dates}
                isEditing={isEditing}
                onChange={(v) => updateField('exhibition_dates', v)}
                placeholder="e.g., Jan 2025 - Mar 2025"
              />
              <EditableField
                label="Insurance Value"
                value={formData.insurance_value}
                isEditing={isEditing}
                onChange={(v) => updateField('insurance_value', v)}
                type="number"
                placeholder="0.00"
              />
            </div>
          </WorkspaceSection>
        )}

        {/* === FINANCIAL GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Financial" icon={DollarSign} />}

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
            <EditableField
              label="Fee Quoted"
              value={formData.fee_quoted}
              isEditing={isEditing}
              onChange={(v) => updateField('fee_quoted', v)}
              type="number"
              placeholder="0.00"
            />
            <EditableField
              label="Fee Paid"
              value={formData.fee_paid}
              isEditing={isEditing}
              onChange={(v) => updateField('fee_paid', v)}
              type="number"
              placeholder="0.00"
            />
            <EditableCheckbox
              label="Fee Waived"
              value={formData.fee_waived}
              isEditing={isEditing}
              onChange={(v) => updateField('fee_waived', v)}
            />
            {formData.fee_waived && (
              <EditableField
                label="Waiver Reason"
                value={formData.fee_waiver_reason}
                isEditing={isEditing}
                onChange={(v) => updateField('fee_waiver_reason', v)}
                placeholder="Reason for fee waiver"
              />
            )}
          </div>
        </WorkspaceSection>

        {/* === ADMIN GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Admin" icon={History} />}

        {/* Approval Conditions */}
        {!isCreateMode && (
          <WorkspaceSection
            id="approval"
            title="Approval Conditions"
            icon={<CheckSquare size={18} />}
            isExpanded={expandedSections.approval}
            onToggle={() => toggleSection('approval')}
            isEditing={isEditing}
            order={getSectionOrder('approval')}
            isEmpty={!hasContent.approval}
            summary={sectionSummaries.approval}
          >
            <EditableField
              label="Conditions"
              value={formData.approval_conditions}
              isEditing={isEditing}
              onChange={(v) => updateField('approval_conditions', v)}
              multiline
              rows={3}
              placeholder="Any conditions attached to approval..."
            />
          </WorkspaceSection>
        )}

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
              entityType="use_request"
              entityId={requestId}
            />
          </WorkspaceSection>
        )}
      </div>

      {/* Footer metadata */}
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
        title="Delete Use Request"
        message={<>Are you sure you want to delete <strong>{displayNumber || 'this use request'}</strong>? This action cannot be undone.</>}
        confirmText="Delete"
        confirmStyle="danger"
      />

      {/* CreateTaskSlideOver */}
      {orgId && requestId && requestRecord && (
        <CreateTaskSlideOver
          isOpen={dialogs.showCreateTask}
          onClose={() => dialogs.setShowCreateTask(false)}
          orgId={orgId}
          initialEntityType={"use_request" as React.ComponentProps<typeof CreateTaskSlideOver>['initialEntityType']}
          initialEntityId={requestId}
          initialEntityLabel={(requestRecord.request_number as string) || `Use Request ${requestId.slice(0, 8)}`}
        />
      )}
    </div>
  );

  // New layout with RecordDetailPageWrapper
  if (useNewLayout && requestRecord) {
    return (
      <WorkspaceErrorBoundary
        backUrl={`/organizations/${orgId}/collections/use-requests`}
        backLabel="Back to Use Requests"
      >
        <RecordDetailPageWrapper
          object={null}
          media={[]}
          sectionIds={ALL_SECTION_IDS}
          sectionGroups={USE_REQUEST_SECTION_GROUPS}
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
          pageType="use-request"
          enabled={true}
          showHeader={true}
          title="Use Request"
          objectNumber={displayNumber || undefined}
          subtitle={displayTitle}
          backUrl={`/organizations/${orgId}/collections/use-requests`}
          backLabel="Back to Use Requests"
        >
          {pageContent}
        </RecordDetailPageWrapper>
      </WorkspaceErrorBoundary>
    );
  }

  return (
    <WorkspaceErrorBoundary
      backUrl={orgId ? `/organizations/${orgId}/collections/use-requests` : undefined}
      backLabel="Back to Use Requests"
    >
      {pageContent}
    </WorkspaceErrorBoundary>
  );
}
