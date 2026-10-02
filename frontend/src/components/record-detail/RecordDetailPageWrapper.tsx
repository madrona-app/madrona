/**
 * RecordDetailPageWrapper - Integration wrapper for existing workspace pages
 *
 * Wraps existing workspace page content with the new three-column layout.
 * Allows gradual adoption by workspace pages without full rewrite.
 *
 * Usage:
 * ```tsx
 * <RecordDetailPageWrapper
 *   object={object}
 *   media={linkedMedia}
 *   sectionIds={['identification', 'media', 'physical', ...]}
 *   // ... callbacks
 * >
 *   {existingPageContent}
 * </RecordDetailPageWrapper>
 * ```
 *
 * @see /docs/record-detail-page-redesign.md
 */

import { useMemo, useCallback, useState, type ReactNode } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  RecordDetailLayout,
  RecordDetailHeaderArea,
  RecordDetailSectionNav,
  RecordDetailMain,
  RecordDetailRail,
} from './RecordDetailLayout';
import { SectionNav, DEFAULT_SECTION_GROUPS, type SectionGroup } from './SectionNav';
import { RightRailSummary } from './RightRailSummary';
import { RecordHeader } from './RecordHeader';
import { KeyInfoStrip } from './KeyInfoStrip';
import { ImageModal, type ImageModalMedia } from './ImageModal';
import { RequestDownloadModal } from '../dam/RequestDownloadModal';
import { getDownloadUrl } from '../../lib/api/media-dam';
import { downloadWithFilename } from '../../lib/download';
import { useToast } from '../../contexts/ToastContext';
import { logger } from '../../lib/logger';
import { scrollToSection } from './useScrollSpy';
import { useRecordDetailData, type RecordDetailCallbacks, type RecordDetailPermissions } from './useRecordDetailData';
import { ActiveSectionProvider, useActiveSection } from './ActiveSectionContext';

// =============================================================================
// TYPES
// =============================================================================

export interface RecordDetailPageWrapperProps {
  /** Page content (existing workspace sections) */
  children: ReactNode;
  /** Record title */
  title?: string;
  /** Record identifier (e.g., loan number, entry number) — shown beside the title */
  objectNumber?: string;
  /** Record subtitle / brief description */
  subtitle?: string;
  /** Back link URL */
  backUrl?: string;
  /** Back link label */
  backLabel?: string;
  /** Collection object data */
  object?: {
    object_id: string;
    object_number?: string | null;
    object_type?: string | null;
    object_status?: string | null;
    current_location_name?: string | null;
    current_location?: { name?: string; path?: string; on_display?: boolean } | null;
    is_on_display?: boolean;
    primary_image_url?: string | null;
    titles?: Array<{ title: string; type?: string; is_primary?: boolean }>;
  } | null;
  /** Media items for gallery */
  media?: Array<{
    media_id: string;
    filename?: string;
    title?: string | null;
    thumbnail_url?: string;
    url?: string;
    width?: number | null;
    height?: number | null;
    is_primary?: boolean;
    label?: string;
    download_access?: 'direct' | 'request' | 'blocked' | null;
  }>;
  /** Section IDs present on the page (for nav and scroll spy) */
  sectionIds?: string[];
  /** Custom section groups (defaults to standard groups) */
  sectionGroups?: SectionGroup[];
  /** Data for computing section completeness */
  sectionData?: Record<string, unknown>;
  /** Permissions for quick actions */
  permissions?: RecordDetailPermissions;
  /** Callbacks for quick actions */
  callbacks?: RecordDetailCallbacks;
  /** Whether page is in edit mode */
  isEditing?: boolean;
  /** Callback when navigating to a section (for click-to-edit pattern) */
  onSectionNavigate?: (sectionId: string) => void;
  /** Entry locations for loan records (shows list instead of single location) */
  entryLocations?: Array<{ entryNumber: string; locationName: string | null }>;
  /** Page type for persisting nav group expanded state */
  pageType?: string;
  /** Whether to show the new layout (feature flag) */
  enabled?: boolean;
  /** Whether to show the integrated header (vs custom headerContent) */
  showHeader?: boolean;
  /** Additional header content (legacy, use showHeader=true for integrated header) */
  headerContent?: ReactNode;
  /** Whether the object is publicly discoverable (Collection Objects only) */
  isDiscoverable?: boolean;
  /** Callback to toggle discoverable status */
  onToggleDiscoverable?: () => void;
  /** Override the rail image click handler (e.g., to open IIIF viewer instead of ImageModal) */
  onImageClick?: () => void;
  /** Whether to show the right rail (image, identifiers, actions). Default true. */
  showRail?: boolean;
  /**
   * Label for the rail's identifier row. Defaults to "Object #".
   * Pages whose record is not a collection object should override it.
   */
  identifierLabel?: string;
  /**
   * Whether the record has a physical location. Default true.
   * People and organizations pass false — they are never shelved, so a
   * Location row would sit permanently empty.
   */
  showLocation?: boolean;
  /**
   * Whether the record carries rights. Default true.
   * Rights attach to objects and media; a person has none, so the strip
   * would otherwise read "Rights: Unknown" forever.
   */
  showRights?: boolean;
  /** Timestamp of the last successful autosave (shown in the header) */
  lastSaved?: Date | null;
  /** Additional CSS classes */
  className?: string;
}

