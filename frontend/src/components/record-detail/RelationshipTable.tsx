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

import { useId, useState, useMemo, type ReactNode } from 'react';
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
  hasActionColumn: boolean;
}

function TableHeader<T>({ columns, isCompact, hasActionColumn }: TableHeaderProps<T>) {
  const visibleColumns = columns.filter(
    (col) => !isCompact || !col.hideInCompact
  );

  return (
    <thead>
      <tr className="border-b border-lichen">
        {visibleColumns.map((col) => (
          <th
            key={col.key}
            scope="col"
            className={cn(
              'font-medium text-archive uppercase tracking-wide text-left',
              isCompact ? 'text-[10px] py-1.5 px-2' : 'text-xs py-2 px-3',
              col.align === 'center' && 'text-center',
              col.align === 'right' && 'text-right'
            )}
            style={{ width: col.width }}
          >
            {col.header}
          </th>
        ))}
        {hasActionColumn && (
          <th scope="col" className="w-10">
            <span className="sr-only">Open</span>
          </th>
        )}
      </tr>
    </thead>
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

function renderCell<T extends RelatedItem>(col: ColumnDef<T>, item: T, index: number): ReactNode {
  const value = item[col.key];
  if (col.render) return col.render(item, index);
  return value !== null && value !== undefined ? String(value) : '—';
}

/**
 * Open button for a clickable row. Its accessible name is "Open" followed by
 * the row's first cell, so screen reader users hear which item it opens. The
 * row itself also responds to mouse clicks as a larger target.
 */
function RowOpenButton({
  onClick,
  labelledBy,
  buttonId,
  visible,
  size,
}: {
  onClick?: () => void;
  labelledBy: string;
  buttonId: string;
  visible: boolean;
  size: number;
}) {
  return (
    <button
      type="button"
      id={buttonId}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      aria-labelledby={`${buttonId} ${labelledBy}`}
      className={cn(
        'p-1 rounded text-archive hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2',
        !visible && 'sr-only focus-visible:not-sr-only'
      )}
    >
      <span className="sr-only">Open</span>
      <ChevronRight size={size} aria-hidden="true" />
    </button>
  );
}

function TableRow<T extends RelatedItem>({
  item,
  index,
  columns,
  isCompact,
  onClick,
  clickable,
}: TableRowProps<T>) {
  const rowId = useId();
  const visibleColumns = columns.filter(
    (col) => !isCompact || !col.hideInCompact
  );

  return (
    // Whole-row click is a mouse convenience; the Open button in the last
    // cell is the keyboard and screen reader path.
    <tr
      className={cn(
        'border-b border-lichen/50 last:border-b-0 group',
        clickable && 'cursor-pointer hover:bg-stone/30 transition-colors'
      )}
      onClick={clickable ? onClick : undefined}
    >
      {visibleColumns.map((col, i) => (
        <td
          key={col.key}
          id={i === 0 ? `${rowId}-label` : undefined}
          className={cn(
            isCompact ? 'text-sm py-1.5 px-2' : 'text-base py-2.5 px-3',
            'text-ink truncate',
            col.align === 'center' && 'text-center',
            col.align === 'right' && 'text-right'
          )}
        >
          {renderCell(col, item, index)}
        </td>
      ))}
      {clickable && (
        <td className="w-10 pr-2 text-right">
          <RowOpenButton
            onClick={onClick}
            buttonId={`${rowId}-open`}
            labelledBy={`${rowId}-label`}
            visible
            size={16}
          />
        </td>
      )}
    </tr>
  );
}

/**
 * Card row — below md. Each column becomes a label/value pair stacked
 * vertically so rows stay readable on phones without horizontal scroll.
 */
function CardRow<T extends RelatedItem>({
  item,
  index,
  columns,
  isCompact,
  onClick,
  clickable,
  showLinkIcon,
}: TableRowProps<T>) {
  const rowId = useId();
  const visibleColumns = columns.filter(
    (col) => !isCompact || !col.hideInCompact
  );
  const [headline, ...rest] = visibleColumns;

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- mouse convenience; the card's Open button is the keyboard path
    <li
      className={cn(
        'border-b border-lichen/50 last:border-b-0 px-3 py-3',
        clickable && 'cursor-pointer active:bg-stone/40 hover:bg-stone/30 transition-colors'
      )}
      onClick={clickable ? onClick : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          {headline && (
            <div id={`${rowId}-label`} className="text-base font-medium text-ink break-words">
              {renderCell(headline, item, index)}
            </div>
          )}
          {rest.length > 0 && (
            <dl className="space-y-1">
              {rest.map((col) => (
                <div key={col.key} className="flex gap-2 text-sm">
                  <dt className="text-[11px] font-medium text-archive uppercase tracking-wide shrink-0 pt-0.5 min-w-[72px]">
                    {col.header}
                  </dt>
                  <dd className="text-ink break-words min-w-0">{renderCell(col, item, index)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        {clickable && (
          <RowOpenButton
            onClick={onClick}
            buttonId={`${rowId}-open`}
            labelledBy={`${rowId}-label`}
            visible={showLinkIcon}
            size={18}
          />
        )}
      </div>
    </li>
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
  const rowsClickable = clickable && !!onItemClick;
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
        {/* Table — md and up */}
        <table className="hidden md:table w-full border-collapse">
          <caption className="sr-only">{title || 'Related items'}</caption>
          <TableHeader columns={columns} isCompact={isCompact} hasActionColumn={rowsClickable} />
          <tbody>
            {displayedItems.map((item, index) => (
              <TableRow
                key={item.id}
                item={item}
                index={index}
                columns={columns}
                isCompact={isCompact}
                onClick={onItemClick ? () => onItemClick(item) : undefined}
                clickable={rowsClickable}
                showLinkIcon={showLinkIcon}
              />
            ))}
          </tbody>
        </table>

        {/* Cards — below md */}
        <ul className="md:hidden divide-y divide-lichen/50" aria-label={title || 'Related items'}>
          {displayedItems.map((item, index) => (
            <CardRow
              key={item.id}
              item={item}
              index={index}
              columns={columns}
              isCompact={isCompact}
              onClick={onItemClick ? () => onItemClick(item) : undefined}
              clickable={rowsClickable}
              showLinkIcon={showLinkIcon}
            />
          ))}
        </ul>

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
                  <ExternalLink size={12} aria-hidden="true" />
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
