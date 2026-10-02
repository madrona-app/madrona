import { useLayoutEffect, useCallback } from 'react';
import { useNavigate, Link, useSearchParams, useLocation } from 'react-router-dom';
import { formatDateTime } from '@/lib/formatters';
import {
  User,
  Trash2,
  History,
  MessageSquare,
  Mail,
  Globe,
  Shield,
  X,
  ListTodo,
  Image,
} from 'lucide-react';
import {
  WorkspaceHeader,
  WorkspaceSection,
  RecordAuditHistory,
  SectionGroupDivider,
  ReadOnlyBanner,
} from '../../../components/workspace';
import { cn } from '../../../lib/utils';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { RecordDiscussionTab } from '../../../components/RecordDiscussionTab';
import { useWorkspacePage } from '../../../hooks/useWorkspacePage';
import type { WithFieldAccess } from '../../../lib/schemas/entities';
import { RecordDetailPageWrapper, SectionOrderProvider } from '../../../components/record-detail';
import { CreateTaskSlideOver } from '../../../components/work/CreateTaskSlideOver';

// Hooks
import {
  useConstituentData,
  useConstituentFormState,
  useSectionState,
  useSectionSummaries,
  useHasContent,
  useUlanSearch,
  useAuthoritySearch,
} from './hooks';

// Section components
import { IdentitySection } from './IdentitySection';
import { ContactSection } from './ContactSection';
import { BiographySection } from './BiographySection';
import { ExternalIdsSection } from './ExternalIdsSection';
import { AdminSection } from './AdminSection';
import { MediaSection } from './MediaSection';

// Types & constants
import { PAGE_SECTION_GROUPS, CONSTITUENT_TYPE_OPTIONS, CONSTITUENT_TYPE_ICONS } from './types';
import { MadronaLoader } from '../../../components/ui/MadronaLoader';

/**
 * Outer wrapper that provides section order context.
 */
export default function ConstituentWorkspacePage() {
  return (
    <SectionOrderProvider>
      <ConstituentWorkspacePageContent />
    </SectionOrderProvider>
  );
}

/**
 * Inner component with all the logic and hooks.
 */
function ConstituentWorkspacePageContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const [, setSearchParams] = useSearchParams();

  // Data fetching
  const {
    orgId,
    constituentId,
    isCreateMode,
    constituent,
    isLoading,
    error,
  } = useConstituentData();

  const wp = useWorkspacePage({
    entityType: 'constituent',
    entityId: constituentId,
    entityLabel: constituent?.name,
    orgId,
    editPermission: 'constituents.edit',
    restrictedFields: (constituent as WithFieldAccess | undefined)?._restricted_fields,
  });
  const { isEditing, setIsEditing, useNewLayout, canEdit, isRestricted, hasPermission, dialogs } = wp;

  // Mode state
  const isEditPath =
    location.pathname.endsWith('/edit') || location.pathname.endsWith('/create');

  // Form state and autosave
  const {
    formData,
    saveStatus,
    errorMessage,
    setErrorMessage,
    lastSaved,
    hasUnsavedChanges,
    updateField,
    updatePlaceField,
    handleFieldBlur,
    performSave,
    deleteMutation,
    queryClient,
  } = useConstituentFormState(constituent, isCreateMode, isEditing, orgId, constituentId, navigate);

  // Section state
  const {
    expandedSections,
    setExpandedSections,
    sectionRefs,
    getSectionOrder,
    sectionIds,
    lowerAllSections,
    raiseSection: raiseSectionBase,
    toggleSection: toggleSectionBase,
  } = useSectionState(isCreateMode);

  // Section summaries
  const sectionSummaries = useSectionSummaries(constituent, formData);

  // Has content checks
  const hasContent = useHasContent(constituent);

  // Authority search hooks
  const ulan = useUlanSearch(orgId, formData, updateField, handleFieldBlur);
  const authority = useAuthoritySearch(orgId, formData, updateField, handleFieldBlur);

  // Wrap section helpers with editing context
  const raiseSection = useCallback((sectionId: string) => {
    raiseSectionBase(sectionId, isEditing, isCreateMode, canEdit, setIsEditing, setSearchParams);
  }, [raiseSectionBase, isEditing, isCreateMode, canEdit, setSearchParams]);

  const toggleSection = useCallback((sectionId: string) => {
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
        navigate(`/organizations/${orgId}/collections/constituents/${constituentId}`, { replace: true });
      } else {
        setSearchParams({}, { replace: true });
      }
      queryClient.invalidateQueries({ queryKey: ['constituent', orgId, constituentId] });
    }
  }, [isEditing, hasUnsavedChanges, performSave, setSearchParams, queryClient, orgId, constituentId, isEditPath, navigate, lowerAllSections]);

  // Scroll to top when navigating
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [constituentId]);

  // ---------------------------------------------------------------------------
  // Loading / error states
  // ---------------------------------------------------------------------------

  if (!isCreateMode && isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <MadronaLoader label="Loading…" />
      </div>
    );
  }

  if (!isCreateMode && (error || !constituent)) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="text-center py-12">
          <User size={48} className="mx-auto text-archive mb-4" />
          <h3 className="text-lg font-serif font-medium text-forest mb-2">
            Record not found
          </h3>
          <p className="text-accessible-gray mb-4">
            {error
              ? (error as Error).message
              : 'This record could not be loaded.'}
          </p>
          <Link
            to={`/organizations/${orgId}/collections/constituents`}
            className="text-bark hover:text-copper-dark"
          >
            Back to People and Organizations
          </Link>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Derived display values
  // ---------------------------------------------------------------------------

  const ConstituentIcon =
    CONSTITUENT_TYPE_ICONS[formData.constituent_type] || User;
  const constituentTypeLabel =
    CONSTITUENT_TYPE_OPTIONS.find((t) => t.value === formData.constituent_type)
      ?.label || 'Person';

  // Common props for sections
  const baseSectionProps = {
    orgId: orgId!,
    constituentId,
    isEditing,
    isCreateMode,
    formData,
    updateField,
    handleFieldBlur,
    expandedSections,
    toggleSection,
    sectionRefs,
    getSectionOrder,
    sectionSummaries,
    isRestricted,
  };

  // ---------------------------------------------------------------------------
  // Page content
  // ---------------------------------------------------------------------------

  const pageContent = (
    <div className={cn(useNewLayout ? '' : 'p-6 max-w-4xl mx-auto')}>
      {/* Header - hide when using new layout */}
      {!useNewLayout && (
        <WorkspaceHeader
          backUrl={`/organizations/${orgId}/collections/constituents`}
          backText="Back to People and Organizations"
          title={isCreateMode ? 'New Person or Organization' : formData.name || ''}
          objectNumber={isCreateMode ? undefined : constituentTypeLabel}
          isEditing={isEditing}
          onToggleMode={isCreateMode ? undefined : toggleMode}
          saveStatus={saveStatus}
          hasUnsavedChanges={hasUnsavedChanges}
          lastSaved={lastSaved}
          showCreateButton={isCreateMode}
          createButtonText="Create Person or Organization"
          onSave={isCreateMode ? performSave : undefined}
          actions={
            !isCreateMode && !isEditing ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => dialogs.setShowCreateTask(true)}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm border border-lichen rounded-lg text-ink hover:bg-stone transition-colors"
                >
                  <ListTodo size={14} />
                  Create Task
                </button>
                <button
                  onClick={() => dialogs.setShowDeleteConfirm(true)}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm border border-semantic-error/30 text-semantic-error rounded-lg hover:bg-semantic-error/10 transition-colors"
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 size={14} />
                  Delete
                </button>
              </div>
            ) : undefined
          }
        />
      )}

      {/* Status badges */}
      {!isCreateMode && constituent && (
        <div className="flex items-center gap-4 mb-6">
          <span
            className={cn(
              'inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium',
              (constituent as any).status === 'active' || constituent.is_active
                ? 'bg-semantic-success/10 text-semantic-success'
                : 'bg-stone text-archive',
            )}
          >
            <ConstituentIcon size={16} />
            {constituentTypeLabel}
          </span>
          {!constituent.is_active && (
            <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-semantic-error/10 text-semantic-error rounded-full text-sm font-medium">
              Inactive
            </span>
          )}
          {(constituent as any).is_verified && (
            <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-forest/10 text-forest rounded-full text-sm font-medium">
              Verified
            </span>
          )}
        </div>
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

      {/* Sections Container */}
      <div className="flex flex-col gap-4">
        {/* Media Section */}
        {orgId && (isCreateMode ? (
          <WorkspaceSection
            id="media"
            title="Media"
            icon={<Image size={18} />}
            isExpanded={expandedSections.media}
            onToggle={() => toggleSection('media')}
            isEditing={isEditing}
            order={getSectionOrder('media')}
            isEmpty
          >
            <p className="text-sm text-archive text-center py-4">Save the record first to add media.</p>
          </WorkspaceSection>
        ) : constituentId ? (
          <MediaSection
            organizationId={orgId}
            constituentId={constituentId}
            isEditing={isEditing}
            isExpanded={expandedSections.media}
            onToggle={() => toggleSection('media')}
            order={getSectionOrder('media')}
          />
        ) : null)}

        {/* Identity Section */}
        <IdentitySection {...baseSectionProps} isEmpty={!hasContent.identity} />

        {/* === DETAILS GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Details" icon={Mail} />}

        {/* Contact Details Section */}
        <ContactSection {...baseSectionProps} isEmpty={!hasContent.contact} />

        {/* Biography Section */}
        <BiographySection
          {...baseSectionProps}
          updatePlaceField={updatePlaceField}
          isEmpty={!hasContent.biography}
        />

        {/* === AUTHORITY LINKS GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Authority Links" icon={Globe} />}

        {/* External IDs Section */}
        <ExternalIdsSection
          {...baseSectionProps}
          ulan={ulan}
          authority={authority}
          isEmpty={!hasContent.external}
        />

        {/* === ADMIN GROUP === */}
        {useNewLayout && <SectionGroupDivider label="Admin" icon={Shield} />}

        {/* Admin Section */}
        <AdminSection {...baseSectionProps} isEmpty={!hasContent.admin} />

        {/* Discussion Section */}
        {!isCreateMode && orgId && constituentId && (
          <WorkspaceSection
            id="discussion"
            title="Discussion"
            icon={<MessageSquare size={18} />}
            isExpanded={expandedSections.discussion}
            onToggle={() => toggleSection('discussion')}
            sectionRef={(el) => { sectionRefs.current['discussion'] = el; }}
            order={getSectionOrder('discussion')}
          >
            <RecordDiscussionTab
              entityType="constituent"
              entityId={constituentId}
              organizationId={orgId}
            />
          </WorkspaceSection>
        )}

        {/* Change History Section */}
        {hasPermission('org.view_audit_logs') &&
          !isCreateMode &&
          orgId &&
          constituentId && (
            <WorkspaceSection
              id="history"
              title="Change History"
              icon={<History size={18} />}
              isExpanded={expandedSections.history}
              onToggle={() => toggleSection('history')}
              isEditing={isEditing}
              sectionRef={(el) => { sectionRefs.current['history'] = el; }}
              order={getSectionOrder('history')}
            >
              <RecordAuditHistory
                organizationId={orgId}
                entityType="constituent"
                entityId={constituentId}
              />
            </WorkspaceSection>
          )}
      </div>

      {/* Footer metadata */}
      {!isCreateMode && constituent && (
        <div className="mt-8 pt-6 border-t border-lichen text-sm text-archive">
          <p>Created: {formatDateTime(constituent.created_at)}</p>
          {constituent.updated_at && (
            <p>
              Last updated: {formatDateTime(constituent.updated_at)}
            </p>
          )}
        </div>
      )}

      {/* Create Task Slide-over */}
      {orgId && constituentId && constituent && (
        <CreateTaskSlideOver
          isOpen={dialogs.showCreateTask}
          onClose={() => dialogs.setShowCreateTask(false)}
          orgId={orgId}
          initialEntityType="constituent"
          initialEntityId={constituentId}
          initialEntityLabel={constituent.name || 'Person or Organization'}
        />
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={dialogs.showDeleteConfirm}
        onClose={() => dialogs.setShowDeleteConfirm(false)}
        onConfirm={() => {
          deleteMutation.mutate();
          dialogs.setShowDeleteConfirm(false);
        }}
        title="Delete Person or Organization"
        message={<>Are you sure you want to delete <strong>{formData.display_name || formData.name || 'this record'}</strong>? This action cannot be undone.</>}
        confirmText="Delete"
        confirmStyle="danger"
      />
    </div>
  );

  // Return with or without new layout wrapper
  if (useNewLayout && constituent) {
    return (
      <RecordDetailPageWrapper
        object={{
          object_id: constituentId!,
          // A person or organization has no object number. The type already
          // renders as its own row, so leaving this null avoids both a wrong
          // "Object #" label and a duplicate of Type.
          object_number: null,
          object_type: constituentTypeLabel,
          object_status: formData.status,
        }}
        // Never shelved, and rights attach to objects and media rather than
        // to people — both rows would be permanently empty.
        showLocation={false}
        showRights={false}
        sectionIds={sectionIds}
        sectionGroups={PAGE_SECTION_GROUPS}
        sectionData={{
          identity: {
            name: constituent.name,
            constituent_type: constituent.constituent_type,
            display_name: constituent.display_name,
          },
          contact: {
            email: constituent.email,
            phone: constituent.phone,
            organization_name: constituent.organization_name,
          },
          biography: {
            birth_date_display: constituent.birth_date_display,
            death_date_display: constituent.death_date_display,
            biography: constituent.biography,
          },
          external: {
            ulan_id: constituent.ulan_id,
            viaf_id: constituent.viaf_id,
            wikidata_id: constituent.wikidata_id,
            loc_id: constituent.loc_id,
          },
          admin: {
            status: constituent.status,
            is_active: constituent.is_active,
          },
          discussion: { exists: true },
          history: { exists: true },
        }}
        callbacks={{
          onCreateTask: () => dialogs.setShowCreateTask(true),
          onDelete: () => dialogs.setShowDeleteConfirm(true),
        }}
        permissions={{
          canCreateTask: true,
          canViewHistory: true,
          canDelete: true,
        }}
        onSectionNavigate={handleEnterEditMode}
        pageType="constituent"
        enabled={true}
        showHeader={true}
        title={constituent.name || 'Person or Organization'}
        subtitle={constituent.display_name || constituentTypeLabel}
        backUrl={`/organizations/${orgId}/collections/constituents`}
        backLabel="Back to People and Organizations"
      >
        {pageContent}
      </RecordDetailPageWrapper>
    );
  }

  return pageContent;
}
