import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useWorkspacePage } from '../../../hooks/useWorkspacePage';
import { formatDateTime } from '@/lib/formatters';
import {
  Box,
  Ruler,
  Settings,
  MapPin,
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
import { LocationPickerButton } from '../../../components/collections/LocationPickerModal';
import { cn } from '../../../lib/utils';
import { getCrate } from '../../../lib/api';
import ConfirmDialog from '../../../components/ConfirmDialog';

import { useFormState, useSectionState, useSectionSummaries, useHasContent } from './hooks';
import {
  CRATE_SECTION_GROUPS,
  ALL_SECTION_IDS,
  CONDITION_OPTIONS,
} from './types';
import { MadronaLoader } from '../../../components/ui/MadronaLoader';

/**
 * Outer wrapper that provides section order context.
 */
export default function CrateWorkspacePage() {
  return (
    <SectionOrderProvider>
      <CrateWorkspacePageContent />
    </SectionOrderProvider>
  );
}

function CrateWorkspacePageContent() {
  const { orgId, crateId } = useParams<{ orgId: string; crateId?: string }>();
  const isCreateMode = !crateId;

  // Fetch crate data (disabled in create mode)
  const { data: crate, isLoading, error } = useQuery({
    queryKey: ['crate', orgId, crateId],
    queryFn: () => getCrate(orgId!, crateId!),
    enabled: !!crateId && !!orgId,
  });

  const crateRecord = crate;

  const wp = useWorkspacePage({
    entityType: 'crate',
    entityId: crateId,
    entityLabel: (crateRecord?.crate_number as string) || (crateId ? `Crate ${crateId.slice(0, 8)}` : undefined),
    orgId,
    editPermission: 'collections.edit',
  });
  const { isEditing, setIsEditing, useNewLayout, canEdit, hasPermission, dialogs } = wp;

  const form = useFormState({ orgId, crateId, isCreateMode, crate: crateRecord });

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
    crateId,
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
    identification: {
      crate_number: formData.crate_number,
      description: formData.description,
    },
    condition: {
      condition: formData.condition,
      materials: formData.materials,
    },
    exterior: {
      height_cm: formData.height_cm,
      width_cm: formData.width_cm,
      depth_cm: formData.depth_cm,
    },
    interior: {
      interior_height_cm: formData.interior_height_cm,
      interior_width_cm: formData.interior_width_cm,
      interior_depth_cm: formData.interior_depth_cm,
    },
    locations: {
      location_id: formData.location_id,
      home_location_id: formData.home_location_id,
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
  if (!isCreateMode && (error || !crate)) {
    return (
      <div className="p-6 max-w-4xl mx-auto text-center py-12">
        <Box size={48} className="mx-auto text-archive mb-4" />
        <h3 className="text-lg font-serif font-medium text-forest mb-2">
          Crate not found
        </h3>
        <p className="text-accessible-gray mb-4">
          {error ? (error as Error).message : 'The crate record could not be loaded.'}
        </p>
      </div>
    );
  }

  const displayNumber = isCreateMode ? '' : ((crateRecord?.crate_number as string) || '');
  const displayTitle = isCreateMode
    ? 'New Crate'
    : ((crateRecord?.crate_number as string) || 'Crate');

  const conditionLabel = crateRecord?.condition_label as string | undefined;

  const pageContent = (
    <div className={cn(!useNewLayout && 'p-6 max-w-4xl mx-auto')}>
      {/* Header - only in classic layout */}
      {!useNewLayout && (
        <WorkspaceHeader
          backUrl={`/organizations/${orgId}/collections/crates`}
          backText="Back to Crates"
          title={displayTitle}
          objectNumber={displayNumber}
          isEditing={isEditing}
          saveStatus={saveStatus}
          lastSaved={lastSaved}
          hasUnsavedChanges={hasUnsavedChanges}
          showCreateButton={isCreateMode}
          createButtonText="Create Crate"
          onSave={isCreateMode ? handleCreate : undefined}
          onToggleMode={isCreateMode ? undefined : handleToggleMode}
        />
      )}

      {/* Status bar - only in view/edit mode, not create mode */}
      {!isCreateMode && crateRecord && (
        <div className="flex items-center gap-4 mb-6">
          {conditionLabel && (
            <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-stone rounded-full text-sm text-archive">
              {conditionLabel}
            </span>
          )}
          {crateRecord.climate_controlled && (
            <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-semantic-info/10 text-semantic-info rounded-full text-sm font-medium">
              Climate Controlled
            </span>
          )}
          {!crateRecord.is_active && (
            <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-semantic-error/10 text-semantic-error rounded-full text-sm font-medium">
              Inactive
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
        {useNewLayout && <SectionGroupDivider label="Overview" icon={Box} />}

        {/* Identification */}
        <WorkspaceSection
          id="identification"
          title="Identification"
          icon={<Box size={18} />}
          isExpanded={expandedSections.identification}
          onToggle={() => toggleSection('identification')}
          isEditing={isEditing}
          order={getSectionOrder('identification')}
          isEmpty={!hasContent.identification}
          summary={sectionSummaries.identification}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableField
              label="Crate Number"
              value={formData.crate_number}
              isEditing={isEditing}
              onChange={(v) => updateField('crate_number', v)}
              placeholder="e.g., CRT-0001"
              required
            />
            <EditableCheckbox
              label="Active"
              value={formData.is_active}
              isEditing={isEditing}
              onChange={(v) => updateField('is_active', v)}
            />
            <EditableField
              label="Description"
              value={formData.description}
              isEditing={isEditing}
              onChange={(v) => updateField('description', v)}
              multiline
              rows={3}
              placeholder="Describe the crate..."
              className="md:col-span-2"
            />
          </div>
        </WorkspaceSection>

        {/* Condition & Features */}
        <WorkspaceSection
          id="condition"
          title="Condition & Features"
          icon={<Settings size={18} />}
          isExpanded={expandedSections.condition}
          onToggle={() => toggleSection('condition')}
          isEditing={isEditing}
          order={getSectionOrder('condition')}
          isEmpty={!hasContent.condition}
          summary={sectionSummaries.condition}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableSelect
              label="Condition"
              value={formData.condition}
              isEditing={isEditing}
              onChange={(v) => updateField('condition', v)}
              options={CONDITION_OPTIONS}
            />
            <EditableField
              label="Materials"
              value={formData.materials}
              isEditing={isEditing}
              onChange={(v) => updateField('materials', v)}
              placeholder="e.g., Plywood, foam-lined"
            />
            <EditableCheckbox
              label="Climate Controlled"
              value={formData.climate_controlled}
              isEditing={isEditing}
              onChange={(v) => updateField('climate_controlled', v)}
            />
            <EditableCheckbox
              label="Stackable"
              value={formData.is_stackable}
              isEditing={isEditing}
              onChange={(v) => updateField('is_stackable', v)}
            />
            <EditableCheckbox
              label="Oversized"
              value={formData.is_oversized}
              isEditing={isEditing}
              onChange={(v) => updateField('is_oversized', v)}
            />
          </div>
        </WorkspaceSection>

        {/* === PHYSICAL GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Physical" icon={Ruler} />}

        {/* Exterior Dimensions */}
        <WorkspaceSection
          id="exterior"
          title="Exterior Dimensions"
          icon={<Ruler size={18} />}
          isExpanded={expandedSections.exterior}
          onToggle={() => toggleSection('exterior')}
          isEditing={isEditing}
          order={getSectionOrder('exterior')}
          isEmpty={!hasContent.exterior}
          summary={sectionSummaries.exterior}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableField
              label="Height (cm)"
              value={formData.height_cm}
              isEditing={isEditing}
              onChange={(v) => updateField('height_cm', v)}
              type="number"
              placeholder="e.g., 120"
            />
            <EditableField
              label="Width (cm)"
              value={formData.width_cm}
              isEditing={isEditing}
              onChange={(v) => updateField('width_cm', v)}
              type="number"
              placeholder="e.g., 80"
            />
            <EditableField
              label="Depth (cm)"
              value={formData.depth_cm}
              isEditing={isEditing}
              onChange={(v) => updateField('depth_cm', v)}
              type="number"
              placeholder="e.g., 60"
            />
            <EditableField
              label="Empty Weight (kg)"
              value={formData.weight_empty_kg}
              isEditing={isEditing}
              onChange={(v) => updateField('weight_empty_kg', v)}
              type="number"
              placeholder="e.g., 25"
            />
          </div>
        </WorkspaceSection>

        {/* Interior Dimensions */}
        <WorkspaceSection
          id="interior"
          title="Interior Dimensions"
          icon={<Ruler size={18} />}
          isExpanded={expandedSections.interior}
          onToggle={() => toggleSection('interior')}
          isEditing={isEditing}
          order={getSectionOrder('interior')}
          isEmpty={!hasContent.interior}
          summary={sectionSummaries.interior}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableField
              label="Interior Height (cm)"
              value={formData.interior_height_cm}
              isEditing={isEditing}
              onChange={(v) => updateField('interior_height_cm', v)}
              type="number"
              placeholder="e.g., 110"
            />
            <EditableField
              label="Interior Width (cm)"
              value={formData.interior_width_cm}
              isEditing={isEditing}
              onChange={(v) => updateField('interior_width_cm', v)}
              type="number"
              placeholder="e.g., 70"
            />
            <EditableField
              label="Interior Depth (cm)"
              value={formData.interior_depth_cm}
              isEditing={isEditing}
              onChange={(v) => updateField('interior_depth_cm', v)}
              type="number"
              placeholder="e.g., 50"
            />
          </div>
        </WorkspaceSection>

        {/* === LOCATION GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Location" icon={MapPin} />}

        {/* Location Tracking */}
        <WorkspaceSection
          id="locations"
          title="Location Tracking"
          icon={<MapPin size={18} />}
          isExpanded={expandedSections.locations}
          onToggle={() => toggleSection('locations')}
          isEditing={isEditing}
          order={getSectionOrder('locations')}
          isEmpty={!hasContent.locations}
          summary={sectionSummaries.locations}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {orgId && (
              <>
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">Current Location</label>
                  {isEditing ? (
                    <LocationPickerButton
                      organizationId={orgId}
                      value={formData.location_id}
                      onChange={(locId) => updateField('location_id', locId || '')}
                      placeholder="Select current location..."
                    />
                  ) : (
                    <div className="text-sm text-ink">
                      {formData.location_id ? (
                        <LocationPickerButton
                          organizationId={orgId}
                          value={formData.location_id}
                          onChange={() => {}}
                          disabled
                        />
                      ) : (
                        <span className="text-archive">Not set</span>
                      )}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">Home Location</label>
                  {isEditing ? (
                    <LocationPickerButton
                      organizationId={orgId}
                      value={formData.home_location_id}
                      onChange={(locId) => updateField('home_location_id', locId || '')}
                      placeholder="Select home location..."
                    />
                  ) : (
                    <div className="text-sm text-ink">
                      {formData.home_location_id ? (
                        <LocationPickerButton
                          organizationId={orgId}
                          value={formData.home_location_id}
                          onChange={() => {}}
                          disabled
                        />
                      ) : (
                        <span className="text-archive">Not set</span>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
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
        {hasPermission('org.view_audit_logs') && !isCreateMode && orgId && crateId && (
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
              entityType="crate"
              entityId={crateId}
            />
          </WorkspaceSection>
        )}
      </div>

      {/* Footer metadata - only in view/edit mode, not create mode */}
      {!isCreateMode && crateRecord && (crateRecord.created_at as string) && (
        <div className="mt-8 pt-6 border-t border-lichen text-sm text-archive">
          <p>Created: {formatDateTime(crateRecord.created_at as string)}</p>
          {crateRecord.updated_at && (
            <p>Last updated: {formatDateTime(crateRecord.updated_at as string)}</p>
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
        title="Delete Crate"
        message={<>Are you sure you want to deactivate <strong>{displayNumber || 'this crate'}</strong>? It will be marked as inactive.</>}
        confirmText="Delete"
        confirmStyle="danger"
      />

      {/* CreateTaskSlideOver */}
      {orgId && crateId && crateRecord && (
        <CreateTaskSlideOver
          isOpen={dialogs.showCreateTask}
          onClose={() => dialogs.setShowCreateTask(false)}
          orgId={orgId}
          initialEntityType={"crate" as React.ComponentProps<typeof CreateTaskSlideOver>['initialEntityType']}
          initialEntityId={crateId}
          initialEntityLabel={(crateRecord.crate_number as string) || `Crate ${crateId.slice(0, 8)}`}
        />
      )}
    </div>
  );

  // New layout with RecordDetailPageWrapper
  if (useNewLayout && crateRecord) {
    return (
      <WorkspaceErrorBoundary
        backUrl={`/organizations/${orgId}/collections/crates`}
        backLabel="Back to Crates"
      >
        <RecordDetailPageWrapper
          object={null}
          media={[]}
          sectionIds={ALL_SECTION_IDS}
          sectionGroups={CRATE_SECTION_GROUPS}
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
          pageType="crate"
          enabled={true}
          showHeader={true}
          title="Crate"
          objectNumber={displayNumber}
          subtitle={displayTitle}
          backUrl={`/organizations/${orgId}/collections/crates`}
          backLabel="Back to Crates"
        >
          {pageContent}
        </RecordDetailPageWrapper>
      </WorkspaceErrorBoundary>
    );
  }

  return (
    <WorkspaceErrorBoundary
      backUrl={orgId ? `/organizations/${orgId}/collections/crates` : undefined}
      backLabel="Back to Crates"
    >
      {pageContent}
    </WorkspaceErrorBoundary>
  );
}
