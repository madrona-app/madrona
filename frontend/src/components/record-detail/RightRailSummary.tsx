/**
 * RightRailSummary - Sticky right rail for record detail pages
 *
 * Displays always-visible context:
 * - Primary image thumbnail
 * - Key identifiers (object number, type, status, location)
 * - "Set now →" link for missing required location (opens movement slide-over)
 * - Quick actions (permission-filtered)
 *
 * @see /docs/record-detail-page-redesign.md
 */

import { useState, type ReactNode } from 'react';
import {
  MapPin,
  Expand,
  MoreHorizontal,
  Plus,
  AlertTriangle,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Globe,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../../lib/utils';

// =============================================================================
// TYPES
// =============================================================================

export interface QuickAction {
  id: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  variant?: 'default' | 'outline' | 'destructive';
  permission?: string;
}

export interface MediaItemForRail {
  media_id: string;
  url?: string;
  thumbnail_url?: string;
  filename?: string;
  is_primary?: boolean;
  /** Optional label to display (e.g., object description) */
  label?: string;
}

export interface EntryLocation {
  entryNumber: string;
  locationName: string | null;
}

export interface RightRailSummaryProps {
  /** Primary image URL (legacy - prefer media array) */
  imageUrl?: string | null;
  /** Alt text for image */
  imageAlt?: string;
  /** Array of media items for slideshow */
  media?: MediaItemForRail[];
  /** Callback when image expand button is clicked - receives current index */
  onExpandImage?: (index?: number) => void;
  /** Object number / accession number */
  objectNumber?: string;
  /**
   * Label for the identifier row. Defaults to "Object #".
   * Records that are not collection objects should pass their own wording —
   * a person has no object number.
   */
  identifierLabel?: string;
  /** Object type */
  objectType?: string;
  /** Current status */
  status?: string;
  /** Status badge variant */
  statusVariant?: 'default' | 'success' | 'warning' | 'error';
  /** Current location */
  location?: string | null;
  /** Is object currently on display */
  isOnDisplay?: boolean;
  /** Is location a required field */
  isLocationRequired?: boolean;
  /**
   * Whether the record has a physical location at all. Defaults to true.
   * Pass false for records that are never shelved (people, organizations) —
   * otherwise the rail shows a permanently empty Location row.
   */
  showLocation?: boolean;
  /** Callback when "Set now" is clicked for missing location (opens movement slide-over) */
  onSetLocation?: () => void;
  /** Entry locations for loan records (shows list instead of single location) */
  entryLocations?: EntryLocation[];
  /** Whether user can create tasks */
  canCreateTask?: boolean;
  /** Callback when Create Task button is clicked */
  onCreateTask?: () => void;
  /** Whether user can generate reports */
  canGenerateReport?: boolean;
  /** Callback when Generate Report button is clicked */
  onGenerateReport?: () => void;
  /** Quick actions (permission-filtered by parent) */
  quickActions?: QuickAction[];
  /** Maximum visible quick actions before overflow (default managed by budget) */
  maxVisibleActions?: number;
  /** Whether the object is publicly discoverable */
  isDiscoverable?: boolean;
  /** Callback to toggle discoverable status */
  onToggleDiscoverable?: () => void;
  /** Additional content to render below quick actions */
  children?: ReactNode;
  /** Additional CSS classes */
  className?: string;
}

// =============================================================================
// STATUS BADGE
// =============================================================================

interface StatusBadgeProps {
  status: string;
  variant?: 'default' | 'success' | 'warning' | 'error';
}

function StatusBadge({ status, variant = 'default' }: StatusBadgeProps) {
  const variantClasses = {
    default: 'bg-stone text-ink border-lichen',
    success: 'bg-semantic-success/10 text-semantic-success border-semantic-success/20',
    warning: 'bg-semantic-warning/10 text-semantic-warning border-semantic-warning/20',
    error: 'bg-semantic-error/10 text-semantic-error border-semantic-error/20',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 text-xs font-medium rounded border',
        variantClasses[variant]
      )}
    >
      {status}
    </span>
  );
}

// =============================================================================
// MEDIA THUMBNAIL WITH NAVIGATION
// =============================================================================

interface MediaThumbnailProps {
  imageUrl?: string | null;
  imageAlt?: string;
  media?: MediaItemForRail[];
  onExpand?: (index?: number) => void;
}

