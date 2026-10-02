/**
 * RelationshipTable - Configurable table for related items
 *
 * Unified table component for displaying relationships:
 * - Contributors/Constituents
 * - Related Objects
 * - Citations/Bibliography
 * - Places
 * - Events
 *
 * Features:
 * - Configurable columns
 * - Row click handler
 * - Expandable rows (optional)
 * - Show more / View all pattern
 * - Empty state
 * - Virtualization for large lists
 *
 * @see /docs/record-detail-page-redesign.md
 */

import { useState, useMemo, type ReactNode } from 'react';
import { ChevronRight, ExternalLink, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { shouldVirtualize } from './LazySection';
import { logger } from '../../lib/logger';

// =============================================================================
// TYPES
// =============================================================================

export interface ColumnDef<T = Record<string, unknown>> {
  /** Column key */
  key: string;
  /** Column header text */
  header: string;
  /** Column width (CSS value) */
  width?: string;
  /** Flex grow */
  flex?: number;
  /** Cell alignment */
  align?: 'left' | 'center' | 'right';
  /** Custom cell renderer */
  render?: (item: T, index: number) => ReactNode;
  /** Sort key (if different from key) */
  sortKey?: string;
  /** Whether column is hidden in compact mode */
  hideInCompact?: boolean;
}

export interface RelatedItem {
  /** Unique identifier */
  id: string;
  /** Additional data */
  [key: string]: unknown;
}

export interface EmptyStateConfig {
  /** Icon component */
  icon?: LucideIcon;
  /** Title text */
  title: string;
  /** Description text */
  description?: string;
  /** Action button config */
  action?: {
    label: string;
    onClick: () => void;
    permission?: string;
  };
}

export interface RelationshipTableProps<T extends RelatedItem = RelatedItem> {
  /** Table title */
  title?: string;
  /** Items to display */
  items: T[];
  /** Column definitions */
  columns: ColumnDef<T>[];
  /** Maximum rows to show initially */
  maxInitialRows?: number;
  /** Callback when row is clicked */
  onItemClick?: (item: T) => void;
  /** Callback for "View all" action */
  onViewAll?: () => void;
  /** Empty state configuration */
  emptyState?: EmptyStateConfig;
  /** Whether rows are clickable */
  clickable?: boolean;
  /** Whether to show link icon on hover */
  showLinkIcon?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Virtualization list type (for threshold checking) */
  virtualizationType?: 'relatedObjects' | 'citations' | 'mediaItems';
}

// =============================================================================
// TABLE HEADER
// =============================================================================

interface TableHeaderProps<T> {
  columns: ColumnDef<T>[];
  isCompact: boolean;
}

function TableHeader<T>({ columns, isCompact }: TableHeaderProps<T>) {
  const visibleColumns = columns.filter(
    (col) => !isCompact || !col.hideInCompact
  );

  return (
    <div
      className={cn(
        'hidden md:flex items-center border-b border-lichen',
        isCompact ? 'py-1.5 px-2' : 'py-2 px-3'
      )}
    >
      {visibleColumns.map((col) => (
        <div
          key={col.key}
          className={cn(
            'font-medium text-archive uppercase tracking-wide',
            isCompact ? 'text-[10px]' : 'text-xs',
            col.align === 'center' && 'text-center',
            col.align === 'right' && 'text-right'
          )}
          style={{
            width: col.width,
            flex: col.flex ?? 1,
          }}
        >
          {col.header}
        </div>
      ))}
    </div>
  );
}

// =============================================================================
// TABLE ROW
// =============================================================================

interface TableRowProps<T> {
  item: T;
  index: number;
  columns: ColumnDef<T>[];
  isCompact: boolean;
  onClick?: () => void;
  clickable: boolean;
  showLinkIcon: boolean;
}

function TableRow<T extends RelatedItem>({
  item,
  index,
  columns,
  isCompact,
  onClick,
  clickable,
  showLinkIcon,
}: TableRowProps<T>) {
  const visibleColumns = columns.filter(
    (col) => !isCompact || !col.hideInCompact
  );

  const keyboardHandler = clickable
    ? (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }
    : undefined;

  return (
    <>
      {/* Table row — md and up */}
      <div
        className={cn(
          'hidden md:flex items-center border-b border-lichen/50 last:border-b-0 group',
          isCompact ? 'py-1.5 px-2' : 'py-2.5 px-3',
          clickable && 'cursor-pointer hover:bg-stone/30 transition-colors'
        )}
        onClick={onClick}
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        onKeyDown={keyboardHandler}
      >
        {visibleColumns.map((col) => {
          const value = item[col.key];
          const rendered = col.render
            ? col.render(item, index)
            : value !== null && value !== undefined
              ? String(value)
              : '—';

          return (
            <div
              key={col.key}
              className={cn(
                isCompact ? 'text-sm' : 'text-base',
                'text-ink truncate',
                col.align === 'center' && 'text-center',
                col.align === 'right' && 'text-right'
              )}
              style={{
                width: col.width,
                flex: col.flex ?? 1,
              }}
            >
              {rendered}
            </div>
          );
        })}
        {clickable && showLinkIcon && (
          <ChevronRight
            size={16}
            className="text-archive opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex-shrink-0 ml-2"
          />
        )}
      </div>

      {/* Card row — below md. Each column becomes a label/value pair stacked
       * vertically so rows stay readable on phones without horizontal scroll. */}
      <div
        className={cn(
          'md:hidden border-b border-lichen/50 last:border-b-0 px-3 py-3',
          clickable && 'cursor-pointer active:bg-stone/40 hover:bg-stone/30 transition-colors'
        )}
        onClick={onClick}
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        onKeyDown={keyboardHandler}
      >
        <div className="flex items-start justify-between gap-2">
          <dl className="min-w-0 flex-1 space-y-1">
            {visibleColumns.map((col, i) => {
              const value = item[col.key];
              const rendered = col.render
                ? col.render(item, index)
                : value !== null && value !== undefined
                  ? String(value)
                  : '—';

              // First column rendered large as the "headline"; subsequent
              // columns get a small label prefix.
              if (i === 0) {
                return (
                  <div key={col.key} className="text-base font-medium text-ink break-words">
                    {rendered}
                  </div>
                );
              }
              return (
                <div key={col.key} className="flex gap-2 text-sm">
                  <dt className="text-[11px] font-medium text-archive uppercase tracking-wide shrink-0 pt-0.5 min-w-[72px]">
                    {col.header}
                  </dt>
                  <dd className="text-ink break-words min-w-0">{rendered}</dd>
                </div>
              );
            })}
          </dl>
          {clickable && showLinkIcon && (
            <ChevronRight
              size={18}
              className="text-archive shrink-0 mt-0.5"
              aria-hidden="true"
            />
          )}
        </div>
      </div>
    </>
  );
}

// =============================================================================
// EMPTY STATE
// =============================================================================

interface TableEmptyStateProps {
  config?: EmptyStateConfig;
  isCompact: boolean;
}

function TableEmptyState({ config, isCompact }: TableEmptyStateProps) {
  if (!config) {
    return (
      <div
        className={cn(
          'text-center text-archive',
          isCompact ? 'py-4' : 'py-6'
        )}
      >
        No items
      </div>
    );
  }

  const Icon = config.icon;

  return (
    <div className={cn('text-center', isCompact ? 'py-4' : 'py-6')}>
      {Icon && (
        <div className="flex justify-center mb-2">
          <Icon size={isCompact ? 24 : 32} className="text-archive/40" />
        </div>
      )}
      <p className={cn('font-medium text-ink', isCompact ? 'text-sm' : 'text-base')}>
        {config.title}
      </p>
      {config.description && (
        <p className={cn('text-archive mt-1', isCompact ? 'text-xs' : 'text-sm')}>
          {config.description}
        </p>
      )}
      {config.action && (
        <button
          onClick={config.action.onClick}
          className={cn(
            'mt-3 text-bark hover:text-copper-dark transition-colors',
            isCompact ? 'text-sm' : 'text-base'
          )}
        >
          {config.action.label}
        </button>
      )}
    </div>
  );
}

// =============================================================================
// RELATIONSHIP TABLE COMPONENT
// =============================================================================

export function RelationshipTable<T extends RelatedItem = RelatedItem>({
  title,
  items,
  columns,
  maxInitialRows = 5,
  onItemClick,
  onViewAll,
  emptyState,
  clickable = true,
  showLinkIcon = true,
  className,
  virtualizationType,
}: RelationshipTableProps<T>) {
  const [showAll, setShowAll] = useState(false);

  // Compact mode removed - always use default styling
  const isCompact = false;

  // Determine if we need virtualization
  const needsVirtualization = virtualizationType
    ? shouldVirtualize(virtualizationType, items.length)
    : false;

  // Items to display
  const displayedItems = useMemo(() => {
    if (showAll || items.length <= maxInitialRows) {
      return items;
    }
    return items.slice(0, maxInitialRows);
  }, [items, showAll, maxInitialRows]);

  const hasMore = items.length > maxInitialRows;
  const remainingCount = items.length - maxInitialRows;

  // Empty state
  if (items.length === 0) {
    return (
      <div className={cn('relationship-table', className)}>
        {title && (
          <h4 className={cn('font-medium text-forest mb-2', isCompact ? 'text-sm' : 'text-base')}>
            {title}
          </h4>
        )}
        <TableEmptyState config={emptyState} isCompact={isCompact} />
      </div>
    );
  }

  // Note: Full virtualization would use @tanstack/react-virtual here
  // This is a simplified implementation that just warns about large lists
  if (needsVirtualization) {
    logger.warn(
      `RelationshipTable: List has ${items.length} items and should be virtualized. Consider using react-virtual.`
    );
  }

  return (
    <div className={cn('relationship-table', className)}>
      {title && (
        <div className="flex items-center justify-between mb-2">
          <h4 className={cn('font-medium text-forest', isCompact ? 'text-sm' : 'text-base')}>
            {title}
          </h4>
          <span className="text-xs text-archive">
            {items.length} {items.length === 1 ? 'item' : 'items'}
          </span>
        </div>
      )}

      <div className="border border-lichen rounded-lg overflow-hidden bg-parchment">
        <TableHeader columns={columns} isCompact={isCompact} />

        <div className="divide-y divide-lichen/50">
          {displayedItems.map((item, index) => (
            <TableRow
              key={item.id}
              item={item}
              index={index}
              columns={columns}
              isCompact={isCompact}
              onClick={onItemClick ? () => onItemClick(item) : undefined}
              clickable={clickable && !!onItemClick}
              showLinkIcon={showLinkIcon}
            />
          ))}
        </div>

        {/* Show more / View all */}
        {hasMore && !showAll && (
          <div
            className={cn(
              'border-t border-lichen bg-stone/20',
              isCompact ? 'px-2 py-1.5' : 'px-3 py-2'
            )}
          >
            <div className="flex items-center justify-between">
              <button
                onClick={() => setShowAll(true)}
                className={cn(
                  'text-bark hover:text-copper-dark transition-colors',
                  isCompact ? 'text-xs' : 'text-sm'
                )}
              >
                Show {remainingCount} more...
              </button>
              {onViewAll && (
                <button
                  onClick={onViewAll}
                  className={cn(
                    'flex items-center gap-1 text-bark hover:text-copper-dark transition-colors',
                    isCompact ? 'text-xs' : 'text-sm'
                  )}
                >
                  View all
                  <ExternalLink size={12} />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// COMMON COLUMN DEFINITIONS
// =============================================================================

/**
 * Common columns for Contributors/Constituents table
 */
export const CONTRIBUTOR_COLUMNS: ColumnDef[] = [
  { key: 'name', header: 'Name', flex: 2 },
  { key: 'role', header: 'Role', flex: 1 },
  { key: 'dates', header: 'Dates', flex: 1, hideInCompact: true },
];

/**
 * Common columns for Related Objects table
 */
export const RELATED_OBJECTS_COLUMNS: ColumnDef[] = [
  { key: 'object_number', header: 'Object #', width: '100px' },
  { key: 'title', header: 'Title', flex: 2 },
  { key: 'relationship_type', header: 'Relationship', flex: 1 },
];

/**
 * Common columns for Citations table
 */
export const CITATIONS_COLUMNS: ColumnDef[] = [
  { key: 'citation', header: 'Citation', flex: 3 },
  { key: 'page_reference', header: 'Page', width: '80px', hideInCompact: true },
  { key: 'type', header: 'Type', width: '100px', hideInCompact: true },
];

/**
 * Common columns for Places table
 */
export const PLACES_COLUMNS: ColumnDef[] = [
  { key: 'name', header: 'Place', flex: 2 },
  { key: 'role', header: 'Role', flex: 1 },
  { key: 'date', header: 'Date', flex: 1, hideInCompact: true },
];

export default RelationshipTable;
