import { useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  Calendar,
  Users,
  GraduationCap,
  Clock,
  CheckCircle,
  Trash2,
  Package,
  FileText,
  MessageSquare,
  AlertTriangle,
  History,
} from 'lucide-react';
import { EventObjectLinker } from '../../../components/collections/EventObjectLinker';
import { EventCollectionsImpact } from '../../../components/collections/EventCollectionsImpact';
import { RecordDiscussionTab } from '../../../components/RecordDiscussionTab';
import ConfirmDialog from '../../../components/ConfirmDialog';
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
import { useLookupValues } from '../../../hooks/useLookupValues';
import { useWorkspacePage } from '../../../hooks/useWorkspacePage';

import { useFormState, useSectionState, useSectionSummaries, useHasContent } from './hooks';
import { EVENT_SECTION_GROUPS, ALL_SECTION_IDS } from './types';
import { MadronaLoader } from '../../../components/ui/MadronaLoader';

// Constants - SESSION_FORMATS stays hardcoded as it's tied to teaching session logic
const SESSION_FORMATS = [
  { value: '', label: 'Select format...' },
  { value: 'gallery', label: 'Gallery' },
  { value: 'study_room', label: 'Study Room' },
  { value: 'handling_session', label: 'Handling Session' },
];

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  draft: { label: 'Draft', color: 'bg-stone text-ink', icon: Clock },
  scheduled: { label: 'Scheduled', color: 'bg-semantic-info/10 text-semantic-info', icon: Calendar },
  completed: { label: 'Completed', color: 'bg-semantic-success/10 text-semantic-success', icon: CheckCircle },
  cancelled: { label: 'Cancelled', color: 'bg-semantic-error/10 text-semantic-error', icon: Clock },
};

const WORKFLOW_STEPS = [
  { key: 'draft', label: 'Draft' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'completed', label: 'Completed' },
];

/**
 * Outer wrapper that provides section order context.
 */
export default function EventWorkspacePage() {
  return (
    <SectionOrderProvider>
      <EventWorkspacePageContent />
    </SectionOrderProvider>
  );
}

