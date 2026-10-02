/**
 * Field Highlighting Utilities
 *
 * Functions for highlighting and navigating to form fields,
 * particularly for requirement validation feedback.
 */

const HIGHLIGHT_CLASS = 'field-highlight-missing';
const HELPER_CLASS = 'field-helper-required';
const HIGHLIGHT_DURATION = 5000; // 5 seconds

/**
 * Scroll to a section and optionally highlight a specific field
 */
export function navigateToSection(
  sectionId: string,
  fieldPath?: string,
  options: {
    expandSection?: (sectionId: string) => void;
    highlightDuration?: number;
    helperText?: string;
  } = {}
): void {
  const { expandSection, highlightDuration = HIGHLIGHT_DURATION, helperText } = options;

  // Expand the section if callback provided
  expandSection?.(sectionId);

  // Small delay to allow section to expand
  setTimeout(() => {
    // Find the section element
    // Try with section- prefix first (WorkspaceSection format), then without
    const sectionElement = document.getElementById(`section-${sectionId}`) || document.getElementById(sectionId);
    if (!sectionElement) return;

    // Scroll to section
    sectionElement.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // If a field path is provided, find and highlight the field
    if (fieldPath) {
      const fieldElement = findFieldElement(fieldPath);

      if (fieldElement) {
        highlightField(fieldElement, highlightDuration, helperText);
      }
    }
  }, 150);
}

/**
 * Find a field element by various selectors
 */
export function findFieldElement(fieldPath: string): HTMLElement | null {
  // Convert field path to potential element IDs
  const fieldId = fieldPath.replace(/\./g, '-').replace(/_/g, '-');
  const possibleSelectors = [
    `[data-field="${fieldPath}"]`,
    `#field-${fieldPath}`,
    `#field-${fieldId}`,
    `[name="${fieldPath}"]`,
    `[name="${fieldId}"]`,
  ];

  for (const selector of possibleSelectors) {
    const element = document.querySelector(selector) as HTMLElement;
    if (element) return element;
  }

  return null;
}

/**
 * Add highlight styling to a field element with optional inline helper text
 */
export function highlightField(
  element: HTMLElement,
  duration: number = HIGHLIGHT_DURATION,
  helperText?: string
): void {
  // Find the wrapper element (for adding helper text)
  const wrapper = element.closest('[data-field]') || element.parentElement || element;

  // Find the input/select/textarea
  const input = element.tagName === 'INPUT' || element.tagName === 'SELECT' || element.tagName === 'TEXTAREA'
    ? element
    : element.querySelector('input, select, textarea') as HTMLElement;

  const targetElement = input || element;

  // Add highlight class
  targetElement.classList.add(HIGHLIGHT_CLASS);

  // Add inline helper text if provided
  let helperElement: HTMLElement | null = null;
  if (helperText && wrapper) {
    // Check if helper already exists
    const existingHelper = wrapper.querySelector(`.${HELPER_CLASS}`);
    if (existingHelper) {
      existingHelper.remove();
    }

    helperElement = document.createElement('p');
    helperElement.className = `${HELPER_CLASS} text-xs text-semantic-warning mt-1 font-medium`;
    helperElement.textContent = helperText;
    wrapper.appendChild(helperElement);
  }

  // Focus the element if it's focusable
  if (targetElement instanceof HTMLInputElement ||
      targetElement instanceof HTMLSelectElement ||
      targetElement instanceof HTMLTextAreaElement) {
    targetElement.focus();
  }

  // Remove highlight and helper after duration
  setTimeout(() => {
    targetElement.classList.remove(HIGHLIGHT_CLASS);
    helperElement?.remove();
  }, duration);
}

/**
 * Remove all field highlights
 */
export function clearAllHighlights(): void {
  const highlighted = document.querySelectorAll(`.${HIGHLIGHT_CLASS}`);
  highlighted.forEach((el) => {
    el.classList.remove(HIGHLIGHT_CLASS);
  });
}

/**
 * CSS styles for field highlighting (add to global CSS)
 * Uses Madrona semantic-warning color: #8E6B3B (rgb 142, 107, 59)
 */
export const FIELD_HIGHLIGHT_CSS = `
.field-highlight-missing {
  animation: fieldHighlightPulse 0.5s ease-in-out 3;
  box-shadow: 0 0 0 3px rgba(142, 107, 59, 0.5) !important;
  border-color: rgb(142, 107, 59) !important;
}

@keyframes fieldHighlightPulse {
  0%, 100% {
    box-shadow: 0 0 0 3px rgba(142, 107, 59, 0.5);
  }
  50% {
    box-shadow: 0 0 0 5px rgba(142, 107, 59, 0.3);
  }
}
`;
