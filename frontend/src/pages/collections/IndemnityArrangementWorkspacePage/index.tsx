import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useWorkspacePage } from '../../../hooks/useWorkspacePage';
import { formatCurrency, formatDateTime } from '@/lib/formatters';
import {
  Shield,
  Calendar,
  DollarSign,
  StickyNote,
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
  PendingApprovalBanner,
} from '../../../components/workspace';
import { RecordDetailPageWrapper, SectionOrderProvider } from '../../../components/record-detail';
import { CreateTaskSlideOver } from '../../../components/work/CreateTaskSlideOver';
import { cn } from '../../../lib/utils';
import { useProcedureRequirements } from '../../../hooks/useProcedureRequirements';
import { ProcedureRequirementsCard } from '../../../components/collections/ProcedureRequirementsCard';
import { getIndemnityArrangement } from '../../../lib/api';
import Checkbox from '../../../components/Checkbox';
import ConfirmDialog from '../../../components/ConfirmDialog';

import { useFormState, useSectionState, useSectionSummaries, useHasContent } from './hooks';
import ObjectsSection from './ObjectsSection';
import {
  INDEMNITY_SECTION_GROUPS,
  ALL_SECTION_IDS,
  PROGRAM_OPTIONS,
  STATUS_OPTIONS,
  CURRENCY_OPTIONS,
  STATUS_STYLES,
} from './types';
import { MadronaLoader } from '../../../components/ui/MadronaLoader';

function formatCurrencyShort(amount: number, currency = 'USD') {
  return formatCurrency(amount, currency, 0);
}

/**
 * Outer wrapper that provides section order context.
 */
export default function IndemnityArrangementWorkspacePage() {
  return (
    <SectionOrderProvider>
      <IndemnityArrangementWorkspacePageContent />
    </SectionOrderProvider>
  );
}

