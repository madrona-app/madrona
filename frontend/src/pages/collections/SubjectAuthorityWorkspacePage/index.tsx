import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useWorkspacePage } from '../../../hooks/useWorkspacePage';
import { formatDateTime } from '@/lib/formatters';
import {
  Tag,
  Globe,
  StickyNote,
  BookOpen,
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
import { getSubjectAuthority } from '../../../lib/api';
import ConfirmDialog from '../../../components/ConfirmDialog';

import { useFormState, useSectionState, useSectionSummaries, useHasContent } from './hooks';
import {
  SUBJECT_AUTHORITY_SECTION_GROUPS,
  ALL_SECTION_IDS,
} from './types';
import { MadronaLoader } from '../../../components/ui/MadronaLoader';

const SUBJECT_TYPE_OPTIONS = [
  { value: 'iconographic', label: 'Iconographic' },
  { value: 'narrative', label: 'Narrative' },
  { value: 'thematic', label: 'Thematic' },
  { value: 'genre', label: 'Genre' },
  { value: 'decorative', label: 'Decorative' },
  { value: 'symbolic', label: 'Symbolic' },
];

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'deprecated', label: 'Deprecated' },
];

/**
 * Outer wrapper that provides section order context.
 */
export default function SubjectAuthorityWorkspacePage() {
  return (
    <SectionOrderProvider>
      <SubjectAuthorityWorkspacePageContent />
    </SectionOrderProvider>
  );
}

