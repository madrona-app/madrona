import { useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useWorkspacePage } from '../../../hooks/useWorkspacePage';
import { formatDateTime } from '@/lib/formatters';
import {
  Palette,
  Calendar,
  Globe,
  StickyNote,
  Plus,
  X,
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
import { getStylePeriodAuthority } from '../../../lib/api';
import ConfirmDialog from '../../../components/ConfirmDialog';
import type { StylePeriodAuthority } from '../../../lib/schemas';

import { useFormState, useSectionState, useSectionSummaries, useHasContent } from './hooks';
import {
  STYLE_PERIOD_SECTION_GROUPS,
  ALL_SECTION_IDS,
} from './types';
import { MadronaLoader } from '../../../components/ui/MadronaLoader';

const AUTHORITY_TYPE_OPTIONS = [
  { value: 'style', label: 'Style' },
  { value: 'period', label: 'Period' },
  { value: 'group', label: 'Group' },
  { value: 'movement', label: 'Movement' },
  { value: 'school', label: 'School' },
];

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'deprecated', label: 'Deprecated' },
];

/**
 * Outer wrapper that provides section order context.
 */
export default function StylePeriodAuthorityWorkspacePage() {
  return (
    <SectionOrderProvider>
      <StylePeriodAuthorityWorkspacePageContent />
    </SectionOrderProvider>
  );
}

