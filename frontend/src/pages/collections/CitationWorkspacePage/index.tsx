import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useWorkspacePage } from '../../../hooks/useWorkspacePage';
import { formatDateTime } from '@/lib/formatters';
import {
  BookOpen,
  FileText,
  Globe,
  Tag,
  StickyNote,
  History,
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
} from '../../../components/workspace';
import { RecordDetailPageWrapper, SectionOrderProvider } from '../../../components/record-detail';
import { CreateTaskSlideOver } from '../../../components/work/CreateTaskSlideOver';
import { cn } from '../../../lib/utils';
import { getCitation } from '../../../lib/api';
import ConfirmDialog from '../../../components/ConfirmDialog';

import { useFormState, useSectionState, useSectionSummaries, useHasContent } from './hooks';
import {
  CITATION_SECTION_GROUPS,
  ALL_SECTION_IDS,
} from './types';
import { MadronaLoader } from '../../../components/ui/MadronaLoader';

/**
 * Outer wrapper that provides section order context.
 */
export default function CitationWorkspacePage() {
  return (
    <SectionOrderProvider>
      <CitationWorkspacePageContent />
    </SectionOrderProvider>
  );
}

function CitationWorkspacePageContent() {
  const { orgId, citationId } = useParams<{ orgId: string; citationId?: string }>();
  const isCreateMode = !citationId;

  // Fetch citation data (disabled in create mode)
  const { data: citation, isLoading, error } = useQuery({
    queryKey: ['citation', orgId, citationId],
    queryFn: () => getCitation(orgId!, citationId!),
    enabled: !!citationId && !!orgId,
  });

  const citationRecord = citation;

  const wp = useWorkspacePage({
    entityType: 'citation',
    entityId: citationId,
    entityLabel: (citationRecord?.brief_citation as string) || (citationRecord?.title as string) || (citationId ? `Citation ${citationId.slice(0, 8)}` : undefined),
    orgId,
    editPermission: 'citations.edit',
  });
  const { isEditing, setIsEditing, useNewLayout, canEdit, hasPermission, dialogs } = wp;

  const form = useFormState({ orgId, citationId, isCreateMode, citation: citationRecord });

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
    getLookup,
    getLabel,
  } = form;

  const sectionState = useSectionState({
    orgId,
    citationId,
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
    basic: {
      citation_type: formData.citation_type,
      brief_citation: formData.brief_citation,
    },
    structured: {
      author: formData.author,
      title: formData.title,
      publication_year: formData.publication_year,
    },
    digital: {
      url: formData.url,
      doi: formData.doi,
      isbn: formData.isbn,
    },
    flags: {
      works_cited: formData.works_cited,
      works_illustrated: formData.works_illustrated,
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
  if (!isCreateMode && (error || !citation)) {
    return (
      <div className="p-6 max-w-4xl mx-auto text-center py-12">
        <BookOpen size={48} className="mx-auto text-archive mb-4" />
        <h3 className="text-lg font-serif font-medium text-forest mb-2">
          Citation not found
        </h3>
        <p className="text-accessible-gray mb-4">
          {error ? (error as Error).message : 'The citation record could not be loaded.'}
        </p>
      </div>
    );
  }

  const displayNumber = isCreateMode ? '' : ((citationRecord?.citation_id as string)?.slice(0, 8) || '');
  const displayTitle = isCreateMode
    ? 'New Citation'
    : ((citationRecord?.brief_citation as string) || (citationRecord?.title as string) || 'Citation');

  const pageContent = (
    <div className={cn(!useNewLayout && 'p-6 max-w-4xl mx-auto')}>
      {/* Header - only in classic layout */}
      {!useNewLayout && (
        <WorkspaceHeader
          backUrl={`/organizations/${orgId}/collections/citations`}
          backText="Back to Citations"
          title={displayTitle}
          objectNumber={displayNumber}
          isEditing={isEditing}
          saveStatus={saveStatus}
          lastSaved={lastSaved}
          hasUnsavedChanges={hasUnsavedChanges}
          showCreateButton={isCreateMode}
          createButtonText="Create Citation"
          onSave={isCreateMode ? handleCreate : undefined}
          onToggleMode={isCreateMode ? undefined : handleToggleMode}
        />
      )}

      {/* Edit mode indicator */}

      {/* Status bar - only in view/edit mode, not create mode */}
      {!isCreateMode && citationRecord && (
        <div className="flex items-center gap-4 mb-6">
          <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-stone rounded-full text-sm text-archive">
            <BookOpen size={16} />
            {getLabel('citation_type', citationRecord.citation_type as string)}
          </span>
          {citationRecord.works_cited && (
            <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-copper/10 text-copper rounded-full text-sm font-medium">
              Works Cited
            </span>
          )}
          {citationRecord.works_illustrated && (
            <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-forest/10 text-forest rounded-full text-sm font-medium">
              Works Illustrated
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
        {useNewLayout && <SectionGroupDivider label="Overview" icon={BookOpen} />}

        {/* Basic Information */}
        <WorkspaceSection
          id="basic"
          title="Basic Information"
          icon={<BookOpen size={18} />}
          isExpanded={expandedSections.basic}
          onToggle={() => toggleSection('basic')}
          isEditing={isEditing}
          order={getSectionOrder('basic')}
          isEmpty={!hasContent.basic}
          summary={sectionSummaries.basic}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableSelect
              label="Citation Type"
              value={formData.citation_type}
              isEditing={isEditing}
              onChange={(v) => updateField('citation_type', v)}
              options={getLookup('citation_type')}
            />
            <EditableField
              label="Brief Citation"
              value={formData.brief_citation}
              isEditing={isEditing}
              onChange={(v) => updateField('brief_citation', v)}
              placeholder="e.g., Smith 2020"
              required
            />
            <EditableField
              label="Full Citation"
              value={formData.full_citation}
              isEditing={isEditing}
              onChange={(v) => updateField('full_citation', v)}
              multiline
              rows={3}
              placeholder="Complete bibliographic citation..."
              className="md:col-span-2"
            />
          </div>
        </WorkspaceSection>

        {/* Structured Fields */}
        <WorkspaceSection
          id="structured"
          title="Structured Fields"
          icon={<FileText size={18} />}
          isExpanded={expandedSections.structured}
          onToggle={() => toggleSection('structured')}
          isEditing={isEditing}
          order={getSectionOrder('structured')}
          isEmpty={!hasContent.structured}
          summary={sectionSummaries.structured}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableField
              label="Author"
              value={formData.author}
              isEditing={isEditing}
              onChange={(v) => updateField('author', v)}
              placeholder="e.g., Smith, John"
            />
            <EditableField
              label="Publication Year"
              value={formData.publication_year}
              isEditing={isEditing}
              onChange={(v) => updateField('publication_year', v)}
              type="number"
              placeholder="e.g., 2020"
            />
            <EditableField
              label="Title"
              value={formData.title}
              isEditing={isEditing}
              onChange={(v) => updateField('title', v)}
              placeholder="Title of the work..."
              className="md:col-span-2"
            />
            <EditableField
              label="Publication"
              value={formData.publication}
              isEditing={isEditing}
              onChange={(v) => updateField('publication', v)}
              placeholder="Journal or series name..."
            />
            <EditableField
              label="Publisher"
              value={formData.publisher}
              isEditing={isEditing}
              onChange={(v) => updateField('publisher', v)}
              placeholder="Publisher name..."
            />
            <EditableField
              label="Publication Place"
              value={formData.publication_place}
              isEditing={isEditing}
              onChange={(v) => updateField('publication_place', v)}
              placeholder="e.g., New York"
            />
            <EditableField
              label="Volume"
              value={formData.volume}
              isEditing={isEditing}
              onChange={(v) => updateField('volume', v)}
              placeholder="e.g., 12"
            />
            <EditableField
              label="Issue"
              value={formData.issue}
              isEditing={isEditing}
              onChange={(v) => updateField('issue', v)}
              placeholder="e.g., 3"
            />
            <EditableField
              label="Pages"
              value={formData.pages}
              isEditing={isEditing}
              onChange={(v) => updateField('pages', v)}
              placeholder="e.g., 45-67"
            />
          </div>
        </WorkspaceSection>

        {/* === DETAILS GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Details" icon={Globe} />}

        {/* Digital Identifiers */}
        <WorkspaceSection
          id="digital"
          title="Digital Identifiers"
          icon={<Globe size={18} />}
          isExpanded={expandedSections.digital}
          onToggle={() => toggleSection('digital')}
          isEditing={isEditing}
          order={getSectionOrder('digital')}
          isEmpty={!hasContent.digital}
          summary={sectionSummaries.digital}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableField
              label="URL"
              value={formData.url}
              isEditing={isEditing}
              onChange={(v) => updateField('url', v)}
              placeholder="https://..."
              className="md:col-span-2"
            />
            <EditableField
              label="DOI"
              value={formData.doi}
              isEditing={isEditing}
              onChange={(v) => updateField('doi', v)}
              placeholder="e.g., 10.1000/xyz123"
            />
            <EditableField
              label="ISBN"
              value={formData.isbn}
              isEditing={isEditing}
              onChange={(v) => updateField('isbn', v)}
              placeholder="e.g., 978-3-16-148410-0"
            />
          </div>
        </WorkspaceSection>

        {/* Citation Flags */}
        <WorkspaceSection
          id="flags"
          title="Citation Flags"
          icon={<Tag size={18} />}
          isExpanded={expandedSections.flags}
          onToggle={() => toggleSection('flags')}
          isEditing={isEditing}
          order={getSectionOrder('flags')}
          isEmpty={!hasContent.flags}
          summary={sectionSummaries.flags}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableCheckbox
              label="Works Cited"
              value={formData.works_cited}
              isEditing={isEditing}
              onChange={(v) => updateField('works_cited', v)}
            />
            <EditableCheckbox
              label="Works Illustrated"
              value={formData.works_illustrated}
              isEditing={isEditing}
              onChange={(v) => updateField('works_illustrated', v)}
            />
          </div>
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
            value={formData.notes}
            isEditing={isEditing}
            onChange={(v) => updateField('notes', v)}
            multiline
            rows={3}
            placeholder="Internal notes..."
          />
        </WorkspaceSection>

        {/* Change History */}
        {hasPermission('org.view_audit_logs') && !isCreateMode && orgId && citationId && (
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
              entityType="citation"
              entityId={citationId}
            />
          </WorkspaceSection>
        )}
      </div>

      {/* Footer metadata - only in view/edit mode, not create mode */}
      {!isCreateMode && citationRecord && (citationRecord.created_at as string) && (
        <div className="mt-8 pt-6 border-t border-lichen text-sm text-archive">
          <p>Created: {formatDateTime(citationRecord.created_at as string)}</p>
          {citationRecord.updated_at && (
            <p>Last updated: {formatDateTime(citationRecord.updated_at as string)}</p>
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
        title="Delete Citation"
        message={<>Are you sure you want to delete <strong>{formData.title || 'this citation record'}</strong>? This action cannot be undone.</>}
        confirmText="Delete"
        confirmStyle="danger"
      />

      {/* CreateTaskSlideOver */}
      {orgId && citationId && citationRecord && (
        <CreateTaskSlideOver
          isOpen={dialogs.showCreateTask}
          onClose={() => dialogs.setShowCreateTask(false)}
          orgId={orgId}
          initialEntityType={"citation" as React.ComponentProps<typeof CreateTaskSlideOver>['initialEntityType']}
          initialEntityId={citationId}
          initialEntityLabel={(citationRecord.brief_citation as string) || `Citation ${citationId.slice(0, 8)}`}
        />
      )}
    </div>
  );

  // New layout with RecordDetailPageWrapper
  if (useNewLayout && citationRecord) {
    return (
      <WorkspaceErrorBoundary
        backUrl={`/organizations/${orgId}/collections/citations`}
        backLabel="Back to Citations"
      >
        <RecordDetailPageWrapper
          object={null}
          media={[]}
          sectionIds={ALL_SECTION_IDS}
          sectionGroups={CITATION_SECTION_GROUPS}
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
          pageType="citation"
          enabled={true}
          showHeader={true}
          title="Citation"
          objectNumber={displayNumber}
          subtitle={displayTitle}
          backUrl={`/organizations/${orgId}/collections/citations`}
          backLabel="Back to Citations"
        >
          {pageContent}
        </RecordDetailPageWrapper>
      </WorkspaceErrorBoundary>
    );
  }

  return (
    <WorkspaceErrorBoundary
      backUrl={orgId ? `/organizations/${orgId}/collections/citations` : undefined}
      backLabel="Back to Citations"
    >
      {pageContent}
    </WorkspaceErrorBoundary>
  );
}
