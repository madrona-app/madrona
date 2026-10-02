import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useWorkspacePage } from '../../../hooks/useWorkspacePage';
import { formatDateTime } from '@/lib/formatters';
import {
  AlertTriangle,
  Eye,
  Zap,
  Shield,
  DollarSign,
  Search,
  CheckCircle,
  FileText,
  Trash2,
  Package,
  History,
} from 'lucide-react';
import {
  getIncidentReport,
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
import { IncidentObjectLinker } from '../../../components/collections/IncidentObjectLinker';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { cn } from '../../../lib/utils';
import { useProcedureRequirements } from '../../../hooks/useProcedureRequirements';
import { ProcedureRequirementsCard } from '../../../components/collections/ProcedureRequirementsCard';

import { useFormState, useSectionState, useSectionSummaries, useHasContent } from './hooks';
import {
  INCIDENT_REPORT_SECTION_GROUPS,
  ALL_SECTION_IDS,
  STATUS_STYLES,
} from './types';
import { MadronaLoader } from '../../../components/ui/MadronaLoader';

/**
 * Outer wrapper that provides section order context.
 */
export default function IncidentReportWorkspacePage() {
  return (
    <SectionOrderProvider>
      <IncidentReportWorkspacePageContent />
    </SectionOrderProvider>
  );
}

function IncidentReportWorkspacePageContent() {
  const { orgId, reportId } = useParams<{ orgId: string; reportId?: string }>();

  // Fetch report data (disabled in create mode)
  const isCreateMode = !reportId;
  const { requirementGroups } = useProcedureRequirements('incident_report', orgId);

  const { data: report, isLoading, error } = useQuery({
    queryKey: ['incident-report', orgId, reportId],
    queryFn: () => getIncidentReport(orgId!, reportId!),
    enabled: !isCreateMode && !!orgId && !!reportId,
  });

  const reportRecord = report as Record<string, unknown> | undefined;

  const wp = useWorkspacePage({
    entityType: 'incident_report',
    entityId: reportId,
    entityLabel: reportRecord ? ((reportRecord.report_number as string) || `Incident ${reportId!.slice(0, 8)}`) : undefined,
    orgId,
    editPermission: 'incidents.edit',
  });
  const { isEditing, setIsEditing, useNewLayout, canEdit, hasPermission, dialogs } = wp;

  const form = useFormState({ orgId, reportId, isCreateMode, report: reportRecord });

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
    submitMutation,
    investigateMutation,
    resolveMutation,
    closeMutation,
    getLookup,
    getLabel,
  } = form;

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

  const currentStatus = (reportRecord?.status as string) || 'draft';
  const currentType = formData.incident_type || (reportRecord?.incident_type as string) || '';

  // Compute sectionData for nav completeness indicators
  const sectionData: Record<string, unknown> = {
    incident: {
      incident_type: formData.incident_type,
      incident_date: formData.incident_date,
      incident_description: formData.incident_description,
    },
    discovery: {
      discovered_date: formData.discovered_date,
      discovered_by_name: formData.discovered_by_name,
    },
    objects: {},
    response: {
      cause_analysis: formData.cause_analysis,
      immediate_actions: formData.immediate_actions,
    },
    police: {
      police_notified: formData.police_notified,
      police_report_number: formData.police_report_number,
    },
    insurance: {
      insurance_claim_filed: formData.insurance_claim_filed,
      insurance_claim_number: formData.insurance_claim_number,
    },
    investigation: {
      investigation_required: formData.investigation_required,
      investigation_findings: formData.investigation_findings,
    },
    resolution: {
      resolution_summary: formData.resolution_summary,
      resolved_date: formData.resolved_date,
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
  if (!isCreateMode && (error || !report)) {
    return (
      <div className="p-6 max-w-4xl mx-auto text-center py-12">
        <AlertTriangle size={48} className="mx-auto text-archive mb-4" />
        <h3 className="text-lg font-serif font-medium text-forest mb-2">
          Incident report not found
        </h3>
        <p className="text-accessible-gray mb-4">
          {error ? (error as Error).message : 'The incident report could not be loaded.'}
        </p>
      </div>
    );
  }

  const displayNumber = formData.report_number || (reportRecord?.report_number as string) || '';
  const displayTitle = isCreateMode
    ? 'New Incident Report'
    : getLabel('incident_type', (reportRecord?.incident_type as string) || '');

  const pageContent = (
    <div className={cn(!useNewLayout && 'p-6 max-w-4xl mx-auto')}>
      {/* Header - only in classic layout */}
      {!useNewLayout && (
        <WorkspaceHeader
          backUrl={`/organizations/${orgId}/collections/incidents`}
          backText="Back to Incident Reports"
          title={displayTitle}
          objectNumber={displayNumber}
          isEditing={isEditing}
          saveStatus={saveStatus}
          lastSaved={lastSaved}
          hasUnsavedChanges={hasUnsavedChanges}
          showCreateButton={isCreateMode}
          createButtonText="Create Report"
          onSave={isCreateMode ? handleCreate : undefined}
          onToggleMode={isCreateMode ? undefined : handleToggleMode}
          statusBadge={!isCreateMode && reportRecord ? (
            <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLES[currentStatus]}`}>
              {currentStatus.replace('_', ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
            </span>
          ) : undefined}
          typeBadge={!isCreateMode && reportRecord ? (
            <span className="text-xs px-2 py-0.5 bg-semantic-error/10 rounded-full text-semantic-error uppercase tracking-wide">
              {getLabel('incident_type', (reportRecord.incident_type as string) || '')}
            </span>
          ) : undefined}
          actions={!isCreateMode && !isEditing ? (
            <div className="flex gap-2">
              {currentStatus === 'draft' && (
                <button
                  onClick={() => submitMutation.mutate()}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm border border-lichen rounded-lg text-ink hover:bg-stone transition-colors"
                  disabled={submitMutation.isPending}
                >
                  <FileText size={14} />
                  Submit
                </button>
              )}
              {currentStatus === 'submitted' && (
                <button
                  onClick={() => investigateMutation.mutate()}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm border border-lichen rounded-lg text-ink hover:bg-stone transition-colors"
                  disabled={investigateMutation.isPending}
                >
                  <Search size={14} />
                  Start Investigation
                </button>
              )}
              {currentStatus === 'under_investigation' && (
                <button
                  onClick={() => resolveMutation.mutate()}
                  className="btn btn-primary text-sm flex items-center gap-2"
                  disabled={resolveMutation.isPending}
                >
                  <CheckCircle size={14} />
                  Resolve
                </button>
              )}
              {currentStatus === 'resolved' && (
                <button
                  onClick={() => closeMutation.mutate()}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm border border-lichen rounded-lg text-ink hover:bg-stone transition-colors"
                  disabled={closeMutation.isPending}
                >
                  <CheckCircle size={14} />
                  Close
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

      {/* Alert Banner for serious incidents */}
      {!isCreateMode && (currentType === 'theft' || currentType === 'fire') && (
        <div className="mb-4 bg-semantic-error/10 border border-semantic-error/30 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-semantic-error mt-0.5" />
            <div>
              <p className="font-medium text-semantic-error">
                {currentType === 'theft' ? 'Theft Incident' : 'Fire Incident'}
              </p>
              <p className="text-sm text-archive">
                {currentType === 'theft'
                  ? 'Ensure police have been notified and a report filed.'
                  : 'Ensure fire department and insurance have been notified.'}
              </p>
            </div>
          </div>
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
      {!isCreateMode && reportRecord && (
                  <ProcedureRequirementsCard
            title="Incident Report Requirements"
            requirementGroups={requirementGroups}
            record={formData as unknown as Record<string, unknown>}
            currentStatus={currentStatus}
            statusOrder={['draft', 'submitted', 'under_investigation', 'resolved', 'closed']}
            onSectionNavigate={handleEnterEditMode}
          />
      )}

      {/* Sections */}
      <div className="flex flex-col gap-4">
        {/* === OVERVIEW GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Overview" icon={AlertTriangle} />}

        {/* Incident Information */}
        <WorkspaceSection
          id="incident"
          title="Incident Information"
          icon={<AlertTriangle size={18} />}
          isExpanded={expandedSections.incident}
          onToggle={() => toggleSection('incident')}
          isEditing={isEditing}
          order={getSectionOrder('incident')}
          isEmpty={!hasContent.incident}
          summary={sectionSummaries.incident}
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <EditableField
              label="Report Number"
              value={formData.report_number}
              isEditing={false}
              onChange={() => {}}
              placeholder={isCreateMode ? 'Auto-generated' : ''}
            />
            <EditableField
              label="Report Date"
              value={formData.report_date}
              isEditing={isEditing}
              onChange={(v) => updateField('report_date', v)}
              type="date"
            />
            <EditableSelect
              label="Incident Type"
              value={formData.incident_type}
              isEditing={isEditing}
              onChange={(v) => updateField('incident_type', v)}
              options={getLookup('incident_type')}
              required
            />
            <EditableField
              label="Incident Date"
              value={formData.incident_date}
              isEditing={isEditing}
              onChange={(v) => updateField('incident_date', v)}
              type="date"
            />
            <EditableField
              label="Subtype"
              value={formData.incident_subtype}
              isEditing={isEditing}
              onChange={(v) => updateField('incident_subtype', v)}
              placeholder="Optional subtype"
            />
            <div />
            <EditableField
              label="Location"
              value={formData.incident_location_description}
              isEditing={isEditing}
              onChange={(v) => updateField('incident_location_description', v)}
              placeholder="Where did the incident occur?"
              className="md:col-span-3"
            />
            <EditableField
              label="Incident Description"
              value={formData.incident_description}
              isEditing={isEditing}
              onChange={(v) => updateField('incident_description', v)}
              multiline
              rows={4}
              placeholder="Describe what happened..."
              required
              className="md:col-span-3"
            />
          </div>
        </WorkspaceSection>

        {/* Discovery */}
        <WorkspaceSection
          id="discovery"
          title="Discovery"
          icon={<Eye size={18} />}
          isExpanded={expandedSections.discovery}
          onToggle={() => toggleSection('discovery')}
          isEditing={isEditing}
          order={getSectionOrder('discovery')}
          isEmpty={!hasContent.discovery}
          summary={sectionSummaries.discovery}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableField
              label="Discovered Date"
              value={formData.discovered_date}
              isEditing={isEditing}
              onChange={(v) => updateField('discovered_date', v)}
              type="date"
            />
            <EditableField
              label="Discovered By"
              value={formData.discovered_by_name}
              isEditing={isEditing}
              onChange={(v) => updateField('discovered_by_name', v)}
            />
            <EditableField
              label="Discovery Circumstances"
              value={formData.discovery_circumstances}
              isEditing={isEditing}
              onChange={(v) => updateField('discovery_circumstances', v)}
              multiline
              rows={2}
              placeholder="How was the incident discovered?"
              className="md:col-span-2"
            />
          </div>
        </WorkspaceSection>

        {/* Affected Objects - only show for existing reports */}
        {!isCreateMode && (
          <WorkspaceSection
            id="objects"
            title="Affected Objects"
            icon={<Package size={18} />}
            isExpanded={expandedSections.objects}
            onToggle={() => toggleSection('objects')}
            isEditing={isEditing}
            order={getSectionOrder('objects')}
            isEmpty={!hasContent.objects}
            summary={sectionSummaries.objects}
          >
            <IncidentObjectLinker
              organizationId={orgId!}
              reportId={reportId!}
              isEditing={isEditing}
            />
          </WorkspaceSection>
        )}

        {/* === RESPONSE GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Response" icon={Zap} />}

        {/* Response */}
        <WorkspaceSection
          id="response"
          title="Response"
          icon={<Zap size={18} />}
          isExpanded={expandedSections.response}
          onToggle={() => toggleSection('response')}
          isEditing={isEditing}
          order={getSectionOrder('response')}
          isEmpty={!hasContent.response}
          summary={sectionSummaries.response}
        >
          <div className="grid grid-cols-1 gap-4">
            <EditableField
              label="Cause Analysis"
              value={formData.cause_analysis}
              isEditing={isEditing}
              onChange={(v) => updateField('cause_analysis', v)}
              multiline
              rows={3}
              placeholder="What caused the incident?"
            />
            <EditableField
              label="Immediate Actions Taken"
              value={formData.immediate_actions}
              isEditing={isEditing}
              onChange={(v) => updateField('immediate_actions', v)}
              multiline
              rows={3}
              placeholder="What actions were taken immediately?"
            />
          </div>
        </WorkspaceSection>

        {/* Police Report */}
        <WorkspaceSection
          id="police"
          title="Police Report"
          icon={<Shield size={18} />}
          isExpanded={expandedSections.police}
          onToggle={() => toggleSection('police')}
          isEditing={isEditing}
          order={getSectionOrder('police')}
          isEmpty={!hasContent.police}
          summary={sectionSummaries.police}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableCheckbox
              label="Police notified"
              value={formData.police_notified}
              isEditing={isEditing}
              onChange={(v) => updateField('police_notified', v)}
              className="md:col-span-2"
            />
            {formData.police_notified && (
              <>
                <EditableField
                  label="Report Number"
                  value={formData.police_report_number}
                  isEditing={isEditing}
                  onChange={(v) => updateField('police_report_number', v)}
                />
                <EditableField
                  label="Report Date"
                  value={formData.police_report_date}
                  isEditing={isEditing}
                  onChange={(v) => updateField('police_report_date', v)}
                  type="date"
                />
              </>
            )}
          </div>
        </WorkspaceSection>

        {/* Insurance Claim */}
        <WorkspaceSection
          id="insurance"
          title="Insurance Claim"
          icon={<DollarSign size={18} />}
          isExpanded={expandedSections.insurance}
          onToggle={() => toggleSection('insurance')}
          isEditing={isEditing}
          order={getSectionOrder('insurance')}
          isEmpty={!hasContent.insurance}
          summary={sectionSummaries.insurance}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableCheckbox
              label="Insurance claim filed"
              value={formData.insurance_claim_filed}
              isEditing={isEditing}
              onChange={(v) => updateField('insurance_claim_filed', v)}
              className="md:col-span-2"
            />
            {formData.insurance_claim_filed && (
              <>
                <EditableField
                  label="Claim Number"
                  value={formData.insurance_claim_number}
                  isEditing={isEditing}
                  onChange={(v) => updateField('insurance_claim_number', v)}
                />
                <EditableSelect
                  label="Status"
                  value={formData.insurance_claim_status}
                  isEditing={isEditing}
                  onChange={(v) => updateField('insurance_claim_status', v)}
                  options={getLookup('claim_status')}
                  placeholder="Select status..."
                />
                <EditableField
                  label="Claim Amount"
                  value={formData.insurance_claim_amount}
                  isEditing={isEditing}
                  onChange={(v) => updateField('insurance_claim_amount', v)}
                  type="number"
                  placeholder="0.00"
                />
                <EditableField
                  label="Settlement Amount"
                  value={formData.insurance_settlement_amount}
                  isEditing={isEditing}
                  onChange={(v) => updateField('insurance_settlement_amount', v)}
                  type="number"
                  placeholder="0.00"
                />
              </>
            )}
          </div>
        </WorkspaceSection>

        {/* === OUTCOME GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Outcome" icon={CheckCircle} />}

        {/* Investigation */}
        <WorkspaceSection
          id="investigation"
          title="Investigation"
          icon={<Search size={18} />}
          isExpanded={expandedSections.investigation}
          onToggle={() => toggleSection('investigation')}
          isEditing={isEditing}
          order={getSectionOrder('investigation')}
          isEmpty={!hasContent.investigation}
          summary={sectionSummaries.investigation}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableCheckbox
              label="Investigation required"
              value={formData.investigation_required}
              isEditing={isEditing}
              onChange={(v) => updateField('investigation_required', v)}
              className="md:col-span-2"
            />
            {formData.investigation_required && (
              <>
                <EditableField
                  label="Investigation Findings"
                  value={formData.investigation_findings}
                  isEditing={isEditing}
                  onChange={(v) => updateField('investigation_findings', v)}
                  multiline
                  rows={3}
                  className="md:col-span-2"
                />
                <EditableField
                  label="Completed Date"
                  value={formData.investigation_completed_date}
                  isEditing={isEditing}
                  onChange={(v) => updateField('investigation_completed_date', v)}
                  type="date"
                />
              </>
            )}
          </div>
        </WorkspaceSection>

        {/* Resolution */}
        <WorkspaceSection
          id="resolution"
          title="Resolution"
          icon={<CheckCircle size={18} />}
          isExpanded={expandedSections.resolution}
          onToggle={() => toggleSection('resolution')}
          isEditing={isEditing}
          order={getSectionOrder('resolution')}
          isEmpty={!hasContent.resolution}
          summary={sectionSummaries.resolution}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableField
              label="Resolved Date"
              value={formData.resolved_date}
              isEditing={isEditing}
              onChange={(v) => updateField('resolved_date', v)}
              type="date"
            />
            <div />
            <EditableField
              label="Resolution Summary"
              value={formData.resolution_summary}
              isEditing={isEditing}
              onChange={(v) => updateField('resolution_summary', v)}
              multiline
              rows={3}
              placeholder="How was the incident resolved?"
              className="md:col-span-2"
            />
            <EditableField
              label="Lessons Learned"
              value={formData.lessons_learned}
              isEditing={isEditing}
              onChange={(v) => updateField('lessons_learned', v)}
              multiline
              rows={3}
              placeholder="What can be done to prevent similar incidents?"
              className="md:col-span-2"
            />
          </div>
        </WorkspaceSection>

        {/* === ADMIN GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Admin" icon={History} />}

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
          >
            <RecordAuditHistory
              organizationId={orgId}
              entityType="incident_report"
              entityId={reportId}
            />
          </WorkspaceSection>
        )}
      </div>

      {/* Footer metadata - only in view/edit mode, not create mode */}
      {!isCreateMode && reportRecord && (reportRecord.created_at as string) && (
        <div className="mt-8 pt-6 border-t border-lichen text-sm text-archive">
          <p>Created: {formatDateTime(reportRecord.created_at as string)}</p>
          {Boolean(reportRecord.updated_at) && (
            <p>Last updated: {formatDateTime(reportRecord.updated_at as string)}</p>
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
        title="Delete Incident Report"
        message={<>Are you sure you want to delete <strong>{displayNumber || 'this incident report'}</strong>? This action cannot be undone.</>}
        confirmText="Delete"
        confirmStyle="danger"
      />

      {/* CreateTaskSlideOver */}
      {orgId && reportId && reportRecord && (
        <CreateTaskSlideOver
          isOpen={dialogs.showCreateTask}
          onClose={() => dialogs.setShowCreateTask(false)}
          orgId={orgId}
          initialEntityType={"incident_report" as React.ComponentProps<typeof CreateTaskSlideOver>['initialEntityType']}
          initialEntityId={reportId}
          initialEntityLabel={(reportRecord.report_number as string) || `Incident ${reportId.slice(0, 8)}`}
        />
      )}
    </div>
  );

  // New layout with RecordDetailPageWrapper
  if (useNewLayout && reportRecord) {
    return (
      <WorkspaceErrorBoundary
        backUrl={`/organizations/${orgId}/collections/incidents`}
        backLabel="Back to Incident Reports"
      >
        <RecordDetailPageWrapper
          object={null}
          media={[]}
          sectionIds={ALL_SECTION_IDS}
          sectionGroups={INCIDENT_REPORT_SECTION_GROUPS}
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
          pageType="incident-report"
          enabled={true}
          showHeader={true}
          title="Incident Report"
          objectNumber={displayNumber || undefined}
          subtitle={displayTitle}
          backUrl={`/organizations/${orgId}/collections/incidents`}
          backLabel="Back to Incident Reports"
        >
          {pageContent}
        </RecordDetailPageWrapper>
      </WorkspaceErrorBoundary>
    );
  }

  return (
    <WorkspaceErrorBoundary
      backUrl={orgId ? `/organizations/${orgId}/collections/incidents` : undefined}
      backLabel="Back to Incident Reports"
    >
      {pageContent}
    </WorkspaceErrorBoundary>
  );
}
