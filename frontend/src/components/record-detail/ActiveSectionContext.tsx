/**
 * ActiveSectionContext - Provides active section state for nav highlighting
 *
 * This context allows any component (like WorkspaceSection) to update
 * the nav highlighting without requiring manual prop wiring in each page.
 *
 * Usage:
 * - RecordDetailPageWrapper provides this context
 * - WorkspaceSection calls setActiveSection when expanded
 * - SectionNav reads activeSection for highlighting
 */

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface ActiveSectionContextValue {
  activeSection: string;
  setActiveSection: (sectionId: string) => void;
}

const ActiveSectionContext = createContext<ActiveSectionContextValue | null>(null);

export function ActiveSectionProvider({ children }: { children: ReactNode }) {
  const [activeSection, setActiveSectionState] = useState<string>('');

  const setActiveSection = useCallback((sectionId: string) => {
    setActiveSectionState(sectionId);
  }, []);

  return (
    <ActiveSectionContext.Provider value={{ activeSection, setActiveSection }}>
      {children}
    </ActiveSectionContext.Provider>
  );
}

/**
 * Hook to get and set the active section.
 * Returns null if used outside of ActiveSectionProvider.
 */
export function useActiveSection(): ActiveSectionContextValue | null {
  return useContext(ActiveSectionContext);
}

/**
 * Hook that requires ActiveSectionContext (throws if not available).
 * Use this in components that must be inside RecordDetailPageWrapper.
 */
export function useActiveSectionRequired(): ActiveSectionContextValue {
  const context = useContext(ActiveSectionContext);
  if (!context) {
    throw new Error('useActiveSectionRequired must be used within ActiveSectionProvider');
  }
  return context;
}