function StylePeriodAuthorityWorkspacePageContent() {
  const { orgId, authorityId } = useParams<{ orgId: string; authorityId?: string }>();

  const [variantTermInput, setVariantTermInput] = useState('');

  // Fetch authority data (disabled in create mode)
  const isCreateMode = !authorityId;
  const { data: existingAuthority, isLoading, error } = useQuery({
    queryKey: ['style-period-authority', orgId, authorityId],
    queryFn: () => getStylePeriodAuthority(orgId!, authorityId!),
    enabled: !isCreateMode && !!orgId && !!authorityId,
  });

  const authority = existingAuthority as StylePeriodAuthority | undefined;

  const wp = useWorkspacePage({
    entityType: 'style_period_authority',
    entityId: authorityId,
    entityLabel: authority ? (authority.preferred_term || `Style/Period ${authorityId!.slice(0, 8)}`) : undefined,
    orgId,
    editPermission: 'style_period_authorities.edit',
  });
  const { isEditing, setIsEditing, useNewLayout, canEdit, hasPermission, dialogs } = wp;

  const form = useFormState({
    orgId,
    styleId: authorityId,
    isCreateMode,
    style: authority,
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
    styleId: authorityId,
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

  // Variant term helpers
  const handleAddVariantTerm = useCallback(() => {
    if (variantTermInput.trim() && !formData.variant_terms?.includes(variantTermInput.trim())) {
      updateField('variant_terms', [...(formData.variant_terms || []), variantTermInput.trim()]);
      setVariantTermInput('');
    }
  }, [variantTermInput, formData.variant_terms, updateField]);

  const handleRemoveVariantTerm = useCallback((term: string) => {
    updateField('variant_terms', formData.variant_terms?.filter(t => t !== term) || []);
  }, [formData.variant_terms, updateField]);

  // Compute sectionData for nav completeness indicators
  const sectionData: Record<string, unknown> = {
    identity: {
      preferred_term: formData.preferred_term,
      authority_type: formData.authority_type,
      culture: formData.culture,
    },
    dates: {
      date_display: formData.date_display,
      date_earliest: formData.date_earliest,
      date_latest: formData.date_latest,
    },
    external: {
      aat_id: formData.aat_id,
      wikidata_id: formData.wikidata_id,
    },
    status: {
      status: formData.status,
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
  if (!isCreateMode && (error || !existingAuthority)) {
    return (
      <div className="p-6 max-w-4xl mx-auto text-center py-12">
        <Palette size={48} className="mx-auto text-archive mb-4" />
        <h3 className="text-lg font-serif font-medium text-forest mb-2">
          Style/Period Authority not found
        </h3>
        <p className="text-accessible-gray mb-4">
          {error ? (error as Error).message : 'The style/period authority record could not be loaded.'}
        </p>
      </div>
    );
  }

  const displayTitle = isCreateMode
    ? 'New Style/Period Authority'
    : (authority?.preferred_term || 'Style/Period Authority');
  const displayNumber = isCreateMode ? '' : (authority?.authority_id?.slice(0, 8) || '');

  const pageContent = (
    <div className={cn(!useNewLayout && 'p-6 max-w-4xl mx-auto')}>
      {/* Header - only in classic layout */}
      {!useNewLayout && (
        <WorkspaceHeader
          backUrl={`/organizations/${orgId}/collections/vocabularies`}
          backText="Back to Vocabularies"
          title={displayTitle}
          objectNumber={displayNumber}
          isEditing={isEditing}
          saveStatus={saveStatus}
          lastSaved={lastSaved}
          hasUnsavedChanges={hasUnsavedChanges}
          showCreateButton={isCreateMode}
          createButtonText="Create Style/Period"
          onSave={isCreateMode ? handleCreate : undefined}
          onToggleMode={isCreateMode ? undefined : handleToggleMode}
        />
      )}

      {/* Edit mode indicator */}

      {/* Status badge & delete button */}
      {!isCreateMode && authority && (
        <div className="flex items-center gap-4 mb-6">
          <span className={cn(
            'inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium',
            authority.status === 'active'
              ? 'bg-semantic-success/10 text-semantic-success'
              : 'bg-stone text-ink'
          )}>
            {authority.status === 'active' ? 'Active' : 'Deprecated'}
          </span>
          <span className="px-2 py-0.5 text-xs bg-bark/10 text-bark rounded-full capitalize">
            {authority.authority_type}
          </span>
          {authority.linked_objects_count != null && authority.linked_objects_count > 0 && (
            <span className="text-sm text-archive">
              Linked to {authority.linked_objects_count} object{authority.linked_objects_count !== 1 ? 's' : ''}
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

      {/* Sections */}
      <div className="flex flex-col gap-4">
        {/* === OVERVIEW GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Overview" icon={Palette} />}

        {/* Identity */}
        <WorkspaceSection
          id="identity"
          title="Identity"
          icon={<Palette size={18} />}
          isExpanded={expandedSections.identity}
          onToggle={() => toggleSection('identity')}
          isEditing={isEditing}
          order={getSectionOrder('identity')}
          isEmpty={!hasContent.identity}
          summary={sectionSummaries.identity}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableField
              label="Preferred Term"
              value={formData.preferred_term || ''}
              isEditing={isEditing}
              onChange={(v) => updateField('preferred_term', v)}
              required
              placeholder="e.g., Baroque"
              className="md:col-span-2"
            />

            {/* Variant Terms */}
            {isEditing ? (
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-ink mb-1.5">
                  Variant Terms
                </label>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={variantTermInput}
                    onChange={(e) => setVariantTermInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddVariantTerm();
                      }
                    }}
                    className="flex-1 px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                    placeholder="Add variant term..."
                  />
                  <button
                    type="button"
                    onClick={handleAddVariantTerm}
                    className="px-3 py-2 border border-lichen rounded-lg text-ink hover:bg-stone transition-colors"
                  >
                    <Plus size={16} />
                  </button>
                </div>
                {formData.variant_terms && formData.variant_terms.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {formData.variant_terms.map((term, i) => (
                      <span key={i} className="inline-flex items-center gap-1 px-2 py-1 bg-stone text-ink text-sm rounded-full">
                        {term}
                        <button
                          type="button"
                          onClick={() => handleRemoveVariantTerm(term)}
                          className="text-archive hover:text-ink"
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ) : formData.variant_terms && formData.variant_terms.length > 0 ? (
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-archive mb-1.5">
                  Variant Terms
                </label>
                <div className="flex flex-wrap gap-2">
                  {formData.variant_terms.map((term, i) => (
                    <span key={i} className="px-2 py-0.5 text-xs bg-stone rounded-full text-ink">{term}</span>
                  ))}
                </div>
              </div>
            ) : null}

            <EditableSelect
              label="Authority Type"
              value={formData.authority_type || 'style'}
              isEditing={isEditing}
              onChange={(v) => updateField('authority_type', v)}
              options={AUTHORITY_TYPE_OPTIONS}
            />

            <EditableField
              label="Culture"
              value={formData.culture || ''}
              isEditing={isEditing}
              onChange={(v) => updateField('culture', v)}
              placeholder="e.g., Italian"
            />

            <EditableField
              label="Geographic Scope"
              value={formData.geographic_scope || ''}
              isEditing={isEditing}
              onChange={(v) => updateField('geographic_scope', v)}
              placeholder="e.g., Western Europe"
              className="md:col-span-2"
            />

            <EditableField
              label="Description"
              value={formData.description || ''}
              isEditing={isEditing}
              onChange={(v) => updateField('description', v)}
              multiline
              rows={3}
              placeholder="Brief description of this style/period..."
              className="md:col-span-2"
            />
          </div>
        </WorkspaceSection>

        {/* Dates */}
        <WorkspaceSection
          id="dates"
          title="Date Range"
          icon={<Calendar size={18} />}
          isExpanded={expandedSections.dates}
          onToggle={() => toggleSection('dates')}
          isEditing={isEditing}
          order={getSectionOrder('dates')}
          isEmpty={!hasContent.dates}
          summary={sectionSummaries.dates}
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <EditableField
              label="Date Display"
              value={formData.date_display || ''}
              isEditing={isEditing}
              onChange={(v) => updateField('date_display', v)}
              placeholder="e.g., 1600-1750"
            />
            <EditableField
              label="Date Earliest"
              value={formData.date_earliest || ''}
              isEditing={isEditing}
              onChange={(v) => updateField('date_earliest', v)}
              placeholder="e.g., 1600"
            />
            <EditableField
              label="Date Latest"
              value={formData.date_latest || ''}
              isEditing={isEditing}
              onChange={(v) => updateField('date_latest', v)}
              placeholder="e.g., 1750"
            />
          </div>
        </WorkspaceSection>

        {/* === DETAILS GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Details" icon={Globe} />}

        {/* External Identifiers */}
        <WorkspaceSection
          id="external"
          title="External Identifiers"
          icon={<Globe size={18} />}
          isExpanded={expandedSections.external}
          onToggle={() => toggleSection('external')}
          isEditing={isEditing}
          order={getSectionOrder('external')}
          isEmpty={!hasContent.external}
          summary={sectionSummaries.external}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableField
              label="AAT ID"
              value={formData.aat_id || ''}
              isEditing={isEditing}
              onChange={(v) => updateField('aat_id', v)}
              placeholder="e.g., 300021147"
            />
            <EditableField
              label="Wikidata ID"
              value={formData.wikidata_id || ''}
              isEditing={isEditing}
              onChange={(v) => updateField('wikidata_id', v)}
              placeholder="e.g., Q37853"
            />
          </div>
        </WorkspaceSection>

        {/* Status */}
        <WorkspaceSection
          id="status"
          title="Status"
          icon={<Globe size={18} />}
          isExpanded={expandedSections.status}
          onToggle={() => toggleSection('status')}
          isEditing={isEditing}
          order={getSectionOrder('status')}
          isEmpty={!hasContent.status}
          summary={sectionSummaries.status}
        >
          <EditableSelect
            label="Record Status"
            value={formData.status || 'active'}
            isEditing={isEditing}
            onChange={(v) => updateField('status', v)}
            options={STATUS_OPTIONS}
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
        {hasPermission('org.view_audit_logs') && !isCreateMode && orgId && authorityId && (
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
              entityType="style_period_authority"
              entityId={authorityId}
            />
          </WorkspaceSection>
        )}
      </div>

      {/* Footer metadata */}
      {!isCreateMode && authority && authority.created_at && (
        <div className="mt-8 pt-6 border-t border-lichen text-sm text-archive">
          <p>Created: {formatDateTime(authority.created_at)}</p>
          {authority.updated_at && (
            <p>Last updated: {formatDateTime(authority.updated_at)}</p>
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
        title="Delete Style/Period Authority"
        message={<>Are you sure you want to delete <strong>{formData.preferred_term || 'this style/period authority'}</strong>? This action cannot be undone.</>}
        confirmText="Delete"
        confirmStyle="danger"
      />

      {/* CreateTaskSlideOver */}
      {orgId && authorityId && authority && (
        <CreateTaskSlideOver
          isOpen={dialogs.showCreateTask}
          onClose={() => dialogs.setShowCreateTask(false)}
          orgId={orgId}
          initialEntityType={"style_period_authority" as React.ComponentProps<typeof CreateTaskSlideOver>['initialEntityType']}
          initialEntityId={authorityId}
          initialEntityLabel={authority.preferred_term || `Style/Period ${authorityId.slice(0, 8)}`}
        />
      )}
    </div>
  );

  // New layout with RecordDetailPageWrapper
  if (useNewLayout && authority) {
    return (
      <WorkspaceErrorBoundary
        backUrl={`/organizations/${orgId}/collections/vocabularies`}
        backLabel="Back to Vocabularies"
      >
        <RecordDetailPageWrapper
          object={null}
          media={[]}
          sectionIds={ALL_SECTION_IDS}
          sectionGroups={STYLE_PERIOD_SECTION_GROUPS}
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
          pageType="style-period-authority"
          enabled={true}
          showHeader={true}
          title="Style/Period"
          objectNumber={displayNumber}
          subtitle={displayTitle}
          backUrl={`/organizations/${orgId}/collections/vocabularies`}
          backLabel="Back to Vocabularies"
        >
          {pageContent}
        </RecordDetailPageWrapper>
      </WorkspaceErrorBoundary>
    );
  }

  return (
    <WorkspaceErrorBoundary
      backUrl={orgId ? `/organizations/${orgId}/collections/vocabularies` : undefined}
      backLabel="Back to Vocabularies"
    >
      {pageContent}
    </WorkspaceErrorBoundary>
  );
}
