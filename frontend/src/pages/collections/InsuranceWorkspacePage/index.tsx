import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useWorkspacePage } from '../../../hooks/useWorkspacePage';
import { formatCurrency, formatDateTime } from '@/lib/formatters';
import {
  Shield,
  Building2,
  Calendar,
  DollarSign,
  StickyNote,
  CheckCircle,
  Clock,
  Link as LinkIcon,
  Plus,
  Package,
  ArrowRightLeft,
  Truck,
  Theater,
  History,
  type LucideIcon,
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
import {
  getInsurancePolicy,
  getInsuranceCoverages,
} from '../../../lib/api';
import ConfirmDialog from '../../../components/ConfirmDialog';

import { useFormState, useSectionState, useSectionSummaries, useHasContent } from './hooks';
import {
  INSURANCE_SECTION_GROUPS,
  ALL_SECTION_IDS,
  POLICY_TYPE_OPTIONS,
  STATUS_OPTIONS,
  CURRENCY_OPTIONS,
  STATUS_STYLES,
  ENTITY_TYPE_OPTIONS,
} from './types';
import { MadronaLoader } from '../../../components/ui/MadronaLoader';

const COVERAGE_STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  pending: { bg: 'bg-semantic-warning/10', text: 'text-semantic-warning' },
  confirmed: { bg: 'bg-semantic-success/10', text: 'text-semantic-success' },
  certificate_issued: { bg: 'bg-semantic-info/10', text: 'text-semantic-info' },
  expired: { bg: 'bg-stone', text: 'text-archive' },
  cancelled: { bg: 'bg-semantic-error/10', text: 'text-semantic-error' },
  claimed: { bg: 'bg-semantic-error/10', text: 'text-semantic-error' },
};

const ENTITY_TYPE_ICONS: Record<string, LucideIcon> = {
  collection_object: Package,
  loan_in: ArrowRightLeft,
  loan_out: ArrowRightLeft,
  shipment: Truck,
  exhibition: Theater,
  movement: ArrowRightLeft,
  object_entry: Package,
  object_exit: Package,
};

function formatCurrencyShort(amount: number, currency = 'USD') {
  return formatCurrency(amount, currency, 0);
}

/**
 * Outer wrapper that provides section order context.
 */
export default function InsuranceWorkspacePage() {
  return (
    <SectionOrderProvider>
      <InsuranceWorkspacePageContent />
    </SectionOrderProvider>
  );
}

