import { useState, useEffect, useRef, type ReactNode } from 'react';
import { ArrowLeft, Edit, Eye, Check, Loader2, X, Image as ImageIcon, MapPin } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatTime } from '../../lib/formatters';
import { cn } from '../../lib/utils';

interface LocationInfo {
  /** Location name */
  name: string;
  /** Whether the location is a display/gallery location */
  isOnDisplay?: boolean | null;
}

interface WorkspaceHeaderProps {
  /** Back navigation URL */
  backUrl: string;
  /** Back link text */
  backText?: string;
  /** Object thumbnail URL */
  thumbnailUrl?: string | null;
  /** Object title */
  title: string;
  /** Object number (optional for create mode) */
  objectNumber?: string;
  /** Creator info */
  creator?: string | null;
  /** Date info */
  date?: string | null;
  /** Current location info (derived from movements) */
  locationInfo?: LocationInfo | null;
  /** Parts location summary (for multi-part objects, replaces locationInfo) */
  partsLocationSummary?: ReactNode;
  /** Current mode */
  isEditing: boolean;
  /** Toggle mode callback (optional in create mode) */
  onToggleMode?: () => void;
  /** Save status */
  saveStatus?: 'idle' | 'saving' | 'saved' | 'error';
  /** Has unsaved changes */
  hasUnsavedChanges?: boolean;
  /** Last saved timestamp */
  lastSaved?: Date | null;
  /** Click on image to open viewer */
  onImageClick?: () => void;
  /** Explicit save callback (for create mode) */
  onSave?: () => void;
  /** Show create button instead of edit toggle */
  showCreateButton?: boolean;
  /** Custom text for create button (default: "Create Object") */
  createButtonText?: string;
  /** Status badge element (e.g., "Approved", "Pending") */
  statusBadge?: ReactNode;
  /** Type badge element (e.g., "Research", "Exhibition") */
  typeBadge?: ReactNode;
  /** Additional action buttons (shown in view mode) */
  actions?: ReactNode;
}

/**
 * Unified header for Object Workspace.
 * Shows object identity and mode toggle.
 * Becomes sticky when scrolling.
 */
