/**
 * RecentItems - Navigational memory for recently accessed records
 *
 * Per specification:
 * - Displays chronological list of recently accessed records
 * - Provides navigational memory for returning to interrupted work
 * - Does NOT initiate new workflows
 * - Shows owning group for each record type
 */

import { Link } from 'react-router-dom';
import {
  Package,
  ClipboardCheck,
  Download,
  Upload,
  Archive,
  ArrowRightLeft,
  Hammer,
  AlertCircle,
  FileQuestion,
  LayoutGrid,
  Clock,
  Trash2,
  Image,
  FolderOpen,
} from 'lucide-react';
import { useWork, RECORD_TYPE_TO_GROUP, filterRecentItemsByApp } from '../../contexts/WorkContext';
import { useActiveProduct } from '../../hooks/useActiveProduct';
import { cn } from '../../lib/utils';
import { formatRelativeTime } from '../../lib/formatters';

// Icon mapping for record types
const TYPE_ICONS: Record<string, typeof Package> = {
  object: Package,
  condition_report: ClipboardCheck,
  loan_in: Download,
  loan_out: Upload,
  acquisition: Archive,
  movement: ArrowRightLeft,
  conservation: Hammer,
  incident: AlertCircle,
  use_request: FileQuestion,
  exhibition: LayoutGrid,
  media_asset: Image,
  media_collection: FolderOpen,
  download_request: Download,
};

interface RecentItemsProps {
  /** Limit number of items shown */
  limit?: number;
  /** Show as compact list */
  compact?: boolean;
  /**
   * Filtering scope. Default 'product' filters to the active product (Collections,
   * Media, etc.). 'all' shows recents across every app — used by the org-level
   * dashboard and recent-activity page.
   */
  scope?: 'product' | 'all';
  className?: string;
}

export function RecentItems({
  limit = 10,
  compact = false,
  scope = 'product',
  className,
}: RecentItemsProps) {
  const { recentItems, clearRecentItems } = useWork();
  const { activeProductId } = useActiveProduct();
  const scoped =
    scope === 'all'
      ? recentItems
      : filterRecentItemsByApp(recentItems, activeProductId);
  const filteredItems = scoped.filter(
    (item) => item.path && item.path.startsWith('/organizations/'),
  );

  if (filteredItems.length === 0) {
    return (
      <div className={cn('text-center py-8', className)}>
        <Clock size={24} className="mx-auto text-archive mb-2" />
        <p className="text-sm text-archive">No recent items</p>
        <p className="text-xs text-archive/70 mt-1">
          Items you view will appear here
        </p>
      </div>
    );
  }

  const itemsToShow = filteredItems.slice(0, limit);

  if (compact) {
    return (
      <div className={cn('space-y-1', className)}>
        {itemsToShow.map((item) => {
          const Icon = TYPE_ICONS[item.type] || Package;

          return (
            <Link
              key={`${item.type}-${item.id}-${item.timestamp}`}
              to={item.path}
              className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-stone/30 transition-colors"
            >
              <Icon size={14} className="text-archive flex-shrink-0" />
              <span className="flex-1 text-sm text-ink truncate">
                {item.label}
              </span>
              <span className="text-xs text-archive">
                {formatRelativeTime(new Date(item.timestamp))}
              </span>
            </Link>
          );
        })}
      </div>
    );
  }

  return (
    <div className={className}>
      {/* Header with clear action */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-ink">Recent Items</h3>
        {filteredItems.length > 0 && (
          <button
            onClick={clearRecentItems}
            className="text-xs text-archive hover:text-semantic-error flex items-center gap-1"
          >
            <Trash2 size={12} />
            Clear
          </button>
        )}
      </div>

      {/* Items list */}
      <div className="space-y-2">
        {itemsToShow.map((item) => {
          const Icon = TYPE_ICONS[item.type] || Package;
          const group = RECORD_TYPE_TO_GROUP[item.type] || '';

          return (
            <Link
              key={`${item.type}-${item.id}-${item.timestamp}`}
              to={item.path}
              className="flex items-start gap-3 p-3 rounded-lg border border-lichen hover:border-bark/30 hover:bg-stone transition-colors"
            >
              <div className="p-1.5 rounded bg-stone/50">
                <Icon size={14} className="text-archive" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink truncate">
                  {item.label}
                </p>
                {item.sublabel && (
                  <p className="text-xs text-archive truncate mt-0.5">
                    {item.sublabel}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-archive/70">{group}</span>
                  <span className="text-xs text-archive/50">·</span>
                  <span className="text-xs text-archive/70">
                    {formatRelativeTime(new Date(item.timestamp))}
                  </span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {filteredItems.length > limit && (
        <p className="text-xs text-archive text-center mt-3">
          Showing {limit} of {filteredItems.length} recent items
        </p>
      )}
    </div>
  );
}
