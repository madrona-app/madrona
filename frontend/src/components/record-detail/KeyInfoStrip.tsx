/**
 * KeyInfoStrip - Inline key information strip
 *
 * Displays key record information in a horizontal strip below the header.
 * Visible when right rail is collapsed or on smaller screens.
 *
 * Shows: <identifier> • Type • Status • Location • Rights, each of which the
 * caller can omit — not every record is a collection object.
 *
 * @see /docs/record-detail-page-redesign.md
 */

import { Fragment, memo, type ReactNode } from 'react';
import { Globe } from 'lucide-react';
import { cn } from '../../lib/utils';

// =============================================================================
// TYPES
// =============================================================================

export type RightsStatus = 'open' | 'restricted' | 'unknown';

export interface KeyInfoStripProps {
  /** Object number / accession number */
  objectNumber?: string;
  /**
   * Label for the identifier. Defaults to "Object #".
   * Records that are not collection objects should pass their own wording.
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
  /**
   * Whether the record has a physical location. Default true.
   * People and organizations pass false — they are never shelved.
   */
  showLocation?: boolean;
  /** Rights status */
  rightsStatus?: RightsStatus;
  /**
   * Whether the record carries rights at all. Default true.
   * People and organizations pass false — rights attach to objects and
   * media, so "Rights: Unknown" on a person is noise, not a gap.
   */
  showRights?: boolean;
  /** Whether the object is publicly discoverable */
  isDiscoverable?: boolean;
  /** Callback to toggle discoverable status */
  onToggleDiscoverable?: () => void;
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
        'inline-flex items-center px-1.5 py-0.5 text-xs font-medium rounded border',
        variantClasses[variant]
      )}
    >
      {status}
    </span>
  );
}

// =============================================================================
// RIGHTS INDICATOR
// =============================================================================

interface RightsIndicatorProps {
  status: RightsStatus;
}

function RightsIndicator({ status }: RightsIndicatorProps) {
  const config = {
    open: {
      label: 'Open',
      className: 'text-semantic-success',
    },
    restricted: {
      label: 'Restricted',
      className: 'text-semantic-warning',
    },
    unknown: {
      label: 'Unknown',
      className: 'text-archive',
    },
  };

  const { label, className } = config[status];

  return (
    <span className={cn('text-xs font-medium', className)}>
      Rights: {label}
    </span>
  );
}

// =============================================================================
// KEY INFO STRIP
// =============================================================================

export const KeyInfoStrip = memo(function KeyInfoStrip({
  objectNumber,
  identifierLabel = 'Object #',
  objectType,
  status,
  statusVariant = 'default',
  location,
  showLocation = true,
  rightsStatus = 'unknown',
  showRights = true,
  isDiscoverable,
  onToggleDiscoverable,
  className,
}: KeyInfoStripProps) {
  // Every block is optional, and three of them can now be switched off
  // independently. Emitting separators inside each block produced dangling
  // and doubled bullets as soon as one was hidden, so the items are collected
  // first and the bullets interleaved between whatever actually rendered.
  const items: ReactNode[] = [];

  if (objectNumber) {
    items.push(
      <span key="identifier" className="flex items-center gap-1.5">
        <span className="text-archive">{identifierLabel}</span>
        <span className="font-medium text-ink">{objectNumber}</span>
      </span>
    );
  }

  if (objectType) {
    items.push(
      <span key="type" className="flex items-center gap-1.5">
        <span className="text-archive">Type</span>
        <span className="text-ink capitalize">{objectType}</span>
      </span>
    );
  }

  if (status) {
    items.push(
      <span key="status" className="flex items-center gap-1.5">
        <span className="text-archive">Status</span>
        <StatusBadge status={status} variant={statusVariant} />
      </span>
    );
  }

  // Omitted entirely for records that are never shelved.
  if (showLocation) {
    items.push(
      <span key="location" className="flex items-center gap-1.5">
        <span className="text-archive">Location</span>
        <span className={location ? 'text-ink' : 'text-archive italic'}>
          {location || 'Not set'}
        </span>
      </span>
    );
  }

  if (showRights && rightsStatus) {
    items.push(<RightsIndicator key="rights" status={rightsStatus} />);
  }

  return (
    <div
      className={cn(
        'key-info-strip',
        'flex flex-wrap items-center gap-x-4 gap-y-2',
        'px-4 py-2.5',
        'bg-stone/50 rounded-lg',
        'text-sm',
        // Hidden at ≥1280px when right rail is visible
        'lg:hidden',
        className
      )}
      role="region"
      aria-label="Key record information"
    >
      {items.map((item, index) => (
        <Fragment key={index}>
          {index > 0 && (
            <span className="text-lichen" aria-hidden="true">•</span>
          )}
          {item}
        </Fragment>
      ))}

      {/* Public Discovery Toggle — outside the list because it is a control,
          not a read-only field. Its separator is conditional on something
          having rendered before it. */}
      {isDiscoverable !== undefined && onToggleDiscoverable && (
        <>
          {items.length > 0 && (
            <span className="text-lichen" aria-hidden="true">•</span>
          )}
          <span className="flex items-center gap-2">
            <Globe size={14} className={isDiscoverable ? 'text-bark' : 'text-archive'} />
            <span className="text-archive text-xs">Public</span>
            <button
              onClick={onToggleDiscoverable}
              className={cn(
                'relative inline-flex h-4 w-7 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2',
                isDiscoverable ? 'bg-bark' : 'bg-stone'
              )}
              title={isDiscoverable ? 'Visible on public collection page' : 'Hidden from public collection page'}
              aria-label={isDiscoverable ? 'Disable public visibility' : 'Enable public visibility'}
            >
              <span
                className={cn(
                  'inline-block h-3 w-3 transform rounded-full bg-parchment transition-transform shadow-sm',
                  isDiscoverable ? 'translate-x-3.5' : 'translate-x-0.5'
                )}
              />
            </button>
          </span>
        </>
      )}
    </div>
  );
});

export default KeyInfoStrip;