function SubjectAuthorityWorkspacePageContent() {
  const { orgId, authorityId } = useParams<{ orgId: string; authorityId?: string }>();

  const [variantTermInput, setVariantTermInput] = useState('');

  // Fetch authority data (disabled in create mode)
  const isCreateMode = !authorityId;
  const { data: existingAuthority, isLoading, error } = useQuery({
    queryKey: ['subject-authority', orgId, authorityId],
    queryFn: () => getSubjectAuthority(orgId!, authorityId!),
    enabled: !isCreateMode && !!orgId && !!authorityId,
  });

  const wp = useWorkspacePage({
    entityType: 'subject_authority',
    entityId: authorityId,
    entityLabel: existingAuthority ? (existingAuthority.preferred_term || `Subject ${authorityId!.slice(0, 8)}`) : undefined,
    orgId,
    editPermission: 'subject_authorities.edit',
  });
  const { isEditing, setIsEditing, useNewLayout, canEdit, hasPermission, dialogs } = wp;

  const form = useFormState({ orgId, subjectId: authorityId, isCreateMode, subject: existingAuthority });

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
    subjectId: authorityId,
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
    identity: {
      preferred_term: formData.preferred_term,
      subject_type: formData.subject_type,
    },
    description: {
      description: formData.description,
    },
    external: {
      aat_id: formData.aat_id,
      iconclass_id: formData.iconclass_id,
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

  const handleAddVariantTerm = () => {
    if (variantTermInput.trim() && !formData.variant_terms?.includes(variantTermInput.trim())) {
      updateField('variant_terms', [...(formData.variant_terms || []), variantTermInput.trim()]);
      setVariantTermInput('');
    }
  };

  const handleRemoveVariantTerm = (term: string) => {
    updateField('variant_terms', formData.variant_terms?.filter(t => t !== term) || []);
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
        <Tag size={48} className="mx-auto text-archive mb-4" />
        <h3 className="text-lg font-serif font-medium text-forest mb-2">
          Subject Authority not found
        </h3>
        <p className="text-accessible-gray mb-4">
          {error ? (error as Error).message : 'The subject authority record could not be loaded.'}
        </p>
      </div>
    );
  }

  const displayTitle = isCreateMode
    ? 'New Subject Authority'
    : (existingAuthority?.preferred_term || 'Subject Authority');
  const displayNumber = isCreateMode ? '' : (authorityId?.slice(0, 8) || '');

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
          createButtonText="Create Subject"
          onSave={isCreateMode ? handleCreate : undefined}
          onToggleMode={isCreateMode ? undefined : handleToggleMode}
        />
      )}

      {/* Edit mode indicator */}

      {/* Status bar - only in view/edit mode, not create mode */}
      {!isCreateMode && existingAuthority && (
        <div className="flex items-center gap-4 mb-6">
          <span className={cn(
            'inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium',
            existingAuthority.status === 'active'
              ? 'bg-semantic-success/10 text-semantic-success'
              : 'bg-stone text-ink'
          )}>
            {existingAuthority.status === 'active' ? 'Active' : 'Deprecated'}
          </span>
          <span className="px-2 py-0.5 text-xs bg-bark/10 text-bark rounded-full capitalize">
            {existingAuthority.subject_type}
          </span>
          {existingAuthority.linked_objects_count != null && existingAuthority.linked_objects_count > 0 && (
            <span className="text-sm text-archive">
              Linked to {existingAuthority.linked_objects_count} object{existingAuthority.linked_objects_count !== 1 ? 's' : ''}
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
        {useNewLayout && <SectionGroupDivider label="Overview" icon={Tag} />}

        {/* Identity */}
        <WorkspaceSection
          id="identity"
          title="Identity"
          icon={<Tag size={18} />}
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
              placeholder="e.g., Madonna and Child"
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
              label="Subject Type"
              value={formData.subject_type || 'iconographic'}
              isEditing={isEditing}
              onChange={(v) => updateField('subject_type', v)}
              options={SUBJECT_TYPE_OPTIONS}
            />
          </div>
        </WorkspaceSection>

        {/* Description */}
        <WorkspaceSection
          id="description"
          title="Description"
          icon={<BookOpen size={18} />}
          isExpanded={expandedSections.description}
          onToggle={() => toggleSection('description')}
          isEditing={isEditing}
          order={getSectionOrder('description')}
          isEmpty={!hasContent.description}
          summary={sectionSummaries.description}
        >
          <EditableField
            label="Subject Description"
            value={formData.description || ''}
            isEditing={isEditing}
            onChange={(v) => updateField('description', v)}
            multiline
            rows={4}
            placeholder="Describe this subject term, its iconographic significance, and typical representations..."
          />
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <EditableField
              label="AAT ID"
              value={formData.aat_id || ''}
              isEditing={isEditing}
              onChange={(v) => updateField('aat_id', v)}
              placeholder="e.g., 300025943"
            />
            <EditableField
              label="Iconclass ID"
              value={formData.iconclass_id || ''}
              isEditing={isEditing}
              onChange={(v) => updateField('iconclass_id', v)}
              placeholder="e.g., 11F411"
            />
            <EditableField
              label="Wikidata ID"
              value={formData.wikidata_id || ''}
              isEditing={isEditing}
              onChange={(v) => updateField('wikidata_id', v)}
              placeholder="e.g., Q208267"
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
              entityType="subject_authority"
              entityId={authorityId}
            />
          </WorkspaceSection>
        )}
      </div>

      {/* Footer metadata */}
      {!isCreateMode && existingAuthority && existingAuthority.created_at && (
        <div className="mt-8 pt-6 border-t border-lichen text-sm text-archive">
          <p>Created: {formatDateTime(existingAuthority.created_at)}</p>
          {existingAuthority.updated_at && (
            <p>Last updated: {formatDateTime(existingAuthority.updated_at)}</p>
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
        title="Delete Subject Authority"
        message={<>Are you sure you want to delete <strong>{formData.preferred_term || 'this subject authority'}</strong>? This action cannot be undone.</>}
        confirmText="Delete"
        confirmStyle="danger"
      />

      {/* CreateTaskSlideOver */}
      {orgId && authorityId && existingAuthority && (
        <CreateTaskSlideOver
          isOpen={dialogs.showCreateTask}
          onClose={() => dialogs.setShowCreateTask(false)}
          orgId={orgId}
          initialEntityType={"subject_authority" as React.ComponentProps<typeof CreateTaskSlideOver>['initialEntityType']}
          initialEntityId={authorityId}
          initialEntityLabel={existingAuthority.preferred_term || `Subject ${authorityId.slice(0, 8)}`}
        />
      )}
    </div>
  );

  // New layout with RecordDetailPageWrapper
  if (useNewLayout && existingAuthority) {
    return (
      <WorkspaceErrorBoundary
        backUrl={`/organizations/${orgId}/collections/vocabularies`}
        backLabel="Back to Vocabularies"
      >
        <RecordDetailPageWrapper
          object={null}
          media={[]}
          sectionIds={ALL_SECTION_IDS}
          sectionGroups={SUBJECT_AUTHORITY_SECTION_GROUPS}
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
          pageType="subject-authority"
          enabled={true}
          showHeader={true}
          title="Subject Authority"
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
