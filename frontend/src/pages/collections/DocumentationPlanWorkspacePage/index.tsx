import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useWorkspacePage } from '../../../hooks/useWorkspacePage';
import { formatDateShort, formatDateTime } from '@/lib/formatters';
import {
  FileText,
  Target,
  Calendar,
  DollarSign,
  StickyNote,
  Plus,
  X,
  CheckCircle,
  Play,
  Clock,
  Loader2,
  History,
} from 'lucide-react';
import {
  WorkspaceHeader,
  WorkspaceErrorBoundary,
  WorkspaceSection,
  EditableField,
  EditableSelect,
  RecordAuditHistory,
  SectionGroupDivider,
  ReadOnlyBanner,
} from '../../../components/workspace';
import { RecordDetailPageWrapper, SectionOrderProvider } from '../../../components/record-detail';
import { CreateTaskSlideOver } from '../../../components/work/CreateTaskSlideOver';
import { cn } from '../../../lib/utils';
import { getDocumentationPlan } from '../../../lib/api';
import { ProcedureRequirementsCard } from '../../../components/collections/ProcedureRequirementsCard';
import { useProcedureRequirements } from '../../../hooks/useProcedureRequirements';
import ConfirmDialog from '../../../components/ConfirmDialog';

import { useFormState, useSectionState, useSectionSummaries, useHasContent } from './hooks';
import {
  DOC_PLAN_SECTION_GROUPS,
  ALL_SECTION_IDS,
} from './types';
import { MadronaLoader } from '../../../components/ui/MadronaLoader';

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-stone text-archive',
  approved: 'bg-semantic-info/10 text-semantic-info',
  in_progress: 'bg-semantic-warning/10 text-semantic-warning',
  completed: 'bg-semantic-success/10 text-semantic-success',
  cancelled: 'bg-semantic-error/10 text-semantic-error',
};

/**
 * Outer wrapper that provides section order context.
 */
export default function DocumentationPlanWorkspacePage() {
  return (
    <SectionOrderProvider>
      <DocumentationPlanWorkspacePageContent />
    </SectionOrderProvider>
  );
}