function IndemnityArrangementWorkspacePageContent() {
  const { orgId, indemnityId } = useParams<{ orgId: string; indemnityId?: string }>();
  const isCreateMode = !indemnityId;
  const { requirementGroups } = useProcedureRequirements('indemnity_arrangement', orgId);

  // Fetch indemnity data (disabled in create mode)
  const { data: indemnity, isLoading, error } = useQuery({
    queryKey: ['indemnity-arrangement', orgId, indemnityId],
    queryFn: () => getIndemnityArrangement(orgId!, indemnityId!),
    enabled: !!indemnityId && !!orgId,
  });

  const indemnityRecord = indemnity as Record<string, unknown> | undefined;

  const wp = useWorkspacePage({
    entityType: 'indemnity_arrangement',
    entityId: indemnityId,
    entityLabel: (indemnityRecord?.internal_reference as string) || (indemnityRecord?.reference_number as string) || (indemnityId ? `Indemnity ${indemnityId.slice(0, 8)}` : undefined),
    orgId,
    editPermission: 'insurance.edit',
  });
  const { isEditing, setIsEditing, useNewLayout, canEdit, hasPermission, dialogs } = wp;

  const form = useFormState({
    orgId,
    indemnityId,
    isCreateMode,
    indemnity: indemnityRecord,
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
  } = form;

  const sectionState = useSectionState({
    orgId,
    indemnityId,
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

  const indemnityObjects = (indemnityRecord?.objects as Array<Record<string, unknown>>) ?? [];
  const objectCount = indemnityObjects.length;

  const sectionSummaries = useSectionSummaries(formData, objectCount);
  const hasContent = useHasContent(formData, objectCount);

  // Compute sectionData for nav completeness indicators
  const sectionData: Record<string, unknown> = {
    arrangement: {
      program: formData.program,
      reference_number: formData.reference_number,
      status: formData.status,
    },
    application: {
      requested_coverage: formData.requested_coverage,
      awarded_coverage: formData.awarded_coverage,
      application_date: formData.application_date,
    },
    coveragePeriod: {
      coverage_start_date: formData.coverage_start_date,
      coverage_end_date: formData.coverage_end_date,
    },
    objects: {
      count: objectCount,
    },
    notes: {
      notes: formData.notes,
    },
    history: {},
  };

  // Loading state
  if (!isCreateMode && isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <MadronaLoader label="Loading\u2026" />
      </div>
    );
  }

  // Error state
  if (!isCreateMode && (error || !indemnity)) {
    return (
      <div className="p-6 max-w-4xl mx-auto text-center py-12">
        <Shield size={48} className="mx-auto text-archive mb-4" />
        <h3 className="text-lg font-serif font-medium text-forest mb-2">
          Indemnity arrangement not found
        </h3>
        <p className="text-accessible-gray mb-4">
          {error ? (error as Error).message : 'The indemnity arrangement could not be loaded.'}
        </p>
      </div>
    );
  }

  const getProgramLabel = (value: string) =>
    PROGRAM_OPTIONS.find(o => o.value === value)?.label || value;

  const displayNumber = isCreateMode ? '' : ((indemnityRecord?.reference_number as string) || (indemnityRecord?.internal_reference as string) || (indemnityRecord?.indemnity_id as string)?.slice(0, 8) || '');
  const displayTitle = isCreateMode
    ? 'New Indemnity Arrangement'
    : ((indemnityRecord?.internal_reference as string) || getProgramLabel((indemnityRecord?.program as string) || 'uk_gis'));

  const statusStyle = STATUS_STYLES[formData.status] || STATUS_STYLES.draft;
  const StatusIcon = statusStyle.icon;

  const pageContent = (
    <div className={cn(!useNewLayout && 'p-6 max-w-4xl mx-auto')}>
      {/* Header - only in classic layout */}
      {!useNewLayout && (
        <WorkspaceHeader
          backUrl={`/organizations/${orgId}/collections/insurance/indemnities`}
          backText="Back to Indemnity Arrangements"
          title={displayTitle}
          objectNumber={displayNumber}
          isEditing={isEditing}
          saveStatus={saveStatus}
          lastSaved={lastSaved}
          hasUnsavedChanges={hasUnsavedChanges}
          showCreateButton={isCreateMode}
          createButtonText="Create Arrangement"
          onSave={isCreateMode ? handleCreate : undefined}
          onToggleMode={isCreateMode ? undefined : handleToggleMode}
        />
      )}

      {/* Status badge & coverage - only in view/edit mode */}
      {!isCreateMode && indemnityRecord && (
        <div className="flex items-center gap-4 mb-6">
          <span className={cn(
            'inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium',
            statusStyle.bg,
            statusStyle.text
          )}>
            <StatusIcon size={16} />
            {STATUS_OPTIONS.find(s => s.value === indemnityRecord.status)?.label || (indemnityRecord.status as string)}
          </span>
          {(indemnityRecord.awarded_coverage as number) ? (
            <span className="text-lg font-medium text-forest">
              {formatCurrencyShort(indemnityRecord.awarded_coverage as number, indemnityRecord.coverage_currency as string)} awarded
            </span>
          ) : (indemnityRecord.requested_coverage as number) ? (
            <span className="text-lg font-medium text-archive">
              {formatCurrencyShort(indemnityRecord.requested_coverage as number, indemnityRecord.coverage_currency as string)} requested
            </span>
          ) : null}
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
        visible={!isCreateMode && formData.status === 'submitted'}
        entityType="indemnity_arrangement"
        entityId={indemnityId || ''}
        orgId={orgId || ''}
        onReviewed={() => window.location.reload()}
      />

      {/* Procedure Compliance Card */}
      {!isCreateMode && indemnityRecord && (
                  <ProcedureRequirementsCard
            title="Indemnity Requirements"
            requirementGroups={requirementGroups}
            record={formData as unknown as Record<string, unknown>}
            currentStatus={formData.status}
            statusOrder={['draft', 'submitted', 'under_review', 'approved', 'rejected', 'active', 'expired']}
            onSectionNavigate={handleEnterEditMode}
          />
      )}

      {/* Sections */}
      <div className="flex flex-col gap-4">
        {/* === OVERVIEW GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Overview" icon={Shield} />}

        {/* Arrangement Details */}
        <WorkspaceSection
          id="arrangement"
          title="Arrangement Details"
          icon={<Shield size={18} />}
          isExpanded={expandedSections.arrangement}
          onToggle={() => toggleSection('arrangement')}
          isEditing={isEditing}
          order={getSectionOrder('arrangement')}
          isEmpty={!hasContent.arrangement}
          summary={sectionSummaries.arrangement}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableSelect
              label="Program"
              value={formData.program}
              isEditing={isEditing}
              onChange={(v) => updateField('program', v)}
              options={PROGRAM_OPTIONS}
              required
            />
            <EditableSelect
              label="Status"
              value={formData.status}
              isEditing={isEditing}
              onChange={(v) => updateField('status', v)}
              options={STATUS_OPTIONS}
              required
            />
            <EditableField
              label="Reference Number"
              value={formData.reference_number}
              isEditing={isEditing}
              onChange={(v) => updateField('reference_number', v)}
              placeholder="External reference number"
            />
            <EditableField
              label="Internal Reference"
              value={formData.internal_reference}
              isEditing={isEditing}
              onChange={(v) => updateField('internal_reference', v)}
              placeholder="Internal tracking reference"
            />
            <EditableField
              label="Exhibition ID"
              value={formData.exhibition_id}
              isEditing={isEditing}
              onChange={(v) => updateField('exhibition_id', v)}
              placeholder="Linked exhibition"
            />
            <EditableField
              label="Loan In ID"
              value={formData.loan_in_id}
              isEditing={isEditing}
              onChange={(v) => updateField('loan_in_id', v)}
              placeholder="Linked loan in"
            />
          </div>
        </WorkspaceSection>

        {/* Application & Coverage */}
        <WorkspaceSection
          id="application"
          title="Application & Coverage"
          icon={<DollarSign size={18} />}
          isExpanded={expandedSections.application}
          onToggle={() => toggleSection('application')}
          isEditing={isEditing}
          order={getSectionOrder('application')}
          isEmpty={!hasContent.application}
          summary={sectionSummaries.application}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableField
              label="Application Date"
              value={formData.application_date}
              isEditing={isEditing}
              onChange={(v) => updateField('application_date', v)}
              type="date"
            />
            <EditableSelect
              label="Currency"
              value={formData.coverage_currency}
              isEditing={isEditing}
              onChange={(v) => updateField('coverage_currency', v)}
              options={CURRENCY_OPTIONS}
            />
            <EditableField
              label="Requested Coverage"
              value={formData.requested_coverage}
              isEditing={isEditing}
              onChange={(v) => updateField('requested_coverage', v)}
              type="number"
              placeholder="Amount requested"
            />
            <EditableField
              label="Awarded Coverage"
              value={formData.awarded_coverage}
              isEditing={isEditing}
              onChange={(v) => updateField('awarded_coverage', v)}
              type="number"
              placeholder="Amount awarded"
            />
          </div>
        </WorkspaceSection>

        {/* === COVERAGE GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Coverage" icon={DollarSign} />}

        {/* Coverage Period */}
        <WorkspaceSection
          id="coveragePeriod"
          title="Coverage Period"
          icon={<Calendar size={18} />}
          isExpanded={expandedSections.coveragePeriod}
          onToggle={() => toggleSection('coveragePeriod')}
          isEditing={isEditing}
          order={getSectionOrder('coveragePeriod')}
          isEmpty={!hasContent.coveragePeriod}
          summary={sectionSummaries.coveragePeriod}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableField
              label="Coverage Start Date"
              value={formData.coverage_start_date}
              isEditing={isEditing}
              onChange={(v) => updateField('coverage_start_date', v)}
              type="date"
            />
            <EditableField
              label="Coverage End Date"
              value={formData.coverage_end_date}
              isEditing={isEditing}
              onChange={(v) => updateField('coverage_end_date', v)}
              type="date"
            />
          </div>
          <div className="mt-4">
            {isEditing ? (
              <div className="flex items-center gap-3">
                <Checkbox
                  id="commercial_gap_required"
                  checked={formData.commercial_gap_required}
                  onChange={(e) => updateField('commercial_gap_required', e.target.checked)}
                />
                <label htmlFor="commercial_gap_required" className="text-sm text-ink">
                  Commercial gap insurance required
                </label>
              </div>
            ) : formData.commercial_gap_required ? (
              <p className="text-sm text-ink">Commercial gap insurance is required for this arrangement.</p>
            ) : null}
          </div>
        </WorkspaceSection>

        {/* Covered Objects */}
        {!isCreateMode && orgId && indemnityId && (
          <ObjectsSection
            orgId={orgId}
            indemnityId={indemnityId}
            objects={indemnityObjects as any[]}
            coverageCurrency={formData.coverage_currency}
            isEditing={isEditing}
            isExpanded={expandedSections.objects}
            onToggle={() => toggleSection('objects')}
            order={getSectionOrder('objects')}
            isEmpty={!hasContent.objects}
            summary={sectionSummaries.objects || ''}
          />
        )}

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
            label="Notes"
            value={formData.notes}
            isEditing={isEditing}
            onChange={(v) => updateField('notes', v)}
            multiline
            rows={4}
            placeholder="Additional notes about this indemnity arrangement..."
          />
        </WorkspaceSection>

        {/* Change History */}
        {hasPermission('org.view_audit_logs') && !isCreateMode && orgId && indemnityId && (
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
              entityType="indemnity_arrangement"
              entityId={indemnityId}
            />
          </WorkspaceSection>
        )}
      </div>

      {/* Footer metadata */}
      {!isCreateMode && indemnityRecord && (indemnityRecord.created_at as string) && (
        <div className="mt-8 pt-6 border-t border-lichen text-sm text-archive">
          <p>Created: {formatDateTime(indemnityRecord.created_at as string)}</p>
          {Boolean(indemnityRecord.updated_at) && (
            <p>Last updated: {formatDateTime(indemnityRecord.updated_at as string)}</p>
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
        title="Delete Indemnity Arrangement"
        message={<>Are you sure you want to delete <strong>{displayNumber || 'this indemnity arrangement'}</strong>? This action cannot be undone.</>}
        confirmText="Delete"
        confirmStyle="danger"
      />

      {/* CreateTaskSlideOver */}
      {orgId && indemnityId && indemnityRecord && (
        <CreateTaskSlideOver
          isOpen={dialogs.showCreateTask}
          onClose={() => dialogs.setShowCreateTask(false)}
          orgId={orgId}
          initialEntityType={"indemnity_arrangement" as React.ComponentProps<typeof CreateTaskSlideOver>['initialEntityType']}
          initialEntityId={indemnityId}
          initialEntityLabel={(indemnityRecord.internal_reference as string) || (indemnityRecord.reference_number as string) || `Indemnity ${indemnityId.slice(0, 8)}`}
        />
      )}
    </div>
  );

  // New layout with RecordDetailPageWrapper
  if (useNewLayout && indemnityRecord) {
    return (
      <WorkspaceErrorBoundary
        backUrl={`/organizations/${orgId}/collections/insurance/indemnities`}
        backLabel="Back to Indemnity Arrangements"
      >
        <RecordDetailPageWrapper
          object={null}
          media={[]}
          sectionIds={ALL_SECTION_IDS}
          sectionGroups={INDEMNITY_SECTION_GROUPS}
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
          pageType="indemnity"
          enabled={true}
          showHeader={true}
          title="Indemnity"
          objectNumber={(indemnityRecord.reference_number as string) || undefined}
          subtitle={displayTitle}
          backUrl={`/organizations/${orgId}/collections/insurance/indemnities`}
          backLabel="Back to Indemnity Arrangements"
        >
          {pageContent}
        </RecordDetailPageWrapper>
      </WorkspaceErrorBoundary>
    );
  }

  return (
    <WorkspaceErrorBoundary
      backUrl={orgId ? `/organizations/${orgId}/collections/insurance/indemnities` : undefined}
      backLabel="Back to Indemnity Arrangements"
    >
      {pageContent}
    </WorkspaceErrorBoundary>
  );
}
