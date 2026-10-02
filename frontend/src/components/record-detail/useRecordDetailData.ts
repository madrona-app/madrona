/**
 * useRecordDetailData - Hook to wire record data to the RightRailSummary
 *
 * Transforms collection object data into props for RightRailSummary
 * and manages the image modal state.
 *
 * @see /docs/record-detail-page-redesign.md
 */

import { useMemo, useState, useCallback } from 'react';
import {
  ArrowRightLeft,
  ClipboardCheck,
  FileOutput,
  AlertTriangle,
  FileQuestion,
  Hammer,
  DollarSign,
  Layers,
} from 'lucide-react';
import type { QuickAction, RightRailSummaryProps } from './RightRailSummary';
import type { ImageModalMedia } from './ImageModal';

// =============================================================================
// TYPES
// =============================================================================

export interface CollectionObjectData {
  object_id: string;
  object_number?: string | null;
  object_type?: string | null;
  object_status?: string | null;
  current_location_name?: string | null;
  current_location_id?: string | null;
  is_on_display?: boolean;
  primary_image_url?: string | null;
  primary_image_id?: string | null;
  titles?: Array<{ title: string; type?: string; is_primary?: boolean }>;
}

export interface MediaItem {
  media_id: string;
  filename?: string;
  title?: string | null;
  thumbnail_url?: string;
  url?: string;
  full_url?: string;
  width?: number | null;
  height?: number | null;
  is_primary?: boolean;
  /** Optional label to display (e.g., object description) */
  label?: string;
  /** Rights-derived download gate ('direct' | 'request' | 'blocked') */
  download_access?: 'direct' | 'request' | 'blocked' | null;
}

export interface RecordDetailPermissions {
  canCreateTask?: boolean;
  canViewHistory?: boolean;
  canDelete?: boolean;
  canCreateMovement?: boolean;
  canCreateConditionReport?: boolean;
  canCreateLoanRequest?: boolean;
  canCreateIncident?: boolean;
  canCreateUseRequest?: boolean;
  canCreateConservation?: boolean;
  canCreateValuation?: boolean;
  canDownloadMedia?: boolean;
  canGenerateReport?: boolean;
  canAddToWorkset?: boolean;
}

export interface RecordDetailCallbacks {
  onCreateTask?: () => void;
  onViewHistory?: () => void;
  onDelete?: () => void;
  onGenerateReport?: () => void;
  onMovementClick?: () => void;
  onConditionReportClick?: () => void;
  onLoanRequestClick?: () => void;
  onIncidentClick?: () => void;
  onUseRequestClick?: () => void;
  onConservationClick?: () => void;
  onValuationClick?: () => void;
  onAddToWorkset?: () => void;
}

export interface UseRecordDetailDataOptions {
  object: CollectionObjectData | undefined | null;
  media?: MediaItem[];
  permissions?: RecordDetailPermissions;
  callbacks?: RecordDetailCallbacks;
}

export interface UseRecordDetailDataReturn {
  /** Props to spread onto RightRailSummary */
  railProps: Partial<RightRailSummaryProps>;
  /** Props for RecordHeader component */
  headerProps: {
    canCreateTask: boolean;
    onCreateTask?: () => void;
    canViewHistory: boolean;
    onViewHistory?: () => void;
    quickActions: QuickAction[];
  };
  /** Whether the image modal is open */
  isImageModalOpen: boolean;
  /** Open the image modal at a specific index */
  openImageModal: (index?: number) => void;
  /** Close the image modal */
  closeImageModal: () => void;
  /** Media items formatted for ImageModal */
  imageModalMedia: ImageModalMedia[];
  /** Initial index for ImageModal */
  imageModalInitialIndex: number;
}

// =============================================================================
// STATUS LABELS AND VARIANT MAPPING
// =============================================================================

const OBJECT_STATUS_LABELS: Record<string, string> = {
  accessioned: 'Accessioned',
  active: 'Active',
  on_loan: 'On Loan',
  in_conservation: 'In Conservation',
  pending: 'Pending',
  deaccessioned: 'Deaccessioned',
  missing: 'Missing',
  approved: 'Approved',
  review: 'Under Review',
  damaged: 'Damaged',
  rejected: 'Rejected',
};

function getStatusLabel(status: string | null | undefined): string | undefined {
  if (!status) return undefined;
  return OBJECT_STATUS_LABELS[status.toLowerCase()] || status;
}