function InsuranceWorkspacePageContent() {
  const { orgId, policyId } = useParams<{ orgId: string; policyId?: string }>();
  const isCreateMode = !policyId;
  const { requirementGroups } = useProcedureRequirements('insurance_policy', orgId);

  // Fetch policy data (disabled in create mode)
  const { data: policy, isLoading, error } = useQuery({
    queryKey: ['insurance-policy', orgId, policyId],
    queryFn: () => getInsurancePolicy(orgId!, policyId!),
    enabled: !!policyId && !!orgId,
  });

  // Fetch coverages linked to this policy
  const { data: coveragesData } = useQuery({
    queryKey: ['insurance-coverages', orgId, policyId],
    queryFn: () => getInsuranceCoverages(orgId!, { policy_id: policyId }),
    enabled: !!policyId && !!orgId,
  });

  const coverages = coveragesData?.coverages || [];

  const policyRecord = policy as Record<string, unknown> | undefined;

  const wp = useWorkspacePage({
    entityType: 'insurance_policy',
    entityId: policyId,
    entityLabel: (policyRecord?.policy_name as string) || (policyRecord?.policy_number as string) || (policyId ? `Policy ${policyId.slice(0, 8)}` : undefined),
    orgId,
    editPermission: 'insurance.edit',
  });
  const { isEditing, setIsEditing, useNewLayout, canEdit, hasPermission, dialogs } = wp;

  const form = useFormState({
    orgId,
    policyId,
    isCreateMode,
    policy: policyRecord,
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
    addCoverageMutation,
    showAddCoverageForm,
    setShowAddCoverageForm,
    newCoverage,
    setNewCoverage,
    handleAddCoverage,
  } = form;

  const sectionState = useSectionState({
    orgId,
    policyId,
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
      policy_number: formData.policy_number,
      policy_type: formData.policy_type,
      status: formData.status,
    },
    provider: {
      provider_name: formData.provider_name,
      broker_name: formData.broker_name,
    },
    coverage: {
      coverage_limit: formData.coverage_limit,
      deductible: formData.deductible,
      annual_premium: formData.annual_premium,
    },
    dates: {
      effective_date: formData.effective_date,
      expiration_date: formData.expiration_date,
    },
    coveredItems: {
      count: coverages.length,
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
  if (!isCreateMode && (error || !policy)) {
    return (
      <div className="p-6 max-w-4xl mx-auto text-center py-12">
        <Shield size={48} className="mx-auto text-archive mb-4" />
        <h3 className="text-lg font-serif font-medium text-forest mb-2">
          Insurance policy not found
        </h3>
        <p className="text-accessible-gray mb-4">
          {error ? (error as Error).message : 'The insurance policy could not be loaded.'}
        </p>
      </div>
    );
  }

  const getTypeLabel = (value: string) =>
    POLICY_TYPE_OPTIONS.find(o => o.value === value)?.label || value;

  const displayNumber = isCreateMode ? '' : ((policyRecord?.policy_number as string) || (policyRecord?.policy_id as string)?.slice(0, 8) || '');
  const displayTitle = isCreateMode
    ? 'New Insurance Policy'
    : ((policyRecord?.policy_name as string) || getTypeLabel((policyRecord?.policy_type as string) || 'blanket'));

  const statusStyle = STATUS_STYLES[formData.status] || STATUS_STYLES.draft;
  const StatusIcon = statusStyle.icon;

  const pageContent = (
    <div className={cn(!useNewLayout && 'p-6 max-w-4xl mx-auto')}>
      {/* Header - only in classic layout */}
      {!useNewLayout && (
        <WorkspaceHeader
          backUrl={`/organizations/${orgId}/collections/insurance`}
          backText="Back to Insurance"
          title={displayTitle}
          objectNumber={displayNumber}
          isEditing={isEditing}
          saveStatus={saveStatus}
          lastSaved={lastSaved}
          hasUnsavedChanges={hasUnsavedChanges}
          showCreateButton={isCreateMode}
          createButtonText="Create Policy"
          onSave={isCreateMode ? handleCreate : undefined}
          onToggleMode={isCreateMode ? undefined : handleToggleMode}
        />
      )}

      {/* Edit mode indicator */}

      {/* Status badge & coverage - only in view/edit mode */}
      {!isCreateMode && policyRecord && (
        <div className="flex items-center gap-4 mb-6">
          <span className={cn(
            'inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium',
            statusStyle.bg,
            statusStyle.text
          )}>
            <StatusIcon size={16} />
            {STATUS_OPTIONS.find(s => s.value === policyRecord.status)?.label || (policyRecord.status as string)}
          </span>
          {(policyRecord.coverage_limit as number) && (
            <span className="text-lg font-medium text-forest">
              {formatCurrencyShort(policyRecord.coverage_limit as number, policyRecord.coverage_limit_currency as string)}
            </span>
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
        visible={!isCreateMode && formData.status === 'pending_approval'}
        entityType="insurance_policy"
        entityId={policyId || ''}
        orgId={orgId || ''}
        onReviewed={() => window.location.reload()}
      />

      {/* Procedure Compliance Card */}
      {!isCreateMode && policyRecord && (
                  <ProcedureRequirementsCard
            title="Insurance Requirements"
            requirementGroups={requirementGroups}
            record={formData as unknown as Record<string, unknown>}
            currentStatus={formData.status}
            statusOrder={['draft', 'pending_approval', 'active', 'expired', 'cancelled', 'renewed']}
            onSectionNavigate={handleEnterEditMode}
          />
      )}

      {/* Sections */}
      <div className="flex flex-col gap-4">
        {/* === OVERVIEW GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Overview" icon={Shield} />}

        {/* Policy Details */}
        <WorkspaceSection
          id="details"
          title="Policy Details"
          icon={<Shield size={18} />}
          isExpanded={expandedSections.details}
          onToggle={() => toggleSection('details')}
          isEditing={isEditing}
          order={getSectionOrder('details')}
          isEmpty={!hasContent.details}
          summary={sectionSummaries.details}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableField
              label="Policy Number"
              value={formData.policy_number}
              isEditing={isEditing}
              onChange={(v) => updateField('policy_number', v)}
              placeholder="e.g., POL-2024-001"
              required
            />
            <EditableField
              label="Policy Name"
              value={formData.policy_name}
              isEditing={isEditing}
              onChange={(v) => updateField('policy_name', v)}
              placeholder="Optional display name"
            />
            <EditableSelect
              label="Policy Type"
              value={formData.policy_type}
              isEditing={isEditing}
              onChange={(v) => updateField('policy_type', v)}
              options={POLICY_TYPE_OPTIONS}
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
          </div>
        </WorkspaceSection>

        {/* Provider Information */}
        <WorkspaceSection
          id="provider"
          title="Provider Information"
          icon={<Building2 size={18} />}
          isExpanded={expandedSections.provider}
          onToggle={() => toggleSection('provider')}
          isEditing={isEditing}
          order={getSectionOrder('provider')}
          isEmpty={!hasContent.provider}
          summary={sectionSummaries.provider}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableField
              label="Insurance Provider"
              value={formData.provider_name}
              isEditing={isEditing}
              onChange={(v) => updateField('provider_name', v)}
              placeholder="Name of insurance company"
              required
            />
            <EditableField
              label="Broker"
              value={formData.broker_name}
              isEditing={isEditing}
              onChange={(v) => updateField('broker_name', v)}
              placeholder="Insurance broker (if applicable)"
            />
          </div>
        </WorkspaceSection>

        {/* === FINANCIAL GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Financial" icon={DollarSign} />}

        {/* Coverage & Financial */}
        <WorkspaceSection
          id="coverage"
          title="Coverage & Financial"
          icon={<DollarSign size={18} />}
          isExpanded={expandedSections.coverage}
          onToggle={() => toggleSection('coverage')}
          isEditing={isEditing}
          order={getSectionOrder('coverage')}
          isEmpty={!hasContent.coverage}
          summary={sectionSummaries.coverage}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableField
              label="Coverage Limit"
              value={formData.coverage_limit}
              isEditing={isEditing}
              onChange={(v) => updateField('coverage_limit', v)}
              type="number"
              placeholder="Maximum coverage amount"
            />
            <EditableSelect
              label="Currency"
              value={formData.coverage_limit_currency}
              isEditing={isEditing}
              onChange={(v) => updateField('coverage_limit_currency', v)}
              options={CURRENCY_OPTIONS}
            />
            <EditableField
              label="Per Occurrence Limit"
              value={formData.per_occurrence_limit}
              isEditing={isEditing}
              onChange={(v) => updateField('per_occurrence_limit', v)}
              type="number"
              placeholder="Maximum per event"
            />
            <EditableField
              label="Deductible"
              value={formData.deductible}
              isEditing={isEditing}
              onChange={(v) => updateField('deductible', v)}
              type="number"
              placeholder="Policy deductible"
            />
            <EditableField
              label="Annual Premium"
              value={formData.annual_premium}
              isEditing={isEditing}
              onChange={(v) => updateField('annual_premium', v)}
              type="number"
              placeholder="Annual premium amount"
            />
          </div>
        </WorkspaceSection>

        {/* Coverage Period */}
        <WorkspaceSection
          id="dates"
          title="Coverage Period"
          icon={<Calendar size={18} />}
          isExpanded={expandedSections.dates}
          onToggle={() => toggleSection('dates')}
          isEditing={isEditing}
          order={getSectionOrder('dates')}
          isEmpty={!hasContent.dates}
          summary={sectionSummaries.dates}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableField
              label="Effective Date"
              value={formData.effective_date}
              isEditing={isEditing}
              onChange={(v) => updateField('effective_date', v)}
              type="date"
              required
            />
            <EditableField
              label="Expiration Date"
              value={formData.expiration_date}
              isEditing={isEditing}
              onChange={(v) => updateField('expiration_date', v)}
              type="date"
            />
          </div>
        </WorkspaceSection>

        {/* === LINKED ITEMS GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Linked Items" icon={LinkIcon} />}

        {/* Covered Items - only shown for existing policies */}
        {!isCreateMode && (
          <WorkspaceSection
            id="coveredItems"
            title={`Covered Items (${coverages.length})`}
            icon={<LinkIcon size={18} />}
            isExpanded={expandedSections.coveredItems}
            onToggle={() => toggleSection('coveredItems')}
            isEditing={isEditing}
            order={getSectionOrder('coveredItems')}
            isEmpty={!hasContent.coveredItems}
            summary={sectionSummaries.coveredItems}
          >
            {coverages.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-lichen">
                      <th className="text-left py-2 px-2 font-medium text-archive">Type</th>
                      <th className="text-left py-2 px-2 font-medium text-archive">Reference</th>
                      <th className="text-left py-2 px-2 font-medium text-archive">Declared Value</th>
                      <th className="text-left py-2 px-2 font-medium text-archive">Status</th>
                      <th className="text-left py-2 px-2 font-medium text-archive">Certificate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {coverages.map((coverage) => {
                      const EntityIcon = ENTITY_TYPE_ICONS[coverage.covered_entity_type] || Package;
                      const covStatusStyle = COVERAGE_STATUS_STYLES[coverage.status] || COVERAGE_STATUS_STYLES.pending;
                      return (
                        <tr key={coverage.coverage_id} className="border-b border-lichen/50 hover:bg-stone/30">
                          <td className="py-2 px-2">
                            <div className="flex items-center gap-2">
                              <EntityIcon size={16} className="text-archive" />
                              <span>{coverage.covered_entity_type_label}</span>
                            </div>
                          </td>
                          <td className="py-2 px-2">
                            {coverage.covered_entity?.url_path ? (
                              <Link
                                to={`/organizations/${orgId}/${coverage.covered_entity.url_path}`}
                                className="text-bark hover:text-copper-dark"
                              >
                                {coverage.covered_entity.reference || coverage.covered_entity.title || coverage.covered_entity_id.slice(0, 8)}
                              </Link>
                            ) : (
                              <span className="text-archive">{coverage.covered_entity_id.slice(0, 8)}</span>
                            )}
                            {coverage.covered_entity?.title && coverage.covered_entity?.reference && (
                              <p className="text-xs text-archive mt-0.5">{coverage.covered_entity.title}</p>
                            )}
                          </td>
                          <td className="py-2 px-2">
                            {coverage.declared_value
                              ? formatCurrencyShort(coverage.declared_value, coverage.value_currency)
                              : '\u2014'}
                          </td>
                          <td className="py-2 px-2">
                            <span className={cn(
                              'inline-flex px-2 py-0.5 text-xs font-medium rounded-full',
                              covStatusStyle.bg,
                              covStatusStyle.text
                            )}>
                              {coverage.status_label}
                            </span>
                          </td>
                          <td className="py-2 px-2">
                            {coverage.certificate_received ? (
                              <CheckCircle size={16} className="text-semantic-success" />
                            ) : coverage.certificate_requested ? (
                              <Clock size={16} className="text-semantic-warning" />
                            ) : (
                              <span className="text-archive">{'\u2014'}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-archive text-sm">No items linked to this policy yet.</p>
            )}

            {/* Add Coverage Form */}
            {isEditing && (
              <div className="mt-4 pt-4 border-t border-lichen">
                {showAddCoverageForm ? (
                  <div className="bg-stone/30 rounded-lg p-4 space-y-4">
                    <h4 className="font-medium text-ink">Link Item to Policy</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-archive mb-1">Entity Type</label>
                        <select
                          value={newCoverage.covered_entity_type}
                          onChange={(e) => setNewCoverage(prev => ({ ...prev, covered_entity_type: e.target.value }))}
                          className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                        >
                          {ENTITY_TYPE_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-archive mb-1">Entity ID</label>
                        <input
                          type="text"
                          value={newCoverage.covered_entity_id}
                          onChange={(e) => setNewCoverage(prev => ({ ...prev, covered_entity_id: e.target.value }))}
                          placeholder="UUID of the entity"
                          className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-archive mb-1">Declared Value</label>
                        <input
                          type="number"
                          value={newCoverage.declared_value}
                          onChange={(e) => setNewCoverage(prev => ({ ...prev, declared_value: e.target.value }))}
                          placeholder="0.00"
                          className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-archive mb-1">Currency</label>
                        <select
                          value={newCoverage.value_currency}
                          onChange={(e) => setNewCoverage(prev => ({ ...prev, value_currency: e.target.value }))}
                          className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                        >
                          {CURRENCY_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handleAddCoverage}
                        disabled={addCoverageMutation.isPending}
                        className="btn btn-primary disabled:opacity-50"
                      >
                        {addCoverageMutation.isPending ? 'Adding...' : 'Add Coverage'}
                      </button>
                      <button
                        onClick={() => setShowAddCoverageForm(false)}
                        className="px-4 py-2 border border-lichen rounded-lg hover:bg-stone/50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowAddCoverageForm(true)}
                    className="flex items-center gap-2 text-bark hover:text-copper-dark text-sm"
                  >
                    <Plus size={16} />
                    Link item to this policy
                  </button>
                )}
              </div>
            )}
          </WorkspaceSection>
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
            label="Policy Notes"
            value={formData.notes}
            isEditing={isEditing}
            onChange={(v) => updateField('notes', v)}
            multiline
            rows={4}
            placeholder="Additional notes about this policy..."
          />
        </WorkspaceSection>

        {/* Change History */}
        {hasPermission('org.view_audit_logs') && !isCreateMode && orgId && policyId && (
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
              entityType="insurance"
              entityId={policyId}
            />
          </WorkspaceSection>
        )}
      </div>

      {/* Footer metadata */}
      {!isCreateMode && policyRecord && (policyRecord.created_at as string) && (
        <div className="mt-8 pt-6 border-t border-lichen text-sm text-archive">
          <p>Created: {formatDateTime(policyRecord.created_at as string)}</p>
          {Boolean(policyRecord.updated_at) && (
            <p>Last updated: {formatDateTime(policyRecord.updated_at as string)}</p>
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
        title="Delete Insurance Policy"
        message={<>Are you sure you want to delete <strong>{displayNumber || 'this insurance policy'}</strong>? This action cannot be undone.</>}
        confirmText="Delete"
        confirmStyle="danger"
      />

      {/* CreateTaskSlideOver */}
      {orgId && policyId && policyRecord && (
        <CreateTaskSlideOver
          isOpen={dialogs.showCreateTask}
          onClose={() => dialogs.setShowCreateTask(false)}
          orgId={orgId}
          initialEntityType={"insurance_policy" as React.ComponentProps<typeof CreateTaskSlideOver>['initialEntityType']}
          initialEntityId={policyId}
          initialEntityLabel={(policyRecord.policy_name as string) || (policyRecord.policy_number as string) || `Policy ${policyId.slice(0, 8)}`}
        />
      )}
    </div>
  );

  // New layout with RecordDetailPageWrapper
  if (useNewLayout && policyRecord) {
    return (
      <WorkspaceErrorBoundary
        backUrl={`/organizations/${orgId}/collections/insurance`}
        backLabel="Back to Insurance"
      >
        <RecordDetailPageWrapper
          object={null}
          media={[]}
          sectionIds={ALL_SECTION_IDS}
          sectionGroups={INSURANCE_SECTION_GROUPS}
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
          pageType="insurance"
          enabled={true}
          showHeader={true}
          title="Insurance"
          objectNumber={(policyRecord.policy_number as string) || undefined}
          subtitle={displayTitle}
          backUrl={`/organizations/${orgId}/collections/insurance`}
          backLabel="Back to Insurance"
        >
          {pageContent}
        </RecordDetailPageWrapper>
      </WorkspaceErrorBoundary>
    );
  }

  return (
    <WorkspaceErrorBoundary
      backUrl={orgId ? `/organizations/${orgId}/collections/insurance` : undefined}
      backLabel="Back to Insurance"
    >
      {pageContent}
    </WorkspaceErrorBoundary>
  );
}
