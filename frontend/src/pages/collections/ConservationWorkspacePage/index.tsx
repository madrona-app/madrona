import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { formatDateTime } from '@/lib/formatters';
import {
  Wrench,
  User,
  FileText,
  Calendar,
  DollarSign,
  StickyNote,
  CheckCircle,
  PlayCircle,
  Search,
  X,
  History,
} from 'lucide-react';
import { ContactSelectorSlideOver } from '../../../components/collections/ConstituentSelectorSlideOver';
import { ObjectSelector } from '../../../components/collections/ObjectSelector';
import { GenerateReportSlideOver } from '../../../components/reports/GenerateReportSlideOver';
import {
  WorkspaceHeader,
  WorkspaceErrorBoundary,
  WorkspaceSection,
  EditableField,
  EditableSelect,
  RestrictedFieldPlaceholder,
  RecordAuditHistory,
  SectionGroupDivider,
  ReadOnlyBanner,
} from '../../../components/workspace';
import { RecordDetailPageWrapper, SectionOrderProvider } from '../../../components/record-detail';
import { CreateTaskSlideOver } from '../../../components/work/CreateTaskSlideOver';
import { cn } from '../../../lib/utils';
import { useWorkspacePage } from '../../../hooks/useWorkspacePage';
import { useProcedureRequirements } from '../../../hooks/useProcedureRequirements';
import { ProcedureRequirementsCard } from '../../../components/collections/ProcedureRequirementsCard';
import ConfirmDialog from '../../../components/ConfirmDialog';

import { useFormState, useSectionState, useSectionSummaries, useHasContent } from './hooks';
import {
  STATUS_CONFIG,
  CONSERVATION_SECTION_GROUPS,
  ALL_SECTION_IDS,
} from './types';
import { MadronaLoader } from '../../../components/ui/MadronaLoader';

/**
 * Outer wrapper that provides section order context.
 */
export default function ConservationWorkspacePage() {
  return (
    <SectionOrderProvider>
      <ConservationWorkspacePageContent />
    </SectionOrderProvider>
  );
}

