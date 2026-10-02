import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useWorkspacePage } from '../../../hooks/useWorkspacePage';
import { formatDateTime } from '@/lib/formatters';
import {
  FileText,
  Users,
  AlertTriangle,
  ClipboardList,
  Calendar,
  StickyNote,
  Plus,
  X,
  Shield,
  CheckCircle,
  PlayCircle,
  History,
} from 'lucide-react';
import {
  WorkspaceHeader,
  WorkspaceErrorBoundary,
  WorkspaceSection,
  EditableField,
  RecordAuditHistory,
  SectionGroupDivider,
  ReadOnlyBanner,
} from '../../../components/workspace';
import { RecordDetailPageWrapper, SectionOrderProvider } from '../../../components/record-detail';
import { CreateTaskSlideOver } from '../../../components/work/CreateTaskSlideOver';
import { cn } from '../../../lib/utils';
import { getEmergencyPlan } from '../../../lib/api';
import ConfirmDialog from '../../../components/ConfirmDialog';

import { useFormState, useSectionState, useSectionSummaries, useHasContent } from './hooks';
import {
  EMERGENCY_PLAN_SECTION_GROUPS,
  ALL_SECTION_IDS,
  STATUS_STYLES,
} from './types';
import { MadronaLoader } from '../../../components/ui/MadronaLoader';

/**
 * Outer wrapper that provides section order context.
 */
export default function EmergencyPlanWorkspacePage() {
  return (
    <SectionOrderProvider>
      <EmergencyPlanWorkspacePageContent />
    </SectionOrderProvider>
  );
}

