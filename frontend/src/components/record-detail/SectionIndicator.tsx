/**
 * SectionIndicator - Semantic status indicators for section navigation
 *
 * Displays unambiguous visual indicators for section completeness:
 * - complete: ✓ (checkmark)
 * - partial: ◐ (half-circle)
 * - empty: ○ (empty circle)
 * - required-missing: ⚠ (warning triangle)
 *
 * @see /docs/record-detail-page-redesign.md
 */

import { memo } from 'react';
import { Check, Circle, AlertTriangle } from 'lucide-react';
import { cn } from '../../lib/utils';

// =============================================================================
// TYPES
// =============================================================================

export type SectionStatus = 'complete' | 'partial' | 'empty' | 'required-missing';

export interface SectionIndicatorProps {
  status: SectionStatus;
  size?: 'sm' | 'md';
  className?: string;
}

// =============================================================================
// CUSTOM HALF-CIRCLE ICON (for "partial" status)
// =============================================================================

interface CircleHalfProps {
  size?: number;
  className?: string;
}

function CircleHalf({ size = 14, className }: CircleHalfProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* Outer circle stroke */}
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" fill="none" />
      {/* Right half filled */}
      <path d="M8 2a6 6 0 0 1 0 12V2z" fill="currentColor" />
    </svg>
  );
}

// =============================================================================
// STATUS CONFIGURATION
// =============================================================================

interface StatusConfig {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  color: string;
  title: string;
  ariaLabel: string;
}

const STATUS_CONFIG: Record<SectionStatus, StatusConfig> = {
  complete: {
    icon: Check,
    color: 'text-semantic-success',
    title: 'Complete',
    ariaLabel: 'Section complete',
  },
  partial: {
    icon: CircleHalf,
    color: 'text-semantic-warning',
    title: 'Partially complete',
    ariaLabel: 'Section partially complete',
  },
  empty: {
    icon: Circle,
    color: 'text-archive',
    title: 'Empty',
    ariaLabel: 'Section empty',
  },
  'required-missing': {
    icon: AlertTriangle,
    color: 'text-semantic-error',
    title: 'Required — needs attention',
    ariaLabel: 'Required section needs attention',
  },
};

// =============================================================================
// SECTION INDICATOR COMPONENT
// =============================================================================

export const SectionIndicator = memo(function SectionIndicator({ status, size = 'sm', className }: SectionIndicatorProps) {
  const config = STATUS_CONFIG[status];
  const iconSize = size === 'sm' ? 14 : 16;
  const Icon = config.icon;

  return (
    <span
      className={cn('inline-flex items-center justify-center', config.color, className)}
      title={config.title}
      aria-label={config.ariaLabel}
      role="img"
    >
      <Icon size={iconSize} />
    </span>
  );
});

// =============================================================================
// INDICATOR COMPUTATION UTILITIES
// =============================================================================

/**
 * Safe deep getter for nested object paths (supports dot notation)
 * e.g., get(obj, 'location.current_location_id')
 */
export function getPath(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;

  const keys = path.split('.');
  let current: unknown = obj;

  for (const key of keys) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

/**
 * Check if a value is considered "empty" for completeness purposes
 */
function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (value === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  if (typeof value === 'object' && Object.keys(value as object).length === 0) return true;
  return false;
}

/**
 * Check if section data is completely empty
 * For objects, checks if ALL values within are empty
 */
function isSectionEmpty(data: unknown): boolean {
  if (isEmptyValue(data)) return true;

  // For objects, check if all values are empty
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    const values = Object.values(data as Record<string, unknown>);
    // If object has values, check if all of them are empty
    if (values.length > 0) {
      return values.every((v) => isEmptyValue(v));
    }
  }

  return false;
}

/**
 * Configuration for a section's completeness calculation
 */
export interface SectionCompletenessConfig {
  /** If true, empty section triggers required-missing instead of empty */
  isRequired?: boolean;
  /** Field paths that must be filled for "complete" status */
  requiredFields?: string[];
}

/**
 * Compute the indicator status for a section based on its data
 *
 * Algorithm:
 * 1. If section data is empty:
 *    - If isRequired → 'required-missing'
 *    - Otherwise → 'empty'
 * 2. If section has data:
 *    - If data is an array (linker section) with no requiredFields → 'partial'
 *      (arrays represent relationships that are never truly "complete")
 *    - If no requiredFields defined → 'complete'
 *    - If all requiredFields filled → 'complete'
 *    - If some requiredFields filled → 'partial'
 *    - If no requiredFields filled AND isRequired → 'required-missing'
 *    - If no requiredFields filled AND not required → 'empty'
 */
export function computeSectionIndicator(
  data: unknown,
  config: SectionCompletenessConfig = {}
): SectionStatus {
  const { isRequired = false, requiredFields = [] } = config;

  // Check if section data is empty
  if (isSectionEmpty(data)) {
    return isRequired ? 'required-missing' : 'empty';
  }

  // Array data (linker sections like places, subjects, citations, etc.)
  // These are relationship lists that are never truly "complete" - show partial
  if (Array.isArray(data) && requiredFields.length === 0) {
    return 'partial';
  }

  // Has data but no required fields specified → complete
  if (requiredFields.length === 0) {
    return 'complete';
  }

  // Count how many required fields are filled
  let filledCount = 0;
  for (const fieldPath of requiredFields) {
    const value = getPath(data, fieldPath);
    if (!isEmptyValue(value)) {
      filledCount++;
    }
  }

  // All required fields filled → complete
  if (filledCount === requiredFields.length) {
    return 'complete';
  }

  // Some required fields filled → partial
  if (filledCount > 0) {
    return 'partial';
  }

  // No required fields filled
  return isRequired ? 'required-missing' : 'empty';
}

/**
 * Compute aggregate warning count for a group of sections
 */
export function computeGroupWarningCount(
  sectionStatuses: Map<string, SectionStatus>
): number {
  let count = 0;
  sectionStatuses.forEach((status) => {
    if (status === 'required-missing') {
      count++;
    }
  });
  return count;
}

export default SectionIndicator;