function MediaThumbnail({ imageUrl, imageAlt, media, onExpand }: MediaThumbnailProps) {
  const [currentIndex, setCurrentIndex] = useState(0);

  // Use media array if provided, otherwise fall back to single imageUrl
  const hasMultipleImages = media && media.length > 1;
  const currentMedia = media && media.length > 0 ? media[currentIndex] : null;
  const currentImage = currentMedia
    ? currentMedia.thumbnail_url
    : imageUrl;
  const currentLabel = currentMedia?.label;

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (media && media.length > 0) {
      setCurrentIndex((prev) => (prev === 0 ? media.length - 1 : prev - 1));
    }
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (media && media.length > 0) {
      setCurrentIndex((prev) => (prev === media.length - 1 ? 0 : prev + 1));
    }
  };

  if (!currentImage) {
    return (
      <div className="aspect-[4/3] bg-stone rounded-lg flex items-center justify-center">
        <div className="text-archive text-sm">No image</div>
      </div>
    );
  }

  return (
    <div className="relative group">
      <div className="aspect-[4/3] bg-stone rounded-lg overflow-hidden">
        <img
          src={currentImage}
          alt={imageAlt || 'Image'}
          className="w-full h-full object-contain opacity-0 transition-opacity duration-200"
          onLoad={(e) => { (e.target as HTMLImageElement).classList.remove('opacity-0'); }}
        />
      </div>

      {/* Navigation arrows - only show if multiple images */}
      {hasMultipleImages && (
        <>
          <button
            onClick={handlePrev}
            className={cn(
              'absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full',
              'bg-ink/70 text-parchment',
              'opacity-0 group-hover:opacity-100 transition-opacity',
              'hover:bg-ink',
              'focus-visible:outline-none focus-visible:opacity-100'
            )}
            title="Previous image"
            aria-label="Previous image"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={handleNext}
            className={cn(
              'absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full',
              'bg-ink/70 text-parchment',
              'opacity-0 group-hover:opacity-100 transition-opacity',
              'hover:bg-ink',
              'focus-visible:outline-none focus-visible:opacity-100'
            )}
            title="Next image"
            aria-label="Next image"
          >
            <ChevronRight size={18} />
          </button>

          {/* Image counter */}
          <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-ink/70 text-parchment text-xs">
            {currentIndex + 1} / {media.length}
          </div>
        </>
      )}

      {onExpand && (
        <button
          onClick={() => onExpand(currentIndex)}
          className={cn(
            'absolute bottom-2 right-2 p-2 rounded-lg',
            'bg-ink/70 text-parchment',
            'opacity-0 group-hover:opacity-100 transition-opacity',
            'hover:bg-ink',
            'focus-visible:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2'
          )}
          title="Expand image"
          aria-label="Expand image to full size"
        >
          <Expand size={16} />
        </button>
      )}

      {/* Label caption below image */}
      {currentLabel && (
        <p className="mt-2 text-xs text-archive text-center line-clamp-2" title={currentLabel}>
          {currentLabel}
        </p>
      )}
    </div>
  );
}

// =============================================================================
// IDENTIFIERS LIST
// =============================================================================

interface IdentifiersListProps {
  objectNumber?: string;
  identifierLabel?: string;
  objectType?: string;
  status?: string;
  statusVariant?: 'default' | 'success' | 'warning' | 'error';
  location?: string | null;
  isOnDisplay?: boolean;
  isLocationRequired?: boolean;
  showLocation?: boolean;
  onSetLocation?: () => void;
  entryLocations?: EntryLocation[];
}

