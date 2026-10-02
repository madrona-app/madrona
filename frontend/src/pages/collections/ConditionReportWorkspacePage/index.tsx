import { useState, useEffect } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { formatDateTime } from '@/lib/formatters';
import {
  FileText,
  Activity,
  Wrench,
  Hand,
  StickyNote,
  CheckCircle,
  Shield,
  Clock,
  Search,
  X,
  User,
  History,
} from 'lucide-react';
import { ContactSelectorSlideOver } from '../../../components/collections/ConstituentSelectorSlideOver';
import { GenerateReportSlideOver } from '../../../components/reports/GenerateReportSlideOver';
import { ObjectSelector } from '../../../components/collections/ObjectSelector';
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
import { useProcedureRequirements } from '../../../hooks/useProcedureRequirements';
import { ProcedureRequirementsCard } from '../../../components/collections/ProcedureRequirementsCard';
import ConfirmDialog from '../../../components/ConfirmDialog';

import { useFormState, useSectionState, useSectionSummaries, useHasContent } from './hooks';
import {
  CONDITION_REPORT_SECTION_GROUPS,
  ALL_SECTION_IDS,
} from './types';

import type { LucideIcon } from 'lucide-react';
import { MadronaLoader } from '../../../components/ui/MadronaLoader';

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: LucideIcon }> = {
  draft: { label: 'Draft', color: 'bg-stone text-ink', icon: Clock },
  completed: { label: 'Completed', color: 'bg-semantic-info/10 text-semantic-info', icon: CheckCircle },
  reviewed: { label: 'Reviewed', color: 'bg-semantic-success/10 text-semantic-success', icon: Shield },
};

const CONDITION_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  excellent: { bg: 'bg-semantic-success/10', text: 'text-semantic-success', label: 'Excellent' },
  good: { bg: 'bg-forest/10', text: 'text-forest', label: 'Good' },
  fair: { bg: 'bg-semantic-warning/10', text: 'text-semantic-warning', label: 'Fair' },
  poor: { bg: 'bg-copper/10', text: 'text-copper', label: 'Poor' },
  unacceptable: { bg: 'bg-semantic-error/10', text: 'text-semantic-error', label: 'Unacceptable' },
};

/**
 * Outer wrapper that provides section order context.
 */
export default function ConditionReportWorkspacePage() {
  return (
    <SectionOrderProvider>
      <ConditionReportWorkspacePageContent />
    </SectionOrderProvider>
  );
}

