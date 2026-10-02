import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useWorkspacePage } from '../../../hooks/useWorkspacePage';
import { formatDateShort, formatDateTime } from '@/lib/formatters';
import {
  FileSearch,
  Calendar,
  FileText,
  CheckSquare,
  CheckCircle,
  PlayCircle,
  Users,
  Target,
  ClipboardCheck,
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
import { useProcedureRequirements } from '../../../hooks/useProcedureRequirements';
import { ProcedureRequirementsCard } from '../../../components/collections/ProcedureRequirementsCard';
import {
  getCollectionsReview,
  getReviewAssessments,
} from '../../../lib/api';
import ConfirmDialog from '../../../components/ConfirmDialog';

import { useFormState, useSectionState, useSectionSummaries, useHasContent } from './hooks';
import {
  REVIEW_SECTION_GROUPS,
  ALL_SECTION_IDS,
  STATUS_STYLES,
  RECOMMENDATION_LABELS,
} from './types';
import { MadronaLoader } from '../../../components/ui/MadronaLoader';

/**
 * Outer wrapper that provides section order context.
 */
export default function CollectionsReviewWorkspacePage() {
  return (
    <SectionOrderProvider>
      <CollectionsReviewWorkspacePageContent />
    </SectionOrderProvider>
  );
}

function CollectionsReviewWorkspacePageContent() {
  const { orgId, reviewId } = useParams<{ orgId: string; reviewId?: string }>();

  // Fetch review data (disabled in create mode)
  const isCreateMode = !reviewId;
  const { requirementGroups } = useProcedureRequirements('collections_review', orgId);

  const { data: review, isLoading, error } = useQuery({
    queryKey: ['collections-review', orgId, reviewId],
    queryFn: () => getCollectionsReview(orgId!, reviewId!),
    enabled: !isCreateMode && !!orgId && !!reviewId,
  });

  // Fetch assessments (disabled in create mode)
  const { data: assessmentsData } = useQuery({
    queryKey: ['review-assessments', orgId, reviewId],
    queryFn: () => getReviewAssessments(orgId!, reviewId!, { limit: 20 }),
    enabled: !isCreateMode && !!orgId && !!reviewId,
  });

  const reviewRecord = review;

  const wp = useWorkspacePage({
    entityType: 'collections_review',
    entityId: reviewId,
    entityLabel: reviewRecord ? ((reviewRecord.title as string) || `Review ${reviewId!.slice(0, 8)}`) : undefined,
    orgId,
    editPermission: 'reviews.edit',
  });
  const { isEditing, setIsEditing, useNewLayout, canEdit, hasPermission, dialogs } = wp;

  const form = useFormState({ orgId, reviewId, isCreateMode, review: reviewRecord });

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
  } = form;

  const sectionState = useSectionState({
    orgId,
    reviewId,
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
    info: {
      title: formData.title,
      review_type: formData.review_type,
    },
    timeline: {
      planned_start_date: formData.planned_start_date,
      planned_end_date: formData.planned_end_date,
    },
    methodology: {
      methodology: formData.methodology,
      scoring_guidance: formData.scoring_guidance,
    },
    progress: {},
    assessments: {},
    findings: {
      findings_summary: formData.findings_summary,
      recommendations: formData.recommendations,
    },
    team: {},
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
  if (!isCreateMode && (error || !review)) {
    return (
      <div className="p-6 max-w-4xl mx-auto text-center py-12">
        <ClipboardCheck size={48} className="mx-auto text-archive mb-4" />
        <h3 className="text-lg font-serif font-medium text-forest mb-2">
          Review not found
        </h3>
        <p className="text-accessible-gray mb-4">
          {error ? (error as Error).message : 'The review record could not be loaded.'}
        </p>
        <Link
          to={`/organizations/${orgId}/collections/reviews`}
          className="text-bark hover:text-copper-dark no-underline"
        >
          Back to Collections Reviews
        </Link>
      </div>
    );
  }

  const assessments = assessmentsData?.items || [];
  const objectsTotal = (reviewRecord?.objects_total as number) || 0;
  const objectsReviewed = (reviewRecord?.objects_reviewed as number) || 0;
  const progressPercent = !isCreateMode && objectsTotal > 0
    ? Math.round((objectsReviewed / objectsTotal) * 100)
    : 0;

  const displayNumber = isCreateMode ? '' : ((reviewRecord?.review_number as string) || '');
  const displayTitle = isCreateMode
    ? 'New Collections Review'
    : ((reviewRecord?.title as string) || 'Collections Review');

  const pageContent = (
    <div className={cn(!useNewLayout && 'p-6 max-w-4xl mx-auto')}>
      {/* Header - only in classic layout */}
      {!useNewLayout && (
        <WorkspaceHeader
          backUrl={`/organizations/${orgId}/collections/reviews`}
          backText="Back to Collections Reviews"
          title={displayTitle}
          objectNumber={displayNumber}
          isEditing={isEditing}
          saveStatus={saveStatus}
          lastSaved={lastSaved}
          hasUnsavedChanges={hasUnsavedChanges}
          showCreateButton={isCreateMode}
          createButtonText="Create Review"
          onSave={isCreateMode ? handleCreate : undefined}
          onToggleMode={isCreateMode ? undefined : handleToggleMode}
        />
      )}

      {/* Edit mode indicator */}

      {/* Status bar and actions - only show in view/edit mode, not create mode */}
      {!isCreateMode && reviewRecord && (
        <div className="flex items-center gap-4 mb-6">
          <span className={cn('text-xs px-2 py-0.5 rounded-full uppercase tracking-wide', STATUS_STYLES[(reviewRecord.status as string)])}>
            {(reviewRecord.status as string).replace('_', ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
          </span>
          <span className="text-xs px-2 py-0.5 bg-stone rounded-full text-archive uppercase tracking-wide">
            {getLabel('review_type', reviewRecord.review_type as string)}
          </span>
          {reviewRecord.planned_start_date && (
            <span className="text-sm text-archive flex items-center gap-1">
              <Calendar size={14} />
              {formatDateShort(reviewRecord.planned_start_date as string)}
              {reviewRecord.planned_end_date && ` - ${formatDateShort(reviewRecord.planned_end_date as string)}`}
            </span>
          )}

          {/* Status Actions */}
          <div className="flex-1" />
          {reviewRecord.status === 'draft' && (
            <button
              onClick={() => approveMutation.mutate()}
              className="btn btn-primary text-sm flex items-center gap-2"
              disabled={approveMutation.isPending}
            >
              <CheckCircle size={14} />
              Approve
            </button>
          )}
          {reviewRecord.status === 'approved' && (
            <button
              onClick={() => startMutation.mutate()}
              className="flex items-center gap-2 px-3 py-1.5 border border-lichen rounded-lg text-ink hover:bg-stone transition-colors text-sm"
              disabled={startMutation.isPending}
            >
              <PlayCircle size={14} />
              Start Review
            </button>
          )}
          {reviewRecord.status === 'in_progress' && (
            <button
              onClick={() => completeMutation.mutate()}
              className="btn btn-primary text-sm flex items-center gap-2"
              disabled={completeMutation.isPending}
            >
              <CheckCircle size={14} />
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
      {!isCreateMode && reviewRecord && (
                  <ProcedureRequirementsCard
            title="Collections Review Requirements"
            requirementGroups={requirementGroups}
            record={formData as unknown as Record<string, unknown>}
            currentStatus={(reviewRecord.status as string) || 'draft'}
            statusOrder={['draft', 'approved', 'in_progress', 'completed', 'cancelled']}
            onSectionNavigate={handleEnterEditMode}
          />
      )}

      {/* Sections */}
      <div className="flex flex-col gap-4">
        {/* === OVERVIEW GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Overview" icon={FileSearch} />}

        {/* Review Information */}
        <WorkspaceSection
          id="info"
          title="Review Information"
          icon={<FileSearch size={18} />}
          isExpanded={expandedSections.info}
          onToggle={() => toggleSection('info')}
          isEditing={isEditing}
          order={getSectionOrder('info')}
          isEmpty={!hasContent.info}
          summary={sectionSummaries.info}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableField
              label="Title"
              value={formData.title}
              isEditing={isEditing}
              onChange={(v) => updateField('title', v)}
              placeholder="e.g., 2026 Significance Review - Paintings"
              required
              className="md:col-span-2"
            />
            <EditableSelect
              label="Review Type"
              value={formData.review_type}
              isEditing={isEditing}
              onChange={(v) => updateField('review_type', v)}
              options={getLookup('review_type')}
              required
            />
            <EditableField
              label="Review Reason"
              value={formData.review_reason}
              isEditing={isEditing}
              onChange={(v) => updateField('review_reason', v)}
              multiline
              rows={2}
              placeholder="Why is this review being conducted?"
            />
            <EditableField
              label="Total Objects to Review"
              value={formData.objects_total}
              isEditing={isEditing}
              onChange={(v) => updateField('objects_total', v)}
              type="number"
            />
            <EditableField
              label="Scope Description"
              value={formData.scope_description}
              isEditing={isEditing}
              onChange={(v) => updateField('scope_description', v)}
              multiline
              rows={3}
              placeholder="Describe what is included in this review..."
              className="md:col-span-2"
            />
          </div>
        </WorkspaceSection>

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
              label="Planned Start Date"
              value={formData.planned_start_date}
              isEditing={isEditing}
              onChange={(v) => updateField('planned_start_date', v)}
              type="date"
            />
            <EditableField
              label="Planned End Date"
              value={formData.planned_end_date}
              isEditing={isEditing}
              onChange={(v) => updateField('planned_end_date', v)}
              type="date"
            />
            {/* Show actual dates in view mode only */}
            {!isCreateMode && reviewRecord && (
              <>
                {reviewRecord.actual_start_date && (
                  <div>
                    <label className="text-sm font-medium text-archive">Actual Start</label>
                    <p className="text-ink mt-1">{formatDateShort(reviewRecord.actual_start_date as string)}</p>
                  </div>
                )}
                {reviewRecord.actual_end_date && (
                  <div>
                    <label className="text-sm font-medium text-archive">Actual End</label>
                    <p className="text-ink mt-1">{formatDateShort(reviewRecord.actual_end_date as string)}</p>
                  </div>
                )}
              </>
            )}
          </div>
        </WorkspaceSection>

        {/* === DETAILS GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Details" icon={FileText} />}

        {/* Methodology */}
        <WorkspaceSection
          id="methodology"
          title="Methodology"
          icon={<FileText size={18} />}
          isExpanded={expandedSections.methodology}
          onToggle={() => toggleSection('methodology')}
          isEditing={isEditing}
          order={getSectionOrder('methodology')}
          isEmpty={!hasContent.methodology}
          summary={sectionSummaries.methodology}
        >
          <div className="grid grid-cols-1 gap-4">
            <EditableField
              label="Review Methodology"
              value={formData.methodology}
              isEditing={isEditing}
              onChange={(v) => updateField('methodology', v)}
              multiline
              rows={4}
              placeholder="Describe the approach and methods for this review..."
            />
            <EditableField
              label="Scoring Guidance"
              value={formData.scoring_guidance}
              isEditing={isEditing}
              onChange={(v) => updateField('scoring_guidance', v)}
              multiline
              rows={4}
              placeholder="Provide guidance on how to score objects..."
            />
          </div>
        </WorkspaceSection>

        {/* Progress - only show in view/edit mode, not create mode */}
        {!isCreateMode && reviewRecord && (
          <WorkspaceSection
            id="progress"
            title="Progress"
            icon={<Target size={18} />}
            isExpanded={expandedSections.progress}
            onToggle={() => toggleSection('progress')}
            isEditing={isEditing}
            order={getSectionOrder('progress')}
            isEmpty={!hasContent.progress}
            summary={sectionSummaries.progress}
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-ink">Objects Reviewed</span>
                <span className="text-lg font-semibold text-forest">
                  {objectsReviewed} / {objectsTotal}
                </span>
              </div>
              <div className="h-4 bg-stone rounded-full overflow-hidden">
                <div
                  className="h-full bg-forest rounded-full transition-all"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <div className="text-center text-2xl font-bold text-forest">
                {progressPercent}%
              </div>
            </div>
          </WorkspaceSection>
        )}

        {/* Recent Assessments - only show in view/edit mode, not create mode */}
        {!isCreateMode && assessments.length > 0 && (
          <WorkspaceSection
            id="assessments"
            title="Recent Assessments"
            icon={<ClipboardCheck size={18} />}
            isExpanded={expandedSections.assessments}
            onToggle={() => toggleSection('assessments')}
            isEditing={isEditing}
            order={getSectionOrder('assessments')}
            isEmpty={!hasContent.assessments}
            summary={sectionSummaries.assessments}
          >
            <div className="space-y-3">
              {assessments.slice(0, 10).map((assessment) => (
                <div
                  key={assessment.assessment_id as string}
                  className="flex items-center justify-between p-3 bg-stone/30 rounded-lg"
                >
                  <div>
                    <Link
                      to={`/organizations/${orgId}/collections/objects/${assessment.object_id}`}
                      className="text-bark hover:text-copper-dark font-medium"
                    >
                      View Object
                    </Link>
                    {assessment.overall_score !== null && (
                      <span className="ml-2 text-sm text-archive">
                        Score: {assessment.overall_score as number}
                      </span>
                    )}
                  </div>
                  {assessment.recommendation && (
                    <span className={cn(
                      'text-xs px-2 py-0.5 rounded-full',
                      assessment.recommendation === 'retain' || assessment.recommendation === 'retain_priority'
                        ? 'bg-semantic-success/10 text-semantic-success'
                        : assessment.recommendation === 'deaccession'
                        ? 'bg-semantic-error/10 text-semantic-error'
                        : 'bg-stone text-archive'
                    )}>
                      {RECOMMENDATION_LABELS[assessment.recommendation as string] || (assessment.recommendation as string)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </WorkspaceSection>
        )}

        {/* === OUTCOME GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Outcome" icon={CheckSquare} />}

        {/* Findings & Recommendations - only show in view/edit mode, not create mode */}
        {!isCreateMode && (
          <WorkspaceSection
            id="findings"
            title="Findings & Recommendations"
            icon={<CheckSquare size={18} />}
            isExpanded={expandedSections.findings}
            onToggle={() => toggleSection('findings')}
            isEditing={isEditing}
            order={getSectionOrder('findings')}
            isEmpty={!hasContent.findings}
            summary={sectionSummaries.findings}
          >
            <div className="grid grid-cols-1 gap-4">
              <EditableField
                label="Findings Summary"
                value={formData.findings_summary}
                isEditing={isEditing}
                onChange={(v) => updateField('findings_summary', v)}
                multiline
                rows={4}
                placeholder="Summarize the findings from the review..."
              />
              <EditableField
                label="Recommendations"
                value={formData.recommendations}
                isEditing={isEditing}
                onChange={(v) => updateField('recommendations', v)}
                multiline
                rows={4}
                placeholder="Provide recommendations based on the findings..."
              />
            </div>
          </WorkspaceSection>
        )}

        {/* Team - only show in view/edit mode, not create mode */}
        {!isCreateMode && reviewRecord && ((reviewRecord.review_lead_id as string) || ((reviewRecord.review_team as unknown[]) && (reviewRecord.review_team as unknown[]).length > 0)) && (
          <WorkspaceSection
            id="team"
            title="Team"
            icon={<Users size={18} />}
            isExpanded={expandedSections.team}
            onToggle={() => toggleSection('team')}
            isEditing={isEditing}
            order={getSectionOrder('team')}
            isEmpty={!hasContent.team}
            summary={sectionSummaries.team}
          >
            <dl className="space-y-4">
              {reviewRecord.review_lead_id && (
                <div>
                  <dt className="text-sm font-medium text-archive">Review Lead</dt>
                  <dd className="mt-1 text-ink">
                    {(reviewRecord.review_lead_id as string).slice(0, 8)}...
                  </dd>
                </div>
              )}
              {reviewRecord.review_team && (reviewRecord.review_team as unknown[]).length > 0 && (
                <div>
                  <dt className="text-sm font-medium text-archive">Team Members</dt>
                  <dd className="mt-1 text-ink">
                    {(reviewRecord.review_team as unknown[]).length} member{(reviewRecord.review_team as unknown[]).length !== 1 ? 's' : ''}
                  </dd>
                </div>
              )}
            </dl>
          </WorkspaceSection>
        )}

        {/* Approval info - only show in view/edit mode when approved */}
        {!isCreateMode && reviewRecord && reviewRecord.approval_date && (
          <div className="card p-6 border-l-4 border-semantic-success">
            <h2 className="text-lg font-medium text-ink mb-4 flex items-center gap-2">
              <CheckCircle size={18} className="text-semantic-success" />
              Approved
            </h2>
            <p className="text-ink">
              {formatDateShort(reviewRecord.approval_date as string)}
            </p>
          </div>
        )}

        {/* === ADMIN GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Admin" icon={History} />}

        {/* Change History */}
        {hasPermission('org.view_audit_logs') && !isCreateMode && orgId && reviewId && (
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
              entityType="collections_review"
              entityId={reviewId}
            />
          </WorkspaceSection>
        )}
      </div>

      {/* Footer metadata - only in view/edit mode, not create mode */}
      {!isCreateMode && reviewRecord && (
        <div className="mt-8 pt-6 border-t border-lichen text-sm text-archive">
          <p>Created: {formatDateTime(reviewRecord.created_at as string)}</p>
          {reviewRecord.updated_at && (
            <p>Last updated: {formatDateTime(reviewRecord.updated_at as string)}</p>
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
        title="Delete Collections Review"
        message={<>Are you sure you want to delete <strong>{formData.title || 'this collections review'}</strong>? This action cannot be undone.</>}
        confirmText="Delete"
        confirmStyle="danger"
      />

      {/* CreateTaskSlideOver */}
      {orgId && reviewId && reviewRecord && (
        <CreateTaskSlideOver
          isOpen={dialogs.showCreateTask}
          onClose={() => dialogs.setShowCreateTask(false)}
          orgId={orgId}
          initialEntityType={"collections_review" as React.ComponentProps<typeof CreateTaskSlideOver>['initialEntityType']}
          initialEntityId={reviewId}
          initialEntityLabel={(reviewRecord.title as string) || `Review ${reviewId.slice(0, 8)}`}
        />
      )}
    </div>
  );

  // New layout with RecordDetailPageWrapper
  if (useNewLayout && reviewRecord) {
    return (
      <WorkspaceErrorBoundary
        backUrl={`/organizations/${orgId}/collections/reviews`}
        backLabel="Back to Collections Reviews"
      >
        <RecordDetailPageWrapper
          object={null}
          media={[]}
          sectionIds={ALL_SECTION_IDS}
          sectionGroups={REVIEW_SECTION_GROUPS}
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
          pageType="collections-review"
          enabled={true}
          showHeader={true}
          title="Collections Review"
          objectNumber={(reviewRecord.review_number as string) || undefined}
          subtitle={displayTitle}
          backUrl={`/organizations/${orgId}/collections/reviews`}
          backLabel="Back to Collections Reviews"
        >
          {pageContent}
        </RecordDetailPageWrapper>
      </WorkspaceErrorBoundary>
    );
  }

  return (
    <WorkspaceErrorBoundary
      backUrl={orgId ? `/organizations/${orgId}/collections/reviews` : undefined}
      backLabel="Back to Collections Reviews"
    >
      {pageContent}
    </WorkspaceErrorBoundary>
  );
}
