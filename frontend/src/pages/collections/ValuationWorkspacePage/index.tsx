import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useWorkspacePage } from '../../../hooks/useWorkspacePage';
import { formatCurrency, formatDateTime } from '@/lib/formatters';
import { NavigationBlockerDialog } from '../../../components/NavigationBlockerDialog';
import {
  DollarSign,
  User,
  Calendar,
  FileText,
  Link as LinkIcon,
  StickyNote,
  CheckCircle,
  Search,
  X,
  History,
  ShieldCheck,
} from 'lucide-react';
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
import { RecordDetailPageWrapper } from '../../../components/record-detail';
import { WorkspacePageShell } from '../../../components/workspace/WorkspacePageShell';
import { CreateTaskSlideOver } from '../../../components/work/CreateTaskSlideOver';
import { ObjectSelector } from '../../../components/collections/ObjectSelector';
import { ContactSelectorSlideOver } from '../../../components/collections/ConstituentSelectorSlideOver';
import { cn } from '../../../lib/utils';
import { useProcedureRequirements } from '../../../hooks/useProcedureRequirements';
import { ProcedureRequirementsCard } from '../../../components/collections/ProcedureRequirementsCard';
import { getValuation, getContact } from '../../../lib/api';
import type { Valuation } from '../../../lib/schemas';
import ConfirmDialog from '../../../components/ConfirmDialog';

import { useFormState, useSectionState, useSectionSummaries, useHasContent } from './hooks';
import {
  VALUATION_SECTION_GROUPS,
  ALL_SECTION_IDS,
} from './types';

export default function ValuationWorkspacePage() {
  const { orgId, valuationId } = useParams<{ orgId: string; valuationId?: string }>();

  // Fetch valuation data (disabled in create mode)
  const isCreateMode = !valuationId;
  const { data: valuation, isLoading, error } = useQuery({
    queryKey: ['valuation', orgId, valuationId],
    queryFn: () => getValuation(orgId!, valuationId!),
    enabled: !isCreateMode && !!orgId && !!valuationId,
  });

  return (
    <WorkspacePageShell
      isLoading={isLoading}
      error={error}
      isCreateMode={isCreateMode}
      entityName="Valuation"
      backUrl={`/organizations/${orgId}/collections/valuations`}
      icon={DollarSign}
      entityData={valuation}
    >
      <ValuationWorkspacePageContent orgId={orgId} valuationId={valuationId} valuation={valuation} />
    </WorkspacePageShell>
  );
}