function ConditionReportWorkspacePageContent() {
  const { orgId, reportId } = useParams<{ orgId: string; reportId?: string }>();
  const [searchParams] = useSearchParams();
  const { getLookup } = useLookupValues({ context: 'condition_reports' });
  const { requirementGroups } = useProcedureRequirements('condition_report', orgId);

  const [showExaminerSelector, setShowExaminerSelector] = useState(false);
  const [showReportSlideOver, setShowReportSlideOver] = useState(false);

  // Get object_id from URL query params for create mode
  const initialObjectId = searchParams.get('object_id') || '';
  const isCreateMode = !reportId;

  const form = useFormState({
    orgId,
    reportId,
    isCreateMode: isCreateMode,
  });

  const {
    formData,
    updateField,
    hasUnsavedChanges,
    saveStatus,
    lastSaved,
    errorMessage,
    existingReport,
    isLoading,
    error,
    examinerContact,
    queryClient,
    triggerSave,
    handleCreate,
    statusMutation,
    deleteMutation,
  } = form;

  // Set initial object_id for create mode
  useEffect(() => {
    if (isCreateMode && initialObjectId) {
      updateField('object_id', initialObjectId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const wp = useWorkspacePage({
    entityType: 'condition_report',
    entityId: reportId,
    entityLabel: existingReport?.report_number,
    orgId,
    editPermission: 'condition_reports.edit',
    restrictedFields: existingReport?._restricted_fields,
  });
  const { isEditing, setIsEditing, useNewLayout, canEdit, isRestricted, hasPermission, dialogs } = wp;

  const sectionState = useSectionState({
    orgId,
    reportId,
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
    report: {
      report_type: formData.report_type,
      report_date: formData.report_date,
      examiner_id: formData.examiner_id,
      object_id: formData.object_id,
    },
    condition: {
      overall_condition: formData.overall_condition,
      condition_summary: formData.condition_summary,
    },
    conservation: {
      conservation_needed: formData.conservation_needed,
      conservation_priority: formData.conservation_priority,
    },
    requirements: {
      handling_requirements: formData.handling_requirements,
      packing_requirements: formData.packing_requirements,
      display_restrictions: formData.display_restrictions,
    },
    notes: {
      report_note: formData.report_note,
    },
    history: {},
  };

  // Get label from lookup options
  const getTypeLabel = (value: string) => {
    const options = getLookup('report_type');
    return options.find(o => o.value === value)?.label || value;
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
  if (!isCreateMode && (error || !existingReport)) {
    return (
      <div className="p-6 max-w-4xl mx-auto text-center py-12">
        <FileText size={48} className="mx-auto text-archive mb-4" />
        <h3 className="text-lg font-serif font-medium text-forest mb-2">
          Report not found
        </h3>
        <p className="text-accessible-gray mb-4">
          {error ? (error as Error).message : 'The condition report could not be loaded.'}
        </p>
        <Link
          to={`/organizations/${orgId}/collections/condition-reports`}
          className="text-bark hover:text-copper-dark"
        >
          Back to Condition Reports
        </Link>
      </div>
    );
  }

  const statusConfig = !isCreateMode && existingReport ? STATUS_CONFIG[existingReport.status] || STATUS_CONFIG.draft : STATUS_CONFIG.draft;
  const StatusIcon = statusConfig.icon;
  const conditionStyle = !isCreateMode && existingReport?.overall_condition ? CONDITION_STYLES[existingReport.overall_condition] : null;
  const displayNumber = isCreateMode ? '' : (existingReport?.report_number || '');
  const displayTitle = isCreateMode
    ? 'New Condition Report'
    : getTypeLabel(existingReport?.report_type || 'periodic');

  const pageContent = (
    <div className={cn(!useNewLayout && 'p-6 max-w-4xl mx-auto')}>
      {/* Header - only in classic layout */}
      {!useNewLayout && (
        <WorkspaceHeader
          backUrl={`/organizations/${orgId}/collections/condition-reports`}
          backText="Back to Condition Reports"
          title={displayTitle}
          objectNumber={displayNumber}
          isEditing={isEditing}
          saveStatus={saveStatus}
          lastSaved={lastSaved}
          hasUnsavedChanges={hasUnsavedChanges}
          showCreateButton={isCreateMode}
          createButtonText="Create Condition Report"
          onSave={isCreateMode ? handleCreate : undefined}
          onToggleMode={isCreateMode ? undefined : handleToggleMode}
        />
      )}

      {/* Edit mode indicator */}

      {/* Status Bar - only show in view/edit mode, not create mode */}
      {!isCreateMode && existingReport && (
        <div className="flex items-center gap-4 mb-6">
          <span className={cn('inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium', statusConfig.color)}>
            <StatusIcon size={16} />
            {statusConfig.label}
          </span>
          {conditionStyle && (
            <span className={cn('inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium', conditionStyle.bg, conditionStyle.text)}>
              {conditionStyle.label} Condition
            </span>
          )}

          {/* Status Actions */}
          <div className="flex-1" />
          <button
            onClick={() => setShowReportSlideOver(true)}
            className="btn btn-secondary text-sm"
          >
            <FileText size={16} className="mr-1.5" />
            Generate Report
          </button>
          {existingReport.status === 'draft' && (
            <button
              onClick={() => statusMutation.mutate('completed')}
              className="btn btn-secondary text-sm"
              disabled={statusMutation.isPending}
            >
              <CheckCircle size={16} className="mr-1.5" />
              Mark Complete
            </button>
          )}
          {existingReport.status === 'completed' && (
            <button
              onClick={() => statusMutation.mutate('reviewed')}
              className="btn btn-secondary text-sm"
              disabled={statusMutation.isPending}
            >
              <Shield size={16} className="mr-1.5" />
              Mark Reviewed
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
      <PendingApprovalBanner
        visible={!isCreateMode && existingReport?.status === 'pending_approval'}
        entityType="condition_report"
        entityId={reportId || ''}
        orgId={orgId || ''}
        onReviewed={() => window.location.reload()}
      />

      {/* Procedure Compliance Card */}
      {!isCreateMode && existingReport && (
                  <ProcedureRequirementsCard
            title="Condition Report Requirements"
            requirementGroups={requirementGroups}
            record={formData as unknown as Record<string, unknown>}
            currentStatus={existingReport.status}
            statusOrder={['draft', 'completed', 'reviewed', 'superseded']}
            onSectionNavigate={handleEnterEditMode}
          />
      )}

      {/* Sections */}
      <div className="flex flex-col gap-4">
        {/* === OVERVIEW GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Overview" icon={FileText} />}

        {/* Report Information */}
        <WorkspaceSection
          id="report"
          title="Report Information"
          icon={<FileText size={18} />}
          isExpanded={expandedSections.report}
          onToggle={() => toggleSection('report')}
          isEditing={isEditing}
          order={getSectionOrder('report')}
          isEmpty={!hasContent.report}
          summary={sectionSummaries.report}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableSelect
              label="Report Type"
              value={formData.report_type}
              isEditing={isEditing}
              onChange={(v) => updateField('report_type', v)}
              required
              options={getLookup('report_type')}
            />
            <EditableField
              label="Report Date"
              value={formData.report_date}
              isEditing={isEditing}
              onChange={(v) => updateField('report_date', v)}
              type="date"
              required
            />
            <EditableField
              label="Check Reason"
              value={formData.check_reason}
              isEditing={isEditing}
              onChange={(v) => updateField('check_reason', v)}
              placeholder="Why is this condition check being performed?"
              className="md:col-span-2"
            />
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">
                Examiner
              </label>
              {isEditing ? (
                <div className="flex items-center gap-2">
                  {formData.examiner_id && examinerContact ? (
                    <div className="flex-1 flex items-center gap-2 px-3 py-2 border border-lichen rounded-lg bg-parchment">
                      <User size={16} className="text-archive flex-shrink-0" />
                      <span className="text-sm text-ink">{examinerContact.name}</span>
                      {examinerContact.organization_name && (
                        <span className="text-xs text-archive">({examinerContact.organization_name})</span>
                      )}
                      <button
                        type="button"
                        onClick={() => updateField('examiner_id', '')}
                        className="ml-auto p-1 text-archive hover:text-semantic-error"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowExaminerSelector(true)}
                      className="flex-1 flex items-center gap-2 px-3 py-2 border border-dashed border-lichen rounded-lg text-sm text-archive hover:border-bark hover:text-bark transition-colors"
                    >
                      <Search size={16} />
                      Search or create examiner...
                    </button>
                  )}
                  {formData.examiner_id && (
                    <button
                      type="button"
                      onClick={() => setShowExaminerSelector(true)}
                      className="px-3 py-2 text-sm text-bark hover:text-copper-dark"
                    >
                      Change
                    </button>
                  )}
                </div>
              ) : (
                <div className="text-sm text-ink">
                  {examinerContact ? (
                    <span>
                      {examinerContact.name}
                      {examinerContact.organization_name && (
                        <span className="text-archive ml-1">({examinerContact.organization_name})</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-archive">Not specified</span>
                  )}
                </div>
              )}
            </div>
            <ObjectSelector
              organizationId={orgId!}
              objectId={formData.object_id || null}
              onChange={(id) => updateField('object_id', id || '')}
              isEditing={isEditing}
              label="Linked Object"
            />
          </div>
        </WorkspaceSection>

        {/* Condition Assessment */}
        <WorkspaceSection
          id="condition"
          title="Condition Assessment"
          icon={<Activity size={18} />}
          isExpanded={expandedSections.condition}
          onToggle={() => toggleSection('condition')}
          isEditing={isEditing}
          order={getSectionOrder('condition')}
          isEmpty={!hasContent.condition}
          summary={sectionSummaries.condition}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableSelect
              label="Overall Condition"
              value={formData.overall_condition}
              isEditing={isEditing}
              onChange={(v) => updateField('overall_condition', v)}
              options={getLookup('condition')}
              placeholder="Select condition..."
            />
            <div className="md:col-span-2">
              <EditableField
                label="Condition Summary"
                value={formData.condition_summary}
                isEditing={isEditing}
                onChange={(v) => updateField('condition_summary', v)}
                multiline
                rows={4}
                placeholder="Detailed description of current condition..."
              />
            </div>
            {/* Completeness */}
            <EditableField
              label="Completeness"
              value={formData.completeness}
              isEditing={isEditing}
              onChange={(v) => updateField('completeness', v)}
              multiline
              rows={2}
              placeholder="Assessment of whether the object is complete..."
              className="md:col-span-2"
            />
            <EditableField
              label="Completeness Date"
              value={formData.completeness_date}
              isEditing={isEditing}
              onChange={(v) => updateField('completeness_date', v)}
              type="date"
            />
            <EditableField
              label="Hazards"
              value={formData.hazards}
              isEditing={isEditing}
              onChange={(v) => updateField('hazards', v)}
              multiline
              rows={2}
              placeholder="Any hazards or safety concerns..."
              className="md:col-span-2"
              restricted={isRestricted('hazards')}
            />
            <EditableField
              label="Recommendations"
              value={formData.recommendations}
              isEditing={isEditing}
              onChange={(v) => updateField('recommendations', v)}
              multiline
              rows={3}
              placeholder="Treatment or care recommendations..."
              className="md:col-span-2"
              restricted={isRestricted('recommendations')}
            />
          </div>
        </WorkspaceSection>

        {/* === DETAILS GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Details" icon={Wrench} />}

        {/* Conservation */}
        <WorkspaceSection
          id="conservation"
          title="Conservation"
          icon={<Wrench size={18} />}
          isExpanded={expandedSections.conservation}
          onToggle={() => toggleSection('conservation')}
          isEditing={isEditing}
          order={getSectionOrder('conservation')}
          isEmpty={!hasContent.conservation}
          summary={sectionSummaries.conservation}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableCheckbox
              label="Conservation Needed"
              value={formData.conservation_needed}
              isEditing={isEditing}
              onChange={(v) => updateField('conservation_needed', v)}
            />
            <EditableSelect
              label="Conservation Priority"
              value={formData.conservation_priority}
              isEditing={isEditing}
              onChange={(v) => updateField('conservation_priority', v)}
              options={getLookup('priority')}
              placeholder="Select priority..."
              restricted={isRestricted('conservation_priority')}
            />
          </div>
        </WorkspaceSection>

        {/* Handling Requirements */}
        <WorkspaceSection
          id="requirements"
          title="Handling Requirements"
          icon={<Hand size={18} />}
          isExpanded={expandedSections.requirements}
          onToggle={() => toggleSection('requirements')}
          isEditing={isEditing}
          order={getSectionOrder('requirements')}
          isEmpty={!hasContent.requirements}
          summary={sectionSummaries.requirements}
        >
          <div className="grid grid-cols-1 gap-4">
            <EditableField
              label="Handling Requirements"
              value={formData.handling_requirements}
              isEditing={isEditing}
              onChange={(v) => updateField('handling_requirements', v)}
              multiline
              rows={2}
              placeholder="Special handling instructions..."
              restricted={isRestricted('handling_requirements')}
            />
            <EditableField
              label="Packing Requirements"
              value={formData.packing_requirements}
              isEditing={isEditing}
              onChange={(v) => updateField('packing_requirements', v)}
              multiline
              rows={2}
              placeholder="Packing and storage requirements..."
            />
            <EditableField
              label="Display Restrictions"
              value={formData.display_restrictions}
              isEditing={isEditing}
              onChange={(v) => updateField('display_restrictions', v)}
              multiline
              rows={2}
              placeholder="Light levels, climate requirements, etc..."
              restricted={isRestricted('display_restrictions')}
            />
            <EditableField
              label="Next Check Date"
              value={formData.next_check_date}
              isEditing={isEditing}
              onChange={(v) => updateField('next_check_date', v)}
              type="date"
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
            label="Report Notes"
            value={formData.report_note}
            isEditing={isEditing}
            onChange={(v) => updateField('report_note', v)}
            multiline
            rows={4}
            placeholder="Any additional notes..."
            restricted={isRestricted('report_note')}
          />
        </WorkspaceSection>

        {/* Change History */}
        {hasPermission('org.view_audit_logs') && !isCreateMode && orgId && reportId && (
          <WorkspaceSection
            id="history"
            title="Change History"
            icon={<History size={20} />}
            isExpanded={expandedSections.history}
            onToggle={() => toggleSection('history')}
            isEditing={isEditing}
            order={getSectionOrder('history')}
            isEmpty={!hasContent.history}
            summary={sectionSummaries.history}
          >
            <RecordAuditHistory
              organizationId={orgId}
              entityType="condition_report"
              entityId={reportId}
            />
          </WorkspaceSection>
        )}
      </div>

      {/* Footer metadata */}
      {!isCreateMode && existingReport && (
        <div className="mt-8 pt-6 border-t border-lichen text-sm text-archive">
          <p>Created: {formatDateTime(existingReport.created_at)}</p>
          {existingReport.updated_at && (
            <p>Last updated: {formatDateTime(existingReport.updated_at)}</p>
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
        title="Delete Condition Report"
        message={<>Are you sure you want to delete <strong>{displayNumber || 'this condition report'}</strong>? This action cannot be undone.</>}
        confirmText="Delete"
        confirmStyle="danger"
      />

      <ContactSelectorSlideOver
        isOpen={showExaminerSelector}
        onClose={() => setShowExaminerSelector(false)}
        onSelect={(contactId) => {
          updateField('examiner_id', contactId);
          setShowExaminerSelector(false);
        }}
        organizationId={orgId!}
        title="Select Examiner"
        subtitle="Search for an existing contact or create a new one to use as the examiner."
      />

      {!isCreateMode && orgId && reportId && (
        <GenerateReportSlideOver
          isOpen={showReportSlideOver}
          onClose={() => setShowReportSlideOver(false)}
          contextType="record"
          recordType="condition_reports"
          contextParams={{ record_id: reportId, record_type: 'condition_reports' }}
        />
      )}

      {orgId && reportId && existingReport && (
        <CreateTaskSlideOver
          isOpen={dialogs.showCreateTask}
          onClose={() => dialogs.setShowCreateTask(false)}
          orgId={orgId}
          initialEntityType={"condition_report" as React.ComponentProps<typeof CreateTaskSlideOver>['initialEntityType']}
          initialEntityId={reportId}
          initialEntityLabel={existingReport.report_number || `Condition Report ${reportId.slice(0, 8)}`}
        />
      )}
    </div>
  );

  // New layout with RecordDetailPageWrapper
  if (useNewLayout && existingReport) {
    return (
      <WorkspaceErrorBoundary
        backUrl={`/organizations/${orgId}/collections/condition-reports`}
        backLabel="Back to Condition Reports"
      >
        <RecordDetailPageWrapper
          object={null}
          media={[]}
          sectionIds={ALL_SECTION_IDS}
          sectionGroups={CONDITION_REPORT_SECTION_GROUPS}
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
          pageType="condition-report"
          enabled={true}
          showHeader={true}
          title="Condition Report"
          objectNumber={existingReport.report_number || undefined}
          subtitle={getTypeLabel(existingReport.report_type || 'periodic')}
          backUrl={`/organizations/${orgId}/collections/condition-reports`}
          backLabel="Back to Condition Reports"
        >
          {pageContent}
        </RecordDetailPageWrapper>
      </WorkspaceErrorBoundary>
    );
  }

  return (
    <WorkspaceErrorBoundary
      backUrl={orgId ? `/organizations/${orgId}/collections/condition-reports` : undefined}
      backLabel="Back to Condition Reports"
    >
      {pageContent}
    </WorkspaceErrorBoundary>
  );
}
