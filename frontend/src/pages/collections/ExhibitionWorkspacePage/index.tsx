import { useCallback, lazy, Suspense } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useWorkspacePage } from '../../../hooks/useWorkspacePage';
import { formatDateTime } from '@/lib/formatters';
import { apiFetch } from '../../../lib/api';
import {
  FileText,
  Calendar,
  Package,
  Tag,
  BookOpen,
  Globe,
  Users,
  Eye,
  MessageSquare,
  History,
  Trash2,
  StickyNote,
  ClipboardCheck,
  DollarSign,
  Truck,
  HandCoins,
  FileDown,
} from 'lucide-react';
import { getExhibition } from '../../../lib/api';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { RecordDiscussionTab } from '../../../components/RecordDiscussionTab';
import { ExhibitionObjectLinker } from '../../../components/collections/ExhibitionObjectLinker';
import { ExhibitionLabelsTab } from '../../../components/exhibit/ExhibitionLabelsTab';
import { InterpretiveContentTab } from '../../../components/exhibit/InterpretiveContentTab';
import { TouringScheduleTab } from '../../../components/exhibit/TouringScheduleTab';
import { MadronaLoader } from '../../../components/ui/MadronaLoader';

// Lazy-load heavier tab components
const ExhibitionChecklistTab = lazy(() => import('../../../components/exhibit/ExhibitionChecklistTab'));
const ExhibitionBudgetTab = lazy(() => import('../../../components/exhibit/ExhibitionBudgetTab').then(m => ({ default: m.ExhibitionBudgetTab })));
const ExhibitionLogisticsTab = lazy(() => import('../../../components/exhibit/ExhibitionLogisticsTab').then(m => ({ default: m.ExhibitionLogisticsTab })));
const ExhibitionLoansTab = lazy(() => import('../../../components/exhibit/ExhibitionLoansTab').then(m => ({ default: m.ExhibitionLoansTab })));
const ExportPanel = lazy(() => import('../../../components/exhibit/ExportPanel/ExportPanel'));
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

import { useFormState, useSectionState, useSectionSummaries, useHasContent } from './hooks';
import type { FormData } from './types';
import {
  EXHIBITION_SECTION_GROUPS,
  ALL_SECTION_IDS,
  EXHIBITION_TYPES,
  STATUS_OPTIONS,
  STATUS_CONFIG,
  WORKFLOW_STEPS,
} from './types';

/**
 * Outer wrapper that provides section order context.
 */
export default function ExhibitionWorkspacePage() {
  return (
    <SectionOrderProvider>
      <ExhibitionWorkspacePageContent />
    </SectionOrderProvider>
  );
}

