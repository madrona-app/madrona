/**
 * RecordDetailLayout - Three-column layout shell for record detail pages
 *
 * Implements the redesigned layout with:
 * - Left: Section navigation (collapsible)
 * - Center: Main content area
 * - Right: Summary rail (sticky)
 *
 * Uses CSS Grid with clamp() for flexible, overflow-safe layouts.
 *
 * @see /docs/record-detail-page-redesign.md
 */

import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

// Body class name for CSS styling (replaces :has() selector for better compatibility)
const BODY_CLASS = 'has-record-detail-layout';

// =============================================================================
// LAYOUT CONTEXT
// =============================================================================

interface RecordDetailLayoutContextValue {
  isSectionNavCollapsed: boolean;
  setSectionNavCollapsed: (value: boolean) => void;
  isRailCollapsed: boolean;
  setRailCollapsed: (value: boolean) => void;
}

const RecordDetailLayoutContext = createContext<RecordDetailLayoutContextValue | null>(null);

export function useRecordDetailLayout() {
  const context = useContext(RecordDetailLayoutContext);
  if (!context) {
    throw new Error('useRecordDetailLayout must be used within RecordDetailLayout');
  }
  return context;
}

// =============================================================================
// LAYOUT COMPONENTS
// =============================================================================

interface RecordDetailLayoutProps {
  children: ReactNode;
  className?: string;
  /** Start with the right rail collapsed (hidden). */
  initialRailCollapsed?: boolean;
}

/**
 * Main layout container with three-column grid
 */
export function RecordDetailLayout({
  children,
  className,
  initialRailCollapsed = false,
}: RecordDetailLayoutProps) {
  const [isSectionNavCollapsed, setSectionNavCollapsed] = useState(false);
  const [isRailCollapsed, setRailCollapsed] = useState(initialRailCollapsed);

  // Sync with the prop when it changes (e.g. media loads async and flips
  // showRail from false → true). Without this, the useState initializer only
  // runs on mount and the rail stays collapsed.
  useEffect(() => {
    setRailCollapsed(initialRailCollapsed);
  }, [initialRailCollapsed]);

  // Add body class for CSS styling (replaces :has() selector for better browser support)
  useEffect(() => {
    document.body.classList.add(BODY_CLASS);
    return () => {
      document.body.classList.remove(BODY_CLASS);
    };
  }, []);

  const contextValue: RecordDetailLayoutContextValue = {
    isSectionNavCollapsed,
    setSectionNavCollapsed,
    isRailCollapsed,
    setRailCollapsed,
  };

  return (
    <RecordDetailLayoutContext.Provider value={contextValue}>
      <div
        className={cn(
          'record-detail-layout',
          isSectionNavCollapsed && 'record-detail-layout--nav-collapsed',
          isRailCollapsed && 'record-detail-layout--rail-collapsed',
          className
        )}
      >
        {children}
      </div>
    </RecordDetailLayoutContext.Provider>
  );
}

// =============================================================================
// HEADER AREA (spans full width, above the three columns)
// =============================================================================

interface RecordDetailHeaderAreaProps {
  children: ReactNode;
  className?: string;
}

export function RecordDetailHeaderArea({ children, className }: RecordDetailHeaderAreaProps) {
  return (
    <header className={cn('record-detail-header-area', className)}>
      {children}
    </header>
  );
}

// =============================================================================
// SECTION NAV (left column)
// =============================================================================

interface RecordDetailSectionNavProps {
  children: ReactNode;
  className?: string;
}

export function RecordDetailSectionNav({ children, className }: RecordDetailSectionNavProps) {
  return (
    <nav
      className={cn('record-detail-section-nav', className)}
      aria-label="Record sections"
    >
      {children}
    </nav>
  );
}

// =============================================================================
// MAIN CONTENT (center column)
// =============================================================================

interface RecordDetailMainProps {
  children: ReactNode;
  className?: string;
}

export function RecordDetailMain({ children, className }: RecordDetailMainProps) {
  return (
    <main className={cn('record-detail-main', className)} id="main-content">
      {children}
    </main>
  );
}

// =============================================================================
// RIGHT RAIL (right column)
// =============================================================================

interface RecordDetailRailProps {
  children: ReactNode;
  className?: string;
}

export function RecordDetailRail({ children, className }: RecordDetailRailProps) {
  return (
    <aside
      className={cn('record-detail-rail', className)}
      aria-label="Quick reference"
    >
      {children}
    </aside>
  );
}

// =============================================================================
// EXPORTS
// =============================================================================

export default RecordDetailLayout;
