/**
 * useFocusManagement - Focus management for record detail navigation
 *
 * Handles focus management when navigating between sections:
 * - Focuses section header after scroll navigation
 * - Restores focus after modal close
 * - Manages focus trap in modals
 *
 * @see /docs/record-detail-page-redesign.md
 */

import { useCallback, useRef } from 'react';

// =============================================================================
// TYPES
// =============================================================================

export interface UseFocusManagementReturn {
  /** Store the currently focused element for later restoration */
  saveFocus: () => void;
  /** Restore focus to the previously saved element */
  restoreFocus: () => void;
  /** Focus a section header element */
  focusSection: (sectionId: string, delay?: number) => void;
  /** Focus the first focusable element within a container */
  focusFirst: (container: HTMLElement | null) => void;
}

// =============================================================================
// FOCUSABLE ELEMENTS SELECTOR
// =============================================================================

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

// =============================================================================
// MAIN HOOK
// =============================================================================

export function useFocusManagement(): UseFocusManagementReturn {
  const savedFocusRef = useRef<HTMLElement | null>(null);

  /**
   * Save the currently focused element
   */
  const saveFocus = useCallback(() => {
    savedFocusRef.current = document.activeElement as HTMLElement;
  }, []);

  /**
   * Restore focus to the previously saved element
   */
  const restoreFocus = useCallback(() => {
    if (savedFocusRef.current && typeof savedFocusRef.current.focus === 'function') {
      savedFocusRef.current.focus();
    }
    savedFocusRef.current = null;
  }, []);

  /**
   * Focus a section header element after navigation
   * Per spec: Focus the section's h2 or accordion trigger button
   */
  const focusSection = useCallback((sectionId: string, delay = 500) => {
    setTimeout(() => {
      // Try with section- prefix first (WorkspaceSection format), then without
      const section = document.getElementById(`section-${sectionId}`) || document.getElementById(sectionId);
      if (!section) return;

      // Try to find the section header button or heading
      const focusTarget =
        section.querySelector<HTMLElement>('button[aria-expanded]') ||
        section.querySelector<HTMLElement>('h2') ||
        section.querySelector<HTMLElement>('[tabindex="0"]');

      if (focusTarget) {
        focusTarget.focus();
      } else {
        // Fallback: make the section itself focusable and focus it
        section.setAttribute('tabindex', '-1');
        section.focus();
      }
    }, delay);
  }, []);

  /**
   * Focus the first focusable element within a container
   */
  const focusFirst = useCallback((container: HTMLElement | null) => {
    if (!container) return;

    const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    const firstElement = focusable[0];

    if (firstElement) {
      firstElement.focus();
    }
  }, []);

  return {
    saveFocus,
    restoreFocus,
    focusSection,
    focusFirst,
  };
}

// =============================================================================
// UTILITY: SCROLL TO SECTION WITH FOCUS
// =============================================================================

/**
 * Scroll to a section and focus its header
 * Enhanced version of scrollToSection from useScrollSpy
 */
export function scrollToSectionWithFocus(
  sectionId: string,
  offset = 16,
  focusDelay = 500
): void {
  // Try with section- prefix first (WorkspaceSection format), then without
  const section = document.getElementById(`section-${sectionId}`) || document.getElementById(sectionId);
  if (!section) return;

  // Calculate scroll position
  const elementPosition = section.getBoundingClientRect().top;
  const offsetPosition = elementPosition + window.pageYOffset - offset;

  // Smooth scroll
  window.scrollTo({
    top: offsetPosition,
    behavior: 'smooth',
  });

  // Focus after scroll animation completes
  setTimeout(() => {
    const focusTarget =
      section.querySelector<HTMLElement>('button[aria-expanded]') ||
      section.querySelector<HTMLElement>('h2');

    if (focusTarget) {
      focusTarget.focus();
    }
  }, focusDelay);
}

export default useFocusManagement;
