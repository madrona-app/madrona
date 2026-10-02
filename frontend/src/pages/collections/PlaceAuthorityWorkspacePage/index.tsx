import { useState, useCallback, lazy, Suspense } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useWorkspacePage } from '../../../hooks/useWorkspacePage';
import { formatDateTime } from '@/lib/formatters';
import {
  MapPin,
  Globe,
  StickyNote,
  Plus,
  X,
  Map,
  PenTool,
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
import { getPlaceAuthority, updatePlaceGeometry } from '../../../lib/api';
import ConfirmDialog from '../../../components/ConfirmDialog';
import type { PlaceAuthority } from '../../../lib/schemas';

import { useFormState, useSectionState, useSectionSummaries, useHasContent } from './hooks';
import {
  PLACE_AUTHORITY_SECTION_GROUPS,
  ALL_SECTION_IDS,
  PLACE_TYPE_OPTIONS,
  STATUS_OPTIONS,
} from './types';
import { MadronaLoader } from '../../../components/ui/MadronaLoader';

// Lazy load map components to reduce initial bundle size
const PointPicker = lazy(() => import('../../../components/maps/PointPicker'));
const AreaDrawer = lazy(() => import('../../../components/maps/AreaDrawer'));
const LocationPreview = lazy(() => import('../../../components/maps/LocationPreview'));

/**
 * Outer wrapper that provides section order context.
 */
export default function PlaceAuthorityWorkspacePage() {
  return (
    <SectionOrderProvider>
      <PlaceAuthorityWorkspacePageContent />
    </SectionOrderProvider>
  );
}

function PlaceAuthorityWorkspacePageContent() {
  const { orgId, placeAuthorityId } = useParams<{ orgId: string; placeAuthorityId?: string }>();

  const [variantNameInput, setVariantNameInput] = useState('');

  // Fetch authority data
  const isCreateMode = !placeAuthorityId;
  const { data: existingAuthority, isLoading, error } = useQuery({
    queryKey: ['place-authority', orgId, placeAuthorityId],
    queryFn: () => getPlaceAuthority(orgId!, placeAuthorityId!),
    enabled: !isCreateMode && !!orgId && !!placeAuthorityId,
  });

  const place = existingAuthority as PlaceAuthority | undefined;

  const wp = useWorkspacePage({
    entityType: 'place_authority',
    entityId: placeAuthorityId,
    entityLabel: place ? (place.preferred_name || `Place ${placeAuthorityId!.slice(0, 8)}`) : undefined,
    orgId,
    editPermission: 'place_authorities.edit',
  });
  const { isEditing, setIsEditing, useNewLayout, canEdit, hasPermission, dialogs } = wp;

  const form = useFormState({
    orgId,
    placeId: placeAuthorityId,
    isCreateMode,
    place,
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
    placeId: placeAuthorityId,
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

  // Variant name helpers
  const handleAddVariantName = useCallback(() => {
    if (variantNameInput.trim() && !formData.variant_names?.includes(variantNameInput.trim())) {
      updateField('variant_names', [...(formData.variant_names || []), variantNameInput.trim()]);
      setVariantNameInput('');
    }
  }, [variantNameInput, formData.variant_names, updateField]);

  const handleRemoveVariantName = useCallback((name: string) => {
    updateField('variant_names', formData.variant_names?.filter(n => n !== name) || []);
  }, [formData.variant_names, updateField]);

  // Compute sectionData for nav completeness indicators
  const sectionData: Record<string, unknown> = {
    identity: {
      preferred_name: formData.preferred_name,
      place_type: formData.place_type,
    },
    location: {
      coordinates_lat: formData.coordinates_lat,
      coordinates_lng: formData.coordinates_lng,
    },
    area: {},
    external: {
      tgn_id: formData.tgn_id,
      geonames_id: formData.geonames_id,
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
        <MapPin size={48} className="mx-auto text-archive mb-4" />
        <h3 className="text-lg font-serif font-medium text-forest mb-2">
          Place Authority not found
        </h3>
        <p className="text-accessible-gray mb-4">
          {error ? (error as Error).message : 'The place authority record could not be loaded.'}
        </p>
      </div>
    );
  }

  const displayTitle = isCreateMode
    ? 'New Place Authority'
    : (place?.preferred_name || 'Place Authority');
  const displayNumber = isCreateMode ? '' : (place?.place_type || '');

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
          createButtonText="Create Place Authority"
          onSave={isCreateMode ? handleCreate : undefined}
          onToggleMode={isCreateMode ? undefined : handleToggleMode}
        />
      )}

      {/* Edit mode indicator */}

      {/* Status badge & delete button */}
      {!isCreateMode && place && (
        <div className="flex items-center gap-4 mb-6">
          <span className={cn(
            'inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium',
            place.status === 'active'
              ? 'bg-semantic-success/10 text-semantic-success'
              : 'bg-stone text-ink'
          )}>
            {place.status === 'active' ? 'Active' : 'Deprecated'}
          </span>
          {place.linked_objects_count != null && place.linked_objects_count > 0 && (
            <span className="text-sm text-archive">
              Linked to {place.linked_objects_count} object{place.linked_objects_count !== 1 ? 's' : ''}
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
        {useNewLayout && <SectionGroupDivider label="Overview" icon={MapPin} />}

        {/* Identity */}
        <WorkspaceSection
          id="identity"
          title="Identity"
          icon={<MapPin size={18} />}
          isExpanded={expandedSections.identity}
          onToggle={() => toggleSection('identity')}
          isEditing={isEditing}
          order={getSectionOrder('identity')}
          isEmpty={!hasContent.identity}
          summary={sectionSummaries.identity}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableField
              label="Preferred Name"
              value={formData.preferred_name || ''}
              isEditing={isEditing}
              onChange={(v) => updateField('preferred_name', v)}
              required
              placeholder="e.g., Florence"
              className="md:col-span-2"
            />

            {/* Variant Names */}
            {isEditing ? (
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-ink mb-1.5">
                  Variant Names
                </label>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={variantNameInput}
                    onChange={(e) => setVariantNameInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddVariantName();
                      }
                    }}
                    className="flex-1 px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                    placeholder="Add variant name (e.g., Firenze)..."
                  />
                  <button
                    type="button"
                    onClick={handleAddVariantName}
                    className="px-3 py-2 border border-lichen rounded-lg text-ink hover:bg-stone transition-colors"
                  >
                    <Plus size={16} />
                  </button>
                </div>
                {formData.variant_names && formData.variant_names.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {formData.variant_names.map((name, i) => (
                      <span key={i} className="inline-flex items-center gap-1 px-2 py-1 bg-stone text-ink text-sm rounded-full">
                        {name}
                        <button
                          type="button"
                          onClick={() => handleRemoveVariantName(name)}
                          className="text-archive hover:text-ink"
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ) : formData.variant_names && formData.variant_names.length > 0 ? (
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-archive mb-1.5">
                  Variant Names
                </label>
                <div className="flex flex-wrap gap-2">
                  {formData.variant_names.map((name, i) => (
                    <span key={i} className="px-2 py-0.5 text-xs bg-stone rounded-full text-ink">{name}</span>
                  ))}
                </div>
              </div>
            ) : null}

            <EditableSelect
              label="Place Type"
              value={formData.place_type || 'place'}
              isEditing={isEditing}
              onChange={(v) => updateField('place_type', v)}
              options={PLACE_TYPE_OPTIONS}
            />

            <EditableField
              label="Country Code"
              value={formData.country_code || ''}
              isEditing={isEditing}
              onChange={(v) => updateField('country_code', v)}
              placeholder="e.g., IT"
            />

            <EditableField
              label="Hierarchy Path"
              value={formData.hierarchy_path || ''}
              isEditing={isEditing}
              onChange={(v) => updateField('hierarchy_path', v)}
              placeholder="e.g., Europe > Italy > Tuscany > Florence"
              className="md:col-span-2"
            />
          </div>
        </WorkspaceSection>

        {/* Geographic Location */}
        <WorkspaceSection
          id="location"
          title="Geographic Coordinates"
          icon={<Globe size={18} />}
          isExpanded={expandedSections.location}
          onToggle={() => toggleSection('location')}
          isEditing={isEditing}
          order={getSectionOrder('location')}
          isEmpty={!hasContent.location}
          summary={sectionSummaries.location}
        >
          <div className="space-y-4">
            {/* Coordinate input fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <EditableField
                label="Latitude"
                value={formData.coordinates_lat?.toString() || ''}
                isEditing={isEditing}
                onChange={(v) => updateField('coordinates_lat', v ? parseFloat(v) : null)}
                placeholder="e.g., 43.7696"
                type="number"
              />
              <EditableField
                label="Longitude"
                value={formData.coordinates_lng?.toString() || ''}
                isEditing={isEditing}
                onChange={(v) => updateField('coordinates_lng', v ? parseFloat(v) : null)}
                placeholder="e.g., 11.2558"
                type="number"
              />
            </div>

            {/* Interactive map for editing */}
            {isEditing ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-archive">
                  <Map size={14} />
                  <span>Click on the map to set coordinates, or enter them manually above</span>
                </div>
                <Suspense fallback={
                  <div className="h-[300px] bg-stone rounded-lg animate-pulse flex items-center justify-center">
                    <span className="text-archive">Loading map...</span>
                  </div>
                }>
                  <PointPicker
                    value={
                      formData.coordinates_lat && formData.coordinates_lng
                        ? { latitude: formData.coordinates_lat, longitude: formData.coordinates_lng }
                        : null
                    }
                    onChange={(coords) => {
                      if (coords) {
                        updateField('coordinates_lat', coords.latitude);
                        updateField('coordinates_lng', coords.longitude);
                      } else {
                        updateField('coordinates_lat', null);
                        updateField('coordinates_lng', null);
                      }
                    }}
                    height={300}
                    showCoordinates={false}
                    placeholder="Click to place marker"
                  />
                </Suspense>
              </div>
            ) : (
              // Read-only map preview
              formData.coordinates_lat && formData.coordinates_lng && (
                <Suspense fallback={
                  <div className="h-[200px] bg-stone rounded-lg animate-pulse" />
                }>
                  <LocationPreview
                    latitude={formData.coordinates_lat}
                    longitude={formData.coordinates_lng}
                    name={formData.preferred_name || undefined}
                    height={200}
                    zoom={8}
                  />
                </Suspense>
              )
            )}
          </div>
        </WorkspaceSection>

        {/* === DETAILS GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Details" icon={Globe} />}

        {/* Geographic Area (for regions/excavation sites) */}
        {(formData.place_type === 'region' || formData.place_type === 'site' || formData.place_type === 'district') && (
          <WorkspaceSection
            id="area"
            title="Geographic Area"
            icon={<PenTool size={18} />}
            isExpanded={expandedSections.area}
            onToggle={() => toggleSection('area')}
            isEditing={isEditing}
            order={getSectionOrder('area')}
            isEmpty={!hasContent.area}
            summary={sectionSummaries.area}
          >
            <div className="space-y-2">
              <p className="text-sm text-archive">
                Define the boundary of this {formData.place_type} by drawing a polygon on the map.
              </p>
              {isEditing && (
                <Suspense fallback={
                  <div className="h-[400px] bg-stone rounded-lg animate-pulse flex items-center justify-center">
                    <span className="text-archive">Loading map...</span>
                  </div>
                }>
                  <AreaDrawer
                    value={null}
                    onChange={(polygon) => {
                      if (!orgId || !placeAuthorityId || !polygon) return;
                      updatePlaceGeometry(orgId, placeAuthorityId, {
                        type: 'polygon',
                        coordinates: polygon.coordinates,
                      }).then(() => {
                        queryClient.invalidateQueries({ queryKey: ['place-authority', orgId, placeAuthorityId] });
                      }).catch(() => {
                        // Error handled by mutation
                      });
                    }}
                    height={400}
                  />
                </Suspense>
              )}
            </div>
          </WorkspaceSection>
        )}

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
              label="TGN ID"
              value={formData.tgn_id || ''}
              isEditing={isEditing}
              onChange={(v) => updateField('tgn_id', v)}
              placeholder="e.g., 7000457"
            />
            <EditableField
              label="GeoNames ID"
              value={formData.geonames_id || ''}
              isEditing={isEditing}
              onChange={(v) => updateField('geonames_id', v)}
              placeholder="e.g., 3176959"
            />
            <EditableField
              label="Wikidata ID"
              value={formData.wikidata_id || ''}
              isEditing={isEditing}
              onChange={(v) => updateField('wikidata_id', v)}
              placeholder="e.g., Q2044"
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
        {hasPermission('org.view_audit_logs') && !isCreateMode && orgId && placeAuthorityId && (
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
              entityType="place_authority"
              entityId={placeAuthorityId}
            />
          </WorkspaceSection>
        )}
      </div>

      {/* Footer metadata */}
      {!isCreateMode && place && place.created_at && (
        <div className="mt-8 pt-6 border-t border-lichen text-sm text-archive">
          <p>Created: {formatDateTime(place.created_at)}</p>
          {place.updated_at && (
            <p>Last updated: {formatDateTime(place.updated_at)}</p>
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
        title="Delete Place Authority"
        message={<>Are you sure you want to delete <strong>{formData.preferred_name || 'this place authority'}</strong>? This action cannot be undone.</>}
        confirmText="Delete"
        confirmStyle="danger"
      />

      {/* CreateTaskSlideOver */}
      {orgId && placeAuthorityId && place && (
        <CreateTaskSlideOver
          isOpen={dialogs.showCreateTask}
          onClose={() => dialogs.setShowCreateTask(false)}
          orgId={orgId}
          initialEntityType={"place_authority" as React.ComponentProps<typeof CreateTaskSlideOver>['initialEntityType']}
          initialEntityId={placeAuthorityId}
          initialEntityLabel={place.preferred_name || `Place ${placeAuthorityId.slice(0, 8)}`}
        />
      )}
    </div>
  );

  // New layout with RecordDetailPageWrapper
  if (useNewLayout && place) {
    return (
      <WorkspaceErrorBoundary
        backUrl={`/organizations/${orgId}/collections/vocabularies`}
        backLabel="Back to Vocabularies"
      >
        <RecordDetailPageWrapper
          object={null}
          media={[]}
          sectionIds={ALL_SECTION_IDS}
          sectionGroups={PLACE_AUTHORITY_SECTION_GROUPS}
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
          pageType="place-authority"
          enabled={true}
          showHeader={true}
          title="Place Authority"
          objectNumber={place.place_type || undefined}
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