// =============================================================================
// MAIN WRAPPER COMPONENT
// =============================================================================

export function RecordDetailPageWrapper({
  children,
  title,
  objectNumber: objectNumberProp,
  subtitle,
  backUrl,
  backLabel,
  object,
  media = [],
  sectionIds = [],
  sectionGroups = DEFAULT_SECTION_GROUPS,
  sectionData = {},
  permissions = {},
  callbacks = {},
  isEditing: _isEditing = false,
  onSectionNavigate,
  entryLocations,
  pageType = 'default',
  enabled = true,
  showHeader = false,
  headerContent,
  onImageClick,
  showRail: showRailProp,
  identifierLabel,
  showLocation,
  showRights,
  isDiscoverable,
  onToggleDiscoverable,
  className,
}: RecordDetailPageWrapperProps) {
  // Right rail only shows when the page has media content
  const showRail = showRailProp ?? (media.length > 0 || !!object);

  // Transform object data for hooks
  const objectData = useMemo(() => {
    if (!object) return null;
    return {
      object_id: object.object_id,
      object_number: object.object_number,
      object_type: object.object_type,
      object_status: object.object_status,
      current_location_name:
        object.current_location?.path ||
        object.current_location?.name ||
        object.current_location_name,
      is_on_display: object.current_location?.on_display ?? object.is_on_display,
      primary_image_url: object.primary_image_url,
      titles: object.titles,
    };
  }, [object]);

  // Transform media data
  const mediaData = useMemo(() => {
    return media.map((m) => ({
      media_id: m.media_id,
      filename: m.filename,
      title: m.title,
      thumbnail_url: m.thumbnail_url,
      full_url: m.url,
      width: m.width,
      height: m.height,
      is_primary: m.is_primary,
      label: m.label,
      download_access: m.download_access,
    }));
  }, [media]);

  // Use record detail data hook
  const {
    railProps,
    headerProps,
    isImageModalOpen,
    openImageModal,
    closeImageModal,
    imageModalMedia,
    imageModalInitialIndex,
  } = useRecordDetailData({
    object: objectData,
    media: mediaData,
    permissions,
    callbacks,
  });

  // ---------------------------------------------------------------------------
  // Inline download / request-download actions
  //
  // Keeps the user in Collections: direct download or a download request happen
  // in place; "Open in Media" is the escape hatch to the full asset record (with
  // a returnTo so the Media detail page can link back here).
  // ---------------------------------------------------------------------------
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const [requestMedia, setRequestMedia] = useState<ImageModalMedia | null>(null);

  const handleDirectDownload = useCallback(
    async (m: ImageModalMedia) => {
      if (!orgId) return;
      try {
        const { download_url } = await getDownloadUrl(orgId, m.id);
        await downloadWithFilename(download_url, m.filename || 'download');
      } catch (err) {
        // Rights may have changed mid-session → fall back to a request.
        if ((err as { status?: number })?.status === 403) {
          showToast({ type: 'info', title: 'Download request required — rights may have changed' });
          setRequestMedia(m);
        } else {
          logger.warn('Inline media download failed:', err);
          showToast({ type: 'error', title: 'Download failed', message: 'Please try again.' });
        }
      }
    },
    [orgId, showToast]
  );

  const handleRequestDownload = useCallback((m: ImageModalMedia) => {
    setRequestMedia(m);
  }, []);

  const handleOpenInMedia = useCallback(
    (m: ImageModalMedia) => {
      if (!orgId) return;
      const returnTo = encodeURIComponent(location.pathname + location.search);
      navigate(`/organizations/${orgId}/media/${m.id}?returnTo=${returnTo}`, { viewTransition: true });
    },
    [orgId, navigate, location.pathname, location.search]
  );

  // Compute display title from object or prop
  const displayTitle = useMemo(() => {
    if (title) return title;
    if (!objectData?.titles || objectData.titles.length === 0) return 'Untitled';
    const primaryTitle = objectData.titles.find((t) => t.is_primary);
    return primaryTitle?.title || objectData.titles[0]?.title || 'Untitled';
  }, [title, objectData?.titles]);

  // Filter section groups to only include sections that exist on the page
  const filteredGroups = useMemo(() => {
    if (sectionIds.length === 0) return sectionGroups;

    return sectionGroups
      .map((group) => ({
        ...group,
        sections: group.sections.filter((s) => sectionIds.includes(s.id)),
      }))
      .filter((group) => group.sections.length > 0);
  }, [sectionGroups, sectionIds]);

  // Determine rights status for KeyInfoStrip
  const rightsStatus = useMemo(() => {
    const rights = sectionData.rights as { type?: string } | undefined;
    if (!rights) return 'unknown' as const;
    if (rights.type === 'open' || rights.type === 'public_domain') return 'open' as const;
    if (rights.type === 'restricted' || rights.type === 'copyrighted') return 'restricted' as const;
    return 'unknown' as const;
  }, [sectionData.rights]);

  // If disabled, render children directly without wrapper
  if (!enabled) {
    return <>{children}</>;
  }

  return (
    <ActiveSectionProvider>
      <RecordDetailPageWrapperInner
        className={className}
        showHeader={showHeader}
        objectData={objectData}
        objectNumberProp={objectNumberProp}
        identifierLabel={identifierLabel}
        showLocation={showLocation}
        showRights={showRights}
        displayTitle={displayTitle}
        subtitle={subtitle}
        backUrl={backUrl}
        backLabel={backLabel}
        headerProps={headerProps}
        permissions={permissions}
        callbacks={callbacks}
        headerContent={headerContent}
        rightsStatus={rightsStatus}
        filteredGroups={filteredGroups}
        sectionData={sectionData}
        onSectionNavigate={onSectionNavigate}
        pageType={pageType}
        railProps={railProps}
        openImageModal={openImageModal}
        isImageModalOpen={isImageModalOpen}
        closeImageModal={closeImageModal}
        imageModalMedia={imageModalMedia}
        imageModalInitialIndex={imageModalInitialIndex}
        entryLocations={entryLocations}
        onImageClick={onImageClick}
        showRail={showRail}
        isDiscoverable={isDiscoverable}
        onToggleDiscoverable={onToggleDiscoverable}
        orgId={orgId}
        onDownloadMedia={orgId ? handleDirectDownload : undefined}
        onRequestDownloadMedia={orgId ? handleRequestDownload : undefined}
        onOpenInMedia={orgId ? handleOpenInMedia : undefined}
        requestMedia={requestMedia}
        onCloseRequestMedia={() => setRequestMedia(null)}
      >
        {children}
      </RecordDetailPageWrapperInner>
    </ActiveSectionProvider>
  );
}