function ExhibitionWorkspacePageContent() {
  const { orgId, exhibitionId } = useParams<{ orgId: string; exhibitionId?: string }>();
  const isCreateMode = !exhibitionId;

  // Fetch exhibition data
  const { data: exhibition, isLoading, error } = useQuery({
    queryKey: ['exhibition', orgId, exhibitionId],
    queryFn: () => getExhibition(orgId!, exhibitionId!),
    enabled: !!orgId && !!exhibitionId,
  });

  // Fetch venues for selector
  const { data: venuesData } = useQuery({
    queryKey: ['venues', orgId],
    queryFn: () => apiFetch<{ venues: Array<{ venue_id: string; name: string }> }>(
      `/organizations/${orgId}/exhibit/venues`,
      { expectKeys: ['venues'] }
    ),
    enabled: !!orgId,
  });
  const venueOptions = [
    { value: '', label: 'No venue assigned' },
    ...(venuesData?.venues || []).map(v => ({ value: v.venue_id, label: v.name })),
  ];

  const wp = useWorkspacePage({
    entityType: 'exhibition',
    entityId: exhibitionId,
    entityLabel: exhibition?.title,
    orgId,
    editPermission: 'exhibit.edit',
    restrictedFields: exhibition?._restricted_fields,
  });
  const { isEditing, setIsEditing, useNewLayout, canEdit, isRestricted, hasPermission, dialogs } = wp;

  // Form state hook
  const form = useFormState({
    orgId,
    exhibitionId,
    isCreateMode,
    exhibition,
  });

  const {
    formData,
    updateField: rawUpdateField,
    hasUnsavedChanges,
    saveStatus,
    lastSaved,
    queryClient,
    performSave,
    handleCreate,
    createMutation,
    deleteMutation,
  } = form;

  // Wrap updateField to pass isEditing
  const updateField = useCallback((field: keyof FormData, value: string | boolean) => {
    rawUpdateField(field, value, isEditing);
  }, [rawUpdateField, isEditing]);

  // Section state hook
  const sectionState = useSectionState({
    orgId,
    exhibitionId,
    isCreateMode,
    isEditing,
    setIsEditing,
    canEdit,
    hasUnsavedChanges,
    performSave,
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
      title: formData.title,
      exhibition_type: formData.exhibition_type,
      status: formData.status,
    },
    dates: {
      planned_start_date: formData.planned_start_date,
      planned_end_date: formData.planned_end_date,
    },
    objects: {},
    labels: {},
    interpretive: {},
    touring: {},
    authorization: {
      provisos: formData.provisos,
    },
    placements: {},
    notes: {
      curator_notes: formData.curator_notes,
      outcome: formData.outcome,
    },
    discussion: {},
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
  if (error && !isCreateMode) {
    return (
      <div className="p-6 max-w-4xl mx-auto text-center py-12">
        <Trash2 size={48} className="mx-auto text-archive mb-4" />
        <h3 className="text-lg font-serif font-medium text-forest mb-2">
          Exhibition not found
        </h3>
        <p className="text-accessible-gray mb-4">
          {(error as Error).message}
        </p>
        <Link
          to={`/organizations/${orgId}/collections/exhibitions`}
          className="text-bark hover:text-copper-dark"
        >
          Back to Exhibitions
        </Link>
      </div>
    );
  }

  const currentStatus = exhibition?.status || formData.status;
  const statusConfig = STATUS_CONFIG[currentStatus] || STATUS_CONFIG.proposed;
  const StatusIcon = statusConfig.icon;
  const currentStepIndex = WORKFLOW_STEPS.findIndex(s => s.key === currentStatus);

  // Handle delete
  const handleDelete = () => {
    dialogs.setShowDeleteConfirm(true);
  };

  const confirmDelete = () => {
    deleteMutation.mutate();
    dialogs.setShowDeleteConfirm(false);
  };

  const pageContent = (
    <div className={cn(!useNewLayout && 'p-6 max-w-4xl mx-auto')}>
      {/* Header - only in classic layout */}
      {!useNewLayout && (
        <WorkspaceHeader
          backUrl={`/organizations/${orgId}/collections/exhibitions`}
          backText="Back to Exhibitions"
          title={isCreateMode ? 'New Exhibition' : (exhibition?.title || 'Exhibition')}
          objectNumber={exhibition?.exhibition_number || undefined}
          isEditing={isEditing}
          saveStatus={saveStatus}
          lastSaved={lastSaved}
          hasUnsavedChanges={hasUnsavedChanges}
          showCreateButton={isCreateMode}
          createButtonText="Create Exhibition"
          onSave={isCreateMode ? handleCreate : undefined}
          onToggleMode={isCreateMode ? undefined : handleToggleMode}
        />
      )}


      {/* Workflow Progress (for existing records) */}
      {!isCreateMode && (
        <div className="bg-parchment border border-lichen rounded-lg p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-ink">Workflow</h3>
            <div className={cn('flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium', statusConfig.color)}>
              <StatusIcon size={12} />
              {statusConfig.label}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {WORKFLOW_STEPS.map((step, index) => (
              <div key={step.key} className="flex items-center flex-1">
                <div
                  className={cn(
                    'flex-1 h-2 rounded-full transition-colors',
                    index <= currentStepIndex ? 'bg-bark' : 'bg-stone'
                  )}
                />
                {index < WORKFLOW_STEPS.length - 1 && <div className="w-1" />}
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-1">
            {WORKFLOW_STEPS.map((step, index) => (
              <span
                key={step.key}
                className={cn(
                  'text-[10px]',
                  index <= currentStepIndex ? 'text-ink' : 'text-archive'
                )}
              >
                {step.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Read-only indicator */}
      <ReadOnlyBanner visible={!isCreateMode && !canEdit} />

      {/* Sections */}
      <div className="flex flex-col gap-4">
        {/* === OVERVIEW GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Overview" icon={FileText} />}

        {/* Details Section */}
        <WorkspaceSection
          id="details"
          title="Exhibition Details"
          icon={<FileText size={18} />}
          isExpanded={expandedSections.details}
          onToggle={() => toggleSection('details')}
          isEditing={isEditing}
          order={getSectionOrder('details')}
          isEmpty={!hasContent.details}
          summary={sectionSummaries.details}
        >
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <EditableField
                label="Title"
                value={formData.title}
                onChange={(value) => updateField('title', value)}
                isEditing={isEditing}
                required
                placeholder="Exhibition title"
              />
            </div>
            <EditableField
              label="Exhibition Number"
              value={formData.exhibition_number}
              onChange={(value) => updateField('exhibition_number', value)}
              isEditing={isEditing}
              placeholder="e.g., EXH.2026.001"
              required
            />
            <EditableSelect
              label="Exhibition Type"
              value={formData.exhibition_type}
              onChange={(value) => updateField('exhibition_type', value)}
              options={EXHIBITION_TYPES}
              isEditing={isEditing}
            />
            <EditableSelect
              label="Status"
              value={formData.status}
              onChange={(value) => updateField('status', value)}
              options={STATUS_OPTIONS}
              isEditing={isEditing}
            />
            <EditableSelect
              label="Venue"
              value={formData.venue_id}
              onChange={(value) => updateField('venue_id', value)}
              options={venueOptions}
              isEditing={isEditing}
            />
            <div className="col-span-2">
              <EditableField
                label="Description"
                value={formData.description}
                onChange={(value) => updateField('description', value)}
                isEditing={isEditing}
                multiline
                placeholder="Exhibition description for visitors and records"
              />
            </div>
          </div>
        </WorkspaceSection>

        {/* Dates Section */}
        <WorkspaceSection
          id="dates"
          title="Dates"
          icon={<Calendar size={18} />}
          isExpanded={expandedSections.dates}
          onToggle={() => toggleSection('dates')}
          isEditing={isEditing}
          order={getSectionOrder('dates')}
          isEmpty={!hasContent.dates}
          summary={sectionSummaries.dates}
        >
          <div className="grid grid-cols-2 gap-4">
            <EditableField
              label="Planned Start Date"
              value={formData.planned_start_date}
              onChange={(value) => updateField('planned_start_date', value)}
              isEditing={isEditing}
              type="date"
            />
            <EditableField
              label="Planned End Date"
              value={formData.planned_end_date}
              onChange={(value) => updateField('planned_end_date', value)}
              isEditing={isEditing}
              type="date"
            />
            <EditableField
              label="Actual Start Date"
              value={formData.actual_start_date}
              onChange={(value) => updateField('actual_start_date', value)}
              isEditing={isEditing}
              type="date"
            />
            <EditableField
              label="Actual End Date"
              value={formData.actual_end_date}
              onChange={(value) => updateField('actual_end_date', value)}
              isEditing={isEditing}
              type="date"
            />
          </div>
        </WorkspaceSection>

        {/* === CONTENT GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Content" icon={Package} />}

        {/* Exhibition Objects Section */}
        {!isCreateMode && exhibitionId && (
          <WorkspaceSection
            id="objects"
            title="Exhibition Objects"
            icon={<Package size={18} />}
            isExpanded={expandedSections.objects}
            onToggle={() => toggleSection('objects')}
            isEditing={isEditing}
            order={getSectionOrder('objects')}
            isEmpty={!hasContent.objects}
            summary={sectionSummaries.objects}
          >
            <ExhibitionObjectLinker
              organizationId={orgId!}
              exhibitionId={exhibitionId}
              isEditing={isEditing}
            />
          </WorkspaceSection>
        )}

        {/* Labels Section */}
        {!isCreateMode && exhibitionId && (
          <WorkspaceSection
            id="labels"
            title="Labels"
            icon={<Tag size={18} />}
            isExpanded={expandedSections.labels}
            onToggle={() => toggleSection('labels')}
            isEditing={isEditing}
            order={getSectionOrder('labels')}
            isEmpty={!hasContent.labels}
            summary={sectionSummaries.labels}
          >
            <ExhibitionLabelsTab
              organizationId={orgId!}
              exhibitionId={exhibitionId}
              isEditing={isEditing}
            />
          </WorkspaceSection>
        )}

        {/* Interpretive Content Section */}
        {!isCreateMode && exhibitionId && (
          <WorkspaceSection
            id="interpretive"
            title="Interpretive Content"
            icon={<BookOpen size={18} />}
            isExpanded={expandedSections.interpretive}
            onToggle={() => toggleSection('interpretive')}
            isEditing={isEditing}
            order={getSectionOrder('interpretive')}
            isEmpty={!hasContent.interpretive}
            summary={sectionSummaries.interpretive}
          >
            <InterpretiveContentTab
              organizationId={orgId!}
              exhibitionId={exhibitionId}
              isEditing={isEditing}
            />
          </WorkspaceSection>
        )}

        {/* Touring Schedule Section (only for touring/traveling exhibitions) */}
        {!isCreateMode && exhibitionId && (formData.exhibition_type === 'touring' || formData.exhibition_type === 'traveling') && (
          <WorkspaceSection
            id="touring"
            title="Touring Schedule"
            icon={<Globe size={18} />}
            isExpanded={expandedSections.touring}
            onToggle={() => toggleSection('touring')}
            isEditing={isEditing}
            order={getSectionOrder('touring')}
            isEmpty={!hasContent.touring}
            summary={sectionSummaries.touring}
          >
            <TouringScheduleTab
              organizationId={orgId!}
              exhibitionId={exhibitionId}
              isEditing={isEditing}
            />
          </WorkspaceSection>
        )}

        {/* Authorization Section (part of Overview group) */}
        <WorkspaceSection
          id="authorization"
          title="Authorization"
          icon={<Users size={18} />}
          isExpanded={expandedSections.authorization}
          onToggle={() => toggleSection('authorization')}
          isEditing={isEditing}
          badge={exhibition?.authorization_date ? 'Authorized' : undefined}
          order={getSectionOrder('authorization')}
          isEmpty={!hasContent.authorization}
          summary={sectionSummaries.authorization}
        >
          <div className="grid grid-cols-2 gap-4">
            <EditableField
              label="Authorization Date"
              value={formData.authorization_date}
              onChange={(value) => updateField('authorization_date', value)}
              isEditing={isEditing}
              type="date"
            />
            <EditableField
              label="Authorized By"
              value={formData.authorizer_name}
              onChange={(value) => updateField('authorizer_name', value)}
              isEditing={isEditing}
              placeholder="Name of authorizing officer"
            />
            <div className="col-span-2">
              <EditableField
                label="Provisos"
                value={formData.provisos}
                onChange={(value) => updateField('provisos', value)}
                isEditing={isEditing}
                multiline
                placeholder="Special conditions or requirements for this exhibition"
                restricted={isRestricted('provisos')}
              />
            </div>
          </div>
        </WorkspaceSection>

        {/* === PLANNING GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Planning" icon={ClipboardCheck} />}

        {/* Checklist Section */}
        {!isCreateMode && exhibitionId && orgId && (
          <WorkspaceSection
            id="checklist"
            title="Checklist"
            icon={<ClipboardCheck size={18} />}
            isExpanded={expandedSections.checklist}
            onToggle={() => toggleSection('checklist')}
            isEditing={isEditing}
            order={getSectionOrder('checklist')}
            isEmpty={!hasContent.checklist}
            summary={sectionSummaries.checklist}
          >
            <Suspense fallback={<div className="py-8 flex justify-center"><MadronaLoader variant="dots" /></div>}>
              <ExhibitionChecklistTab
                organizationId={orgId}
                exhibitionId={exhibitionId}
                isEditing={isEditing}
              />
            </Suspense>
          </WorkspaceSection>
        )}

        {/* Budget Section */}
        {!isCreateMode && exhibitionId && orgId && (
          <WorkspaceSection
            id="budget"
            title="Budget"
            icon={<DollarSign size={18} />}
            isExpanded={expandedSections.budget}
            onToggle={() => toggleSection('budget')}
            isEditing={isEditing}
            order={getSectionOrder('budget')}
            isEmpty={!hasContent.budget}
            summary={sectionSummaries.budget}
          >
            <Suspense fallback={<div className="py-8 flex justify-center"><MadronaLoader variant="dots" /></div>}>
              <ExhibitionBudgetTab
                organizationId={orgId}
                exhibitionId={exhibitionId}
                isEditing={isEditing}
              />
            </Suspense>
          </WorkspaceSection>
        )}

        {/* Logistics Section */}
        {!isCreateMode && exhibitionId && orgId && (
          <WorkspaceSection
            id="logistics"
            title="Logistics"
            icon={<Truck size={18} />}
            isExpanded={expandedSections.logistics}
            onToggle={() => toggleSection('logistics')}
            isEditing={isEditing}
            order={getSectionOrder('logistics')}
            isEmpty={!hasContent.logistics}
            summary={sectionSummaries.logistics}
          >
            <Suspense fallback={<div className="py-8 flex justify-center"><MadronaLoader variant="dots" /></div>}>
              <ExhibitionLogisticsTab
                organizationId={orgId}
                exhibitionId={exhibitionId}
                isEditing={isEditing}
              />
            </Suspense>
          </WorkspaceSection>
        )}

        {/* Loans Section */}
        {!isCreateMode && exhibitionId && orgId && (
          <WorkspaceSection
            id="loans"
            title="Loans"
            icon={<HandCoins size={18} />}
            isExpanded={expandedSections.loans}
            onToggle={() => toggleSection('loans')}
            isEditing={isEditing}
            order={getSectionOrder('loans')}
            isEmpty={!hasContent.loans}
            summary={sectionSummaries.loans}
          >
            <Suspense fallback={<div className="py-8 flex justify-center"><MadronaLoader variant="dots" /></div>}>
              <ExhibitionLoansTab
                organizationId={orgId}
                exhibitionId={exhibitionId}
                isEditing={isEditing}
              />
            </Suspense>
          </WorkspaceSection>
        )}


        {/* === PUBLISHING GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Publishing" icon={Eye} />}

        {/* Exports Section */}
        {!isCreateMode && exhibitionId && orgId && (
          <WorkspaceSection
            id="exports"
            title="Exports"
            icon={<FileDown size={18} />}
            isExpanded={expandedSections.exports}
            onToggle={() => toggleSection('exports')}
            isEditing={isEditing}
            order={getSectionOrder('exports')}
            isEmpty={!hasContent.exports}
            summary={sectionSummaries.exports}
          >
            <Suspense fallback={<div className="py-8 flex justify-center"><MadronaLoader variant="dots" /></div>}>
              <ExportPanel
                organizationId={orgId}
                exhibitionId={exhibitionId}
                walls={[]}
              />
            </Suspense>
          </WorkspaceSection>
        )}

        {/* === ADMIN GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Admin" icon={History} />}

        {/* Notes Section */}
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
          <div className="space-y-4">
            <EditableField
              label="Curator Notes"
              value={formData.curator_notes}
              onChange={(value) => updateField('curator_notes', value)}
              isEditing={isEditing}
              multiline
              placeholder="Internal notes for curatorial staff"
              restricted={isRestricted('curator_notes')}
            />
            <EditableField
              label="Outcome"
              value={formData.outcome}
              onChange={(value) => updateField('outcome', value)}
              isEditing={isEditing}
              multiline
              placeholder="Post-exhibition notes and outcomes"
              restricted={isRestricted('outcome')}
            />
          </div>
        </WorkspaceSection>

        {/* Discussion Section */}
        {!isCreateMode && exhibitionId && (
          <WorkspaceSection
            id="discussion"
            title="Discussion"
            icon={<MessageSquare size={18} />}
            isExpanded={expandedSections.discussion}
            onToggle={() => toggleSection('discussion')}
            isEditing={isEditing}
            order={getSectionOrder('discussion')}
            isEmpty={!hasContent.discussion}
            summary={sectionSummaries.discussion}
          >
            <RecordDiscussionTab
              organizationId={orgId!}
              entityType="exhibition"
              entityId={exhibitionId}
            />
          </WorkspaceSection>
        )}

        {/* Change History Section */}
        {hasPermission('org.view_audit_logs') && !isCreateMode && orgId && exhibitionId && (
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
              entityType="exhibition"
              entityId={exhibitionId}
            />
          </WorkspaceSection>
        )}
      </div>

      {/* Create Button (for new records) */}
      {isCreateMode && (
        <div className="flex justify-end gap-3 mt-6">
          <Link
            to={`/organizations/${orgId}/collections/exhibitions`}
            className="px-4 py-2 text-sm border border-lichen rounded-lg hover:bg-stone/50"
          >
            Cancel
          </Link>
          <button
            onClick={handleCreate}
            disabled={!formData.title.trim() || !formData.exhibition_number.trim() || createMutation.isPending}
            className="btn btn-primary text-sm disabled:opacity-50"
          >
            {createMutation.isPending ? 'Creating...' : 'Create Exhibition'}
          </button>
        </div>
      )}

      {/* Footer metadata */}
      {!isCreateMode && exhibition && (
        <div className="mt-8 pt-6 border-t border-lichen text-sm text-archive">
          <p>Created: {formatDateTime(exhibition.created_at)}</p>
          {exhibition.updated_at && (
            <p>Last updated: {formatDateTime(exhibition.updated_at)}</p>
          )}
        </div>
      )}

      {/* Dialogs */}
      <ConfirmDialog
        isOpen={dialogs.showDeleteConfirm}
        onClose={() => dialogs.setShowDeleteConfirm(false)}
        onConfirm={confirmDelete}
        title="Delete Exhibition"
        message={`Are you sure you want to delete "${exhibition?.title}"? This action cannot be undone.`}
        confirmText="Delete"
        confirmStyle="danger"
      />

      {orgId && exhibitionId && exhibition && (
        <CreateTaskSlideOver
          isOpen={dialogs.showCreateTask}
          onClose={() => dialogs.setShowCreateTask(false)}
          orgId={orgId}
          initialEntityType={"exhibition" as React.ComponentProps<typeof CreateTaskSlideOver>['initialEntityType']}
          initialEntityId={exhibitionId}
          initialEntityLabel={exhibition.title || `Exhibition ${exhibitionId.slice(0, 8)}`}
        />
      )}
    </div>
  );

  // New layout with RecordDetailPageWrapper
  if (useNewLayout && exhibition) {
    return (
      <WorkspaceErrorBoundary
        backUrl={`/organizations/${orgId}/collections/exhibitions`}
        backLabel="Back to Exhibitions"
      >
        <RecordDetailPageWrapper
          object={null}
          media={[]}
          sectionIds={ALL_SECTION_IDS}
          sectionGroups={EXHIBITION_SECTION_GROUPS}
          sectionData={sectionData}
          permissions={{
            canCreateTask: true,
            canViewHistory: true,
            canDelete: canEdit,
          }}
          callbacks={{
            onDelete: handleDelete,
            onCreateTask: () => dialogs.setShowCreateTask(true),
          }}
          isEditing={isEditing}
          onSectionNavigate={handleEnterEditMode}
          pageType="exhibition"
          enabled={true}
          showHeader={true}
          title="Exhibition"
          objectNumber={exhibition.exhibition_number || undefined}
          subtitle={exhibition.title}
          backUrl={`/organizations/${orgId}/collections/exhibitions`}
          backLabel="Back to Exhibitions"
        >
          {pageContent}
        </RecordDetailPageWrapper>
      </WorkspaceErrorBoundary>
    );
  }

  return (
    <WorkspaceErrorBoundary
      backUrl={orgId ? `/organizations/${orgId}/collections/exhibitions` : undefined}
      backLabel="Back to Exhibitions"
    >
      {pageContent}
    </WorkspaceErrorBoundary>
  );
}