function ConservationWorkspacePageContent() {
  const { orgId, treatmentId } = useParams<{ orgId: string; treatmentId?: string }>();

  const { requirementGroups } = useProcedureRequirements('conservation', orgId);

  const [showConservatorSelector, setShowConservatorSelector] = useState(false);
  const [showReportSlideOver, setShowReportSlideOver] = useState(false);

  const isCreateMode = !treatmentId;

  const form = useFormState({
    orgId,
    conservationId: treatmentId,
    isCreateMode: isCreateMode,
    conservation: null,
  });

  const {
    formData,
    updateField,
    hasUnsavedChanges,
    saveStatus,
    lastSaved,
    errorMessage,
    conservation,
    isLoading,
    error,
    conservatorContact,
    queryClient,
    triggerSave,
    handleCreate,
    statusMutation,
    deleteMutation,
    getLookup,
    getLabel,
  } = form;

  const wp = useWorkspacePage({
    entityType: 'conservation',
    entityId: treatmentId,
    entityLabel: conservation?.treatment_number,
    orgId,
    editPermission: 'conservation.edit',
    restrictedFields: conservation?._restricted_fields,

  });
  const { isEditing, setIsEditing, useNewLayout, canEdit, isRestricted, hasPermission, dialogs } = wp;

  const sectionState = useSectionState({
    orgId,
    conservationId: treatmentId,
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
    treatment: {
      treatment_type: formData.treatment_type,
      object_id: formData.object_id,
    },
    conservator: {
      conservator_id: formData.conservator_id,
    },
    proposal: {
      proposal_date: formData.proposal_date,
      proposal_summary: formData.proposal_summary,
      estimated_cost: formData.estimated_cost,
    },
    execution: {
      start_date: formData.start_date,
      end_date: formData.end_date,
      treatment_description: formData.treatment_description,
    },
    actuals: {
      actual_duration_days: formData.actual_duration_days,
      actual_cost: formData.actual_cost,
    },
    recommendations: {
      recommendations: formData.recommendations,
      restrictions: formData.restrictions,
    },
    notes: {
      treatment_note: formData.treatment_note,
    },
    history: {},
  };

  // Display values
  const displayNumber = isCreateMode ? '' : (conservation?.treatment_number || conservation?.treatment_id?.slice(0, 8) || '');
  const displayTitle = isCreateMode
    ? 'New Conservation Treatment'
    : getLabel('treatment_type', conservation?.treatment_type || '');

  // Loading state
  if (!isCreateMode && isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <MadronaLoader label="Loading…" />
      </div>
    );
  }

  // Error state
  if (!isCreateMode && (error || !conservation)) {
    return (
      <div className="p-6 max-w-4xl mx-auto text-center py-12">
        <Wrench size={48} className="mx-auto text-archive mb-4" />
        <h3 className="text-lg font-serif font-medium text-forest mb-2">
          Treatment not found
        </h3>
        <p className="text-accessible-gray mb-4">
          {error ? (error as Error).message : 'The treatment record could not be loaded.'}
        </p>
        <Link
          to={`/organizations/${orgId}/collections/conservation`}
          className="text-bark hover:text-copper-dark"
        >
          Back to Conservation
        </Link>
      </div>
    );
  }

  const statusConfig = !isCreateMode && conservation ? STATUS_CONFIG[conservation.status] || STATUS_CONFIG.proposed : STATUS_CONFIG.proposed;
  const StatusIcon = statusConfig.icon;

  const pageContent = (
    <div className={cn(!useNewLayout && 'p-6 max-w-4xl mx-auto')}>
      {/* Header - only in classic layout */}
      {!useNewLayout && (
        <WorkspaceHeader
          backUrl={`/organizations/${orgId}/collections/conservation`}
          backText="Back to Conservation"
          title={displayTitle}
          objectNumber={displayNumber}
          isEditing={isEditing}
          saveStatus={saveStatus}
          lastSaved={lastSaved}
          hasUnsavedChanges={hasUnsavedChanges}
          showCreateButton={isCreateMode}
          createButtonText="Create Conservation Treatment"
          onSave={isCreateMode ? handleCreate : undefined}
          onToggleMode={isCreateMode ? undefined : handleToggleMode}
        />
      )}

      {/* Edit mode indicator */}

      {/* Status Bar - only show in view/edit mode, not create mode */}
      {!isCreateMode && conservation && (
        <div className="flex items-center gap-4 mb-6">
          <span className={cn('inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium', statusConfig.color)}>
            <StatusIcon size={16} />
            {statusConfig.label}
          </span>
          <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-stone rounded-full text-sm text-archive">
            <Wrench size={16} />
            {getLabel('treatment_type', conservation.treatment_type)}
          </span>

          {/* Status Actions */}
          <div className="flex-1" />
          <button
            onClick={() => setShowReportSlideOver(true)}
            className="btn btn-secondary text-sm"
          >
            <FileText size={16} className="mr-1.5" />
            Generate Report
          </button>
          {conservation.status === 'proposed' && (
            <button
              onClick={() => statusMutation.mutate('approved')}
              className="btn btn-secondary text-sm"
              disabled={statusMutation.isPending}
            >
              <CheckCircle size={16} className="mr-1.5" />
              Approve
            </button>
          )}
          {conservation.status === 'approved' && (
            <button
              onClick={() => statusMutation.mutate('in_progress')}
              className="btn btn-secondary text-sm"
              disabled={statusMutation.isPending}
            >
              <PlayCircle size={16} className="mr-1.5" />
              Start Treatment
            </button>
          )}
          {conservation.status === 'in_progress' && (
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
      {!isCreateMode && conservation && (
                  <ProcedureRequirementsCard
            title="Conservation Requirements"
            requirementGroups={requirementGroups}
            record={formData as unknown as Record<string, unknown>}
            currentStatus={conservation.status}
            statusOrder={['proposed', 'under_review', 'committee_reviewed', 'pending_board', 'approved', 'in_progress', 'completed']}
            onSectionNavigate={handleEnterEditMode}
          />
      )}

      {/* Sections */}
      <div className="flex flex-col gap-4">
        {/* === OVERVIEW GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Overview" icon={Wrench} />}

        {/* Treatment Information */}
        <WorkspaceSection
          id="treatment"
          title="Treatment Information"
          icon={<Wrench size={18} />}
          isExpanded={expandedSections.treatment}
          onToggle={() => toggleSection('treatment')}
          isEditing={isEditing}
          order={getSectionOrder('treatment')}
          isEmpty={!hasContent.treatment}
          summary={sectionSummaries.treatment}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableSelect
              label="Treatment Type"
              value={formData.treatment_type}
              isEditing={isEditing}
              onChange={(v) => updateField('treatment_type', v)}
              required
              options={getLookup('treatment_type')}
            />
            <ObjectSelector
              organizationId={orgId!}
              objectId={formData.object_id || null}
              onChange={(id) => updateField('object_id', id || '')}
              isEditing={isEditing}
              label="Linked Object"
            />
          </div>
        </WorkspaceSection>

        {/* Conservator */}
        <WorkspaceSection
          id="conservator"
          title="Conservator Information"
          icon={<User size={18} />}
          isExpanded={expandedSections.conservator}
          onToggle={() => toggleSection('conservator')}
          isEditing={isEditing}
          order={getSectionOrder('conservator')}
          isEmpty={!hasContent.conservator}
          summary={sectionSummaries.conservator}
        >
          {isRestricted('conservator_contact') ? (
            <RestrictedFieldPlaceholder label="Conservator" />
          ) : (
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">
                Conservator
              </label>
              {isEditing ? (
                <div className="flex items-center gap-2">
                  {formData.conservator_id && conservatorContact ? (
                    <div className="flex-1 flex items-center gap-2 px-3 py-2 border border-lichen rounded-lg bg-parchment">
                      <User size={16} className="text-archive flex-shrink-0" />
                      <span className="text-sm text-ink">{conservatorContact.name}</span>
                      {conservatorContact.organization_name && (
                        <span className="text-xs text-archive">({conservatorContact.organization_name})</span>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          updateField('conservator_id', '');
                        }}
                        className="ml-auto p-1 text-archive hover:text-semantic-error"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowConservatorSelector(true)}
                      className="flex-1 flex items-center gap-2 px-3 py-2 border border-dashed border-lichen rounded-lg text-sm text-archive hover:border-bark hover:text-bark transition-colors"
                    >
                      <Search size={16} />
                      Search or create conservator...
                    </button>
                  )}
                  {formData.conservator_id && (
                    <button
                      type="button"
                      onClick={() => setShowConservatorSelector(true)}
                      className="px-3 py-2 text-sm text-bark hover:text-copper-dark"
                    >
                      Change
                    </button>
                  )}
                </div>
              ) : (
                <div className="text-sm text-ink">
                  {conservatorContact ? (
                    <span>
                      {conservatorContact.name}
                      {conservatorContact.organization_name && (
                        <span className="text-archive ml-1">({conservatorContact.organization_name})</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-archive">Not specified</span>
                  )}
                </div>
              )}
            </div>
          )}
        </WorkspaceSection>

        {/* === PROPOSAL GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Proposal" icon={FileText} />}

        {/* Treatment Proposal */}
        <WorkspaceSection
          id="proposal"
          title="Treatment Proposal"
          icon={<FileText size={18} />}
          isExpanded={expandedSections.proposal}
          onToggle={() => toggleSection('proposal')}
          isEditing={isEditing}
          order={getSectionOrder('proposal')}
          isEmpty={!hasContent.proposal}
          summary={sectionSummaries.proposal}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableField
              label="Proposal Date"
              value={formData.proposal_date}
              isEditing={isEditing}
              onChange={(v) => updateField('proposal_date', v)}
              type="date"
            />
            <EditableField
              label="Document Reference"
              value={formData.proposal_document_ref}
              isEditing={isEditing}
              onChange={(v) => updateField('proposal_document_ref', v)}
              placeholder="Proposal document number"
            />
            <EditableField
              label="Proposal Summary"
              value={formData.proposal_summary}
              isEditing={isEditing}
              onChange={(v) => updateField('proposal_summary', v)}
              multiline
              rows={4}
              placeholder="Summary of proposed treatment..."
              className="md:col-span-2"
            />
            <EditableField
              label="Estimated Duration (days)"
              value={formData.estimated_duration_days}
              isEditing={isEditing}
              onChange={(v) => updateField('estimated_duration_days', v)}
              type="number"
            />
            <EditableField
              label="Estimated Cost"
              value={formData.estimated_cost}
              isEditing={isEditing}
              onChange={(v) => updateField('estimated_cost', v)}
              type="number"
              placeholder="0.00"
              restricted={isRestricted('estimated_cost')}
            />
            <EditableSelect
              label="Currency"
              value={formData.estimated_cost_currency}
              isEditing={isEditing}
              onChange={(v) => updateField('estimated_cost_currency', v)}
              options={getLookup('currency')}
            />
          </div>
        </WorkspaceSection>

        {/* === EXECUTION GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Execution" icon={Calendar} />}

        {/* Treatment Execution */}
        <WorkspaceSection
          id="execution"
          title="Treatment Execution"
          icon={<Calendar size={18} />}
          isExpanded={expandedSections.execution}
          onToggle={() => toggleSection('execution')}
          isEditing={isEditing}
          order={getSectionOrder('execution')}
          isEmpty={!hasContent.execution}
          summary={sectionSummaries.execution}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableField
              label="Start Date"
              value={formData.start_date}
              isEditing={isEditing}
              onChange={(v) => updateField('start_date', v)}
              type="date"
            />
            <EditableField
              label="End Date"
              value={formData.end_date}
              isEditing={isEditing}
              onChange={(v) => updateField('end_date', v)}
              type="date"
            />
            <EditableField
              label="Treatment Description"
              value={formData.treatment_description}
              isEditing={isEditing}
              onChange={(v) => updateField('treatment_description', v)}
              multiline
              rows={5}
              placeholder="Detailed description of treatment performed..."
              className="md:col-span-2"
              restricted={isRestricted('treatment_description')}
            />
            <EditableField
              label="Methods Used"
              value={formData.methods_used}
              isEditing={isEditing}
              onChange={(v) => updateField('methods_used', v)}
              multiline
              rows={3}
              placeholder="Conservation methods and techniques used..."
              className="md:col-span-2"
            />
            <EditableField
              label="Materials Used (JSON)"
              value={formData.materials_used}
              isEditing={isEditing}
              onChange={(v) => updateField('materials_used', v)}
              multiline
              rows={3}
              placeholder='[{"material": "Paraloid B-72", "supplier": "Kremer", "lot_number": "12345"}]'
              className="md:col-span-2"
              restricted={isRestricted('materials_used')}
            />
          </div>
        </WorkspaceSection>

        {/* Actual Results */}
        <WorkspaceSection
          id="actuals"
          title="Actual Results"
          icon={<DollarSign size={18} />}
          isExpanded={expandedSections.actuals}
          onToggle={() => toggleSection('actuals')}
          isEditing={isEditing}
          order={getSectionOrder('actuals')}
          isEmpty={!hasContent.actuals}
          summary={sectionSummaries.actuals}
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <EditableField
              label="Actual Duration (days)"
              value={formData.actual_duration_days}
              isEditing={isEditing}
              onChange={(v) => updateField('actual_duration_days', v)}
              type="number"
            />
            <EditableField
              label="Actual Cost"
              value={formData.actual_cost}
              isEditing={isEditing}
              onChange={(v) => updateField('actual_cost', v)}
              type="number"
              placeholder="0.00"
              restricted={isRestricted('actual_cost')}
            />
            <EditableSelect
              label="Currency"
              value={formData.actual_cost_currency}
              isEditing={isEditing}
              onChange={(v) => updateField('actual_cost_currency', v)}
              options={getLookup('currency')}
            />
          </div>
        </WorkspaceSection>

        {/* === OUTCOME GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Outcome" icon={StickyNote} />}

        {/* Recommendations & Restrictions */}
        <WorkspaceSection
          id="recommendations"
          title="Recommendations & Restrictions"
          icon={<FileText size={18} />}
          isExpanded={expandedSections.recommendations}
          onToggle={() => toggleSection('recommendations')}
          isEditing={isEditing}
          order={getSectionOrder('recommendations')}
          isEmpty={!hasContent.recommendations}
          summary={sectionSummaries.recommendations}
        >
          <div className="grid grid-cols-1 gap-4">
            <EditableField
              label="Recommendations"
              value={formData.recommendations}
              isEditing={isEditing}
              onChange={(v) => updateField('recommendations', v)}
              multiline
              rows={3}
              placeholder="Future care recommendations..."
            />
            <EditableField
              label="Restrictions"
              value={formData.restrictions}
              isEditing={isEditing}
              onChange={(v) => updateField('restrictions', v)}
              multiline
              rows={3}
              placeholder="Display or handling restrictions after treatment..."
            />
          </div>
        </WorkspaceSection>

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
            label="Treatment Notes"
            value={formData.treatment_note}
            isEditing={isEditing}
            onChange={(v) => updateField('treatment_note', v)}
            multiline
            rows={3}
            placeholder="Any additional notes..."
          />
        </WorkspaceSection>

        {/* Change History */}
        {hasPermission('org.view_audit_logs') && !isCreateMode && orgId && treatmentId && (
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
              entityType="conservation_treatment"
              entityId={treatmentId}
            />
          </WorkspaceSection>
        )}
      </div>

      {/* Footer metadata */}
      {!isCreateMode && conservation && (
        <div className="mt-8 pt-6 border-t border-lichen text-sm text-archive">
          <p>Created: {formatDateTime(conservation.created_at)}</p>
          {conservation.updated_at && (
            <p>Last updated: {formatDateTime(conservation.updated_at)}</p>
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
        title="Delete Treatment Record"
        message={<>Are you sure you want to delete <strong>{displayNumber || 'this treatment record'}</strong>? This action cannot be undone.</>}
        confirmText="Delete"
        confirmStyle="danger"
      />

      {/* Generate Report SlideOver */}
      {!isCreateMode && orgId && treatmentId && (
        <GenerateReportSlideOver
          isOpen={showReportSlideOver}
          onClose={() => setShowReportSlideOver(false)}
          contextType="record"
          recordType="conservation_treatments"
          contextParams={{ record_id: treatmentId, record_type: 'conservation_treatments' }}
        />
      )}

      {/* Conservator Contact Selector SlideOver */}
      <ContactSelectorSlideOver
        isOpen={showConservatorSelector}
        organizationId={orgId!}
        onClose={() => setShowConservatorSelector(false)}
        onSelect={(contactId) => {
          updateField('conservator_id', contactId);
          setShowConservatorSelector(false);
        }}
        title="Select Conservator"
        subtitle="Search for an existing contact or create a new one"
        constituentTypes={['person', 'organization']}
      />

      {/* Create Task SlideOver */}
      {orgId && treatmentId && conservation && (
        <CreateTaskSlideOver
          isOpen={dialogs.showCreateTask}
          onClose={() => dialogs.setShowCreateTask(false)}
          orgId={orgId}
          initialEntityType={"conservation" as React.ComponentProps<typeof CreateTaskSlideOver>['initialEntityType']}
          initialEntityId={treatmentId}
          initialEntityLabel={conservation.treatment_number || `Conservation ${treatmentId.slice(0, 8)}`}
        />
      )}
    </div>
  );

  // New layout with RecordDetailPageWrapper
  if (useNewLayout && conservation) {
    return (
      <WorkspaceErrorBoundary
        backUrl={`/organizations/${orgId}/collections/conservation`}
        backLabel="Back to Conservation"
      >
        <RecordDetailPageWrapper
          object={null}
          media={[]}
          sectionIds={ALL_SECTION_IDS}
          sectionGroups={CONSERVATION_SECTION_GROUPS}
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
          pageType="conservation"
          enabled={true}
          showHeader={true}
          title="Conservation"
          objectNumber={conservation.treatment_number || undefined}
          subtitle={getLabel('treatment_type', conservation.treatment_type)}
          backUrl={`/organizations/${orgId}/collections/conservation`}
          backLabel="Back to Conservation"
        >
          {pageContent}
        </RecordDetailPageWrapper>
      </WorkspaceErrorBoundary>
    );
  }

  return (
    <WorkspaceErrorBoundary
      backUrl={orgId ? `/organizations/${orgId}/collections/conservation` : undefined}
      backLabel="Back to Conservation"
    >
      {pageContent}
    </WorkspaceErrorBoundary>
  );
}