// Inner component that uses the context
function RecordDetailPageWrapperInner({
  children,
  className,
  showHeader,
  objectData,
  objectNumberProp,
  displayTitle,
  subtitle,
  backUrl,
  backLabel,
  headerProps,
  permissions,
  callbacks,
  headerContent,
  rightsStatus,
  filteredGroups,
  sectionData,
  onSectionNavigate,
  pageType,
  railProps,
  openImageModal,
  isImageModalOpen,
  closeImageModal,
  imageModalMedia,
  imageModalInitialIndex,
  entryLocations,
  onImageClick,
  showRail = false,
  identifierLabel,
  showLocation,
  showRights,
  isDiscoverable,
  onToggleDiscoverable,
  orgId,
  onDownloadMedia,
  onRequestDownloadMedia,
  onOpenInMedia,
  requestMedia,
  onCloseRequestMedia,
}: {
  children: ReactNode;
  className?: string;
  showHeader: boolean;
  objectData: any;
  objectNumberProp?: string;
  displayTitle: string;
  subtitle?: string;
  backUrl?: string;
  backLabel?: string;
  headerProps: any;
  permissions: RecordDetailPermissions;
  callbacks: RecordDetailCallbacks;
  headerContent?: ReactNode;
  rightsStatus: 'open' | 'restricted' | 'unknown';
  filteredGroups: SectionGroup[];
  sectionData: Record<string, unknown>;
  onSectionNavigate?: (sectionId: string) => void;
  pageType: string;
  railProps: any;
  openImageModal: (index: number) => void;
  isImageModalOpen: boolean;
  closeImageModal: () => void;
  imageModalMedia: any[];
  imageModalInitialIndex: number;
  entryLocations?: Array<{ entryNumber: string; locationName: string | null }>;
  onImageClick?: () => void;
  showRail?: boolean;
  identifierLabel?: string;
  showLocation?: boolean;
  showRights?: boolean;
  isDiscoverable?: boolean;
  onToggleDiscoverable?: () => void;
  orgId?: string;
  onDownloadMedia?: (media: ImageModalMedia) => void;
  onRequestDownloadMedia?: (media: ImageModalMedia) => void;
  onOpenInMedia?: (media: ImageModalMedia) => void;
  requestMedia?: ImageModalMedia | null;
  onCloseRequestMedia?: () => void;
}) {
  // Active section from context
  const { activeSection, setActiveSection } = useActiveSection() || { activeSection: '', setActiveSection: () => {} };

  // Location, rights and the "Object #" wording all belong to collection
  // objects. Most pages using this wrapper are not objects — they pass a
  // record identifier (an acquisition or condition-report number) through
  // objectNumber and no object at all, and were getting an "Object #" label
  // plus a permanent "Location: Not set" and "Rights: Unknown" beside it.
  // Defaults now follow the data actually present; an explicit prop still
  // wins, which is how a page opts out (a person) or renames its identifier
  // (an entry).
  const hasCollectionObject = !!objectData?.object_number;
  const resolvedIdentifierLabel =
    identifierLabel ?? (hasCollectionObject ? 'Object #' : 'Record #');
  const resolvedShowLocation = showLocation ?? !!objectData;
  const resolvedShowRights = showRights ?? !!objectData;

  // Section navigation handler
  const handleNavigate = useCallback((sectionId: string) => {
    setActiveSection(sectionId);
    onSectionNavigate?.(sectionId);
    scrollToSection(sectionId, 16);
  }, [setActiveSection, onSectionNavigate]);

  return (
    <RecordDetailLayout className={className} initialRailCollapsed={!showRail}>
      {/* Header Area */}
      <RecordDetailHeaderArea>
        {showHeader ? (
          <RecordHeader
            objectNumber={objectNumberProp || objectData?.object_number || undefined}
            title={displayTitle}
            subtitle={subtitle}
            backUrl={backUrl}
            backLabel={backLabel}
            {...headerProps}
            canDelete={permissions.canDelete}
            onDelete={callbacks.onDelete}
          />
        ) : (
          headerContent
        )}

        {showRail && (
          <KeyInfoStrip
            objectNumber={objectNumberProp || objectData?.object_number || undefined}
            identifierLabel={resolvedIdentifierLabel}
            objectType={objectData?.object_type || undefined}
            status={objectData?.object_status || undefined}
            location={objectData?.current_location_name}
            showLocation={resolvedShowLocation}
            showRights={resolvedShowRights}
            rightsStatus={rightsStatus}
            isDiscoverable={isDiscoverable}
            onToggleDiscoverable={onToggleDiscoverable}
            className="mt-4"
          />
        )}
      </RecordDetailHeaderArea>

      {/* Section Navigation */}
      <RecordDetailSectionNav>
        <SectionNav
          groups={filteredGroups}
          activeSection={activeSection}
          sectionData={sectionData}
          onNavigate={handleNavigate}
          pageType={pageType}
        />
      </RecordDetailSectionNav>

      {/* Main Content */}
      <RecordDetailMain>
        {children}
      </RecordDetailMain>

      {/* Right Rail */}
      {showRail && (
        <RecordDetailRail>
          <RightRailSummary
            {...railProps}
            identifierLabel={resolvedIdentifierLabel}
            showLocation={resolvedShowLocation}
            onExpandImage={onImageClick ? () => onImageClick() : () => openImageModal(0)}
            canCreateTask={permissions.canCreateTask}
            onCreateTask={callbacks.onCreateTask}
            canGenerateReport={permissions.canGenerateReport}
            onGenerateReport={callbacks.onGenerateReport}
            entryLocations={entryLocations}
            isDiscoverable={isDiscoverable}
            onToggleDiscoverable={onToggleDiscoverable}
          />
        </RecordDetailRail>
      )}

      {/* Image Modal */}
      <ImageModal
        isOpen={isImageModalOpen}
        onClose={closeImageModal}
        media={imageModalMedia}
        initialIndex={imageModalInitialIndex}
        canDownload={permissions.canDownloadMedia}
        onDownload={onDownloadMedia}
        onRequestDownload={onRequestDownloadMedia}
        onOpenInMedia={onOpenInMedia}
      />

      {/* Inline download request — stays within Collections */}
      {requestMedia && orgId && (
        <RequestDownloadModal
          organizationId={orgId}
          mediaItems={[
            {
              media_id: requestMedia.id,
              filename: requestMedia.filename || '',
              title: requestMedia.title,
            },
          ]}
          onClose={onCloseRequestMedia ?? (() => {})}
        />
      )}

    </RecordDetailLayout>
  );
}

export default RecordDetailPageWrapper;