function getStatusVariant(
  status: string | null | undefined
): 'default' | 'success' | 'warning' | 'error' {
  if (!status) return 'default';

  const statusLower = status.toLowerCase();

  // Success states
  if (['accessioned', 'active', 'approved'].includes(statusLower)) {
    return 'success';
  }

  // Warning states
  if (['pending', 'on_loan', 'in_conservation', 'review'].includes(statusLower)) {
    return 'warning';
  }

  // Error states
  if (['deaccessioned', 'missing', 'damaged', 'rejected'].includes(statusLower)) {
    return 'error';
  }

  return 'default';
}

// =============================================================================
// QUICK ACTIONS BUILDER
// =============================================================================

const DEFAULT_ACTION_PRIORITY = [
  'movement',
  'condition',
  'loan',
  'incident',
  'use-request',
  'conservation',
  'valuation',
];

function buildQuickActions(
  permissions: RecordDetailPermissions,
  callbacks: RecordDetailCallbacks
): QuickAction[] {
  const actions: QuickAction[] = [];

  if (permissions.canCreateMovement && callbacks.onMovementClick) {
    actions.push({
      id: 'movement',
      label: 'Record Movement',
      icon: ArrowRightLeft,
      onClick: callbacks.onMovementClick,
      permission: 'collections.movements.create',
    });
  }

  if (permissions.canCreateConditionReport && callbacks.onConditionReportClick) {
    actions.push({
      id: 'condition',
      label: 'Condition Report',
      icon: ClipboardCheck,
      onClick: callbacks.onConditionReportClick,
      permission: 'collections.conditions.create',
    });
  }

  if (permissions.canCreateLoanRequest && callbacks.onLoanRequestClick) {
    actions.push({
      id: 'loan',
      label: 'Loan Request',
      icon: FileOutput,
      onClick: callbacks.onLoanRequestClick,
      permission: 'collections.loans.create',
    });
  }

  if (permissions.canCreateIncident && callbacks.onIncidentClick) {
    actions.push({
      id: 'incident',
      label: 'Report Incident',
      icon: AlertTriangle,
      onClick: callbacks.onIncidentClick,
      permission: 'collections.incidents.create',
    });
  }

  if (permissions.canCreateUseRequest && callbacks.onUseRequestClick) {
    actions.push({
      id: 'use-request',
      label: 'Use Request',
      icon: FileQuestion,
      onClick: callbacks.onUseRequestClick,
      permission: 'collections.use-requests.create',
    });
  }

  if (permissions.canCreateConservation && callbacks.onConservationClick) {
    actions.push({
      id: 'conservation',
      label: 'Conservation',
      icon: Hammer,
      onClick: callbacks.onConservationClick,
      permission: 'collections.conservation.create',
    });
  }

  if (permissions.canCreateValuation && callbacks.onValuationClick) {
    actions.push({
      id: 'valuation',
      label: 'Valuation',
      icon: DollarSign,
      onClick: callbacks.onValuationClick,
      permission: 'collections.valuations.create',
    });
  }

  if (permissions.canAddToWorkset && callbacks.onAddToWorkset) {
    actions.push({
      id: 'add-to-workset',
      label: 'Add to Work Set',
      icon: Layers,
      onClick: callbacks.onAddToWorkset,
    });
  }

  // Sort by priority
  return actions.sort((a, b) => {
    const aIndex = DEFAULT_ACTION_PRIORITY.indexOf(a.id);
    const bIndex = DEFAULT_ACTION_PRIORITY.indexOf(b.id);
    return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
  });
}

// =============================================================================
// MAIN HOOK
// =============================================================================

