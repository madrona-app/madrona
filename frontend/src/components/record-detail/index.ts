/**
 * Record Detail Components
 *
 * Components for the redesigned record detail page layout.
 * Implements three-column layout with section nav, main content, and right rail.
 *
 * @see /docs/record-detail-page-redesign.md
 */

// Layout components
export {
  RecordDetailLayout,
  RecordDetailHeaderArea,
  RecordDetailSectionNav,
  RecordDetailMain,
  RecordDetailRail,
  useRecordDetailLayout,
} from './RecordDetailLayout';

// Persistence hooks
export {
  useAccordionState,
  useRecentSections,
  useRecentSectionsCollapsed,
  useSectionNavCollapsed,
  useRightRailCollapsed,
  useNavGroupsExpanded,
  useSectionOrder,
  SectionOrderProvider,
  STORAGE_KEYS,
} from './useLayoutPersistence';

// Scroll spy
export {
  useScrollSpy,
  scrollToSection,
  scrollToSectionAndFocus,
  getCurrentSection,
  type ScrollToSectionAndFocusOptions,
} from './useScrollSpy';

// Section indicators
export {
  SectionIndicator,
  computeSectionIndicator,
  computeGroupWarningCount,
  getPath,
  type SectionStatus,
  type SectionIndicatorProps,
  type SectionCompletenessConfig,
} from './SectionIndicator';

// Section navigation
export {
  SectionNav,
  DEFAULT_SECTION_GROUPS,
  type SectionDefinition,
  type SectionGroup,
  type SectionNavProps,
} from './SectionNav';

// Right rail summary
export {
  RightRailSummary,
  DEFAULT_QUICK_ACTIONS,
  type QuickAction,
  type RightRailSummaryProps,
} from './RightRailSummary';

// Section accordion
export {
  SectionAccordion,
  SectionEmptyState,
  type SectionAccordionProps,
  type SectionEmptyStateProps,
} from './SectionAccordion';

// Key info strip
export {
  KeyInfoStrip,
  type KeyInfoStripProps,
  type RightsStatus,
} from './KeyInfoStrip';

// Image modal
export {
  ImageModal,
  type ImageModalProps,
  type ImageModalMedia,
} from './ImageModal';

// Record detail data hook
export {
  useRecordDetailData,
  type CollectionObjectData,
  type MediaItem,
  type RecordDetailPermissions,
  type RecordDetailCallbacks,
  type UseRecordDetailDataOptions,
  type UseRecordDetailDataReturn,
} from './useRecordDetailData';

// Action menu (More dropdown)
export {
  ActionMenu,
  buildActionMenuItems,
  type ActionMenuItem,
  type ActionMenuGroup,
  type ActionMenuProps,
} from './ActionMenu';

// Record header
export {
  RecordHeader,
  type RecordHeaderProps,
} from './RecordHeader';

// Field grid
export {
  FieldGrid,
  FieldValue,
  IDENTIFICATION_FIELDS,
  PHYSICAL_DESCRIPTION_FIELDS,
  type FieldGridProps,
  type FieldDefinition,
  type FieldType,
  type FieldValueProps,
} from './FieldGrid';

// Skip links (accessibility)
export {
  SkipLinks,
  type SkipLink,
  type SkipLinksProps,
} from './SkipLinks';

// Focus management (accessibility)
export {
  useFocusManagement,
  scrollToSectionWithFocus,
  type UseFocusManagementReturn,
} from './useFocusManagement';

// Lazy loading (performance)
export {
  LazySection,
  LazyComponentLoader,
  createLazyComponent,
  shouldVirtualize,
  VIRTUALIZATION_THRESHOLDS,
  type LazySectionProps,
  type LazyComponentLoaderProps,
} from './LazySection';

// Relationship table
export {
  RelationshipTable,
  CONTRIBUTOR_COLUMNS,
  RELATED_OBJECTS_COLUMNS,
  CITATIONS_COLUMNS,
  PLACES_COLUMNS,
  type ColumnDef,
  type RelatedItem,
  type EmptyStateConfig,
  type RelationshipTableProps,
} from './RelationshipTable';

// Page wrapper for existing workspace pages
export {
  RecordDetailPageWrapper,
  type RecordDetailPageWrapperProps,
} from './RecordDetailPageWrapper';

// Active section context (for nav highlighting)
export {
  ActiveSectionProvider,
  useActiveSection,
  useActiveSectionRequired,
} from './ActiveSectionContext';
