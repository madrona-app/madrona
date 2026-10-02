import { useState, useEffect, useLayoutEffect, useCallback, useMemo, Fragment, type ReactNode } from 'react';
import { useNavigate, useSearchParams, useLocation, useParams } from 'react-router-dom';
import { formatDateTime } from '@/lib/formatters';
import {
  Shield,
  X,
  ZoomIn,
  ListTodo,
  History,
  Globe,
  Eye,
  SlidersHorizontal,
} from 'lucide-react';
import { deleteCollectionObject, toggleObjectDiscoverable } from '../../../lib/api';
import { useResolvedLayout } from '@/lib/layout/useResolvedLayout';
import { LayoutCustomizerSlideOver } from '@/components/workspace/LayoutCustomizerSlideOver';
import { DiscoverPreviewModal } from '../../../components/collections/DiscoverPreviewModal';
import { useMutation } from '@tanstack/react-query';
import type { CollectionObject } from '../../../lib/schemas';
import type { WithFieldAccess } from '../../../lib/schemas/entities';
import {
  WorkspaceHeader,
  RecordAuditHistory,
  WorkspaceSection,
  SectionGroupDivider,
  ReadOnlyBanner,
} from '../../../components/workspace';
import { PartsLocationSummary } from '../../../components/collections/PartsLocationSummary';
import { RecordMovementSlideOver } from '../../../components/collections/RecordMovementSlideOver';
import {
  ConditionReportSlideOver,
  IncidentReportSlideOver,
  ConservationSlideOver,
  ValuationSlideOver,
  LoanRequestSlideOver,
  UseRequestSlideOver,
} from '../../../components/collections/ObjectQuickActionSlideOvers';
import { cn } from '../../../lib/utils';
import { useWork } from '../../../contexts/WorkContext';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { RecordDetailPageWrapper, SectionOrderProvider } from '../../../components/record-detail';
import { useWorkspacePage } from '../../../hooks/useWorkspacePage';
import { AddToWorkspaceDialog } from '../../../components/workspaces';
import { useAuth } from '../../../hooks/useAuth';
import { ObjectActionBar } from '../../../components/work/QuickActions';
import { StartProcedure } from '../../../components/studio/StartProcedure';
import { CreateTaskSlideOver } from '../../../components/work/CreateTaskSlideOver';
import { GenerateReportSlideOver } from '../../../components/reports/GenerateReportSlideOver';
import { ProcedureRequirementsCard } from '../../../components/collections/ProcedureRequirementsCard';
import { useProcedureRequirements } from '../../../hooks/useProcedureRequirements';
import { getDisplayTitle, getCreatorDisplay } from '../../../components/collections/ObjectFieldComponents';

// Import hooks
import {
  useCollectionObjectData,
  useMediaMutations,
  useFormState,
  useSectionState,
  useSectionSummaries,
  useHasContent,
} from './hooks';

// Import section components
import { IdentificationSection } from './IdentificationSection';
import { DescriptionSection } from './DescriptionSection';
import { PhysicalSection } from './PhysicalSection';
import { MediaSection } from './MediaSection';
import IIIFViewer from '../../../components/IIIFViewer';
import { LocationSection } from './LocationSection';
import {
  PeopleSection,
  PlacesSection,
  StylePeriodsSection,
  SubjectsSection,
  RelatedObjectsSection,
  CitationsSection,
  EventsSection,
} from './RelationshipsSection';
import { PAGE_SECTION_GROUPS, NAGPRA_RELEVANT_CLASSIFICATIONS } from './types';
import {
  ConditionSection,
  RightsSection,
  NagpraSection,
  AcquisitionSection,
  ValuationsSection,
  ProceduresSection,
  PartsSection,
} from './AdminSections';
import { MadronaLoader } from '../../../components/ui/MadronaLoader';

/**
 * Outer wrapper that provides section order context.
 * This must be outside the inner component so useSectionOrder can access the context.
 */
export default function CollectionObjectWorkspacePage() {
  return (
    <SectionOrderProvider>
      <CollectionObjectWorkspacePageContent />
    </SectionOrderProvider>
  );
}

/**
 * Inner component with all the logic and hooks.
 * Wrapped by SectionOrderProvider so useSectionOrder works correctly.
 */