function ValuationWorkspacePageContent({ orgId, valuationId, valuation }: {
  orgId: string | undefined;
  valuationId: string | undefined;
  valuation: Valuation | undefined;
}) {
  const wp = useWorkspacePage({
    entityType: 'valuation',
    entityId: valuationId,
    entityLabel: valuation ? `${valuation.valuation_type || 'Valuation'} (${(valuation.valuation_date || '').split('T')[0]})` : undefined,
    orgId,
  });

  const { isCreateMode, isEditing, setIsEditing, useNewLayout, dialogs, hasPermission } = wp;
  const { showDeleteConfirm, setShowDeleteConfirm, showCreateTask, setShowCreateTask } = dialogs;
  const { requirementGroups } = useProcedureRequirements('valuation', orgId);

  const [showValuatorSelector, setShowValuatorSelector] = useState(false);
  const [showAuthorizerSelector, setShowAuthorizerSelector] = useState(false);

  const form = useFormState({ orgId, valuationId, isCreateMode, valuation });

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
    blocker,
    getLookup,
    getLabel,
  } = form;

  // Fetch valuator contact details when valuator_id is set
  const { data: valuatorContact } = useQuery({
    queryKey: ['contact', orgId, formData.valuator_id],
    queryFn: () => getContact(orgId!, formData.valuator_id),
    enabled: !!orgId && !!formData.valuator_id,
  });

  // Fetch authorizer contact details when authorizer_id is set
  const { data: authorizerContact } = useQuery({
    queryKey: ['contact', orgId, formData.authorizer_id],
    queryFn: () => getContact(orgId!, formData.authorizer_id),
    enabled: !!orgId && !!formData.authorizer_id,
  });

  const canEdit = isCreateMode || hasPermission('valuations.edit');

  const sectionState = useSectionState({
    orgId,
    valuationId,
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

  // Format currency for display (uses centralized formatter)
  const formatCurrencyDisplay = (amount: number, currency = 'USD') => {
    return formatCurrency(amount, currency, 2);
  };

  const sectionSummaries = useSectionSummaries(formData);
  const hasContent = useHasContent(formData);

  // Compute sectionData for nav completeness indicators
  const sectionData: Record<string, unknown> = {
    details: {
      valuation_type: formData.valuation_type,
      valuation_amount: formData.valuation_amount,
      valuation_date: formData.valuation_date,
    },
    valuator: {
      valuator_id: formData.valuator_id,
      valuator_credentials: formData.valuator_credentials,
    },
    validity: {
      valid_from: formData.valid_from,
      valid_until: formData.valid_until,
    },
    linkedObject: {
      object_id: formData.object_id,
    },
    documentation: {
      documentation_reference: formData.documentation_reference,
    },
    authorization: {
      authorizer_id: formData.authorizer_id,
      authorization_date: formData.authorization_date,
      authorization_note: formData.authorization_note,
    },
    notes: {
      valuation_note: formData.valuation_note,
    },
    history: {},
  };

  // Loading/error states handled by WorkspacePageShell
  const valuationRecord = valuation;
  const displayNumber = isCreateMode ? '' : (valuationRecord?.valuation_id.slice(0, 8) || '');
  const displayTitle = isCreateMode
    ? 'New Valuation'
    : getLabel('valuation_type', valuationRecord?.valuation_type || 'insurance');

  const pageContent = (
    <div className={cn(!useNewLayout && 'p-6 max-w-4xl mx-auto')}>
      {/* Header - only in classic layout */}
      {!useNewLayout && (
        <WorkspaceHeader
          backUrl={`/organizations/${orgId}/collections/valuations`}
          backText="Back to Valuations"
          title={displayTitle}
          objectNumber={displayNumber}
          isEditing={isEditing}
          saveStatus={saveStatus}
          lastSaved={lastSaved}
          hasUnsavedChanges={hasUnsavedChanges}
          showCreateButton={isCreateMode}
          createButtonText="Create Valuation"
          onSave={isCreateMode ? handleCreate : undefined}
          onToggleMode={isCreateMode ? undefined : handleToggleMode}
        />
      )}

      {/* Edit mode indicator */}

      {/* Current valuation badge & delete - only in view/edit mode */}
      {!isCreateMode && valuationRecord && (
        <div className="flex items-center gap-4 mb-6">
          {valuationRecord.is_current && (
            <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-semantic-success/10 text-semantic-success rounded-full text-sm font-medium">
              <CheckCircle size={16} />
              Current Valuation
            </span>
          )}
          <span className="text-lg font-medium text-forest">
            {formatCurrencyDisplay(valuationRecord.valuation_amount || 0, valuationRecord.valuation_currency)}
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
      <PendingApprovalBanner
        visible={false}
        entityType="valuation"
        entityId={valuationId || ''}
        orgId={orgId || ''}
        onReviewed={() => window.location.reload()}
      />

      {/* Procedure Compliance Card */}
      {!isCreateMode && valuationRecord && (
                  <ProcedureRequirementsCard
            title="Valuation Requirements"
            requirementGroups={requirementGroups}
            record={formData as unknown as Record<string, unknown>}
            currentStatus={(valuationRecord.is_current ? 'current' : 'superseded')}
            statusOrder={['current', 'superseded']}
            onSectionNavigate={handleEnterEditMode}
          />
      )}

      {/* Sections */}
      <div className="flex flex-col gap-4">
        {/* === OVERVIEW GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Overview" icon={DollarSign} />}

        {/* Valuation Details */}
        <WorkspaceSection
          id="details"
          title="Valuation Details"
          icon={<DollarSign size={18} />}
          isExpanded={expandedSections.details}
          onToggle={() => toggleSection('details')}
          isEditing={isEditing}
          order={getSectionOrder('details')}
          isEmpty={!hasContent.details}
          summary={sectionSummaries.details}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableSelect
              label="Valuation Type"
              value={formData.valuation_type}
              isEditing={isEditing}
              onChange={(v) => updateField('valuation_type', v)}
              options={getLookup('valuation_type')}
              required
            />
            <EditableField
              label="Valuation Date"
              value={formData.valuation_date}
              isEditing={isEditing}
              onChange={(v) => updateField('valuation_date', v)}
              type="date"
              required
            />
            <EditableField
              label="Amount"
              value={formData.valuation_amount}
              isEditing={isEditing}
              onChange={(v) => updateField('valuation_amount', v)}
              type="number"
              placeholder="0.00"
              required
            />
            <EditableSelect
              label="Currency"
              value={formData.valuation_currency}
              isEditing={isEditing}
              onChange={(v) => updateField('valuation_currency', v)}
              options={getLookup('currency')}
            />
            <EditableSelect
              label="Valuation Method"
              value={formData.valuation_method}
              isEditing={isEditing}
              onChange={(v) => updateField('valuation_method', v)}
              options={getLookup('valuation_method')}
              placeholder="Select method..."
            />
            <EditableCheckbox
              label="This is the current valuation"
              value={formData.is_current}
              isEditing={isEditing}
              onChange={(v) => updateField('is_current', v)}
            />
          </div>
        </WorkspaceSection>

        {/* Valuator Information */}
        <WorkspaceSection
          id="valuator"
          title="Valuator Information"
          icon={<User size={18} />}
          isExpanded={expandedSections.valuator}
          onToggle={() => toggleSection('valuator')}
          isEditing={isEditing}
          order={getSectionOrder('valuator')}
          isEmpty={!hasContent.valuator}
          summary={sectionSummaries.valuator}
        >
          <div className="space-y-4">
            {/* Valuator Contact Selector */}
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">
                Valuator
              </label>
              {isEditing ? (
                <div className="flex items-center gap-2">
                  {formData.valuator_id && valuatorContact ? (
                    <div className="flex-1 flex items-center gap-2 px-3 py-2 border border-lichen rounded-lg bg-parchment">
                      <User size={16} className="text-archive flex-shrink-0" />
                      <span className="text-sm text-ink">{valuatorContact.name}</span>
                      {valuatorContact.organization_name && (
                        <span className="text-xs text-archive">({valuatorContact.organization_name})</span>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          updateField('valuator_id', '');
                        }}
                        className="ml-auto p-1 text-archive hover:text-semantic-error"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowValuatorSelector(true)}
                      className="flex-1 flex items-center gap-2 px-3 py-2 border border-dashed border-lichen rounded-lg text-sm text-archive hover:border-bark hover:text-bark transition-colors"
                    >
                      <Search size={16} />
                      Search or create valuator...
                    </button>
                  )}
                  {formData.valuator_id && (
                    <button
                      type="button"
                      onClick={() => setShowValuatorSelector(true)}
                      className="px-3 py-2 text-sm text-bark hover:text-copper-dark"
                    >
                      Change
                    </button>
                  )}
                </div>
              ) : (
                <div className="text-sm text-ink">
                  {valuatorContact ? (
                    <span>
                      {valuatorContact.name}
                      {valuatorContact.organization_name && (
                        <span className="text-archive ml-1">({valuatorContact.organization_name})</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-archive">Not specified</span>
                  )}
                </div>
              )}
            </div>

            <EditableField
              label="Credentials"
              value={formData.valuator_credentials}
              isEditing={isEditing}
              onChange={(v) => updateField('valuator_credentials', v)}
              placeholder="Professional qualifications (e.g., ASA, AAA)"
            />
          </div>
        </WorkspaceSection>

        {/* === TIMING & SCOPE GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Timing & Scope" icon={Calendar} />}

        {/* Validity Period */}
        <WorkspaceSection
          id="validity"
          title="Validity Period"
          icon={<Calendar size={18} />}
          isExpanded={expandedSections.validity}
          onToggle={() => toggleSection('validity')}
          isEditing={isEditing}
          order={getSectionOrder('validity')}
          isEmpty={!hasContent.validity}
          summary={sectionSummaries.validity}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableField
              label="Valid From"
              value={formData.valid_from}
              isEditing={isEditing}
              onChange={(v) => updateField('valid_from', v)}
              type="date"
            />
            <EditableField
              label="Valid Until"
              value={formData.valid_until}
              isEditing={isEditing}
              onChange={(v) => updateField('valid_until', v)}
              type="date"
            />
          </div>
        </WorkspaceSection>

        {/* Linked Object */}
        <WorkspaceSection
          id="linkedObject"
          title="Linked Object"
          icon={<LinkIcon size={18} />}
          isExpanded={expandedSections.linkedObject}
          onToggle={() => toggleSection('linkedObject')}
          isEditing={isEditing}
          order={getSectionOrder('linkedObject')}
          isEmpty={!hasContent.linkedObject}
          summary={sectionSummaries.linkedObject}
        >
          <ObjectSelector
            organizationId={orgId!}
            objectId={formData.object_id || null}
            onChange={(id) => updateField('object_id', id || '')}
            isEditing={isEditing}
            label="Linked Object"
          />
          <p className="text-xs text-archive mt-2">
            Leave blank for collection-level valuations that don't apply to a specific object.
          </p>
        </WorkspaceSection>

        {/* === ADMIN GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Admin" icon={History} />}

        {/* Documentation */}
        <WorkspaceSection
          id="documentation"
          title="Documentation"
          icon={<FileText size={18} />}
          isExpanded={expandedSections.documentation}
          onToggle={() => toggleSection('documentation')}
          isEditing={isEditing}
          order={getSectionOrder('documentation')}
          isEmpty={!hasContent.documentation}
          summary={sectionSummaries.documentation}
        >
          <EditableField
            label="Documentation Reference"
            value={formData.documentation_reference}
            isEditing={isEditing}
            onChange={(v) => updateField('documentation_reference', v)}
            placeholder="Reference to valuation report or document"
          />
        </WorkspaceSection>

        {/* Authorization — this procedure minimum requirement.
            Records who formally authorized the valuation, the date the
            authorization was given, and any note explaining limits or
            conditions. Backend has authorizer_id / authorization_date /
            authorization_note on the valuations table; this section is the
            UI that closes the procedure gap. */}
        <WorkspaceSection
          id="authorization"
          title="Authorization"
          icon={<ShieldCheck size={18} />}
          isExpanded={expandedSections.authorization}
          onToggle={() => toggleSection('authorization')}
          isEditing={isEditing}
          order={getSectionOrder('authorization')}
          isEmpty={!hasContent.authorization}
          summary={sectionSummaries.authorization}
        >
          <div className="space-y-4">
            {/* Authorizer contact selector — mirrors the valuator picker */}
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">
                Authorizer
              </label>
              {isEditing ? (
                <div className="flex items-center gap-2">
                  {formData.authorizer_id && authorizerContact ? (
                    <div className="flex-1 flex items-center gap-2 px-3 py-2 border border-lichen rounded-lg bg-parchment">
                      <User size={16} className="text-archive flex-shrink-0" />
                      <span className="text-sm text-ink">{authorizerContact.name}</span>
                      {authorizerContact.organization_name && (
                        <span className="text-xs text-archive">({authorizerContact.organization_name})</span>
                      )}
                      <button
                        type="button"
                        onClick={() => updateField('authorizer_id', '')}
                        className="ml-auto p-1 text-archive hover:text-semantic-error"
                        aria-label="Clear authorizer"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowAuthorizerSelector(true)}
                      className="flex-1 flex items-center gap-2 px-3 py-2 border border-dashed border-lichen rounded-lg text-sm text-archive hover:border-bark hover:text-bark transition-colors"
                    >
                      <Search size={16} />
                      Search or select authorizer...
                    </button>
                  )}
                  {formData.authorizer_id && (
                    <button
                      type="button"
                      onClick={() => setShowAuthorizerSelector(true)}
                      className="px-3 py-2 text-sm text-bark hover:text-copper-dark"
                    >
                      Change
                    </button>
                  )}
                </div>
              ) : (
                <div className="text-sm text-ink">
                  {authorizerContact ? (
                    <span>
                      {authorizerContact.name}
                      {authorizerContact.organization_name && (
                        <span className="text-archive ml-1">({authorizerContact.organization_name})</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-archive">Not authorized</span>
                  )}
                </div>
              )}
            </div>

            <EditableField
              label="Authorization Date"
              value={formData.authorization_date}
              isEditing={isEditing}
              onChange={(v) => updateField('authorization_date', v)}
              type="date"
            />

            <EditableField
              label="Authorization Note"
              value={formData.authorization_note}
              isEditing={isEditing}
              onChange={(v) => updateField('authorization_note', v)}
              multiline
              rows={3}
              placeholder="Limits, conditions, or scope of the authorization"
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
            label="Valuation Notes"
            value={formData.valuation_note}
            isEditing={isEditing}
            onChange={(v) => updateField('valuation_note', v)}
            multiline
            rows={4}
            placeholder="Additional notes about this valuation..."
          />
        </WorkspaceSection>

        {/* Change History */}
        {hasPermission('org.view_audit_logs') && !isCreateMode && orgId && valuationId && (
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
              entityType="valuation"
              entityId={valuationId}
            />
          </WorkspaceSection>
        )}
      </div>

      {/* Footer metadata - only in view/edit mode, not create mode */}
      {!isCreateMode && valuationRecord && valuationRecord.created_at && (
        <div className="mt-8 pt-6 border-t border-lichen text-sm text-archive">
          <p>Created: {formatDateTime(valuationRecord.created_at)}</p>
          {valuationRecord.updated_at && (
            <p>Last updated: {formatDateTime(valuationRecord.updated_at)}</p>
          )}
        </div>
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={() => {
          deleteMutation.mutate();
          setShowDeleteConfirm(false);
        }}
        title="Delete Valuation"
        message={<>Are you sure you want to delete <strong>{displayNumber || 'this valuation record'}</strong>? This action cannot be undone.</>}
        confirmText="Delete"
        confirmStyle="danger"
      />

      {/* Valuator Contact Selector SlideOver */}
      <ContactSelectorSlideOver
        isOpen={showValuatorSelector}
        organizationId={orgId!}
        onClose={() => setShowValuatorSelector(false)}
        onSelect={(contactId) => {
          updateField('valuator_id', contactId);
          setShowValuatorSelector(false);
        }}
        title="Select Valuator"
        subtitle="Search for an existing contact or create a new one"
        constituentTypes={['person', 'organization']}
      />

      {/* Authorizer Contact Selector SlideOver */}
      <ContactSelectorSlideOver
        isOpen={showAuthorizerSelector}
        organizationId={orgId!}
        onClose={() => setShowAuthorizerSelector(false)}
        onSelect={(contactId) => {
          updateField('authorizer_id', contactId);
          setShowAuthorizerSelector(false);
        }}
        title="Select Authorizer"
        subtitle="Search for the person who formally authorized this valuation"
        constituentTypes={['person']}
      />

      {/* CreateTaskSlideOver */}
      {orgId && valuationId && valuationRecord && (
        <CreateTaskSlideOver
          isOpen={showCreateTask}
          onClose={() => setShowCreateTask(false)}
          orgId={orgId}
          initialEntityType={"valuation" as React.ComponentProps<typeof CreateTaskSlideOver>['initialEntityType']}
          initialEntityId={valuationId}
          initialEntityLabel={displayTitle}
        />
      )}

      {/* Navigation guard for unsaved changes */}
      {blocker && <NavigationBlockerDialog blocker={blocker} />}
    </div>
  );

  // New layout with RecordDetailPageWrapper
  if (useNewLayout && valuationRecord) {
    return (
      <WorkspaceErrorBoundary
        backUrl={`/organizations/${orgId}/collections/valuations`}
        backLabel="Back to Valuations"
      >
        <RecordDetailPageWrapper
          object={null}
          media={[]}
          sectionIds={ALL_SECTION_IDS}
          sectionGroups={VALUATION_SECTION_GROUPS}
          sectionData={sectionData}
          permissions={{
            canCreateTask: true,
            canViewHistory: true,
            canDelete: canEdit,
          }}
          callbacks={{
            onDelete: () => setShowDeleteConfirm(true),
            onCreateTask: () => setShowCreateTask(true),
          }}
          isEditing={isEditing}
          onSectionNavigate={handleEnterEditMode}
          pageType="valuation"
          enabled={true}
          showHeader={true}
          title="Valuation"
          objectNumber={displayNumber || undefined}
          subtitle={displayTitle}
          backUrl={`/organizations/${orgId}/collections/valuations`}
          backLabel="Back to Valuations"
        >
          {pageContent}
        </RecordDetailPageWrapper>
      </WorkspaceErrorBoundary>
    );
  }

  return (
    <WorkspaceErrorBoundary
      backUrl={orgId ? `/organizations/${orgId}/collections/valuations` : undefined}
      backLabel="Back to Valuations"
    >
      {pageContent}
    </WorkspaceErrorBoundary>
  );
}
