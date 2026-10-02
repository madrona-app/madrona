/**
 * FieldGrid - Two-column responsive field layout
 *
 * Displays record fields in a responsive grid:
 * - Two columns at wider widths
 * - Single column on narrow screens
 * - Long text fields span full width
 *
 * @see /docs/record-detail-page-redesign.md
 */

import { memo, type ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { formatDateLong, formatNumber } from '../../lib/formatters';

// =============================================================================
// TYPES
// =============================================================================

export type FieldType =
  | 'text'
  | 'date'
  | 'number'
  | 'longtext'
  | 'link'
  | 'badge'
  | 'custom';

export interface FieldDefinition {
  /** Field key for data lookup */
  key: string;
  /** Display label */
  label: string;
  /** Field type for rendering */
  type: FieldType;
  /** Column span (1 or 2). Longtext defaults to 2 */
  span?: 1 | 2;
  /** Custom render function */
  render?: (value: unknown) => ReactNode;
  /** Text to show when empty */
  emptyText?: string;
  /** Hide field when empty */
  hideWhenEmpty?: boolean;
}

export interface FieldGridProps {
  /** Field definitions */
  fields: FieldDefinition[];
  /** Data object to render */
  data: Record<string, unknown>;
  /** Force single column layout */
  columns?: 1 | 2;
  /** Additional CSS classes */
  className?: string;
}

export interface FieldValueProps {
  /** Field definition */
  field: FieldDefinition;
  /** Field value */
  value: unknown;
  /** Whether in compact mode */
  isCompact?: boolean;
}

// =============================================================================
// BADGE COMPONENT
// =============================================================================

interface BadgeProps {
  children: ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'error';
}

function Badge({ children, variant = 'default' }: BadgeProps) {
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
      {children}
    </span>
  );
}

// =============================================================================
// FIELD VALUE RENDERER
// =============================================================================

export function FieldValue({ field, value, isCompact = false }: FieldValueProps) {
  const isEmpty = value === null || value === undefined || value === '';
  const emptyText = field.emptyText || '—';

  // Custom render
  if (field.render) {
    const rendered = field.render(value);
    if (rendered === null || rendered === undefined) {
      return <span className="text-archive italic">{emptyText}</span>;
    }
    return <>{rendered}</>;
  }

  // Empty state
  if (isEmpty) {
    return <span className="text-archive italic">{emptyText}</span>;
  }

  // Type-based rendering
  switch (field.type) {
    case 'date':
      // Format date if it's a valid date string
      if (typeof value === 'string') {
        const formatted = formatDateLong(value);
        if (formatted !== '\u2014') {
          return <span className="text-ink">{formatted}</span>;
        }
      }
      return <span className="text-ink">{String(value)}</span>;

    case 'number': {
      const num = typeof value === 'number' ? value : parseFloat(String(value));
      if (!isNaN(num)) {
        return <span className="text-ink tabular-nums">{formatNumber(num)}</span>;
      }
      return <span className="text-ink">{String(value)}</span>;
    }

    case 'longtext':
      return (
        <p
          className={cn(
            'text-ink whitespace-pre-wrap',
            isCompact ? 'text-sm leading-relaxed' : 'leading-relaxed'
          )}
        >
          {String(value)}
        </p>
      );

    case 'link':
      if (typeof value === 'string' && value.startsWith('http')) {
        return (
          <a
            href={value}
            className="text-bark hover:text-copper-dark underline transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            {value}
          </a>
        );
      }
      return <span className="text-ink">{String(value)}</span>;

    case 'badge':
      return <Badge>{String(value)}</Badge>;

    case 'text':
    case 'custom':
    default:
      // Handle arrays
      if (Array.isArray(value)) {
        if (value.length === 0) {
          return <span className="text-archive italic">{emptyText}</span>;
        }
        return (
          <span className="text-ink">
            {value.map((v) => String(v)).join(', ')}
          </span>
        );
      }
      // Handle objects with a display property
      if (typeof value === 'object' && value !== null) {
        const obj = value as Record<string, unknown>;
        const display = obj.name || obj.title || obj.label || obj.display || JSON.stringify(obj);
        return <span className="text-ink">{String(display)}</span>;
      }
      return <span className="text-ink">{String(value)}</span>;
  }
}

// =============================================================================
// FIELD ITEM COMPONENT
// =============================================================================

interface FieldItemProps {
  field: FieldDefinition;
  value: unknown;
  isCompact?: boolean;
}

const FieldItem = memo(function FieldItem({ field, value, isCompact = false }: FieldItemProps) {
  const span = field.span ?? (field.type === 'longtext' ? 2 : 1);

  return (
    <div
      className={cn(
        'field-item',
        span === 2 && 'col-span-full'
      )}
    >
      <dt
        className={cn(
          'font-medium text-archive uppercase tracking-wide',
          isCompact ? 'text-[11px] mb-0.5' : 'text-xs mb-1'
        )}
      >
        {field.label}
      </dt>
      <dd className={cn('text-ink', isCompact ? 'text-sm' : 'text-base')}>
        <FieldValue field={field} value={value} isCompact={isCompact} />
      </dd>
    </div>
  );
});

// =============================================================================
// FIELD GRID COMPONENT
// =============================================================================

export function FieldGrid({
  fields,
  data,
  columns = 2,
  className,
}: FieldGridProps) {
  // Compact mode removed - always use default styling
  const isCompact = false;

  // Filter out hidden empty fields
  const visibleFields = fields.filter((field) => {
    if (!field.hideWhenEmpty) return true;
    const value = data[field.key];
    return value !== null && value !== undefined && value !== '';
  });

  // Use configured columns (or single column)
  const effectiveColumns = columns === 1 ? 1 : 2;

  return (
    <dl
      className={cn(
        'field-grid',
        effectiveColumns === 2
          ? 'grid grid-cols-1 md:grid-cols-2 gap-x-4 md:gap-x-6'
          : 'grid grid-cols-1',
        'gap-y-4',
        className
      )}
    >
      {visibleFields.map((field) => (
        <FieldItem
          key={field.key}
          field={field}
          value={data[field.key]}
          isCompact={isCompact}
        />
      ))}
    </dl>
  );
}

// =============================================================================
// COMMON FIELD DEFINITIONS
// =============================================================================

/**
 * Example field definitions for Identification section
 */
export const IDENTIFICATION_FIELDS: FieldDefinition[] = [
  { key: 'object_number', label: 'Object Number', type: 'text' },
  { key: 'accession_number', label: 'Accession Number', type: 'text' },
  { key: 'object_type', label: 'Object Type', type: 'badge' },
  { key: 'classification', label: 'Classification', type: 'text' },
  { key: 'date_created', label: 'Date Created', type: 'text' },
  { key: 'culture', label: 'Culture', type: 'text' },
  {
    key: 'brief_description',
    label: 'Brief Description',
    type: 'longtext',
    span: 2,
  },
];

/**
 * Example field definitions for Physical Description section
 */
export const PHYSICAL_DESCRIPTION_FIELDS: FieldDefinition[] = [
  { key: 'medium', label: 'Medium', type: 'text' },
  { key: 'support', label: 'Support', type: 'text' },
  { key: 'dimensions', label: 'Dimensions', type: 'text', span: 2 },
  { key: 'weight', label: 'Weight', type: 'text' },
  { key: 'edition', label: 'Edition', type: 'text' },
  {
    key: 'physical_description',
    label: 'Physical Description',
    type: 'longtext',
    span: 2,
  },
  { key: 'inscriptions', label: 'Inscriptions', type: 'longtext', span: 2 },
];

export default FieldGrid;
