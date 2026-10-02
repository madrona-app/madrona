import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Check, Loader2, Image as ImageIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatTime } from '../../lib/formatters';
import { cn } from '../../lib/utils';

interface ObjectIdentityHeaderProps {
  /** Back link URL */
  backUrl: string;
  /** Back link text */
  backText?: string;
  /** Object thumbnail URL */
  thumbnailUrl?: string | null;
  /** Display title of the object */
  title: string;
  /** Object accession number */
  objectNumber: string;
  /** Current status (e.g., "Accessioned", "On Loan") */
  status?: string;
  /** Status variant for coloring */
  statusVariant?: 'default' | 'success' | 'warning' | 'info';
  /** Show saving indicator */
  isSaving?: boolean;
  /** Last saved timestamp */
  lastSaved?: Date | null;
  /** Has unsaved changes */
  hasUnsavedChanges?: boolean;
}

const STATUS_STYLES = {
  default: 'bg-stone text-ink',
  success: 'bg-semantic-success/10 text-semantic-success',
  warning: 'bg-semantic-warning/10 text-semantic-warning',
  info: 'bg-azurite/10 text-azurite',
};

const STATUS_VARIANT_MAP: Record<string, 'default' | 'success' | 'warning' | 'info'> = {
  active: 'success',
  accessioned: 'success',
  on_loan: 'info',
  in_conservation: 'warning',
  pending: 'warning',
  deaccessioned: 'default',
  missing: 'warning',
  destroyed: 'default',
};

/**
 * Sticky header showing object identity while editing.
 * Remains visible during scroll for context.
 */
export function ObjectIdentityHeader({
  backUrl,
  backText = 'Back to Object',
  thumbnailUrl,
  title,
  objectNumber,
  status,
  statusVariant,
  isSaving = false,
  lastSaved,
  hasUnsavedChanges = false,
}: ObjectIdentityHeaderProps) {
  const [isSticky, setIsSticky] = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Detect when header becomes sticky
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsSticky(!entry.isIntersecting);
      },
      { threshold: 0, rootMargin: '-1px 0px 0px 0px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  // Determine status variant from status value
  const resolvedVariant = statusVariant || (status ? STATUS_VARIANT_MAP[status] || 'default' : 'default');

  // Format status for display
  const displayStatus = status
    ? status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : null;

  // Format last saved time
  const formatLastSaved = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins === 1) return '1 min ago';
    if (diffMins < 60) return `${diffMins} mins ago`;
    return formatTime(date);
  };

  return (
    <>
      {/* Back Link - always in document flow, not part of sticky header */}
      <div className="py-4">
        <Link
          to={backUrl}
          className="inline-flex items-center gap-1.5 text-sm text-archive hover:text-ink transition-colors"
        >
          <ArrowLeft size={16} />
          {backText}
        </Link>
      </div>

      {/* Sentinel element to detect when header should become compact */}
      <div ref={sentinelRef} className="h-px -mt-px" aria-hidden="true" />

      {/* Sticky Header */}
      <div
        ref={headerRef}
        className={cn(
          'sticky top-0 z-40 -mx-6 px-6 py-3 transition-all duration-200',
          isSticky
            ? 'bg-parchment/95 backdrop-blur-sm shadow-md border-b border-lichen/50'
            : 'bg-transparent'
        )}
      >
        {/* Identity Row */}
        <div className="flex items-center gap-4">
          {/* Thumbnail */}
          <div className={cn(
            'flex-shrink-0 bg-stone/50 rounded-lg overflow-hidden border border-lichen/40 flex items-center justify-center transition-all duration-200',
            isSticky ? 'w-10 h-10' : 'w-14 h-14'
          )}>
            {thumbnailUrl ? (
              <img
                src={thumbnailUrl}
                alt=""
                className="w-full h-full object-cover"
              />
            ) : (
              <ImageIcon
                size={isSticky ? 16 : 20}
                className="text-archive"
              />
            )}
          </div>

          {/* Title & Number */}
          <div className="flex-1 min-w-0">
            <h1 className={cn(
              'font-serif font-semibold text-forest truncate transition-all duration-200',
              isSticky ? 'text-base' : 'text-xl'
            )}>
              {title || 'Untitled Object'}
            </h1>
            <p className="text-xs text-archive truncate">
              {objectNumber}
            </p>
          </div>

          {/* Status Badge */}
          {displayStatus && (
            <span className={cn(
              'flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-medium',
              STATUS_STYLES[resolvedVariant]
            )}>
              {displayStatus}
            </span>
          )}

          {/* Save Status Indicator */}
          <div className="flex-shrink-0 flex items-center gap-2 text-xs">
            {isSaving ? (
              <span className="flex items-center gap-1.5 text-archive">
                <Loader2 size={14} className="animate-spin" />
                <span className="hidden sm:inline">Saving...</span>
              </span>
            ) : hasUnsavedChanges ? (
              <span className="text-semantic-warning hidden sm:inline">
                Unsaved changes
              </span>
            ) : lastSaved ? (
              <span className="flex items-center gap-1.5 text-semantic-success">
                <Check size={14} className="stroke-[2.5]" />
                <span className="hidden sm:inline">
                  Saved {formatLastSaved(lastSaved)}
                </span>
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