function EmergencyPlanWorkspacePageContent() {
  const { orgId, planId } = useParams<{ orgId: string; planId?: string }>();

  // Fetch plan data (disabled in create mode)
  const isCreateMode = !planId;
  const { data: existingPlan, isLoading, error } = useQuery({
    queryKey: ['emergency-plan', orgId, planId],
    queryFn: () => getEmergencyPlan(orgId!, planId!),
    enabled: !isCreateMode && !!orgId && !!planId,
  });

  const planRecord = existingPlan as Record<string, unknown> | undefined;

  const wp = useWorkspacePage({
    entityType: 'emergency_plan',
    entityId: planId,
    entityLabel: planRecord ? ((planRecord.title as string) || `Emergency Plan ${planId!.slice(0, 8)}`) : undefined,
    orgId,
    editPermission: 'emergency_plans.edit',
  });
  const { isEditing, setIsEditing, useNewLayout, canEdit, hasPermission, dialogs } = wp;

  const form = useFormState({
    orgId,
    planId,
    isCreateMode,
    plan: planRecord,
  });

  const {
    formData,
    contacts,
    riskAssessments,
    updateField,
    addContact,
    updateContact,
    removeContact,
    addRiskAssessment,
    updateRiskAssessment,
    removeRiskAssessment,
    hasUnsavedChanges,
    saveStatus,
    lastSaved,
    errorMessage,
    queryClient,
    triggerSave,
    handleCreate,
    deleteMutation,
    approveMutation,
    activateMutation,
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

  const sectionSummaries = useSectionSummaries(formData, contacts, riskAssessments);
  const hasContent = useHasContent(formData, contacts, riskAssessments);

  // Compute sectionData for nav completeness indicators
  const sectionData: Record<string, unknown> = {
    info: {
      title: formData.title,
      plan_version: formData.plan_version,
      facility_name: formData.facility_name,
    },
    contacts: {
      emergency_contacts: contacts.length > 0 ? contacts : null,
    },
    risks: {
      risk_assessments: riskAssessments.length > 0 ? riskAssessments : null,
    },
    procedures: {
      evacuation_procedures: formData.evacuation_procedures,
      response_procedures: formData.response_procedures,
      recovery_procedures: formData.recovery_procedures,
      salvage_priority_guidance: formData.salvage_priority_guidance,
    },
    schedule: {
      last_drill_date: formData.last_drill_date,
      next_drill_date: formData.next_drill_date,
      review_date: formData.review_date,
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
        <MadronaLoader label="Loading…" />
      </div>
    );
  }

  // Error state
  if (!isCreateMode && (error || !existingPlan)) {
    return (
      <div className="p-6 max-w-4xl mx-auto text-center py-12">
        <Shield size={48} className="mx-auto text-archive mb-4" />
        <h3 className="text-lg font-serif font-medium text-forest mb-2">
          Emergency plan not found
        </h3>
        <p className="text-accessible-gray mb-4">
          {error ? (error as Error).message : 'The emergency plan could not be loaded.'}
        </p>
        <Link
          to={`/organizations/${orgId}/collections/emergency-plans`}
          className="text-bark hover:text-copper-dark no-underline"
        >
          Back to Emergency Plans
        </Link>
      </div>
    );
  }

  const displayNumber = isCreateMode ? '' : ((planRecord?.plan_number as string) || '');
  const displayTitle = isCreateMode
    ? 'New Emergency Plan'
    : ((planRecord?.title as string) || 'Emergency Plan');

  const pageContent = (
    <div className={cn(!useNewLayout && 'p-6 max-w-4xl mx-auto')}>
      {/* Header - only in classic layout */}
      {!useNewLayout && (
        <WorkspaceHeader
          backUrl={`/organizations/${orgId}/collections/emergency-plans`}
          backText="Back to Emergency Plans"
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

      {/* Status bar with actions - only show in view/edit mode, not create mode */}
      {!isCreateMode && planRecord && (
        <div className="flex items-center gap-4 mb-6">
          {Boolean(planRecord.plan_version) && (
            <span className="text-xs px-2 py-0.5 bg-stone rounded-full text-archive">
              v{planRecord.plan_version as string}
            </span>
          )}
          <span className={`text-xs px-2 py-1 rounded-full ${STATUS_STYLES[(planRecord.status as string)] || ''}`}>
            {(planRecord.status as string)?.charAt(0).toUpperCase() + (planRecord.status as string)?.slice(1)}
          </span>

          {/* Status Actions */}
          <div className="flex-1" />
          {(planRecord.status as string) === 'draft' && (
            <button
              onClick={() => approveMutation.mutate()}
              className="btn btn-secondary text-sm"
              disabled={approveMutation.isPending}
            >
              <CheckCircle size={16} className="mr-1.5" />
              Approve
            </button>
          )}
          {(planRecord.status as string) === 'approved' && (
            <button
              onClick={() => activateMutation.mutate()}
              className="btn btn-primary text-sm"
              disabled={activateMutation.isPending}
            >
              <PlayCircle size={16} className="mr-1.5" />
              Activate
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
        {useNewLayout && <SectionGroupDivider label="Overview" icon={FileText} />}

        {/* Plan Information */}
        <WorkspaceSection
          id="info"
          title="Plan Information"
          icon={<FileText size={18} />}
          isExpanded={expandedSections.info}
          onToggle={() => toggleSection('info')}
          isEditing={isEditing}
          order={getSectionOrder('info')}
          isEmpty={!hasContent.info}
          summary={sectionSummaries.info}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableField
              label="Plan Title"
              value={formData.title}
              isEditing={isEditing}
              onChange={(v) => updateField('title', v)}
              placeholder="e.g., Main Gallery Emergency Response Plan"
              required
              className="md:col-span-2"
            />
            <EditableField
              label="Version"
              value={formData.plan_version}
              isEditing={isEditing}
              onChange={(v) => updateField('plan_version', v)}
              placeholder="1.0"
            />
            <EditableField
              label="Facility Name"
              value={formData.facility_name}
              isEditing={isEditing}
              onChange={(v) => updateField('facility_name', v)}
              placeholder="Building or facility name"
            />
          </div>
        </WorkspaceSection>

        {/* Emergency Contacts */}
        <WorkspaceSection
          id="contacts"
          title="Emergency Contacts"
          icon={<Users size={18} />}
          isExpanded={expandedSections.contacts}
          onToggle={() => toggleSection('contacts')}
          isEditing={isEditing}
          order={getSectionOrder('contacts')}
          isEmpty={!hasContent.contacts}
          summary={sectionSummaries.contacts}
        >
          <div className="space-y-4">
            {isEditing && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={addContact}
                  className="flex items-center gap-1 px-3 py-2 text-sm border border-lichen rounded-lg text-ink hover:bg-stone transition-colors"
                >
                  <Plus size={16} />
                  Add Contact
                </button>
              </div>
            )}

            {contacts.map((contact, index) => (
              <div key={index} className="p-4 bg-stone/30 rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-archive">Contact {index + 1}</span>
                  {isEditing && (
                    <button
                      type="button"
                      onClick={() => removeContact(index)}
                      className="p-1 hover:bg-stone rounded"
                    >
                      <X size={16} className="text-archive" />
                    </button>
                  )}
                </div>
                {isEditing ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-archive mb-1">Name</label>
                      <input
                        type="text"
                        value={contact.name}
                        onChange={(e) => updateContact(index, 'name', e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-archive mb-1">Role</label>
                      <input
                        type="text"
                        value={contact.role}
                        onChange={(e) => updateContact(index, 'role', e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-archive mb-1">Phone</label>
                      <input
                        type="text"
                        value={contact.phone}
                        onChange={(e) => updateContact(index, 'phone', e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-archive mb-1">Email</label>
                      <input
                        type="email"
                        value={contact.email}
                        onChange={(e) => updateContact(index, 'email', e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <span className="text-xs text-archive">Name</span>
                      <p className="text-sm text-ink">{contact.name || '\u2014'}</p>
                    </div>
                    <div>
                      <span className="text-xs text-archive">Role</span>
                      <p className="text-sm text-ink">{contact.role || '\u2014'}</p>
                    </div>
                    <div>
                      <span className="text-xs text-archive">Phone</span>
                      <p className="text-sm text-bark">{contact.phone || '\u2014'}</p>
                    </div>
                    <div>
                      <span className="text-xs text-archive">Email</span>
                      <p className="text-sm text-bark">{contact.email || '\u2014'}</p>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {contacts.length === 0 && (
              <p className="text-sm text-archive text-center py-4">
                No emergency contacts added. {isEditing && 'Click "Add Contact" to add one.'}
              </p>
            )}
          </div>
        </WorkspaceSection>

        {/* === ASSESSMENT GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Assessment" icon={AlertTriangle} />}

        {/* Risk Assessments */}
        <WorkspaceSection
          id="risks"
          title="Risk Assessments"
          icon={<AlertTriangle size={18} />}
          isExpanded={expandedSections.risks}
          onToggle={() => toggleSection('risks')}
          isEditing={isEditing}
          order={getSectionOrder('risks')}
          isEmpty={!hasContent.risks}
          summary={sectionSummaries.risks}
        >
          <div className="space-y-4">
            {isEditing && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={addRiskAssessment}
                  className="flex items-center gap-1 px-3 py-2 text-sm border border-lichen rounded-lg text-ink hover:bg-stone transition-colors"
                >
                  <Plus size={16} />
                  Add Risk
                </button>
              </div>
            )}

            {riskAssessments.map((risk, index) => (
              <div key={index} className="p-4 bg-stone/30 rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-archive">Risk {index + 1}</span>
                  {isEditing && (
                    <button
                      type="button"
                      onClick={() => removeRiskAssessment(index)}
                      className="p-1 hover:bg-stone rounded"
                    >
                      <X size={16} className="text-archive" />
                    </button>
                  )}
                </div>
                {isEditing ? (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-archive mb-1">Hazard Type</label>
                        <input
                          type="text"
                          value={risk.hazard_type}
                          onChange={(e) => updateRiskAssessment(index, 'hazard_type', e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                          placeholder="e.g., Fire, Flood"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-archive mb-1">Likelihood</label>
                        <select
                          value={risk.likelihood}
                          onChange={(e) => updateRiskAssessment(index, 'likelihood', e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                        >
                          <option value="">Select...</option>
                          <option value="rare">Rare</option>
                          <option value="unlikely">Unlikely</option>
                          <option value="possible">Possible</option>
                          <option value="likely">Likely</option>
                          <option value="almost_certain">Almost Certain</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-archive mb-1">Impact</label>
                        <select
                          value={risk.impact}
                          onChange={(e) => updateRiskAssessment(index, 'impact', e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                        >
                          <option value="">Select...</option>
                          <option value="insignificant">Insignificant</option>
                          <option value="minor">Minor</option>
                          <option value="moderate">Moderate</option>
                          <option value="major">Major</option>
                          <option value="catastrophic">Catastrophic</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-archive mb-1">Mitigation Measures</label>
                      <textarea
                        value={risk.mitigation_measures}
                        onChange={(e) => updateRiskAssessment(index, 'mitigation_measures', e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                        rows={2}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <span className="text-xs text-archive">Hazard Type</span>
                        <p className="text-sm text-ink font-medium">{risk.hazard_type || '\u2014'}</p>
                      </div>
                      <div>
                        <span className="text-xs text-archive">Likelihood</span>
                        <p className="text-sm text-ink">{risk.likelihood || '\u2014'}</p>
                      </div>
                      <div>
                        <span className="text-xs text-archive">Impact</span>
                        <p className="text-sm text-ink">{risk.impact || '\u2014'}</p>
                      </div>
                    </div>
                    {risk.mitigation_measures && (
                      <div>
                        <span className="text-xs text-archive">Mitigation Measures</span>
                        <p className="text-sm text-ink">{risk.mitigation_measures}</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}

            {riskAssessments.length === 0 && (
              <p className="text-sm text-archive text-center py-4">
                No risk assessments added. {isEditing && 'Click "Add Risk" to add one.'}
              </p>
            )}
          </div>
        </WorkspaceSection>

        {/* === RESPONSE GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Response" icon={ClipboardList} />}

        {/* Procedures */}
        <WorkspaceSection
          id="procedures"
          title="Procedures"
          icon={<ClipboardList size={18} />}
          isExpanded={expandedSections.procedures}
          onToggle={() => toggleSection('procedures')}
          isEditing={isEditing}
          order={getSectionOrder('procedures')}
          isEmpty={!hasContent.procedures}
          summary={sectionSummaries.procedures}
        >
          <div className="grid grid-cols-1 gap-4">
            <EditableField
              label="Evacuation Procedures"
              value={formData.evacuation_procedures}
              isEditing={isEditing}
              onChange={(v) => updateField('evacuation_procedures', v)}
              multiline
              rows={4}
              placeholder="Step-by-step evacuation instructions..."
            />
            <EditableField
              label="Response Procedures"
              value={formData.response_procedures}
              isEditing={isEditing}
              onChange={(v) => updateField('response_procedures', v)}
              multiline
              rows={4}
              placeholder="Emergency response procedures..."
            />
            <EditableField
              label="Recovery Procedures"
              value={formData.recovery_procedures}
              isEditing={isEditing}
              onChange={(v) => updateField('recovery_procedures', v)}
              multiline
              rows={4}
              placeholder="Post-emergency recovery procedures..."
            />
            <EditableField
              label="Salvage Priority Guidance"
              value={formData.salvage_priority_guidance}
              isEditing={isEditing}
              onChange={(v) => updateField('salvage_priority_guidance', v)}
              multiline
              rows={4}
              placeholder="Guidance for prioritizing salvage of collections..."
            />
          </div>
        </WorkspaceSection>

        {/* Drill Schedule */}
        <WorkspaceSection
          id="schedule"
          title="Drill Schedule"
          icon={<Calendar size={18} />}
          isExpanded={expandedSections.schedule}
          onToggle={() => toggleSection('schedule')}
          isEditing={isEditing}
          order={getSectionOrder('schedule')}
          isEmpty={!hasContent.schedule}
          summary={sectionSummaries.schedule}
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <EditableField
              label="Last Drill Date"
              value={formData.last_drill_date}
              isEditing={isEditing}
              onChange={(v) => updateField('last_drill_date', v)}
              type="date"
            />
            <EditableField
              label="Next Drill Date"
              value={formData.next_drill_date}
              isEditing={isEditing}
              onChange={(v) => updateField('next_drill_date', v)}
              type="date"
            />
            <EditableField
              label="Next Review Date"
              value={formData.review_date}
              isEditing={isEditing}
              onChange={(v) => updateField('review_date', v)}
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
            label="Notes"
            value={formData.notes}
            isEditing={isEditing}
            onChange={(v) => updateField('notes', v)}
            multiline
            rows={3}
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
              entityType="emergency_plan"
              entityId={planId}
            />
          </WorkspaceSection>
        )}
      </div>

      {/* Footer metadata - only in view/edit mode, not create mode */}
      {!isCreateMode && planRecord && (planRecord.created_at as string) && (
        <div className="mt-8 pt-6 border-t border-lichen text-sm text-archive">
          <p>Created: {formatDateTime(planRecord.created_at as string)}</p>
          {Boolean(planRecord.updated_at) && (
            <p>Last updated: {formatDateTime(planRecord.updated_at as string)}</p>
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
        title="Delete Emergency Plan"
        message={<>Are you sure you want to delete <strong>{formData.title || 'this emergency plan'}</strong>? This action cannot be undone.</>}
        confirmText="Delete"
        confirmStyle="danger"
      />

      {/* CreateTaskSlideOver */}
      {orgId && planId && planRecord && (
        <CreateTaskSlideOver
          isOpen={dialogs.showCreateTask}
          onClose={() => dialogs.setShowCreateTask(false)}
          orgId={orgId}
          initialEntityType={"emergency_plan" as React.ComponentProps<typeof CreateTaskSlideOver>['initialEntityType']}
          initialEntityId={planId}
          initialEntityLabel={(planRecord.title as string) || `Emergency Plan ${planId.slice(0, 8)}`}
        />
      )}
    </div>
  );

  // New layout with RecordDetailPageWrapper
  if (useNewLayout && planRecord) {
    return (
      <WorkspaceErrorBoundary
        backUrl={`/organizations/${orgId}/collections/emergency-plans`}
        backLabel="Back to Emergency Plans"
      >
        <RecordDetailPageWrapper
          object={null}
          media={[]}
          sectionIds={ALL_SECTION_IDS}
          sectionGroups={EMERGENCY_PLAN_SECTION_GROUPS}
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
          pageType="emergency-plan"
          enabled={true}
          showHeader={true}
          title="Emergency Plan"
          objectNumber={(planRecord.plan_number as string) || undefined}
          subtitle={displayTitle}
          backUrl={`/organizations/${orgId}/collections/emergency-plans`}
          backLabel="Back to Emergency Plans"
        >
          {pageContent}
        </RecordDetailPageWrapper>
      </WorkspaceErrorBoundary>
    );
  }

  return (
    <WorkspaceErrorBoundary
      backUrl={orgId ? `/organizations/${orgId}/collections/emergency-plans` : undefined}
      backLabel="Back to Emergency Plans"
    >
      {pageContent}
    </WorkspaceErrorBoundary>
  );
}
