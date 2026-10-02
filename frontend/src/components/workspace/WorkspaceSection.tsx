import { useState, useRef, useEffect, memo, Component, type ReactNode, type ErrorInfo, type HTMLAttributes, type MouseEvent, type KeyboardEvent } from 'react';
import { AlertTriangle, RefreshCw, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useActiveSection } from '../record-detail/ActiveSectionContext';
import { logger } from '../../lib/logger';

interface WorkspaceSectionProps extends Omit<HTMLAttributes<HTMLElement>, 'id' | 'title' | 'children'> {
  /** Section ID for scroll targeting */
  id: string;
  /** Section title */
  title: string;
  /** Icon to show */
  icon?: ReactNode;
  /** Badge text or element (e.g., count or completion badge) - can be string or React component */
  badge?: string | ReactNode;
  /** Collapsed hint - muted status text shown when section is collapsed */
  hint?: ReactNode;
  /** When true and collapsed (not editing), renders a compact inline element */
  isEmpty?: boolean;
  /** Section content */
  children: ReactNode;
  /** Is expanded */
  isExpanded: boolean;
  /** Toggle callback */
  onToggle: () => void;
  /** Whether in edit mode - affects styling */
  isEditing?: boolean;
  /** Callback when section is clicked to enter edit mode (click-to-edit pattern) */
  onEdit?: () => void;
  /** Ref callback for scroll targeting */
  sectionRef?: (el: HTMLDivElement | null) => void;
  /** Whether section has unsaved changes */
  hasChanges?: boolean;
  /** CSS order value for flex container reordering */
  order?: number;
  /** Summary text shown next to collapsed section title */
  summary?: string;
  /** Hint text shown when section is collapsed (alias for hint) */
  sectionHint?: string;
}

// =============================================================================
// Section Error Boundary (internal)
// =============================================================================

interface SectionErrorBoundaryProps {
  children: ReactNode;
  sectionTitle: string;
}

interface SectionErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Internal error boundary that wraps section content.
 * Prevents errors in one section from crashing the entire page.
 */
class SectionContentErrorBoundary extends Component<SectionErrorBoundaryProps, SectionErrorBoundaryState> {
  public state: SectionErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): Partial<SectionErrorBoundaryState> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error(`[WorkspaceSection: ${this.props.sectionTitle}] Error:`, error, errorInfo);
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

/**
 * Unified section card for Object Workspace.
 *
 * Interaction pattern:
 * - Collapsed: Minimal card with icon, title, and hint
 * - Hover: Focus effect (subtle lift)
 * - Click: Expands content AND raises card (modal-like focus)
 */