export function useRecordDetailData({
  object,
  media = [],
  permissions = {},
  callbacks = {},
}: UseRecordDetailDataOptions): UseRecordDetailDataReturn {
  // Image modal state
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  const [imageModalInitialIndex, setImageModalInitialIndex] = useState(0);

  // Build image modal media
  const imageModalMedia: ImageModalMedia[] = useMemo(() => {
    return media
      .filter((m) => m.full_url || m.url || m.thumbnail_url)
      .map((m) => ({
        id: m.media_id,
        url: m.full_url || m.url || m.thumbnail_url || '',
        thumbnail_url: m.thumbnail_url || undefined,
        alt: m.title || m.filename || 'Image',
        title: m.title || undefined,
        filename: m.filename,
        width: m.width || undefined,
        height: m.height || undefined,
        download_access: m.download_access,
      }));
  }, [media]);

  // Find primary image URL
  const primaryImageUrl = useMemo(() => {
    if (object?.primary_image_url) {
      return object.primary_image_url;
    }
    const primaryMedia = media.find((m) => m.is_primary);
    if (primaryMedia) {
      return primaryMedia.thumbnail_url || primaryMedia.url || null;
    }
    return media[0]?.thumbnail_url || media[0]?.url || null;
  }, [object?.primary_image_url, media]);

  // Get title for alt text
  const imageAlt = useMemo(() => {
    if (!object?.titles || object.titles.length === 0) return 'Object image';
    const primaryTitle = object.titles.find((t) => t.is_primary);
    return primaryTitle?.title || object.titles[0]?.title || 'Object image';
  }, [object?.titles]);

  // Build quick actions
  const quickActions = useMemo(() => {
    // Set reasonable defaults if not provided
    const defaultPermissions: RecordDetailPermissions = {
      canCreateMovement: true,
      canCreateConditionReport: true,
      canCreateLoanRequest: true,
      canCreateIncident: true,
      ...permissions,
    };
    return buildQuickActions(defaultPermissions, callbacks);
  }, [permissions, callbacks]);

  // Open image modal handler
  const openImageModal = useCallback((index = 0) => {
    setImageModalInitialIndex(index);
    setIsImageModalOpen(true);
  }, []);

  // Close image modal handler
  const closeImageModal = useCallback(() => {
    setIsImageModalOpen(false);
  }, []);

  // Build rail props
  const railProps: Partial<RightRailSummaryProps> = useMemo(() => {
    // Even without an object, we may have media to display
    if (!object && !primaryImageUrl) return {};

    return {
      imageUrl: primaryImageUrl,
      imageAlt,
      media: media.map(m => ({
        media_id: m.media_id,
        url: m.full_url || m.url,
        thumbnail_url: m.thumbnail_url,
        filename: m.filename,
        is_primary: m.is_primary,
        label: m.label,
      })),
      onExpandImage: imageModalMedia.length > 0 ? (index?: number) => openImageModal(index ?? 0) : undefined,
      objectNumber: object?.object_number || undefined,
      objectType: object?.object_type || undefined,
      status: getStatusLabel(object?.object_status),
      statusVariant: getStatusVariant(object?.object_status),
      location: object?.current_location_name,
      isOnDisplay: object?.is_on_display,
      isLocationRequired: !!object,
      onSetLocation: callbacks.onMovementClick,
      canCreateTask: permissions.canCreateTask ?? true,
      onCreateTask: callbacks.onCreateTask,
      canGenerateReport: permissions.canGenerateReport,
      onGenerateReport: callbacks.onGenerateReport,
      quickActions,
      maxVisibleActions: 4,
    };
  }, [
    object,
    primaryImageUrl,
    imageAlt,
    media,
    imageModalMedia.length,
    permissions.canCreateTask,
    permissions.canGenerateReport,
    callbacks.onCreateTask,
    callbacks.onGenerateReport,
    callbacks.onMovementClick,
    quickActions,
    openImageModal,
  ]);

  // Build header props
  const headerProps = useMemo(() => {
    // Build header quick actions — include Generate Report if available
    const headerQuickActions = [...quickActions];
    if (permissions.canGenerateReport && callbacks.onGenerateReport) {
      headerQuickActions.push({
        id: 'generate-report',
        label: 'Generate Report',
        icon: FileOutput,
        onClick: callbacks.onGenerateReport,
      });
    }

    return {
      canCreateTask: permissions.canCreateTask ?? true,
      onCreateTask: callbacks.onCreateTask,
      canViewHistory: permissions.canViewHistory ?? true,
      onViewHistory: callbacks.onViewHistory,
      quickActions: headerQuickActions,
    };
  }, [
    permissions.canCreateTask,
    permissions.canViewHistory,
    permissions.canGenerateReport,
    callbacks.onCreateTask,
    callbacks.onViewHistory,
    callbacks.onGenerateReport,
    quickActions,
  ]);

  return {
    railProps,
    headerProps,
    isImageModalOpen,
    openImageModal,
    closeImageModal,
    imageModalMedia,
    imageModalInitialIndex,
  };
}

export default useRecordDetailData;
