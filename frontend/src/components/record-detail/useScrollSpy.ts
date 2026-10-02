/**
 * useScrollSpy - Track which section is currently in view
 *
 * Uses Intersection Observer to detect which section is visible in the viewport.
 * Returns the ID of the currently active section for nav highlighting.
 *
 * @see /docs/record-detail-page-redesign.md
 */

import { useState } from 'react';
import { logger } from '../../lib/logger';

interface UseScrollSpyOptions {
  /** Offset from top of viewport (accounts for sticky header) */
  offset?: number;
  /** Intersection threshold (0-1) */
  threshold?: number;
  /** Root margin for intersection observer */
  rootMargin?: string;
  /** Debounce delay in ms */
  debounceMs?: number;
}

// Default options (for future IntersectionObserver implementation)
// const DEFAULT_OPTIONS: UseScrollSpyOptions = {
//   offset: 16,
//   threshold: 0.2,
//   rootMargin: '-16px 0px -60% 0px',
//   debounceMs: 100,
// };

/**
 * Hook to track which section is currently visible in the viewport
 *
 * @param sectionIds - Array of section element IDs to observe
 * @param options - Configuration options
 * @returns The ID of the currently active section
 *
 * @example
 * ```tsx
 * const activeSection = useScrollSpy(['identification', 'physical', 'condition']);
 * // activeSection === 'physical' when that section is in view
 * ```
 */
export function useScrollSpy(
  _sectionIds: string[],
  _options: UseScrollSpyOptions = {}
): [string, (id: string) => void] {
  const [activeSection, setActiveSection] = useState<string>('');

  return [activeSection, setActiveSection];
}

/**
 * Get the scroll container element
 * The app uses .app-shell-content as the scroll container, not window
 */
function getScrollContainer(): HTMLElement | Window {
  const appShellContent = document.querySelector('.app-shell-content');
  return appShellContent as HTMLElement || window;
}

/**
 * Scroll to a section with offset for sticky header
 *
 * @param sectionId - The ID of the section element to scroll to
 * @param offset - Offset from top (default: 72px for sticky header)
 * @param behavior - Scroll behavior ('smooth' or 'auto')
 */
export function scrollToSection(
  sectionId: string,
  offset: number = 16,
  behavior: ScrollBehavior = 'smooth'
): void {
  // Try with section- prefix first (WorkspaceSection format), then without
  const section = document.getElementById(`section-${sectionId}`) || document.getElementById(sectionId);
  if (!section) return;

  const scrollContainer = getScrollContainer();

  if (scrollContainer instanceof Window) {
    const elementPosition = section.getBoundingClientRect().top + window.scrollY;
    const offsetPosition = elementPosition - offset;
    window.scrollTo({
      top: offsetPosition,
      behavior,
    });
  } else {
    // Scroll within the app-shell-content container
    const containerRect = scrollContainer.getBoundingClientRect();
    const sectionRect = section.getBoundingClientRect();
    const scrollTop = scrollContainer.scrollTop;
    const targetPosition = sectionRect.top - containerRect.top + scrollTop - offset;

    scrollContainer.scrollTo({
      top: targetPosition,
      behavior,
    });
  }
}

/**
 * Get the current section based on scroll position
 * Useful for determining current section outside of React context
 *
 * @param sectionIds - Array of section element IDs
 * @param offset - Offset from top of scroll container
 * @returns The ID of the section closest to the offset point
 */
export function getCurrentSection(sectionIds: string[], offset: number = 72): string {
  let currentId = sectionIds[0] || '';
  let minDistance = Infinity;

  // Get scroll container position to calculate relative coordinates
  const scrollContainer = document.querySelector('.app-shell-content');
  const containerRect = scrollContainer?.getBoundingClientRect();
  const containerTop = containerRect?.top || 0;

  sectionIds.forEach((id) => {
    // Try with section- prefix first (WorkspaceSection format), then without
    const el = document.getElementById(`section-${id}`) || document.getElementById(id);
    if (!el) return;

    const rect = el.getBoundingClientRect();
    // Calculate position relative to scroll container
    const relativeTop = rect.top - containerTop;
    const relativeBottom = rect.bottom - containerTop;

    // Check if section is at or above the offset line
    if (relativeTop <= offset && relativeBottom > offset) {
      currentId = id;
      minDistance = 0;
    } else if (relativeTop > offset && relativeTop - offset < minDistance) {
      // Section is below offset - find closest one
      minDistance = relativeTop - offset;
      currentId = id;
    }
  });

  return currentId;
}

// =============================================================================
// SCROLL TO SECTION AND FOCUS
// =============================================================================

export interface ScrollToSectionAndFocusOptions {
  /** Callback to expand an accordion section */
  expandAccordion?: (sectionId: string) => void;
  /** CSS selector for the element to focus (defaults to first editable field) */
  focusSelector?: string;
  /** Offset from top of scroll container (default: 16) */
  offset?: number;
}

/**
 * Check if user prefers reduced motion
 */
function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/**
 * Scroll to a section, expand its accordion if collapsed, and focus the first editable field.
 *
 * This is the primary utility for "Set now →" style links that guide users to a specific section.
 *
 * @param sectionId - The ID of the section element to scroll to
 * @param options - Configuration options
 *
 * @example
 * ```tsx
 * // In a "Set now →" click handler
 * await scrollToSectionAndFocus('location', {
 *   expandAccordion: (id) => setExpandedSections(prev => new Set([...prev, id])),
 *   focusSelector: '[data-focus="location-first-field"]',
 * });
 * ```
 */
export async function scrollToSectionAndFocus(
  sectionId: string,
  options: ScrollToSectionAndFocusOptions = {}
): Promise<void> {
  const {
    expandAccordion,
    focusSelector = 'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])',
    offset = 16,
  } = options;

  // 1. Expand accordion if callback provided
  if (expandAccordion) {
    expandAccordion(sectionId);
    // Wait for DOM to update after accordion expansion
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  // 2. Scroll to section within .app-shell-content
  // Try with section- prefix first (WorkspaceSection format), then without
  const section = document.getElementById(`section-${sectionId}`) || document.getElementById(sectionId);
  if (!section) {
    logger.warn(`scrollToSectionAndFocus: Section "${sectionId}" not found`);
    return;
  }

  const scrollContainer = getScrollContainer();
  const behavior: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth';

  if (scrollContainer instanceof Window) {
    const elementPosition = section.getBoundingClientRect().top + window.scrollY;
    const offsetPosition = elementPosition - offset;
    window.scrollTo({
      top: offsetPosition,
      behavior,
    });
  } else {
    // Scroll within the app-shell-content container
    const containerRect = scrollContainer.getBoundingClientRect();
    const sectionRect = section.getBoundingClientRect();
    const scrollTop = scrollContainer.scrollTop;
    const targetPosition = sectionRect.top - containerRect.top + scrollTop - offset;

    scrollContainer.scrollTo({
      top: targetPosition,
      behavior,
    });
  }

  // 3. Wait for scroll to settle, then focus first valid control
  // Use longer delay for smooth scroll to complete
  const scrollDelay = prefersReducedMotion() ? 100 : 450;
  await new Promise((resolve) => setTimeout(resolve, scrollDelay));

  // Try to find and focus the first editable element
  const focusTarget = section.querySelector(focusSelector) as HTMLElement | null;
  if (focusTarget) {
    // Use preventScroll to avoid fighting with our scroll positioning
    focusTarget.focus({ preventScroll: true });
  }
}

export default useScrollSpy;
