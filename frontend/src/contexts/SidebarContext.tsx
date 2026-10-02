import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

interface SidebarContextValue {
  isCollapsed: boolean;
  isMobileOpen: boolean;
  expandedSections: Set<string>;
  toggleCollapsed: () => void;
  setCollapsed: (collapsed: boolean) => void;
  toggleMobileOpen: () => void;
  setMobileOpen: (open: boolean) => void;
  toggleSection: (sectionId: string) => void;
  isSectionExpanded: (sectionId: string) => boolean;
}

const SidebarContext = createContext<SidebarContextValue | undefined>(undefined);

const STORAGE_KEY = 'madrona.sidebar.collapsed';
const SECTIONS_STORAGE_KEY = 'madrona.sidebar.sections';
const MOBILE_BREAKPOINT = 640; // sm breakpoint
const TABLET_BREAKPOINT = 1024; // lg breakpoint

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  // Initialize collapsed state from localStorage or based on viewport
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) return stored === 'true';
    // Default: collapsed on tablet, expanded on desktop
    return window.innerWidth < TABLET_BREAKPOINT && window.innerWidth >= MOBILE_BREAKPOINT;
  });

  const [isMobileOpen, setIsMobileOpen] = useState(false);

  // Initialize expanded sections from localStorage
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set<string>();
    const stored = localStorage.getItem(SECTIONS_STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          return new Set(parsed);
        }
      } catch {
        // Ignore parse errors
      }
    }
    // Default: all sections collapsed
    return new Set<string>();
  });

  // Persist collapsed state to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(isCollapsed));
  }, [isCollapsed]);

  // Persist expanded sections to localStorage
  useEffect(() => {
    localStorage.setItem(SECTIONS_STORAGE_KEY, JSON.stringify([...expandedSections]));
  }, [expandedSections]);

  // Note: We intentionally do NOT auto-expand sections on route change.
  // User's expanded/collapsed preferences are persisted and respected.

  // Handle viewport changes - only close mobile drawer, don't auto-collapse
  // (user preference from localStorage should be respected)
  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      // Close mobile drawer when resizing to desktop
      if (width >= MOBILE_BREAKPOINT) {
        setIsMobileOpen(false);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Close mobile drawer on route change (Escape key)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isMobileOpen) {
        setIsMobileOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isMobileOpen]);

  const toggleCollapsed = useCallback(() => {
    setIsCollapsed(prev => !prev);
  }, []);

  const toggleMobileOpen = useCallback(() => {
    setIsMobileOpen(prev => !prev);
  }, []);

  const toggleSection = useCallback((sectionId: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  }, []);

  const isSectionExpanded = useCallback((sectionId: string) => {
    return expandedSections.has(sectionId);
  }, [expandedSections]);

  const value: SidebarContextValue = {
    isCollapsed,
    isMobileOpen,
    expandedSections,
    toggleCollapsed,
    setCollapsed: setIsCollapsed,
    toggleMobileOpen,
    setMobileOpen: setIsMobileOpen,
    toggleSection,
    isSectionExpanded,
  };

  return (
    <SidebarContext.Provider value={value}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (context === undefined) {
    throw new Error('useSidebar must be used within a SidebarProvider');
  }
  return context;
}