function EventWorkspacePageContent() {
  const { orgId, eventId } = useParams<{ orgId: string; eventId?: string }>();
  const isCreateMode = !eventId;

  // Fetch lookup values for dropdowns
  const { getLookup } = useLookupValues({ context: 'events' });
  const eventTypeOptions = getLookup('event_type');
  const audienceOptions = getLookup('event_audience');

  // Form state hook
  const form = useFormState({ orgId, eventId, isCreateMode: !eventId, event: undefined });

  const {
    formData,
    updateField,
    hasUnsavedChanges,
    saveStatus,
    lastSaved,
    event,
    isLoading,
    error,
    queryClient,
    performSave,
    handleCreateSave,
    statusMutation,
    deleteMutation,
    pendingObjects,
    setPendingObjects,
  } = form;

  const wp = useWorkspacePage({
    entityType: 'event',
    entityId: eventId,
    entityLabel: event?.title || (eventId ? `Event ${eventId.slice(0, 8)}` : undefined),
    orgId,
    editPermission: 'events.edit',
  });
  const { isEditing, setIsEditing, useNewLayout, canEdit, hasPermission, dialogs } = wp;

  // Section state hook
  const sectionState = useSectionState({
    orgId,
    eventId,
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

  // Helper to get workflow step index
  const getStepIndex = useCallback((status: string) => {
    const index = WORKFLOW_STEPS.findIndex((s) => s.key === status);
    return index >= 0 ? index : 0;
  }, []);

  // Compute sectionData for nav completeness indicators
  const sectionData: Record<string, unknown> = {
    details: {
      title: formData.title,
      event_type: formData.event_type,
      start_at: formData.start_at,
    },
    teaching: {
      course_code: formData.course_code,
      institution: formData.institution,
    },
    program: {
      audience: formData.audience,
      capacity: formData.capacity,
    },
    objects: {},
    impact: {},
    discussion: {},
    notes: { notes: formData.notes },
    history: {},
  };

  const isTeachingSession = formData.event_type === 'teaching_session';
  const isProgramType = ['program', 'opening_reception', 'donor_development'].includes(formData.event_type);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <MadronaLoader label="Loading…" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="bg-semantic-error/10 border border-semantic-error/30 rounded-lg p-4 text-semantic-error">
          Error loading event: {(error as Error).message}
        </div>
      </div>
    );
  }

  const statusConfig = STATUS_CONFIG[formData.status] || STATUS_CONFIG.draft;
  const StatusIcon = statusConfig.icon;

  const pageContent = (
    <div className={cn(!useNewLayout && 'max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6')}>
      {/* Header - only in classic layout */}
      {!useNewLayout && (
        <WorkspaceHeader
          backUrl={`/organizations/${orgId}/collections/events`}
          backText="Back to Events"
          title={isCreateMode ? 'New Event' : event?.title || 'Event'}
          objectNumber={isCreateMode ? undefined : event?.event_reference_number}
          isEditing={isEditing}
          onToggleMode={isCreateMode ? undefined : handleToggleMode}
          saveStatus={saveStatus}
          lastSaved={lastSaved}
          hasUnsavedChanges={hasUnsavedChanges}
          onSave={isCreateMode ? handleCreateSave : performSave}
          showCreateButton={isCreateMode}
          createButtonText="Create Event"
          actions={
            !isCreateMode && isEditing ? (
              <button
                onClick={() => dialogs.setShowDeleteConfirm(true)}
                className="flex items-center gap-2 px-3 py-1.5 text-sm text-semantic-error hover:bg-semantic-error/10 rounded-lg transition-colors"
              >
                <Trash2 size={16} />
                Delete
              </button>
            ) : undefined
          }
          statusBadge={
            !isCreateMode && formData.status ? (
              <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium', statusConfig.color)}>
                <StatusIcon size={12} />
                {statusConfig.label}
              </span>
            ) : undefined
          }
        />
      )}

      {/* Edit mode indicator */}

      {/* Workflow Indicator */}
      {!isCreateMode && event && (
        <div className="bg-parchment border border-lichen rounded-lg p-4 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-8">
              {WORKFLOW_STEPS.map((step, index) => {
                const currentIndex = getStepIndex(event.status);
                const isComplete = index < currentIndex;
                const isCurrent = index === currentIndex;
                const isCancelled = event.status === 'cancelled';

                return (
                  <div key={step.key} className="flex items-center gap-2">
                    <div
                      className={cn(
                        'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium',
                        isComplete
                          ? 'bg-semantic-success text-parchment'
                          : isCurrent && !isCancelled
                          ? 'bg-bark text-parchment'
                          : 'bg-stone text-archive'
                      )}
                    >
                      {isComplete ? <CheckCircle size={16} /> : index + 1}
                    </div>
                    <span
                      className={cn(
                        'text-sm',
                        isCurrent && !isCancelled ? 'text-ink font-medium' : 'text-archive'
                      )}
                    >
                      {step.label}
                    </span>
                    {index < WORKFLOW_STEPS.length - 1 && (
                      <div
                        className={cn(
                          'w-12 h-0.5 ml-2',
                          isComplete ? 'bg-semantic-success' : 'bg-lichen'
                        )}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            {isEditing && event.status !== 'cancelled' && (
              <div className="flex gap-2">
                {event.status === 'draft' && (
                  <button
                    onClick={() => statusMutation.mutate('scheduled')}
                    disabled={statusMutation.isPending}
                    className="btn btn-primary text-sm disabled:opacity-50"
                  >
                    Schedule
                  </button>
                )}
                {event.status === 'scheduled' && (
                  <button
                    onClick={() => statusMutation.mutate('completed')}
                    disabled={statusMutation.isPending}
                    className="px-3 py-1.5 text-sm bg-semantic-success text-parchment rounded-lg hover:bg-semantic-success/90 disabled:opacity-50"
                  >
                    Mark Complete
                  </button>
                )}
                <button
                  onClick={() => statusMutation.mutate('cancelled')}
                  disabled={statusMutation.isPending}
                  className="px-3 py-1.5 text-sm text-semantic-error border border-semantic-error/30 rounded-lg hover:bg-semantic-error/10 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Read-only indicator */}
      <ReadOnlyBanner visible={!isCreateMode && !canEdit} />

      {/* Sections */}
      <div className="flex flex-col gap-4">
        {/* === OVERVIEW GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Overview" icon={Calendar} />}

        {/* Details Section */}
        <WorkspaceSection
          id="details"
          title="Event Details"
          icon={<Calendar size={18} />}
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
                onChange={(v: string) => updateField('title', v)}
                isEditing={isEditing}
                required
              />
            </div>
            <EditableSelect
              label="Event Type"
              value={formData.event_type}
              onChange={(v: string) => updateField('event_type', v)}
              options={eventTypeOptions}
              isEditing={isEditing}
              required
            />
            <EditableSelect
              label="Status"
              value={formData.status}
              onChange={(v: string) => updateField('status', v)}
              options={[
                { value: 'draft', label: 'Draft' },
                { value: 'scheduled', label: 'Scheduled' },
                { value: 'completed', label: 'Completed' },
                { value: 'cancelled', label: 'Cancelled' },
              ]}
              isEditing={isEditing}
            />
            <EditableField
              label="Start Date/Time"
              value={formData.start_at}
              onChange={(v: string) => updateField('start_at', v)}
              isEditing={isEditing}
              type="datetime-local"
            />
            <EditableField
              label="End Date/Time"
              value={formData.end_at}
              onChange={(v: string) => updateField('end_at', v)}
              isEditing={isEditing}
              type="datetime-local"
            />
            <div className="col-span-2">
              <EditableField
                label="Description"
                value={formData.description}
                onChange={(v: string) => updateField('description', v)}
                isEditing={isEditing}
                multiline
                rows={3}
              />
            </div>
          </div>
        </WorkspaceSection>

        {/* Teaching Section (conditional) */}
        {isTeachingSession && (
          <WorkspaceSection
            id="teaching"
            title="Teaching Details"
            icon={<GraduationCap size={18} />}
            isExpanded={expandedSections.teaching}
            onToggle={() => toggleSection('teaching')}
            isEditing={isEditing}
            order={getSectionOrder('teaching')}
            isEmpty={!hasContent.teaching}
            summary={sectionSummaries.teaching}
          >
            <div className="grid grid-cols-2 gap-4">
              <EditableField
                label="Course Code"
                value={formData.course_code}
                onChange={(v: string) => updateField('course_code', v)}
                isEditing={isEditing}
              />
              <EditableSelect
                label="Session Format"
                value={formData.session_format}
                onChange={(v: string) => updateField('session_format', v)}
                options={SESSION_FORMATS}
                isEditing={isEditing}
              />
              <EditableField
                label="Institution"
                value={formData.institution}
                onChange={(v: string) => updateField('institution', v)}
                isEditing={isEditing}
              />
              <EditableField
                label="Department"
                value={formData.department}
                onChange={(v: string) => updateField('department', v)}
                isEditing={isEditing}
              />
              <EditableField
                label="Headcount"
                value={formData.headcount}
                onChange={(v: string) => updateField('headcount', v)}
                isEditing={isEditing}
                type="number"
              />
            </div>
          </WorkspaceSection>
        )}

        {/* Program Section (conditional) */}
        {isProgramType && (
          <WorkspaceSection
            id="program"
            title="Program Details"
            icon={<Users size={18} />}
            isExpanded={expandedSections.program}
            onToggle={() => toggleSection('program')}
            isEditing={isEditing}
            order={getSectionOrder('program')}
            isEmpty={!hasContent.program}
            summary={sectionSummaries.program}
          >
            <div className="grid grid-cols-2 gap-4">
              <EditableSelect
                label="Audience"
                value={formData.audience}
                onChange={(v: string) => updateField('audience', v)}
                options={audienceOptions}
                isEditing={isEditing}
              />
              <EditableField
                label="Capacity"
                value={formData.capacity}
                onChange={(v: string) => updateField('capacity', v)}
                isEditing={isEditing}
                type="number"
              />
              <div className="col-span-2">
                <EditableField
                  label="Registration URL"
                  value={formData.registration_url}
                  onChange={(v: string) => updateField('registration_url', v)}
                  isEditing={isEditing}
                  type="url"
                />
              </div>
            </div>
          </WorkspaceSection>
        )}

        {/* === LINKED RECORDS GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Linked Records" icon={Package} />}

        {/* Related Objects Section */}
        <WorkspaceSection
          id="objects"
          title="Related Objects"
          icon={<Package size={18} />}
          isExpanded={expandedSections.objects}
          onToggle={() => toggleSection('objects')}
          badge={isCreateMode ? (pendingObjects.length > 0 ? pendingObjects.length.toString() : undefined) : event?.object_count?.toString()}
          isEditing={isEditing}
          order={getSectionOrder('objects')}
          isEmpty={!hasContent.objects}
          summary={sectionSummaries.objects}
        >
          {isCreateMode ? (
            <EventObjectLinker
              organizationId={orgId!}
              isEditing={true}
              pendingObjects={pendingObjects}
              onPendingObjectsChange={setPendingObjects}
            />
          ) : (
            <EventObjectLinker
              organizationId={orgId!}
              eventId={eventId!}
              isEditing={isEditing}
            />
          )}
        </WorkspaceSection>

        {/* Collections Impact Section */}
        {!isCreateMode && event?.status === 'scheduled' && (event?.object_count ?? 0) > 0 && (
          <WorkspaceSection
            id="impact"
            title="Collections Impact"
            icon={<AlertTriangle size={18} />}
            isExpanded={expandedSections.impact}
            onToggle={() => toggleSection('impact')}
            isEditing={isEditing}
            order={getSectionOrder('impact')}
            isEmpty={!hasContent.impact}
            summary={sectionSummaries.impact}
          >
            <EventCollectionsImpact
              organizationId={orgId!}
              eventId={eventId!}
            />
          </WorkspaceSection>
        )}

        {/* === ADMIN GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Admin" icon={History} />}

        {/* Discussion Section */}
        {!isCreateMode && (
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
              entityType="event"
              entityId={eventId!}
            />
          </WorkspaceSection>
        )}

        {/* Notes Section */}
        <WorkspaceSection
          id="notes"
          title="Notes"
          icon={<FileText size={18} />}
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
            onChange={(v: string) => updateField('notes', v)}
            isEditing={isEditing}
            multiline
            rows={4}
          />
        </WorkspaceSection>

        {/* Change History Section */}
        {hasPermission('org.view_audit_logs') && !isCreateMode && orgId && eventId && (
          <WorkspaceSection
            id="history"
            title="Change History"
            icon={<History size={18} />}
            isExpanded={expandedSections.history}
            onToggle={() => toggleSection('history')}
            isEditing={isEditing}
            order={getSectionOrder('history')}
            isEmpty={!hasContent.history}
            summary={sectionSummaries.history}
          >
            <RecordAuditHistory
              organizationId={orgId}
              entityType="event"
              entityId={eventId}
            />
          </WorkspaceSection>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={dialogs.showDeleteConfirm}
        title="Delete Event"
        message={`Are you sure you want to delete "${event?.title}"? This action cannot be undone.`}
        confirmText="Delete"
        confirmStyle="danger"
        onConfirm={() => {
          deleteMutation.mutate();
          dialogs.setShowDeleteConfirm(false);
        }}
        onClose={() => dialogs.setShowDeleteConfirm(false)}
      />

      {/* CreateTaskSlideOver */}
      {orgId && eventId && event && (
        <CreateTaskSlideOver
          isOpen={dialogs.showCreateTask}
          onClose={() => dialogs.setShowCreateTask(false)}
          orgId={orgId}
          initialEntityType={"event" as React.ComponentProps<typeof CreateTaskSlideOver>['initialEntityType']}
          initialEntityId={eventId}
          initialEntityLabel={event.title || `Event ${eventId.slice(0, 8)}`}
        />
      )}
    </div>
  );

  // New layout with RecordDetailPageWrapper
  if (useNewLayout && event) {
    return (
      <WorkspaceErrorBoundary
        backUrl={`/organizations/${orgId}/collections/events`}
        backLabel="Back to Events"
      >
        <RecordDetailPageWrapper
          object={null}
          media={[]}
          sectionIds={ALL_SECTION_IDS}
          sectionGroups={EVENT_SECTION_GROUPS}
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
          pageType="event"
          enabled={true}
          showHeader={true}
          title="Event"
          objectNumber={event.event_reference_number || undefined}
          subtitle={event.title}
          backUrl={`/organizations/${orgId}/collections/events`}
          backLabel="Back to Events"
        >
          {pageContent}
        </RecordDetailPageWrapper>
      </WorkspaceErrorBoundary>
    );
  }

  return (
    <WorkspaceErrorBoundary
      backUrl={orgId ? `/organizations/${orgId}/collections/events` : undefined}
      backLabel="Back to Events"
    >
      {pageContent}
    </WorkspaceErrorBoundary>
  );
}