export function WorkspaceHeader({
  backUrl,
  backText = 'Back to Collection',
  thumbnailUrl,
  title,
  objectNumber,
  creator,
  date,
  locationInfo,
  partsLocationSummary,
  isEditing,
  onToggleMode,
  saveStatus = 'idle',
  hasUnsavedChanges = false,
  lastSaved,
  onImageClick,
  onSave,
  showCreateButton = false,
  createButtonText = 'Create Object',
  statusBadge,
  typeBadge,
  actions,
}: WorkspaceHeaderProps) {
  const [isSticky, setIsSticky] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Detect sticky state
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsSticky(!entry.isIntersecting),
      { threshold: 0, rootMargin: '-1px 0px 0px 0px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  // Format last saved time
  const formatLastSaved = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    return formatTime(date);
  };

  return (
    <>
      {/* Back Navigation - always in flow */}
      <Link
        to={backUrl}
        className="inline-flex items-center gap-1.5 text-sm text-archive hover:text-ink mb-6 transition-colors"
      >
        <ArrowLeft size={16} />
        {backText}
      </Link>

      {/* Sentinel for sticky detection */}
      <div ref={sentinelRef} className="h-px -mt-px" aria-hidden="true" />

      {/* Sticky Header */}
      <div
        className={cn(
          'sticky top-0 z-40 -mx-6 px-6 py-4 transition-[background-color,box-shadow,border-color] duration-200',
          isSticky
            ? 'bg-parchment/95 backdrop-blur-sm shadow-md border-b border-lichen/50'
            : 'bg-transparent border-b border-transparent',
          isEditing && 'bg-bark/5'
        )}
      >
        <div className="flex items-start justify-between gap-4">
          {/* Left: Identity */}
          <div className="flex items-center gap-4 min-w-0 flex-1">
            {/* Thumbnail */}
            {thumbnailUrl && (
              <div
                onClick={onImageClick}
                className="flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border border-lichen/40 bg-stone/50 cursor-pointer group"
              >
                <img
                  src={thumbnailUrl}
                  alt=""
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                />
              </div>
            )}
            {!thumbnailUrl && (
              <div className="flex-shrink-0 w-16 h-16 rounded-lg border border-lichen/40 bg-stone/50 flex items-center justify-center">
                <ImageIcon size={24} className="text-archive" />
              </div>
            )}

            {/* Title & Info */}
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <p className="text-sm text-archive tracking-wide uppercase">
                  {objectNumber}
                </p>
                {typeBadge}
                {statusBadge}
              </div>
              <h1 className="font-serif font-semibold text-forest text-2xl truncate">
                {title || 'Untitled'}
              </h1>
              {(creator || date || locationInfo || partsLocationSummary) && (
                <p className="text-archive text-sm mt-1 flex items-center flex-wrap gap-1">
                  {creator}
                  {creator && date && ' · '}
                  {date}
                  {(creator || date) && (locationInfo || partsLocationSummary) && <span className="mx-1">·</span>}
                  {partsLocationSummary ? (
                    partsLocationSummary
                  ) : locationInfo ? (
                    <span className="inline-flex items-center gap-1">
                      <MapPin size={12} className="inline" />
                      {locationInfo.name}
                      {locationInfo.isOnDisplay && (
                        <span className="ml-1 px-1.5 py-0.5 text-xs bg-forest/10 text-forest rounded">
                          On Display
                        </span>
                      )}
                    </span>
                  ) : null}
                </p>
              )}
            </div>
          </div>

          {/* Right: Actions, Mode Toggle & Status */}
          <div className="flex items-center gap-3 flex-shrink-0">
            {/* Custom Actions (view mode only) */}
            {!isEditing && actions}

            {/* Save Status (edit mode only) */}
            {isEditing && (
              <div className="flex items-center gap-2 text-xs">
                {saveStatus === 'saving' && (
                  <span className="flex items-center gap-1.5 text-archive">
                    <Loader2 size={14} className="animate-spin" />
                    <span className="hidden sm:inline">Saving...</span>
                  </span>
                )}
                {saveStatus === 'saved' && lastSaved && (
                  <span className="flex items-center gap-1.5 text-semantic-success">
                    <Check size={14} className="stroke-[2.5]" />
                    <span className="hidden sm:inline">Saved {formatLastSaved(lastSaved)}</span>
                  </span>
                )}
                {saveStatus === 'error' && (
                  <span className="flex items-center gap-1.5 text-semantic-error">
                    <X size={14} />
                    <span className="hidden sm:inline">Error saving</span>
                  </span>
                )}
                {saveStatus === 'idle' && hasUnsavedChanges && (
                  <span className="text-semantic-warning hidden sm:inline">Unsaved changes</span>
                )}
              </div>
            )}

            {/* Create Button (create mode) or Mode Toggle Button */}
            {showCreateButton ? (
              <button
                type="button"
                onClick={onSave}
                disabled={saveStatus === 'saving'}
                className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm bg-bark text-parchment hover:bg-copper-dark hover:text-parchment transition-all disabled:opacity-50"
              >
                {saveStatus === 'saving' ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    <span>Creating...</span>
                  </>
                ) : (
                  <>
                    <Check size={16} />
                    <span>{createButtonText}</span>
                  </>
                )}
              </button>
            ) : onToggleMode && (
              <button
                type="button"
                onClick={onToggleMode}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all',
                  isEditing
                    ? 'bg-parchment border border-lichen text-ink hover:bg-stone/50'
                    : 'bg-bark text-parchment hover:bg-copper-dark hover:text-parchment'
                )}
              >
                {isEditing ? (
                  <>
                    <Eye size={16} />
                    <span>Done</span>
                  </>
                ) : (
                  <>
                    <Edit size={16} />
                    <span>Edit</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * Mode indicator bar that appears below header in edit mode.
 * Subtle visual cue that editing is active.
 */
export function EditModeIndicator({ isVisible }: { isVisible: boolean }) {
  if (!isVisible) return null;

  return (
    <div className="bg-bark/5 border-b border-bark/10 px-6 py-2 -mx-6 mb-4">
      <p className="text-xs text-bark flex items-center gap-2">
        <Edit size={12} />
        <span>Editing mode — changes save automatically</span>
      </p>
    </div>
  );
}

/**
 * Read-only banner shown when the user lacks edit permission.
 * Place below the header / workflow indicators, above sections.
 */
export function ReadOnlyBanner({ visible, className }: { visible: boolean; className?: string }) {
  if (!visible) return null;

  return (
    <div className={cn(
      'flex items-center gap-2 px-4 py-2 mb-4 rounded-lg',
      'bg-stone/60 border border-lichen text-archive text-sm',
      className,
    )}>
      <Eye size={14} className="shrink-0" />
      <span>View only — you don't have permission to edit this record</span>
    </div>
  );
}