function CollectionObjectWorkspacePageContent() {
  const { orgId: routeOrgId } = useParams<{ orgId: string }>();
  const { requirementGroups: inventoryGroups } = useProcedureRequirements('inventory', routeOrgId);
  const { requirementGroups: catalogingGroups } = useProcedureRequirements('cataloging', routeOrgId);
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { hasAppAccess } = useAuth();
  const { setActiveObject } = useWork();
  const hasDiscoverApp = hasAppAccess('discover');
  const hasMediaApp = hasAppAccess('media');

  // Data fetching
  const {
    orgId,
    objectId,
    isCreateMode,
    object,
    isLoading,
    error,
    valuationsData,
    proceduresData,
    rightsData,
    linkedMedia,
    isLoadingMedia,
    queryClient,
  } = useCollectionObjectData();

  const wp = useWorkspacePage({
    entityType: 'collection_object',
    entityId: objectId,
    entityLabel: object?.object_number,
    orgId,
    editPermission: 'collections.edit',
    restrictedFields: (object as WithFieldAccess | undefined)?._restricted_fields,
  });
  const { isEditing, setIsEditing, useNewLayout, canEdit, isRestricted, hasPermission, dialogs } = wp;

  // Mode state
  const isEditPath = location.pathname.endsWith('/edit') || location.pathname.endsWith('/create');
  const [showReportSlideOver, setShowReportSlideOver] = useState(false);

  // Form state and autosave
  const {
    formData,
    saveStatus,
    errorMessage,
    setErrorMessage,
    lastSaved,
    hasUnsavedChanges,
    updateField,
    updateFieldSilent,
    handleFieldBlur,
    performSave,
  } = useFormState(object, isCreateMode, isEditing, orgId, objectId, navigate);

  // Section state (with smart auto-expand data)
  const smartExpandData = useMemo(() => ({
    linkedMedia,
    valuationsData,
    rightsData,
  }), [linkedMedia, valuationsData, rightsData]);

  const {
    expandedSections,
    setExpandedSections,
    raisedSectionId: _raisedSectionId,
    sectionRefs,
    lowerAllSections,
    raiseSection: raiseSectionBase,
    toggleSection: toggleSectionBase,
  } = useSectionState(object, isCreateMode, smartExpandData);

  // Section summaries (richer hints for collapsed cards)
  const sectionSummaries = useSectionSummaries(object, linkedMedia, valuationsData, proceduresData, rightsData);

  // Has content checks (extended to all sections)
  const hasContent = useHasContent(object, linkedMedia, valuationsData, rightsData);

  // NAGPRA visibility: react to live classification edits, not just saved data
  const liveClassifications = formData?.classifications || object?.classifications || [];
  const showNagpra = !isCreateMode && !!objectId && (
    liveClassifications.some((c) =>
      NAGPRA_RELEVANT_CLASSIFICATIONS.has(c.value_key || '') ||
      NAGPRA_RELEVANT_CLASSIFICATIONS.has((c.term || '').toLowerCase().replace(/\s+/g, '_'))
    ) ||
    hasContent.nagpra
  );

  // Resolve the user's active layout override (delta) over the base layout,
  // then drop NAGPRA when not applicable. effectiveGroups drives BOTH the body
  // render (order + visibility) and the nav, so the two can't drift.
  const view = useResolvedLayout(PAGE_SECTION_GROUPS, 'collection-object');

  const effectiveGroups = useMemo(() => {
    const groups = showNagpra
      ? view.groups
      : view.groups.map((group) => ({
          ...group,
          sections: group.sections.filter((s) => s.id !== 'nagpra'),
        }));
    return groups.filter((group) => group.sections.length > 0);
  }, [view.groups, showNagpra]);

  const filteredSectionGroups = effectiveGroups;
  const filteredSectionIds = useMemo(
    () => effectiveGroups.flatMap((group) => group.sections.map((s) => s.id)),
    [effectiveGroups],
  );

  // CSS flex `order` for each section card, derived from the resolved layout so
  // a reordered override shows in the body (cards sit in a flex column and set
  // an explicit `order`). Unknown ids sort last.
  const orderOf = useCallback(
    (sectionId: string): number => {
      const idx = filteredSectionIds.indexOf(sectionId);
      return idx === -1 ? 999 : idx;
    },
    [filteredSectionIds],
  );

  // Media mutations
  const {
    linkMediaMutation,
    unlinkMediaMutation,
    setPrimaryMediaMutation,
    updateMediaLinkMutation,
  } = useMediaMutations(orgId, objectId);

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: () => deleteCollectionObject(orgId!, objectId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collection-objects-db', orgId] });
      queryClient.invalidateQueries({ queryKey: ['collections-search', orgId] });
      queryClient.invalidateQueries({ queryKey: ['collection-objects', orgId] });
      navigate(`/organizations/${orgId}/collections/objects`, { replace: true });
    },
  });

  // UI state for slide-overs
  const [showIIIFViewer, setShowIIIFViewer] = useState(false);
  const [showMovementSlideOver, setShowMovementSlideOver] = useState(false);
  const [showConditionReportSlideOver, setShowConditionReportSlideOver] = useState(false);
  const [showIncidentSlideOver, setShowIncidentSlideOver] = useState(false);
  const [showConservationSlideOver, setShowConservationSlideOver] = useState(false);
  const [showValuationSlideOver, setShowValuationSlideOver] = useState(false);
  const [showLayoutCustomizer, setShowLayoutCustomizer] = useState(false);
  const [showLoanRequestSlideOver, setShowLoanRequestSlideOver] = useState(false);
  const [showUseRequestSlideOver, setShowUseRequestSlideOver] = useState(false);
  const [showDiscoverPreview, setShowDiscoverPreview] = useState(false);
  const [togglingDiscoverable, setTogglingDiscoverable] = useState(false);

  const handleToggleDiscoverable = useCallback(async () => {
    if (togglingDiscoverable || !orgId || !objectId || !object) return;
    setTogglingDiscoverable(true);
    const newValue = !object.is_discoverable;
    // Optimistic update
    queryClient.setQueryData(['collection-object', orgId, objectId], (old: any) =>
      old ? { ...old, is_discoverable: newValue } : old
    );
    try {
      const result = await toggleObjectDiscoverable(orgId, objectId, newValue);
      // Apply server response to cache
      queryClient.setQueryData(['collection-object', orgId, objectId], (old: any) =>
        old ? { ...old, is_discoverable: result.is_discoverable, discoverable_at: result.discoverable_at } : old
      );
    } catch {
      // Revert on error
      queryClient.setQueryData(['collection-object', orgId, objectId], (old: any) =>
        old ? { ...old, is_discoverable: !newValue } : old
      );
    } finally {
      setTogglingDiscoverable(false);
    }
  }, [togglingDiscoverable, orgId, objectId, object, queryClient]);

  // Wrap section helpers
  const raiseSection = useCallback((sectionId: string) => {
    raiseSectionBase(sectionId, isEditing, isCreateMode, canEdit, setIsEditing, setSearchParams);
  }, [raiseSectionBase, isEditing, isCreateMode, canEdit, setSearchParams]);

  const toggleSection = useCallback((sectionId: string) => {
    // If section is already expanded and not editing, enter edit mode instead of collapsing
    if (expandedSections[sectionId] && !isEditing && !isCreateMode && canEdit) {
      setExpandedSections(prev => {
        const newState: Record<string, boolean> = {};
        Object.keys(prev).forEach(key => { newState[key] = key === sectionId; });
        return newState;
      });
      raiseSection(sectionId);
    } else {
      toggleSectionBase(sectionId, raiseSection);
    }
  }, [toggleSectionBase, raiseSection, expandedSections, isEditing, isCreateMode, canEdit, setExpandedSections]);

  const handleEnterEditMode = useCallback((sectionId: string) => {
    setExpandedSections(prev => {
      const newState: Record<string, boolean> = {};
      Object.keys(prev).forEach(key => {
        newState[key] = key === sectionId;
      });
      return newState;
    });
    raiseSection(sectionId);
  }, [raiseSection, setExpandedSections]);

  const toggleMode = useCallback(() => {
    if (isEditing && hasUnsavedChanges) {
      performSave();
    }
    const newMode = !isEditing;
    setIsEditing(newMode);

    if (newMode) {
      setSearchParams({ mode: 'edit' }, { replace: true });
    } else {
      lowerAllSections();
      if (isEditPath) {
        navigate(`/organizations/${orgId}/collections/objects/${objectId}`, { replace: true });
      } else {
        setSearchParams({}, { replace: true });
      }
      queryClient.invalidateQueries({ queryKey: ['collection-object', orgId, objectId] });
    }
  }, [isEditing, hasUnsavedChanges, performSave, setSearchParams, queryClient, orgId, objectId, isEditPath, navigate, lowerAllSections]);

  // Scroll to top when navigating
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [objectId]);

  // Set active object when viewing
  useEffect(() => {
    if (object && objectId) {
      const displayTitle = getDisplayTitle(object);
      setActiveObject({
        object_id: objectId,
        accession_number: object.object_number || '',
        title: displayTitle,
        thumbnail_url: object.primary_image_url,
      });
    }
  }, [object, objectId, setActiveObject]);

  // Handle URL action parameters
  useEffect(() => {
    const action = searchParams.get('action');
    if (action && object) {
      const actionToSection: Record<string, string> = {
        relate: 'relationships',
      };
      const section = actionToSection[action];
      if (section) {
        setExpandedSections(prev => ({ ...prev, [section]: true }));
        setTimeout(() => {
          sectionRefs.current[section]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
        const newParams = new URLSearchParams(searchParams);
        newParams.delete('action');
        setSearchParams(newParams, { replace: true });
      }
    }
  }, [searchParams, setSearchParams, object, setExpandedSections, sectionRefs]);

  // Dialog state — must be before early returns to satisfy Rules of Hooks.
  const [showAddToWorksetDialog, setShowAddToWorksetDialog] = useState(false);

  // Redirect to list if record not found (deleted, bad ID, etc.)
  useEffect(() => {
    if (!isCreateMode && error) {
      navigate(`/organizations/${orgId}/collections/objects`, { replace: true });
    }
  }, [isCreateMode, error, orgId, navigate]);

  // Loading state
  if (!isCreateMode && isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <MadronaLoader label="Loading…" />
      </div>
    );
  }

  if (!isCreateMode && error) return null;

  // Guard for data requirements — object may briefly be null during query refetch
  if (!isCreateMode && !object) return null;
  if (isCreateMode && !formData) return null;

  const obj = object ?? ({} as CollectionObject);

  // Get display values
  const displayTitle = isCreateMode
    ? (formData?.object_name || formData?.object_number || 'New Object')
    : getDisplayTitle(obj);
  const displayObjectNumber = isCreateMode ? (formData?.object_number || '') : obj.object_number;
  const displayDate = isCreateMode ? formData?.creation_date_display : obj.creation_date_display;
  const displayThumbnail = isCreateMode ? null : obj.primary_image_url;

  const handleDelete = () => dialogs.setShowDeleteConfirm(true);

  // Quick action callbacks
  const quickActionCallbacks = {
    onCreateTask: () => dialogs.setShowCreateTask(true),
    onGenerateReport: () => setShowReportSlideOver(true),
    onDelete: handleDelete,
    onMovementClick: () => setShowMovementSlideOver(true),
    onConditionReportClick: () => setShowConditionReportSlideOver(true),
    onIncidentClick: () => setShowIncidentSlideOver(true),
    onConservationClick: () => setShowConservationSlideOver(true),
    onValuationClick: () => setShowValuationSlideOver(true),
    onLoanRequestClick: () => setShowLoanRequestSlideOver(true),
    onUseRequestClick: () => setShowUseRequestSlideOver(true),
    onAddToWorkset: () => setShowAddToWorksetDialog(true),
  };

  // Common props for sections
  const baseSectionProps = {
    orgId: orgId!,
    objectId: objectId ?? '',
    isEditing,
    isCreateMode,
    formData,
    object: obj,
    updateField,
    updateFieldSilent,
    handleFieldBlur,
    expandedSections,
    toggleSection,
    sectionRefs,
    getSectionOrder: orderOf,
    sectionSummaries,
    isRestricted,
  };

  // Section card by id. The body renders these by mapping over effectiveGroups
  // (resolved layout), so hide/show + reorder follow the saved variant without
  // hand-maintaining a card sequence. Sections gated by other state (media,
  // location, parts, history) keep their own guard and render null when off.
  const sectionContent: Record<string, ReactNode> = {
    media:
      !isCreateMode && objectId && object ? (
        <MediaSection
          orgId={orgId!}
          objectId={objectId}
          object={object}
          isEditing={isEditing}
          isCreateMode={isCreateMode}
          linkedMedia={linkedMedia}
          isLoadingMedia={isLoadingMedia}
          expandedSections={expandedSections}
          toggleSection={toggleSection}
          sectionRefs={sectionRefs}
          getSectionOrder={orderOf}
          isEmpty={!hasContent.media}
          sectionSummaries={sectionSummaries}
          hasMediaApp={hasMediaApp}
          onLinkMedia={async (params) => { await linkMediaMutation.mutateAsync(params); }}
          onUnlinkMedia={async (mediaId) => { await unlinkMediaMutation.mutateAsync(mediaId); }}
          onSetPrimary={async (mediaId) => { await setPrimaryMediaMutation.mutateAsync(mediaId); }}
          onUpdateLink={async (mediaId, updates) => { await updateMediaLinkMutation.mutateAsync({ mediaId, updates }); }}
        />
      ) : null,
    identification: <IdentificationSection {...baseSectionProps} isEmpty={!hasContent.identification} />,
    description: <DescriptionSection {...baseSectionProps} isEmpty={!hasContent.description} />,
    physical: <PhysicalSection {...baseSectionProps} isEmpty={!hasContent.physical} />,
    stylePeriods: <StylePeriodsSection {...baseSectionProps} isEmpty={!hasContent.stylePeriods} />,
    subjects: <SubjectsSection {...baseSectionProps} isEmpty={!hasContent.subjects} />,
    people: <PeopleSection {...baseSectionProps} isEmpty={!hasContent.people} />,
    places: <PlacesSection {...baseSectionProps} isEmpty={!hasContent.places} />,
    relationships: <RelatedObjectsSection {...baseSectionProps} isEmpty={!hasContent.relationships} />,
    citations: <CitationsSection {...baseSectionProps} isEmpty={!hasContent.citations} />,
    events: <EventsSection {...baseSectionProps} isEmpty={!hasContent.events} />,
    condition: <ConditionSection {...baseSectionProps} isEmpty={!hasContent.condition} />,
    location:
      !isCreateMode && object ? (
        <LocationSection
          orgId={orgId!}
          object={object}
          formData={formData}
          isEditing={isEditing}
          isCreateMode={isCreateMode}
          updateField={updateField}
          handleFieldBlur={handleFieldBlur}
          onMovementClick={() => setShowMovementSlideOver(true)}
          sectionHint={sectionSummaries.location || ''}
          isEmpty={!hasContent.location}
          expandedSections={expandedSections}
          toggleSection={toggleSection}
          sectionRefs={sectionRefs}
          getSectionOrder={orderOf}
        />
      ) : null,
    rights: <RightsSection {...baseSectionProps} isEmpty={!hasContent.rights} />,
    nagpra: <NagpraSection {...baseSectionProps} isEmpty={!hasContent.nagpra} />,
    acquisition: <AcquisitionSection {...baseSectionProps} isEmpty={!hasContent.acquisition} />,
    valuations: <ValuationsSection {...baseSectionProps} valuationsData={valuationsData} isEmpty={!hasContent.valuations} onAddValuation={() => setShowValuationSlideOver(true)} />,
    procedures: <ProceduresSection {...baseSectionProps} isEmpty={!hasContent.procedures} />,
    parts: object ? <PartsSection {...baseSectionProps} object={object} isEmpty={!hasContent.parts} /> : null,
    history:
      hasPermission('org.view_audit_logs') && !isCreateMode && orgId && objectId ? (
        <WorkspaceSection
          id="history"
          title="Change History"
          icon={<History size={18} />}
          isExpanded={expandedSections.history}
          onToggle={() => toggleSection('history')}
          isEditing={isEditing}
          sectionRef={(el) => { sectionRefs.current['history'] = el; }}
          order={orderOf('history')}
        >
          <RecordAuditHistory
            organizationId={orgId}
            entityType="collection_object"
            entityId={objectId}
          />
        </WorkspaceSection>
      ) : null,
  };

  // Page content
  const pageContent = (
    <div className={cn(useNewLayout ? '' : 'p-6 max-w-4xl mx-auto')}>
      {/* Header with mode toggle - hide when using new layout */}
      {!useNewLayout && (
        <WorkspaceHeader
          backUrl={`/organizations/${orgId}/collections/objects`}
          backText="Back to Collection"
          thumbnailUrl={displayThumbnail}
          title={displayTitle}
          objectNumber={displayObjectNumber}
          creator={isCreateMode ? null : getCreatorDisplay(object!)}
          date={displayDate}
          locationInfo={(object?.parts && object.parts.length > 1) ? null : (object?.current_location ? {
            name: object.current_location.path || object.current_location.name,
            isOnDisplay: object.current_location.on_display,
          } : null)}
          partsLocationSummary={(object?.parts && object.parts.length > 1) ? (
            <PartsLocationSummary parts={object.parts} />
          ) : undefined}
          isEditing={isEditing}
          onToggleMode={isCreateMode ? undefined : toggleMode}
          saveStatus={saveStatus}
          hasUnsavedChanges={hasUnsavedChanges}
          lastSaved={lastSaved}
          onImageClick={displayThumbnail ? () => setShowIIIFViewer(true) : undefined}
          onSave={isCreateMode ? performSave : undefined}
          showCreateButton={isCreateMode}
        />
      )}

      {/* Quick Actions Bar - hide when using new layout */}
      {!useNewLayout && !isCreateMode && !isEditing && objectId && object?.object_number && (
        <div className="mb-4 flex items-center gap-2 flex-wrap">
          <ObjectActionBar
            objectId={objectId}
            accessionNumber={obj.object_number}
            onConditionReportClick={() => setShowConditionReportSlideOver(true)}
            onMovementClick={() => setShowMovementSlideOver(true)}
            onIncidentClick={() => setShowIncidentSlideOver(true)}
            onConservationClick={() => setShowConservationSlideOver(true)}
            onValuationClick={() => setShowValuationSlideOver(true)}
            onLoanRequestClick={() => setShowLoanRequestSlideOver(true)}
            onUseRequestClick={() => setShowUseRequestSlideOver(true)}
          />
          <button
            onClick={() => dialogs.setShowCreateTask(true)}
            className="flex items-center gap-2 px-3 py-1.5 border border-lichen rounded-lg text-sm text-ink hover:bg-stone transition-colors"
          >
            <ListTodo size={16} />
            Create Task
          </button>

          {/* Public Discovery Toggle - compact inline version */}
          {hasDiscoverApp && (
            <div className="ml-auto flex items-center gap-2 text-sm">
              <Globe size={16} className={object.is_discoverable ? 'text-bark' : 'text-archive'} />
              <span className="text-archive">Public</span>
              <button
                onClick={() => setShowDiscoverPreview(true)}
                className="p-1 text-archive hover:text-bark transition-colors rounded"
                title="Preview public view"
              >
                <Eye size={14} />
              </button>
              <button
                onClick={handleToggleDiscoverable}
                disabled={togglingDiscoverable}
                className={cn(
                  'relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2',
                  togglingDiscoverable && 'opacity-50',
                  object.is_discoverable ? 'bg-bark' : 'bg-stone'
                )}
                title={object.is_discoverable ? 'Visible on public collection page' : 'Hidden from public collection page'}
              >
                <span
                  className={cn(
                    'inline-block h-3.5 w-3.5 transform rounded-full bg-parchment transition-transform shadow-sm',
                    object.is_discoverable ? 'translate-x-5' : 'translate-x-0.5'
                  )}
                />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Guided (Studio) procedures for this object — deterministic, object-scoped
          plans (loan-out, deaccession, conservation, loan-in). Renders in both
          layouts; the object id is supplied from context, so each runs in hand. */}
      {!isCreateMode && !isEditing && objectId && (
        <div className="mb-4">
          <StartProcedure
            requiresContext="object_id"
            contextEntityType="collection_object"
            contextEntityId={objectId}
            label="Start guided procedure"
          />
        </div>
      )}

      {/* Rights Status Banner */}
      {!isCreateMode && sectionSummaries.rights && (
        <div className="mb-4 p-4 bg-semantic-warning/10 border border-semantic-warning/30 rounded-lg flex items-center gap-3">
          <Shield size={20} className="text-semantic-warning flex-shrink-0" />
          <div className="flex-1">
            <p className="font-medium text-semantic-warning">Rights Status: {sectionSummaries.rights}</p>
            <p className="text-sm text-semantic-warning/80">
              Review and resolve rights before reproducing or lending this object.
            </p>
          </div>
          <button
            onClick={() => {
              setExpandedSections(prev => ({ ...prev, rights: true }));
              sectionRefs.current['rights']?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            className="px-3 py-1.5 text-sm font-medium text-semantic-warning border border-semantic-warning/50 rounded-lg hover:bg-semantic-warning/10 transition-colors"
          >
            Review Rights
          </button>
        </div>
      )}

      {/* Primary Image - Always visible, above workflows for visual context */}
      {!isCreateMode && displayThumbnail && (
        <div className="mb-6">
          <div
            className="relative rounded-lg overflow-hidden bg-stone cursor-pointer group"
            onClick={() => setShowIIIFViewer(true)}
          >
            <img
              src={displayThumbnail}
              alt={displayTitle}
              className="w-full h-auto max-h-[60vh] object-contain opacity-0 transition-opacity duration-200"
              onLoad={(e) => { (e.target as HTMLImageElement).classList.remove('opacity-0'); }}
            />
            <div className="absolute inset-0 bg-ink/0 group-hover:bg-ink/10 transition-colors flex items-center justify-center">
              <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                <ZoomIn size={32} className="text-parchment drop-shadow-lg" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Procedure Compliance */}
      {!isCreateMode && object && (
        <>
          <ProcedureRequirementsCard
            title="Inventory"
            requirementGroups={inventoryGroups}
            record={object as unknown as Record<string, unknown>}
            currentStatus="current"
            statusOrder={['current', 'inventory_complete']}
            onSectionNavigate={handleEnterEditMode}
            defaultExpanded={false}
            readyMessage="Inventory complete"
          />
          <ProcedureRequirementsCard
            title="Cataloging"
            requirementGroups={catalogingGroups}
            record={object as unknown as Record<string, unknown>}
            currentStatus="current"
            statusOrder={['current', 'cataloging_complete']}
            onSectionNavigate={handleEnterEditMode}
            defaultExpanded={false}
            readyMessage="Cataloging complete"
          />
        </>
      )}

      {/* Error message */}
      {errorMessage && (
        <div className="mb-4 p-4 bg-semantic-error/10 border border-semantic-error/30 rounded-lg flex items-start gap-3">
          <div className="text-semantic-error flex-1">
            <p className="font-medium">Error</p>
            <p className="text-sm">{errorMessage}</p>
          </div>
          <button
            onClick={() => setErrorMessage(null)}
            className="text-semantic-error hover:text-semantic-error/80"
          >
            <X size={18} />
          </button>
        </div>
      )}

      {/* Read-only indicator */}
      <ReadOnlyBanner visible={!isCreateMode && !canEdit} />

      {/* Layout customization trigger */}
      {!isCreateMode && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setShowLayoutCustomizer(true)}
            className="btn-tertiary text-sm flex items-center gap-1.5"
          >
            <SlidersHorizontal size={15} />
            Customize layout
          </button>
        </div>
      )}

      {/* Sections Container */}
      <div className="flex flex-col gap-4">
        {effectiveGroups.map((group, groupIndex) => (
          <Fragment key={group.id}>
            {/* First rendered group has no divider (matches the prior layout) */}
            {useNewLayout && groupIndex > 0 && (
              <SectionGroupDivider label={group.label} icon={group.icon} />
            )}
            {group.sections.map((section) => (
              <Fragment key={section.id}>{sectionContent[section.id] ?? null}</Fragment>
            ))}
          </Fragment>
        ))}
      </div>

      {/* Footer metadata */}
      {!isCreateMode && obj && (
        <div className="mt-8 pt-6 border-t border-lichen text-sm text-archive">
          <p>Created: {formatDateTime(obj.created_at)}</p>
          {obj.updated_at && (
            <p>Last updated: {formatDateTime(obj.updated_at)}</p>
          )}
        </div>
      )}

      {/* Quick Action SlideOvers */}
      <RecordMovementSlideOver
        isOpen={showMovementSlideOver}
        onClose={() => setShowMovementSlideOver(false)}
        organizationId={orgId!}
        objectId={objectId!}
        objectNumber={object?.object_number}
        objectTitle={displayTitle}
        currentLocationId={object?.current_location_id}
        currentLocationName={object?.current_location?.path || object?.current_location?.name}
        homeLocationId={object?.home_location_id}
        homeLocationName={object?.home_location?.path || object?.home_location?.name}
        parts={object?.parts?.length && object.parts.length > 1 ? object.parts.map(p => ({
          part_id: p.part_id,
          part_number: p.part_number ?? null,
          name: p.name ?? null,
          current_location_id: p.current_location_id ?? null,
          current_location_name: p.current_location_name ?? null,
          current_location_path: p.current_location_path ?? null,
        })) : undefined}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['object-movements', orgId, objectId] });
          queryClient.invalidateQueries({ queryKey: ['collection-object', orgId, objectId] });
          queryClient.invalidateQueries({ queryKey: ['object-parts', orgId, objectId] });
        }}
      />

      <ConditionReportSlideOver
        isOpen={showConditionReportSlideOver}
        onClose={() => setShowConditionReportSlideOver(false)}
        organizationId={orgId!}
        objectId={objectId!}
        objectNumber={object?.object_number}
        objectTitle={displayTitle}
      />

      <IncidentReportSlideOver
        isOpen={showIncidentSlideOver}
        onClose={() => setShowIncidentSlideOver(false)}
        organizationId={orgId!}
        objectId={objectId!}
        objectNumber={object?.object_number}
        objectTitle={displayTitle}
      />

      <ConservationSlideOver
        isOpen={showConservationSlideOver}
        onClose={() => setShowConservationSlideOver(false)}
        organizationId={orgId!}
        objectId={objectId!}
        objectNumber={object?.object_number}
        objectTitle={displayTitle}
      />

      <ValuationSlideOver
        isOpen={showValuationSlideOver}
        onClose={() => setShowValuationSlideOver(false)}
        organizationId={orgId!}
        objectId={objectId!}
        objectNumber={object?.object_number}
        objectTitle={displayTitle}
      />

      <LayoutCustomizerSlideOver
        isOpen={showLayoutCustomizer}
        onClose={() => setShowLayoutCustomizer(false)}
        surfaceKey="collection-object"
        groups={PAGE_SECTION_GROUPS}
      />

      <LoanRequestSlideOver
        isOpen={showLoanRequestSlideOver}
        onClose={() => setShowLoanRequestSlideOver(false)}
        organizationId={orgId!}
        objectId={objectId!}
        objectNumber={object?.object_number}
        objectTitle={displayTitle}
      />

      <UseRequestSlideOver
        isOpen={showUseRequestSlideOver}
        onClose={() => setShowUseRequestSlideOver(false)}
        organizationId={orgId!}
        objectId={objectId!}
        objectNumber={object?.object_number}
        objectTitle={displayTitle}
      />

      {/* Create Task Slide-over */}
      {orgId && objectId && object && (
        <CreateTaskSlideOver
          isOpen={dialogs.showCreateTask}
          onClose={() => dialogs.setShowCreateTask(false)}
          orgId={orgId}
          initialEntityType="collection_object"
          initialEntityId={objectId}
          initialEntityLabel={obj.object_number || displayTitle || 'Object'}
        />
      )}

      {/* Generate Report Slide-over */}
      {orgId && objectId && (
        <GenerateReportSlideOver
          isOpen={showReportSlideOver}
          onClose={() => setShowReportSlideOver(false)}
          contextType="record"
          contextParams={{
            record_id: objectId,
            record_type: 'collection_objects',
          }}
          recordType="collection_objects"
        />
      )}

      {/* Add to Work Set Dialog */}
      {objectId && (
        <AddToWorkspaceDialog
          isOpen={showAddToWorksetDialog}
          onClose={() => setShowAddToWorksetDialog(false)}
          objectIds={[objectId]}
          objectLabel={object?.object_number || objectId}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={dialogs.showDeleteConfirm}
        onClose={() => dialogs.setShowDeleteConfirm(false)}
        onConfirm={() => deleteMutation.mutate()}
        title="Delete Object Record"
        message={<>Are you sure you want to delete <strong>{formData?.object_number || 'this object record'}</strong>? This action cannot be undone.</>}
        confirmText="Delete"
        confirmStyle="danger"
      />

      {/* Discover Preview Modal */}
      {showDiscoverPreview && objectId && orgId && (
        <DiscoverPreviewModal
          organizationId={orgId}
          objectId={objectId}
          onClose={() => setShowDiscoverPreview(false)}
          onPublish={async () => {
            try {
              await toggleObjectDiscoverable(orgId, objectId, true);
              queryClient.invalidateQueries({ queryKey: ['collection-object', orgId, objectId] });
              setShowDiscoverPreview(false);
            } catch {
              // Error handled by global handler
            }
          }}
        />
      )}

      {/* IIIF Viewer Modal */}
      {showIIIFViewer && objectId && (
        <IIIFViewer
          manifestUrl={`/api/organizations/${orgId}/iiif/objects/${objectId}/manifest.json`}
          showNavigation={true}
          showInfo={true}
          modal={true}
          onClose={() => setShowIIIFViewer(false)}
        />
      )}
    </div>
  );

  // Return with or without new layout wrapper
  if (useNewLayout && object) {
    return (
      <RecordDetailPageWrapper
        object={{
          object_id: object.object_id,
          object_number: object.object_number,
          object_type: object.object_type,
          object_status: object.object_status,
          current_location: object.current_location ? {
            name: object.current_location.name,
            path: object.current_location.path ?? undefined,
            on_display: object.current_location.on_display ?? undefined,
          } : null,
          primary_image_url: object.primary_image_url,
          titles: object.titles ?? undefined,
        }}
        media={linkedMedia.map(m => ({
          media_id: m.media_id,
          filename: m.media?.filename,
          title: m.media?.title,
          thumbnail_url: m.media?.thumbnail_url ?? undefined,
          url: m.media?.url ?? undefined,
          width: m.media?.width,
          height: m.media?.height,
          is_primary: m.is_primary,
        }))}
        sectionIds={filteredSectionIds}
        sectionGroups={filteredSectionGroups}
        sectionData={{
          identification: {
            object_number: object.object_number,
            titles: object.titles,
            object_name: object.object_name,
            object_type: object.object_type,
            classifications: object.classifications,
            creation_date_display: object.creation_date_display,
            creation_place: object.creation_place,
          },
          media: linkedMedia,
          physical_description: {
            material_count: object.material_count || 0,
            technique_count: object.technique_count || 0,
            measurements: object.measurements,
            inscriptions: object.inscriptions,
          },
          styles_periods: object.style_periods || [],
          subjects: object.subjects,
          people: {
            contacts: object.creators,
            person_authorities: object.person_authorities || [],
          },
          places: object.place_authorities || [],
          related_objects: object.related_objects || [],
          citations: object.citations || [],
          events: [],
          condition: {
            condition_note: object.condition_note,
            completeness: object.completeness,
          },
          location: {
            current_location_id: object.current_location_id,
            home_location_id: object.home_location_id,
          },
          rights: rightsData,
          acquisition: {
            acquisition_method: object.acquisition_method,
            acquisition_date: object.acquisition_date,
            acquisition_source: object.acquisition_source,
          },
          valuations: valuationsData,
          procedures: proceduresData,
          parts: object.parts || [],
        }}
        callbacks={quickActionCallbacks}
        permissions={{
          canCreateTask: true,
          canViewHistory: true,
          canDelete: true,
          canCreateMovement: true,
          canCreateConditionReport: true,
          canCreateLoanRequest: true,
          canCreateIncident: true,
          canCreateUseRequest: true,
          canCreateConservation: true,
          canCreateValuation: true,
          canGenerateReport: true,
          canAddToWorkset: !isCreateMode,
        }}
        onSectionNavigate={handleEnterEditMode}
        pageType="collection-object"
        enabled={true}
        showHeader={true}
        title={displayTitle}
        subtitle={obj.brief_description || undefined}
        backUrl={`/organizations/${orgId}/collections/objects`}
        backLabel="Back to Collection"
        isDiscoverable={hasDiscoverApp ? (object.is_discoverable ?? false) : undefined}
        onToggleDiscoverable={hasDiscoverApp ? handleToggleDiscoverable : undefined}
        onImageClick={displayThumbnail ? () => setShowIIIFViewer(true) : undefined}
      >
        {pageContent}
      </RecordDetailPageWrapper>
    );
  }

  return pageContent;
}