function IdentifiersList({
  objectNumber,
  identifierLabel = 'Object #',
  objectType,
  status,
  statusVariant,
  location,
  isOnDisplay,
  isLocationRequired = false,
  showLocation = true,
  onSetLocation,
  entryLocations,
}: IdentifiersListProps) {
  // Determine if location is missing and required
  const isLocationMissing = !location && isLocationRequired;
  // Use entry locations if provided (for loan records)
  const hasEntryLocations = entryLocations && entryLocations.length > 0;
  // Records with no location concept (people, organizations) omit the row
  // entirely rather than showing one that is permanently "Not set".
  const showEntryLocations = showLocation && hasEntryLocations;
  const showSingleLocation = showLocation && !hasEntryLocations;

  return (
    <dl className="space-y-3">
      {objectNumber && (
        <div>
          <dt className="text-xs font-medium text-archive uppercase tracking-wide">
            {identifierLabel}
          </dt>
          <dd className="text-sm font-medium text-ink mt-0.5">{objectNumber}</dd>
        </div>
      )}

      {objectType && (
        <div>
          <dt className="text-xs font-medium text-archive uppercase tracking-wide">
            Type
          </dt>
          <dd className="text-sm text-ink mt-0.5 capitalize">{objectType}</dd>
        </div>
      )}

      {status && (
        <div>
          <dt className="text-xs font-medium text-archive uppercase tracking-wide">
            Status
          </dt>
          <dd className="mt-0.5">
            <StatusBadge status={status} variant={statusVariant} />
          </dd>
        </div>
      )}

      {showEntryLocations && (
        // Entry locations list for loan records
        <div>
          <dt className="text-xs font-medium text-archive uppercase tracking-wide">
            Object Locations
          </dt>
          <dd className="text-sm mt-0.5">
            <div className="space-y-1">
              {entryLocations!.map((entry, index) => (
                <div key={index} className="flex items-center gap-1.5">
                  <MapPin size={14} className="text-archive flex-shrink-0" />
                  <span className="text-ink">{entry.entryNumber}:</span>
                  <span className={entry.locationName ? 'text-ink' : 'text-archive'}>
                    {entry.locationName || 'Not set'}
                  </span>
                </div>
              ))}
            </div>
          </dd>
        </div>
      )}

      {showSingleLocation && (
        <div>
          <dt className="text-xs font-medium text-archive uppercase tracking-wide">
            Location
          </dt>
          <dd className="text-sm mt-0.5">
            {location ? (
            <div className="flex items-center gap-1.5">
              <MapPin size={14} className="text-archive flex-shrink-0" />
              <span className="text-ink">{location}</span>
              {isOnDisplay && (
                <span className="text-xs text-semantic-success flex-shrink-0">(On display)</span>
              )}
            </div>
          ) : isLocationMissing ? (
            // Required but missing - error styling with "Set now →" link
            <div className="flex items-center gap-1.5 flex-wrap">
              <AlertTriangle size={14} className="text-semantic-error flex-shrink-0" />
              <span className="text-semantic-error font-medium">Not set</span>
              {onSetLocation && (
                <button
                  onClick={onSetLocation}
                  className={cn(
                    'inline-flex items-center gap-0.5 text-xs text-bark',
                    'hover:underline underline-offset-2',
                    'focus-visible:outline-none focus-visible:underline'
                  )}
                  aria-label="Record movement to set location"
                >
                  Set now
                  <ArrowRight size={12} />
                </button>
              )}
            </div>
          ) : (
            // Not required, just empty - neutral styling
            <div className="flex items-center gap-1.5">
              <MapPin size={14} className="text-archive flex-shrink-0" />
              <span className="text-archive">Not set</span>
            </div>
          )}
          </dd>
        </div>
      )}
    </dl>
  );
}

// =============================================================================
// QUICK ACTIONS LIST
// =============================================================================

interface QuickActionsListProps {
  actions: QuickAction[];
  maxVisible?: number;
}