function DocumentationPlanWorkspacePageContent() {
  const { orgId, planId } = useParams<{ orgId: string; planId?: string }>();
  const { requirementGroups } = useProcedureRequirements('doc_plan', orgId);

  // Fetch plan data (disabled in create mode)
  const isCreateMode = !planId;
  const { data: existingPlan, isLoading, error } = useQuery({
    queryKey: ['documentation-plan', orgId, planId],
    queryFn: () => getDocumentationPlan(orgId!, planId!),
    enabled: !isCreateMode && !!orgId && !!planId,
  });

  const wp = useWorkspacePage({
    entityType: 'documentation_plan',
    entityId: planId,
    entityLabel: existingPlan ? (existingPlan.title || `Plan ${planId!.slice(0, 8)}`) : undefined,
    orgId,
    editPermission: 'documentation_plans.edit',
  });
  const { isEditing, setIsEditing, useNewLayout, canEdit, hasPermission, dialogs } = wp;

  const form = useFormState({ orgId, planId, isCreateMode, plan: existingPlan });

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
    startMutation,
    completeMutation,
    getLookup,
    getLabel,
    newResult,
    setNewResult,
    newAction,
    setNewAction,
    newMilestone,
    setNewMilestone,
    handleAddResult,
    handleRemoveResult,
    handleAddAction,
    handleRemoveAction,
    handleAddMilestone,
    handleRemoveMilestone,
  } = form;

  const sectionState = useSectionState({
    orgId,
    planId,
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
    basic: {
      title: formData.title,
      plan_type: formData.plan_type,
    },
    content: {
      objectives: formData.objectives,
      measurable_results: formData.measurable_results,
      actions: formData.actions,
    },
    timeline: {
      start_date: formData.start_date,
      end_date: formData.end_date,
      review_frequency: formData.review_frequency,
    },
    resources: {
      resources_required: formData.resources_required,
    },
    notes: {
      notes: formData.notes,
    },
    history: {},
  };

  const isPending = approveMutation.isPending || startMutation.isPending || completeMutation.isPending;

  // Loading state
  if (!isCreateMode && isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <MadronaLoader label="Loading…" />
      </div>
    );
  }

  // Error state
  if (!isCreateMode && (error || !existingPlan)) {
    return (
      <div className="p-6 max-w-4xl mx-auto text-center py-12">
        <FileText size={48} className="mx-auto text-archive mb-4" />
        <h3 className="text-lg font-serif font-medium text-forest mb-2">
          Documentation Plan not found
        </h3>
        <p className="text-accessible-gray mb-4">
          {error ? (error as Error).message : 'The documentation plan record could not be loaded.'}
        </p>
      </div>
    );
  }

  const displayNumber = isCreateMode ? '' : (existingPlan?.plan_number || existingPlan?.plan_id?.slice(0, 8) || '');
  const displayTitle = isCreateMode
    ? 'New Documentation Plan'
    : (existingPlan?.title || 'Documentation Plan');

  const pageContent = (
    <div className={cn(!useNewLayout && 'p-6 max-w-4xl mx-auto')}>
      {/* Header - only in classic layout */}
      {!useNewLayout && (
        <WorkspaceHeader
          backUrl={`/organizations/${orgId}/collections/documentation-plans`}
          backText="Back to Documentation Plans"
          title={displayTitle}
          objectNumber={displayNumber}
          isEditing={isEditing}
          saveStatus={saveStatus}
          lastSaved={lastSaved}
          hasUnsavedChanges={hasUnsavedChanges}
          showCreateButton={isCreateMode}
          createButtonText="Create Plan"
          onSave={isCreateMode ? handleCreate : undefined}
          onToggleMode={isCreateMode ? undefined : handleToggleMode}
        />
      )}

      {/* Edit mode indicator */}

      {/* Status bar and actions - only show in view/edit mode, not create mode */}
      {!isCreateMode && existingPlan && (
        <div className="flex items-center gap-4 mb-6">
          <span className={cn('inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium', STATUS_STYLES[existingPlan.status] || STATUS_STYLES.draft)}>
            {existingPlan.status === 'in_progress' ? <Clock size={16} /> : <CheckCircle size={16} />}
            {existingPlan.status.replace('_', ' ').charAt(0).toUpperCase() + existingPlan.status.replace('_', ' ').slice(1)}
          </span>
          <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-stone rounded-full text-sm text-archive">
            <FileText size={16} />
            {getLabel('documentation_plan_type', existingPlan.plan_type)}
          </span>

          {/* Workflow Actions */}
          <div className="flex-1" />
          {existingPlan.status === 'draft' && (
            <button
              onClick={() => approveMutation.mutate()}
              disabled={isPending}
              className="btn btn-secondary text-sm"
            >
              {approveMutation.isPending ? (
                <Loader2 size={16} className="mr-1.5 animate-spin" />
              ) : (
                <CheckCircle size={16} className="mr-1.5" />
              )}
              Approve
            </button>
          )}
          {existingPlan.status === 'approved' && (
            <button
              onClick={() => startMutation.mutate()}
              disabled={isPending}
              className="btn btn-secondary text-sm"
            >
              {startMutation.isPending ? (
                <Loader2 size={16} className="mr-1.5 animate-spin" />
              ) : (
                <Play size={16} className="mr-1.5" />
              )}
              Start
            </button>
          )}
          {existingPlan.status === 'in_progress' && (
            <button
              onClick={() => completeMutation.mutate()}
              disabled={isPending}
              className="btn btn-primary text-sm"
            >
              {completeMutation.isPending ? (
                <Loader2 size={16} className="mr-1.5 animate-spin" />
              ) : (
                <CheckCircle size={16} className="mr-1.5" />
              )}
              Complete
            </button>
          )}
        </div>
      )}

      {/* Procedure Compliance Card */}
      {!isCreateMode && existingPlan && (
                  <ProcedureRequirementsCard
            title="Documentation Plan Requirements"
            requirementGroups={requirementGroups}
            record={{
              ...(formData as unknown as Record<string, unknown>),
              approved_by: existingPlan.approved_by || null,
              approval_date: existingPlan.approved_at || null,
            }}
            currentStatus={existingPlan.status || 'draft'}
            statusOrder={['draft', 'approved', 'in_progress', 'completed', 'superseded', 'cancelled']}
            onSectionNavigate={handleEnterEditMode}
          />
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
        {useNewLayout && <SectionGroupDivider label="Overview" icon={FileText} />}

        {/* Basic Information */}
        <WorkspaceSection
          id="basic"
          title="Basic Information"
          icon={<FileText size={18} />}
          isExpanded={expandedSections.basic}
          onToggle={() => toggleSection('basic')}
          isEditing={isEditing}
          order={getSectionOrder('basic')}
          isEmpty={!hasContent.basic}
          summary={sectionSummaries.basic}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableField
              label="Title"
              value={formData.title || ''}
              isEditing={isEditing}
              onChange={(v) => updateField('title', v)}
              placeholder="e.g., 2024 Photography Digitisation Plan"
              required
              className="md:col-span-2"
            />
            <EditableSelect
              label="Plan Type"
              value={formData.plan_type || 'cataloging_plan'}
              isEditing={isEditing}
              onChange={(v) => updateField('plan_type', v)}
              options={getLookup('documentation_plan_type')}
            />
          </div>
        </WorkspaceSection>

        {/* Content */}
        <WorkspaceSection
          id="content"
          title="Content"
          icon={<Target size={18} />}
          isExpanded={expandedSections.content}
          onToggle={() => toggleSection('content')}
          isEditing={isEditing}
          order={getSectionOrder('content')}
          isEmpty={!hasContent.content}
          summary={sectionSummaries.content}
        >
          <div className="space-y-6">
            <EditableField
              label="Objectives"
              value={formData.objectives || ''}
              isEditing={isEditing}
              onChange={(v) => updateField('objectives', v)}
              multiline
              rows={4}
              placeholder="Describe the objectives of this plan..."
            />

            {/* Measurable Results */}
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">
                Measurable Results
              </label>
              <div className="space-y-2 mb-2">
                {(formData.measurable_results || []).map((result: string, i: number) => (
                  <div key={i} className="flex items-center gap-2 p-2 bg-stone/30 rounded-lg">
                    <span className="flex-1 text-sm text-ink">{result}</span>
                    {isEditing && (
                      <button
                        type="button"
                        onClick={() => handleRemoveResult(i)}
                        className="text-archive hover:text-semantic-error"
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {isEditing && (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newResult}
                    onChange={(e) => setNewResult(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddResult();
                      }
                    }}
                    className="flex-1 px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                    placeholder="Add measurable result..."
                  />
                  <button
                    type="button"
                    onClick={handleAddResult}
                    className="px-3 py-2 border border-lichen rounded-lg text-ink hover:bg-stone transition-colors"
                  >
                    <Plus size={16} />
                  </button>
                </div>
              )}
            </div>

            {/* Actions */}
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">
                Actions
              </label>
              <div className="space-y-2 mb-2">
                {(formData.actions || []).map((action: string, i: number) => (
                  <div key={i} className="flex items-center gap-2 p-2 bg-stone/30 rounded-lg">
                    <span className="text-xs text-archive shrink-0">{i + 1}.</span>
                    <span className="flex-1 text-sm text-ink">{action}</span>
                    {isEditing && (
                      <button
                        type="button"
                        onClick={() => handleRemoveAction(i)}
                        className="text-archive hover:text-semantic-error"
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {isEditing && (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newAction}
                    onChange={(e) => setNewAction(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddAction();
                      }
                    }}
                    className="flex-1 px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                    placeholder="Add action..."
                  />
                  <button
                    type="button"
                    onClick={handleAddAction}
                    className="px-3 py-2 border border-lichen rounded-lg text-ink hover:bg-stone transition-colors"
                  >
                    <Plus size={16} />
                  </button>
                </div>
              )}
            </div>

            {/* Milestones */}
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">
                Milestones
              </label>
              <div className="space-y-2 mb-2">
                {(formData.milestones || []).map((milestone, i) => (
                  <div key={i} className="flex items-center gap-3 p-2 bg-stone/30 rounded-lg">
                    <span className="text-xs text-bark shrink-0 w-24">
                      {milestone.date ? formatDateShort(milestone.date) : 'TBD'}
                    </span>
                    <span className="flex-1 text-sm text-ink">{milestone.description}</span>
                    {isEditing && (
                      <button
                        type="button"
                        onClick={() => handleRemoveMilestone(i)}
                        className="text-archive hover:text-semantic-error"
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {isEditing && (
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={newMilestone.date}
                    onChange={(e) => setNewMilestone({ ...newMilestone, date: e.target.value })}
                    className="w-40 px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                  />
                  <input
                    type="text"
                    value={newMilestone.description}
                    onChange={(e) => setNewMilestone({ ...newMilestone, description: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddMilestone();
                      }
                    }}
                    className="flex-1 px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                    placeholder="Milestone description..."
                  />
                  <button
                    type="button"
                    onClick={handleAddMilestone}
                    className="px-3 py-2 border border-lichen rounded-lg text-ink hover:bg-stone transition-colors"
                  >
                    <Plus size={16} />
                  </button>
                </div>
              )}
            </div>
          </div>
        </WorkspaceSection>

        {/* === DETAILS GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Details" icon={Calendar} />}

        {/* Timeline */}
        <WorkspaceSection
          id="timeline"
          title="Timeline"
          icon={<Calendar size={18} />}
          isExpanded={expandedSections.timeline}
          onToggle={() => toggleSection('timeline')}
          isEditing={isEditing}
          order={getSectionOrder('timeline')}
          isEmpty={!hasContent.timeline}
          summary={sectionSummaries.timeline}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableField
              label="Start Date"
              value={formData.start_date || ''}
              isEditing={isEditing}
              onChange={(v) => updateField('start_date', v)}
              type="date"
            />
            <EditableField
              label="End Date"
              value={formData.end_date || ''}
              isEditing={isEditing}
              onChange={(v) => updateField('end_date', v)}
              type="date"
            />
            <EditableSelect
              label="Review Frequency"
              value={formData.review_frequency || ''}
              isEditing={isEditing}
              onChange={(v) => updateField('review_frequency', v)}
              options={getLookup('review_frequency')}
            />
            <EditableField
              label="Next Review Date"
              value={formData.next_review_date || ''}
              isEditing={isEditing}
              onChange={(v) => updateField('next_review_date', v)}
              type="date"
            />
          </div>
        </WorkspaceSection>

        {/* Resources */}
        <WorkspaceSection
          id="resources"
          title="Resources"
          icon={<DollarSign size={18} />}
          isExpanded={expandedSections.resources}
          onToggle={() => toggleSection('resources')}
          isEditing={isEditing}
          order={getSectionOrder('resources')}
          isEmpty={!hasContent.resources}
          summary={sectionSummaries.resources}
        >
          <EditableField
            label="Resources Required"
            value={formData.resources_required || ''}
            isEditing={isEditing}
            onChange={(v) => updateField('resources_required', v)}
            multiline
            rows={4}
            placeholder="Describe required staff, equipment, budget, etc..."
          />
        </WorkspaceSection>

        {/* === ADMIN GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Admin" icon={History} />}

        {/* Notes */}
        <WorkspaceSection
          id="notes"
          title="Notes"
          icon={<StickyNote size={18} />}
          isExpanded={expandedSections.notes}
          onToggle={() => toggleSection('notes')}
          isEditing={isEditing}
          order={getSectionOrder('notes')}
          isEmpty={!hasContent.notes}
          summary={sectionSummaries.notes}
        >
          <EditableField
            label="Internal Notes"
            value={formData.notes || ''}
            isEditing={isEditing}
            onChange={(v) => updateField('notes', v)}
            multiline
            rows={3}
            placeholder="Internal notes..."
          />
        </WorkspaceSection>

        {/* Change History */}
        {hasPermission('org.view_audit_logs') && !isCreateMode && orgId && planId && (
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
              entityType="documentation_plan"
              entityId={planId}
            />
          </WorkspaceSection>
        )}
      </div>

      {/* Footer metadata - only in view/edit mode, not create mode */}
      {!isCreateMode && existingPlan && existingPlan.created_at && (
        <div className="mt-8 pt-6 border-t border-lichen text-sm text-archive">
          <p>Created: {formatDateTime(existingPlan.created_at)}</p>
          {existingPlan.updated_at && (
            <p>Last updated: {formatDateTime(existingPlan.updated_at)}</p>
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
        title="Delete Documentation Plan"
        message={<>Are you sure you want to delete <strong>{formData.title || 'this documentation plan'}</strong>? This action cannot be undone.</>}
        confirmText="Delete"
        confirmStyle="danger"
      />

      {/* CreateTaskSlideOver */}
      {orgId && planId && existingPlan && (
        <CreateTaskSlideOver
          isOpen={dialogs.showCreateTask}
          onClose={() => dialogs.setShowCreateTask(false)}
          orgId={orgId}
          initialEntityType={"documentation_plan" as React.ComponentProps<typeof CreateTaskSlideOver>['initialEntityType']}
          initialEntityId={planId}
          initialEntityLabel={existingPlan.title || `Plan ${planId.slice(0, 8)}`}
        />
      )}
    </div>
  );

  // New layout with RecordDetailPageWrapper
  if (useNewLayout && existingPlan) {
    return (
      <WorkspaceErrorBoundary
        backUrl={`/organizations/${orgId}/collections/documentation-plans`}
        backLabel="Back to Documentation Plans"
      >
        <RecordDetailPageWrapper
          object={null}
          media={[]}
          sectionIds={ALL_SECTION_IDS}
          sectionGroups={DOC_PLAN_SECTION_GROUPS}
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
          pageType="documentation-plan"
          enabled={true}
          showHeader={true}
          title="Documentation Plan"
          objectNumber={existingPlan.plan_number || undefined}
          subtitle={displayTitle}
          backUrl={`/organizations/${orgId}/collections/documentation-plans`}
          backLabel="Back to Documentation Plans"
        >
          {pageContent}
        </RecordDetailPageWrapper>
      </WorkspaceErrorBoundary>
    );
  }

  return (
    <WorkspaceErrorBoundary
      backUrl={orgId ? `/organizations/${orgId}/collections/documentation-plans` : undefined}
      backLabel="Back to Documentation Plans"
    >
      {pageContent}
    </WorkspaceErrorBoundary>
  );
}
