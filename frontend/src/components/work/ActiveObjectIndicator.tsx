/**
 * ActiveObjectIndicator - Displays the currently active object context
 *
 * Per specification:
 * - Shows accession number (required)
 * - Shows truncated title (required)
 * - Provides clear/change affordance (required)
 * - Context changes must be intentional and low-friction
 */

import { X, Package } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useWork } from '../../contexts/WorkContext';
import { useOrganization } from '../../contexts/useOrganization';
import { cn } from '../../lib/utils';

interface ActiveObjectIndicatorProps {
  /** Compact mode for sidebar placement */
  compact?: boolean;
  /** Show change object option */
  showChangeOption?: boolean;
  /** Callback when user wants to change object */
  onChangeRequest?: () => void;
  className?: string;
}

export function ActiveObjectIndicator({
  compact = false,
  showChangeOption = true,
  onChangeRequest,
  className,
}: ActiveObjectIndicatorProps) {
  const { activeObject, clearActiveObject } = useWork();
  const { activeOrganization } = useOrganization();

  if (!activeObject) {
    return null;
  }

  const truncatedTitle = activeObject.title.length > (compact ? 20 : 35)
    ? activeObject.title.slice(0, compact ? 20 : 35) + '...'
    : activeObject.title;

  const objectPath = activeOrganization
    ? `/organizations/${activeOrganization?.organization_id}/collections/objects/${activeObject.object_id}`
    : '#';

  if (compact) {
    // Compact mode: single-line pill
    return (
      <div className={cn('flex items-center gap-1', className)}>
        <div className="flex items-center gap-1.5 px-2 py-1 bg-bark/10 rounded-md text-xs">
          <Package size={12} className="text-bark flex-shrink-0" />
          <Link
            to={objectPath}
            className="font-medium text-bark hover:text-copper-dark truncate max-w-[120px]"
            title={`${activeObject.accession_number} — ${activeObject.title}`}
          >
            {activeObject.accession_number}
          </Link>
          <button
            onClick={clearActiveObject}
            className="text-archive hover:text-ink p-0.5 -mr-1"
            title="Clear active object"
          >
            <X size={12} />
          </button>
        </div>
      </div>
    );
  }

  // Full mode: card with inline actions
  return (
    <div className={cn('rounded-lg border bg-bark/5 border-bark/20', className)}>
      {/* Object info */}
      <Link
        to={objectPath}
        className="flex items-center gap-3 p-3 hover:bg-bark/10 transition-colors rounded-t-lg"
      >
        {/* Thumbnail or icon */}
        {activeObject.thumbnail_url ? (
          <img
            src={activeObject.thumbnail_url}
            alt=""
            className="w-10 h-10 rounded object-cover flex-shrink-0"
          />
        ) : (
          <div className="w-10 h-10 rounded bg-stone/50 flex items-center justify-center flex-shrink-0">
            <Package size={16} className="text-archive" />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <p className="text-xs text-bark font-medium tracking-wide">
            {activeObject.accession_number}
          </p>
          <p className="text-sm text-ink truncate" title={activeObject.title}>
            {truncatedTitle}
          </p>
        </div>
      </Link>

      {/* Actions */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-bark/10">
        {showChangeOption && onChangeRequest && (
          <button
            onClick={onChangeRequest}
            className="text-xs text-bark hover:text-copper-dark"
          >
            Change
          </button>
        )}
        {showChangeOption && onChangeRequest && (
          <span className="text-archive">·</span>
        )}
        <button
          onClick={clearActiveObject}
          className="text-xs text-archive hover:text-semantic-error"
        >
          Clear
        </button>
      </div>
    </div>
  );
}

/**
 * Inline active object badge for use in headers/toolbars
 */
export function ActiveObjectBadge({ className }: { className?: string }) {
  const { activeObject, clearActiveObject } = useWork();
  const { activeOrganization } = useOrganization();

  if (!activeObject) {
    return null;
  }

  const truncatedTitle = activeObject.title.length > 25
    ? activeObject.title.slice(0, 25) + '...'
    : activeObject.title;

  const objectPath = activeOrganization
    ? `/organizations/${activeOrganization?.organization_id}/collections/objects/${activeObject.object_id}`
    : '#';

  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 px-3 py-1.5 bg-bark/10 border border-bark/20 rounded-full',
        className
      )}
    >
      <Package size={14} className="text-bark" />
      <Link
        to={objectPath}
        className="text-sm font-medium text-bark hover:text-copper-dark"
        title={`${activeObject.accession_number} — ${activeObject.title}`}
      >
        {activeObject.accession_number} — {truncatedTitle}
      </Link>
      <button
        onClick={clearActiveObject}
        className="text-archive hover:text-ink p-0.5 -mr-1"
        title="Clear active object"
      >
        <X size={14} />
      </button>
    </div>
  );
}