function QuickActionsList({ actions, maxVisible = 5 }: QuickActionsListProps) {
  const [showAll, setShowAll] = useState(false);

  if (actions.length === 0) return null;

  const visibleActions = showAll ? actions : actions.slice(0, maxVisible);
  const hasMore = actions.length > maxVisible;

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium text-archive uppercase tracking-wide">
        Quick Actions
      </h4>
      <div className="space-y-1.5">
        {visibleActions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.id}
              onClick={action.onClick}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-colors text-left',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2',
                action.variant === 'destructive'
                  ? 'text-semantic-error hover:bg-semantic-error/10'
                  : 'text-ink hover:bg-stone border border-lichen'
              )}
            >
              <Icon size={16} className="flex-shrink-0" />
              <span>{action.label}</span>
            </button>
          );
        })}

        {hasMore && !showAll && (
          <button
            onClick={() => setShowAll(true)}
            className={cn(
              'w-full flex items-center gap-2 px-3 py-2 text-sm text-archive hover:text-ink transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2'
            )}
          >
            <MoreHorizontal size={16} />
            <span>More actions…</span>
          </button>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// DEFAULT QUICK ACTIONS
// =============================================================================

export const DEFAULT_QUICK_ACTIONS: Omit<QuickAction, 'onClick'>[] = [
  { id: 'movement', label: 'Record Movement', icon: MapPin, permission: 'collections.movements.create' },
  { id: 'condition', label: 'Condition Report', icon: MapPin, permission: 'collections.conditions.create' },
  { id: 'loan', label: 'Loan Request', icon: MapPin, permission: 'collections.loans.create' },
  { id: 'incident', label: 'Report Incident', icon: AlertTriangle, permission: 'collections.incidents.create' },
];

// =============================================================================
// RIGHT RAIL SUMMARY COMPONENT
// =============================================================================

export function RightRailSummary({
  imageUrl,
  imageAlt,
  media,
  onExpandImage,
  objectNumber,
  identifierLabel,
  objectType,
  status,
  statusVariant,
  location,
  isOnDisplay,
  isLocationRequired = true, // Default to required
  showLocation = true,
  onSetLocation,
  entryLocations,
  canCreateTask = false,
  onCreateTask,
  canGenerateReport = false,
  onGenerateReport,
  quickActions = [],
  maxVisibleActions = 4,
  isDiscoverable,
  onToggleDiscoverable,
  children,
  className,
}: RightRailSummaryProps) {
  return (
    <div className={cn('space-y-6', className)}>
      {/* Primary Image with Navigation — only show if there's media or an image */}
      {(imageUrl || (media && media.length > 0)) && (
        <MediaThumbnail
          imageUrl={imageUrl}
          imageAlt={imageAlt}
          media={media}
          onExpand={onExpandImage}
        />
      )}

      {/* Key Identifiers — only show if there's any data to display */}
      {(objectNumber || objectType || status || location || (entryLocations && entryLocations.length > 0)) && (
        <IdentifiersList
          objectNumber={objectNumber}
          identifierLabel={identifierLabel}
          objectType={objectType}
          status={status}
          statusVariant={statusVariant}
          location={location}
          isOnDisplay={isOnDisplay}
          isLocationRequired={isLocationRequired}
          showLocation={showLocation}
          onSetLocation={onSetLocation}
          entryLocations={entryLocations}
        />
      )}

      {/* Public Discovery Toggle */}
      {isDiscoverable !== undefined && onToggleDiscoverable && (
        <div className="flex items-center justify-between py-2 border-t border-lichen">
          <div className="flex items-center gap-2">
            <Globe size={16} className={isDiscoverable ? 'text-bark' : 'text-archive'} />
            <div>
              <span className="text-sm font-medium text-ink">Public</span>
              <p className="text-xs text-archive">
                {isDiscoverable ? 'Visible on public page' : 'Hidden from public'}
              </p>
            </div>
          </div>
          <button
            onClick={onToggleDiscoverable}
            className={cn(
              'relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2',
              isDiscoverable ? 'bg-bark' : 'bg-stone'
            )}
            title={isDiscoverable ? 'Click to hide from public collection page' : 'Click to show on public collection page'}
            aria-label={isDiscoverable ? 'Disable public visibility' : 'Enable public visibility'}
          >
            <span
              className={cn(
                'inline-block h-3.5 w-3.5 transform rounded-full bg-parchment transition-transform shadow-sm',
                isDiscoverable ? 'translate-x-5' : 'translate-x-0.5'
              )}
            />
          </button>
        </div>
      )}

      {/* Create Task Button */}
      {canCreateTask && onCreateTask && (
        <button
          onClick={onCreateTask}
          className={cn(
            'w-full flex items-center justify-center gap-2 px-4 py-2.5',
            'text-sm font-medium rounded-lg transition-colors',
            'bg-bark text-parchment hover:bg-bark/90',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2'
          )}
          aria-label="Create a new task for this record"
        >
          <Plus size={16} />
          Create Task
        </button>
      )}

      {/* Generate Report Button */}
      {canGenerateReport && onGenerateReport && (
        <button
          onClick={onGenerateReport}
          className={cn(
            'w-full flex items-center justify-center gap-2 px-4 py-2.5',
            'text-sm font-medium rounded-lg transition-colors',
            'border border-forest text-forest hover:bg-forest hover:text-parchment',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2'
          )}
        >
          Generate Report
        </button>
      )}

      {/* Quick Actions */}
      {quickActions.length > 0 && (
        <QuickActionsList
          actions={quickActions}
          maxVisible={maxVisibleActions}
        />
      )}

      {/* Additional content */}
      {children}
    </div>
  );
}

export default RightRailSummary;
