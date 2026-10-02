/**
 * RecordHeader - Header component for record detail pages
 *
 * Displays:
 * - Back link
 * - Record title and subtitle
 * - Action bar: More dropdown (Edit removed - click-to-edit on sections instead)
 *
 * The header scrolls with content (NOT sticky).
 * Only the action bar becomes sticky when header scrolls out of view.
 *
 * @see /docs/record-detail-page-redesign.md
 */

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { ActionMenu, type ActionMenuItem } from './ActionMenu';

// =============================================================================
// TYPES
// =============================================================================

export interface RecordHeaderProps {
  /** Object identifier (shown next to title) */
  objectNumber?: string;
  /** Primary title */
  title: string;
  /** Subtitle or brief description */
  subtitle?: string;
  /** Back link URL (defaults to browser history) */
  backUrl?: string;
  /** Back link label */
  backLabel?: string;
  /** Whether user can create tasks */
  canCreateTask?: boolean;
  /** Callback when Create Task is clicked (from More menu) */
  onCreateTask?: () => void;
  /** Whether user can view history */
  canViewHistory?: boolean;
  /** Callback when View History is clicked */
  onViewHistory?: () => void;
  /** Whether user can delete the record */
  canDelete?: boolean;
  /** Callback when Delete is clicked */
  onDelete?: () => void;
  /** Quick actions for More menu (same as right rail) */
  quickActions?: ActionMenuItem[];
  /** Additional CSS classes */
  className?: string;
}

// =============================================================================
// BACK LINK COMPONENT
// =============================================================================

interface BackLinkProps {
  url?: string;
  label: string;
}

function BackLink({ url, label }: BackLinkProps) {
  const navigate = useNavigate();

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (url) {
        navigate(url);
      } else {
        navigate(-1);
      }
    },
    [navigate, url]
  );

  return (
    <a
      href={url || '#'}
      onClick={handleClick}
      className={cn(
        'inline-flex items-center gap-1.5 text-sm text-archive transition-colors',
        'hover:text-ink focus-visible:outline-none focus-visible:text-ink'
      )}
    >
      <ArrowLeft size={16} />
      <span>{label}</span>
    </a>
  );
}

// =============================================================================
// RECORD HEADER COMPONENT
// =============================================================================

export function RecordHeader({
  objectNumber,
  title,
  subtitle,
  backUrl,
  backLabel = 'Back',
  canCreateTask = false,
  onCreateTask,
  canViewHistory = false,
  onViewHistory,
  canDelete = false,
  onDelete,
  quickActions = [],
  className,
}: RecordHeaderProps) {
  return (
    <div className={cn('space-y-4', className)}>
      {/* Top row: back link + actions */}
      <div className="flex items-center justify-between gap-4">
        <BackLink url={backUrl} label={backLabel} />

        {/* Action bar */}
        <div className="flex items-center gap-2">
          {/* More dropdown (for secondary actions) */}
          <ActionMenu
            canCreateTask={canCreateTask}
            onCreateTask={onCreateTask}
            canViewHistory={canViewHistory}
            onViewHistory={onViewHistory}
            quickActions={quickActions}
            size="md"
          />

          {/* Direct delete button */}
          {canDelete && onDelete && (
            <button
              onClick={onDelete}
              className={cn(
                'inline-flex items-center justify-center p-2 rounded-lg border border-lichen transition-colors',
                'text-archive hover:text-semantic-error hover:bg-semantic-error/10 hover:border-semantic-error/30',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-semantic-error/30 focus-visible:ring-offset-2'
              )}
              aria-label="Delete record"
              title="Delete record"
            >
              <Trash2 size={18} />
            </button>
          )}
        </div>
      </div>

      {/* Title area */}
      <div>
        <h1 className="text-2xl font-semibold text-ink leading-tight">
          {title}
          {objectNumber && (
            <span className="ml-2 text-lg font-normal text-archive">
              {objectNumber}
            </span>
          )}
        </h1>
        {subtitle && (
          <p className="mt-1 text-base text-archive line-clamp-2">{subtitle}</p>
        )}
      </div>
    </div>
  );
}

export default RecordHeader;
