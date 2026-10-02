import { useParams, Link } from 'react-router-dom';
import { useWorkspacePage } from '../../../hooks/useWorkspacePage';
import { formatDateTime } from '@/lib/formatters';
import {
  ClipboardCheck,
  Target,
  Calendar,
  FileText,
  CheckSquare,
  CheckCircle,
  PlayCircle,
  Search,
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
import ConfirmDialog from '../../../components/ConfirmDialog';

import { useFormState, useSectionState, useAuditCampaignQuery, useSectionSummaries, useHasContent } from './hooks';
import {
  AUDIT_CAMPAIGN_SECTION_GROUPS,
  ALL_SECTION_IDS,
  STATUS_STYLES,
} from './types';
import { MadronaLoader } from '../../../components/ui/MadronaLoader';

/**
 * Outer wrapper that provides section order context.
 */
export default function AuditCampaignWorkspacePage() {
  return (
    <SectionOrderProvider>
      <AuditCampaignWorkspacePageContent />
    </SectionOrderProvider>
  );
}

function AuditCampaignWorkspacePageContent() {
  const { orgId, campaignId } = useParams<{ orgId: string; campaignId?: string }>();

  // Fetch campaign data
  const isCreateMode = !campaignId;
  const { data: campaign, isLoading, error } = useAuditCampaignQuery(orgId, campaignId, isCreateMode);

  const wp = useWorkspacePage({
    entityType: 'audit_campaign',
    entityId: campaignId,
    entityLabel: campaign?.audit_number ? (campaign.audit_number as string) : undefined,
    orgId,
    editPermission: 'audits.edit',

  });
  const { isEditing, setIsEditing, useNewLayout, canEdit, hasPermission, dialogs } = wp;

  // Form state
  const form = useFormState({ orgId, campaignId, isCreateMode, campaign });
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

  // Section state
  const sectionState = useSectionState({
    orgId,
    campaignId,
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
      audit_type: formData.audit_type,
      objects_total: formData.objects_total,
    },
    sampling: {
      sample_method: formData.sample_method,
      sample_size: formData.sample_size,
    },
    timeline: {
      planned_start_date: formData.planned_start_date,
      planned_end_date: formData.planned_end_date,
    },
    methodology: {
      methodology: formData.methodology,
    },
    findings: {
      findings_summary: formData.findings_summary,
      remedial_actions: formData.remedial_actions,
    },
    history: {},
  };

  // Display values
  const displayNumber = isCreateMode ? '' : ((campaign?.audit_number as string) || '');
  const displayTitle = isCreateMode
    ? 'New Audit Campaign'
    : ((campaign?.title as string) || 'Audit Campaign');

  // Loading state
  if (!isCreateMode && isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <MadronaLoader label="Loading…" />
      </div>
    );
  }

  // Error state
  if (!isCreateMode && (error || !campaign)) {
    return (
      <div className="p-6 max-w-4xl mx-auto text-center py-12">
        <Search size={48} className="mx-auto text-archive mb-4" />
        <h3 className="text-lg font-serif font-medium text-forest mb-2">
          Audit campaign not found
        </h3>
        <p className="text-accessible-gray mb-4">
          {error ? (error as Error).message : 'The audit campaign could not be loaded.'}
        </p>
        <Link
          to={`/organizations/${orgId}/collections/audits`}
          className="text-bark hover:text-copper-dark"
        >
          Back to Audit Campaigns
        </Link>
      </div>
    );
  }

  const status = (campaign?.status as string) || 'draft';

  const pageContent = (
    <div className={cn(!useNewLayout && 'p-6 max-w-4xl mx-auto')}>
      {/* Header - only in classic layout */}
      {!useNewLayout && (
        <WorkspaceHeader
          backUrl={`/organizations/${orgId}/collections/audits`}
          backText="Back to Audit Campaigns"
          title={displayTitle}
          objectNumber={displayNumber}
          isEditing={isEditing}
          saveStatus={saveStatus}
          lastSaved={lastSaved}
          hasUnsavedChanges={hasUnsavedChanges}
          showCreateButton={isCreateMode}
          createButtonText="Create Campaign"
          onSave={isCreateMode ? handleCreate : undefined}
          onToggleMode={isCreateMode ? undefined : handleToggleMode}
        />
      )}

      {/* Edit mode indicator */}

      {/* Status Bar - only show in view/edit mode, not create mode */}
      {!isCreateMode && campaign && (
        <div className="flex items-center gap-4 mb-6">
          <span className={cn('inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium', STATUS_STYLES[status] || STATUS_STYLES.draft)}>
            {status.replace('_', ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
          </span>
          <span className="text-xs px-2 py-0.5 bg-stone rounded-full text-archive uppercase tracking-wide">
            {getLabel('audit_type', campaign.audit_type as string)}
          </span>

          {/* Status Actions */}
          <div className="flex-1" />
          {status === 'draft' && (
            <button
              onClick={() => approveMutation.mutate()}
              className="btn btn-primary text-sm"
              disabled={approveMutation.isPending}
            >
              <CheckCircle size={16} className="mr-1.5" />
              Approve
            </button>
          )}
          {status === 'approved' && (
            <button
              onClick={() => startMutation.mutate()}
              className="btn btn-secondary text-sm"
              disabled={startMutation.isPending}
            >
              <PlayCircle size={16} className="mr-1.5" />
              Start Audit
            </button>
          )}
          {status === 'in_progress' && (
            <button
              onClick={() => completeMutation.mutate()}
              className="btn btn-primary text-sm"
              disabled={completeMutation.isPending}
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

      {/* Sections */}
      <div className="flex flex-col gap-4">
        {/* === OVERVIEW GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Overview" icon={ClipboardCheck} />}

        {/* Audit Information */}
        <WorkspaceSection
          id="info"
          title="Audit Information"
          icon={<ClipboardCheck size={18} />}
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
              placeholder="e.g., 2026 Annual Location Audit"
              required
              className="md:col-span-2"
            />
            <EditableSelect
              label="Audit Type"
              value={formData.audit_type}
              isEditing={isEditing}
              onChange={(v) => updateField('audit_type', v)}
              options={getLookup('audit_type')}
              required
            />
            <EditableField
              label="Total Objects to Audit"
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
              placeholder="Describe the scope of this audit..."
              className="md:col-span-2"
            />
          </div>
        </WorkspaceSection>

        {/* Sampling Strategy */}
        <WorkspaceSection
          id="sampling"
          title="Sampling Strategy"
          icon={<Target size={18} />}
          isExpanded={expandedSections.sampling}
          onToggle={() => toggleSection('sampling')}
          isEditing={isEditing}
          order={getSectionOrder('sampling')}
          isEmpty={!hasContent.sampling}
          summary={sectionSummaries.sampling}
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <EditableSelect
              label="Sampling Method"
              value={formData.sample_method}
              isEditing={isEditing}
              onChange={(v) => updateField('sample_method', v)}
              options={getLookup('sample_method')}
            />
            <EditableField
              label="Sample Size"
              value={formData.sample_size}
              isEditing={isEditing}
              onChange={(v) => updateField('sample_size', v)}
              type="number"
              placeholder="Number of items"
            />
            <EditableField
              label="Sample Percentage"
              value={formData.sample_percentage}
              isEditing={isEditing}
              onChange={(v) => updateField('sample_percentage', v)}
              type="number"
              placeholder="%"
            />
            <EditableField
              label="Sampling Criteria"
              value={formData.sampling_criteria}
              isEditing={isEditing}
              onChange={(v) => updateField('sampling_criteria', v)}
              multiline
              rows={2}
              placeholder="Describe how items will be selected..."
              className="md:col-span-3"
            />
          </div>
        </WorkspaceSection>

        {/* === PLANNING GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Planning" icon={Calendar} />}

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
          </div>
        </WorkspaceSection>

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
              label="Audit Methodology"
              value={formData.methodology}
              isEditing={isEditing}
              onChange={(v) => updateField('methodology', v)}
              multiline
              rows={4}
              placeholder="Describe the audit approach and methods..."
            />
            <EditableField
              label="Verification Procedures"
              value={formData.verification_procedures}
              isEditing={isEditing}
              onChange={(v) => updateField('verification_procedures', v)}
              multiline
              rows={4}
              placeholder="How will items be verified during the audit?"
            />
          </div>
        </WorkspaceSection>

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
                placeholder="Summarize the audit findings..."
              />
              <EditableField
                label="Recommendations"
                value={formData.recommendations}
                isEditing={isEditing}
                onChange={(v) => updateField('recommendations', v)}
                multiline
                rows={4}
                placeholder="Recommendations based on findings..."
              />
              <EditableField
                label="Remedial Actions"
                value={formData.remedial_actions}
                isEditing={isEditing}
                onChange={(v) => updateField('remedial_actions', v)}
                multiline
                rows={4}
                placeholder="Actions to address discrepancies..."
              />
            </div>
          </WorkspaceSection>
        )}

        {/* === ADMIN GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Admin" icon={History} />}

        {/* Change History */}
        {hasPermission('org.view_audit_logs') && !isCreateMode && orgId && campaignId && (
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
              entityType="audit_campaign"
              entityId={campaignId}
            />
          </WorkspaceSection>
        )}
      </div>

      {/* Footer metadata - only in view/edit mode, not create mode */}
      {!isCreateMode && campaign && (
        <div className="mt-8 pt-6 border-t border-lichen text-sm text-archive">
          <p>Created: {formatDateTime(campaign.created_at as string)}</p>
          {campaign.updated_at && (
            <p>Last updated: {formatDateTime(campaign.updated_at as string)}</p>
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
        title="Delete Audit Campaign"
        message={<>Are you sure you want to delete <strong>{formData.title || 'this audit campaign'}</strong>? This action cannot be undone.</>}
        confirmText="Delete"
        confirmStyle="danger"
      />

      {/* Create Task SlideOver */}
      {orgId && campaignId && campaign && (
        <CreateTaskSlideOver
          isOpen={dialogs.showCreateTask}
          onClose={() => dialogs.setShowCreateTask(false)}
          orgId={orgId}
          initialEntityType={"audit_campaign" as React.ComponentProps<typeof CreateTaskSlideOver>['initialEntityType']}
          initialEntityId={campaignId}
          initialEntityLabel={(campaign.audit_number as string) || `Audit ${campaignId.slice(0, 8)}`}
        />
      )}
    </div>
  );

  // New layout with RecordDetailPageWrapper
  if (useNewLayout && campaign) {
    return (
      <WorkspaceErrorBoundary
        backUrl={`/organizations/${orgId}/collections/audits`}
        backLabel="Back to Audit Campaigns"
      >
        <RecordDetailPageWrapper
          object={null}
          media={[]}
          sectionIds={ALL_SECTION_IDS}
          sectionGroups={AUDIT_CAMPAIGN_SECTION_GROUPS}
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
          pageType="audit-campaign"
          enabled={true}
          showHeader={true}
          showRail={false}
          title="Audit Campaign"
          objectNumber={displayNumber}
          subtitle={displayTitle}
          backUrl={`/organizations/${orgId}/collections/audits`}
          backLabel="Back to Audit Campaigns"
        >
          {pageContent}
        </RecordDetailPageWrapper>
      </WorkspaceErrorBoundary>
    );
  }

  return (
    <WorkspaceErrorBoundary
      backUrl={orgId ? `/organizations/${orgId}/collections/audits` : undefined}
      backLabel="Back to Audit Campaigns"
    >
      {pageContent}
    </WorkspaceErrorBoundary>
  );
}