export const WorkspaceSection = memo(function WorkspaceSection({
  id,
  title,
  icon,
  badge,
  hint,
  isEmpty = false,
  children,
  isExpanded,
  onToggle,
  isEditing = false,
  onEdit,
  sectionRef,
  hasChanges = false,
  order: _order,
  ...restProps
}: WorkspaceSectionProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [_contentHeight, setContentHeight] = useState<number | undefined>(undefined);

  // Active section context for nav highlighting (optional - works outside RecordDetailPageWrapper too)
  const activeSectionContext = useActiveSection();

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

  // Handle click - expand/collapse and update nav highlighting
  const handleClick = () => {
    // If expanding, update active section for nav highlighting
    if (!isExpanded) {
      activeSectionContext?.setActiveSection(id);
    }
    onToggle();
  };

  // Use compact render when empty, collapsed, and not editing
  const useCompactRender = isEmpty && !isExpanded && !isEditing;

  return (
    <section
      id={`section-${id}`}
      ref={sectionRef}
      style={{ scrollMarginTop: 'var(--record-sticky-top, 16px)' }}
      className={cn(
        'workspace-section rounded-lg border',
        'transition-all duration-200',
        isExpanded
          ? 'bg-parchment shadow-sm'
          : 'bg-parchment shadow-sm cursor-pointer',
        !isExpanded && !useCompactRender && 'hover:shadow-md hover:-translate-y-1 hover:border-archive/40',
        useCompactRender && 'border-lichen/40 bg-parchment hover:border-archive/40',
        isEditing ? 'border-bark/20' : (!useCompactRender ? 'border-lichen/60' : '')
      )}
      {...restProps}
    >
      {/* Compact collapsed state for empty sections */}
      {useCompactRender && (
        <button
          type="button"
          onClick={handleClick}
          className={cn(
            'w-full px-3 py-2 flex items-center gap-2 text-left',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-bark/30 focus-visible:ring-offset-2',
            'text-archive hover:text-ink transition-colors'
          )}
          aria-expanded={false}
          aria-controls={`${id}-content`}
        >
          {icon && <span className="flex-shrink-0 opacity-50">{icon}</span>}
          <span className="text-sm">{title}</span>
          <span className="text-xs text-bark ml-auto">+ Add</span>
        </button>
      )}

      {/* Collapsed state - full card */}
      {!isExpanded && !useCompactRender && (
        <button
          type="button"
          onClick={handleClick}
          className={cn(
            'w-full px-4 py-3 flex items-center gap-3 text-left',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-bark/30 focus-visible:ring-offset-2'
          )}
          aria-expanded={false}
          aria-controls={`${id}-content`}
        >
          {icon && <span className="text-archive flex-shrink-0">{icon}</span>}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-medium text-forest truncate">{title}</h2>
              {badge && (
                <span className="text-xs px-2 py-0.5 bg-azurite/10 text-azurite rounded-full flex-shrink-0">
                  {badge}
                </span>
              )}
              {hasChanges && (
                <span className="w-2 h-2 bg-semantic-warning rounded-full flex-shrink-0" title="Unsaved changes" />
              )}
            </div>
            {hint && (
              <div className="text-sm text-archive mt-0.5 truncate">{hint}</div>
            )}
          </div>
        </button>
      )}

      {/* Expanded state - header */}
      {isExpanded && (
        <button
          type="button"
          onClick={handleClick}
          className={cn(
            'w-full px-4 py-3 border-b border-lichen/60 flex items-center justify-between',
            'cursor-pointer hover:bg-stone/30 transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-bark/30 focus-visible:ring-offset-2'
          )}
          aria-expanded={true}
          aria-controls={`${id}-content`}
        >
          <div className="flex items-center gap-3">
            {icon && <span className="text-bark flex-shrink-0">{icon}</span>}
            <h2 className="text-lg font-semibold text-forest">{title}</h2>
            {badge && (
              <span className="text-xs px-2 py-0.5 bg-azurite/10 text-azurite rounded-full">
                {badge}
              </span>
            )}
            {hasChanges && (
              <span className="w-2 h-2 bg-semantic-warning rounded-full" title="Unsaved changes" />
            )}
          </div>
          <span className="p-1.5 rounded-md text-archive">
            <X size={18} />
          </span>
        </button>
      )}

      {/* Content — only rendered when expanded */}
      {isExpanded && (
        <div
          id={`${id}-content`}
          ref={contentRef}
          className={cn('p-4', !isEditing && 'cursor-pointer')}
          {...(!isEditing ? {
            tabIndex: 0,
            role: 'button',
            title: 'Click, Enter, or Space to edit',
            'aria-label': 'Press Enter or Space to edit this section',
            onClick: (e: MouseEvent<HTMLDivElement>) => {
              const target = e.target as HTMLElement;
              if (target.closest('a, button, input, select, textarea, [role="button"]')) return;
              if (onEdit) {
                onEdit();
              } else {
                onToggle();
              }
            },
            onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                const target = e.target as HTMLElement;
                if (target.closest('a, button, input, select, textarea, [role="button"]')) return;
                if (onEdit) {
                  onEdit();
                } else {
                  onToggle();
                }
              }
            },
          } : {})}
        >
          <SectionContentErrorBoundary sectionTitle={title}>
            {children}
          </SectionContentErrorBoundary>
        </div>
      )}
    </section>
  );
});

/**
 * Empty state for sections with no content.
 * Shows invitational message in edit mode.
 */
export const SectionEmptyState = memo(function SectionEmptyState({
  message,
  actionText,
  onAction,
  isEditing,
  icon,
}: {
  message: string;
  actionText?: string;
  onAction?: () => void;
  isEditing: boolean;
  icon?: ReactNode;
}) {
  return (
    <div className="text-center py-6">
      {icon && <div className="text-archive/40 mb-3">{icon}</div>}
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
});
