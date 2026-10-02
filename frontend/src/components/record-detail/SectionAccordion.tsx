/**
 * SectionAccordion - Collapsible section for record detail pages
 *
 * Enhanced accordion component that integrates with the new layout system.
 * Features:
 * - Smooth expand/collapse animation
 * - ARIA attributes for accessibility
 * - Error boundary for section content
 * - Completeness indicator
 *
 * @see /docs/record-detail-page-redesign.md
 */

import {
  useState,
  useRef,
  useEffect,
  Component,
  type ReactNode,
  type ErrorInfo,
} from 'react';
import { ChevronDown, AlertTriangle, RefreshCw, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { SectionStatus } from './SectionIndicator';
import { logger } from '../../lib/logger';

// =============================================================================
// ERROR BOUNDARY
// =============================================================================

interface SectionErrorBoundaryProps {
  children: ReactNode;
  sectionTitle: string;
}

interface SectionErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class SectionContentErrorBoundary extends Component<
  SectionErrorBoundaryProps,
  SectionErrorBoundaryState
> {
  public state: SectionErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(
    error: Error
  ): Partial<SectionErrorBoundaryState> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error(
      `[SectionAccordion: ${this.props.sectionTitle}] Error:`,
      error,
      errorInfo
    );
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="py-6 px-4 text-center">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-semantic-warning/10 mb-3">
            <AlertTriangle size={20} className="text-semantic-warning" />
          </div>
          <p className="text-sm font-medium text-ink mb-1">
            Error loading {this.props.sectionTitle.toLowerCase()}
          </p>
          <p className="text-xs text-archive mb-3">
            {import.meta.env.DEV && this.state.error
              ? this.state.error.message
              : 'Something went wrong in this section.'}
          </p>
          <button
            onClick={this.handleRetry}
            className="inline-flex items-center gap-1.5 text-sm text-bark hover:text-copper-dark transition-colors"
          >
            <RefreshCw size={14} />
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// =============================================================================
// COMPLETENESS INDICATOR
// =============================================================================

interface CompletenessIndicatorProps {
  status: SectionStatus;
}

function CompletenessIndicator({ status }: CompletenessIndicatorProps) {
  const colors: Record<SectionStatus, string> = {
    complete: 'bg-semantic-success',
    partial: 'bg-semantic-warning',
    'required-missing': 'bg-semantic-error',
    empty: 'bg-archive/30',
  };

  const labels: Record<SectionStatus, string> = {
    complete: 'Complete',
    partial: 'Partially complete',
    'required-missing': 'Required — needs attention',
    empty: 'Empty',
  };

  return (
    <span
      className={cn('w-2 h-2 rounded-full', colors[status])}
      title={labels[status]}
    />
  );
}

// =============================================================================
// SECTION ACCORDION
// =============================================================================

export interface SectionAccordionProps {
  /** Section ID for scroll targeting and ARIA */
  id: string;
  /** Section title */
  title: string;
  /** Icon component */
  icon?: LucideIcon;
  /** Badge text (e.g., item count) */
  badge?: string;
  /** Collapsed hint text */
  hint?: string;
  /** Section content */
  children: ReactNode;
  /** Is expanded */
  isExpanded: boolean;
  /** Toggle callback */
  onToggle: () => void;
  /** Whether in edit mode */
  isEditing?: boolean;
  /** Ref callback for scroll targeting */
  sectionRef?: (el: HTMLDivElement | null) => void;
  /** Whether section has unsaved changes */
  hasChanges?: boolean;
  /** Completeness status for indicator */
  completeness?: SectionStatus;
  /** Additional CSS classes */
  className?: string;
}

export function SectionAccordion({
  id,
  title,
  icon: Icon,
  badge,
  hint,
  children,
  isExpanded,
  onToggle,
  isEditing = false,
  sectionRef,
  hasChanges = false,
  completeness,
  className,
}: SectionAccordionProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number | undefined>(undefined);

  // Measure content height for smooth animation
  useEffect(() => {
    if (contentRef.current && isExpanded) {
      const resizeObserver = new ResizeObserver(() => {
        if (contentRef.current) {
          setContentHeight(contentRef.current.scrollHeight);
        }
      });
      resizeObserver.observe(contentRef.current);
      setContentHeight(contentRef.current.scrollHeight);
      return () => resizeObserver.disconnect();
    }
  }, [isExpanded, children]);

  return (
    <section
      id={id}
      ref={sectionRef}
      style={{ scrollMarginTop: 'var(--record-sticky-top, 16px)' }}
      className={cn(
        'rounded-lg border overflow-hidden transition-all duration-200',
        isEditing
          ? 'bg-parchment border-bark/20 shadow-sm'
          : 'bg-parchment border-lichen/60 shadow-sm',
        isExpanded && isEditing && 'ring-1 ring-bark/10',
        className
      )}
    >
      {/* Section Header */}
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'w-full flex items-center justify-between transition-colors p-4',
          'hover:bg-stone/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-bark/30 focus-visible:ring-offset-2',
          isExpanded ? 'rounded-t-lg' : 'rounded-lg'
        )}
        aria-expanded={isExpanded}
        aria-controls={`${id}-content`}
      >
        <div className="flex items-center gap-2">
          {Icon && <Icon size={18} className="text-archive" />}
          <h2 className="font-semibold text-forest text-lg">
            {title}
          </h2>
          {badge && (
            <span className="ml-2 text-xs px-2 py-0.5 bg-azurite/10 text-azurite rounded-full">
              {badge}
            </span>
          )}
          {hasChanges && (
            <span
              className="ml-2 w-2 h-2 bg-semantic-warning rounded-full"
              title="Unsaved changes"
            />
          )}
          {completeness && <CompletenessIndicator status={completeness} />}
        </div>

        <div className="flex items-center gap-2">
          {/* Collapsed hint */}
          {!isExpanded && hint && (
            <span className="text-sm font-normal text-archive mr-2">{hint}</span>
          )}
          <ChevronDown
            size={20}
            className={cn(
              'text-archive transition-transform duration-200',
              isExpanded && 'rotate-180'
            )}
          />
        </div>
      </button>

      {/* Section Content with animation */}
      <div
        id={`${id}-content`}
        role="region"
        aria-labelledby={`${id}-trigger`}
        style={{
          height: isExpanded ? contentHeight : 0,
          opacity: isExpanded ? 1 : 0,
        }}
        className="overflow-hidden transition-all duration-200 ease-out"
      >
        <div
          ref={contentRef}
          className="border-t border-lichen p-4"
        >
          <SectionContentErrorBoundary sectionTitle={title}>
            {children}
          </SectionContentErrorBoundary>
        </div>
      </div>
    </section>
  );
}

// =============================================================================
// EMPTY STATE
// =============================================================================

export interface SectionEmptyStateProps {
  message: string;
  actionText?: string;
  onAction?: () => void;
  isEditing?: boolean;
  icon?: LucideIcon;
}

export function SectionEmptyState({
  message,
  actionText,
  onAction,
  isEditing = false,
  icon: Icon,
}: SectionEmptyStateProps) {
  return (
    <div className="text-center py-6">
      {Icon && (
        <div className="flex justify-center mb-3">
          <Icon size={32} className="text-archive/40" />
        </div>
      )}
      <p className="text-sm text-archive mb-3">{message}</p>
      {isEditing && actionText && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="text-sm text-bark hover:text-copper-dark transition-colors"
        >
          {actionText}
        </button>
      )}
    </div>
  );
}

export default SectionAccordion;
