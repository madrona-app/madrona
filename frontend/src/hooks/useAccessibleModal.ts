import { useEffect, useRef, useCallback } from 'react';

/**
 * Hook for making modals and drawers accessible according to Section 508 / WCAG 2.1.
 *
 * Provides:
 * - Focus trap (Tab/Shift+Tab cycle within modal)
 * - ESC key to close
 * - Focus restoration on close
 * - Proper ARIA attributes setup
 *
 * @example
 * ```tsx
 * function MyModal({ isOpen, onClose }) {
 *   const { modalRef, titleId } = useAccessibleModal({
 *     isOpen,
 *     onClose,
 *     titlePrefix: 'my-modal',
 *   });
 *
 *   if (!isOpen) return null;
 *
 *   return (
 *     <div className="overlay" onClick={onClose}>
 *       <div
 *         ref={modalRef}
 *         role="dialog"
 *         aria-modal="true"
 *         aria-labelledby={titleId}
 *         onClick={(e) => e.stopPropagation()}
 *       >
 *         <h2 id={titleId}>Modal Title</h2>
 *         ...
 *       </div>
 *     </div>
 *   );
 * }
 * ```
 */

interface UseAccessibleModalOptions {
  /** Whether the modal is currently open */
  isOpen: boolean;
  /** Callback to close the modal */
  onClose: () => void;
  /** Prefix for generating unique IDs (e.g., 'confirm-dialog') */
  titlePrefix: string;
}

interface UseAccessibleModalReturn {
  /** Ref to attach to the modal dialog container */
  modalRef: React.RefObject<HTMLDivElement | null>;
  /** ID to use for the modal title (for aria-labelledby) */
  titleId: string;
  /** ID to use for the modal description (for aria-describedby, optional) */
  descriptionId: string;
}

// Selector for focusable elements
const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function useAccessibleModal({
  isOpen,
  onClose,
  titlePrefix,
}: UseAccessibleModalOptions): UseAccessibleModalReturn {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  // Generate unique IDs
  const titleId = `${titlePrefix}-title`;
  const descriptionId = `${titlePrefix}-description`;

  // Handle ESC key
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
        return;
      }

      // Handle Tab key for focus trap
      if (event.key === 'Tab' && modalRef.current) {
        const focusableElements = modalRef.current.querySelectorAll(FOCUSABLE_SELECTOR);
        const firstElement = focusableElements[0] as HTMLElement | undefined;
        const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement | undefined;

        if (!firstElement || !lastElement) return;

        if (event.shiftKey) {
          // Shift+Tab: if on first element, go to last
          if (document.activeElement === firstElement) {
            event.preventDefault();
            lastElement.focus();
          }
        } else {
          // Tab: if on last element, go to first
          if (document.activeElement === lastElement) {
            event.preventDefault();
            firstElement.focus();
          }
        }
      }
    },
    [onClose]
  );

  // Set up focus trap and keyboard handling
  useEffect(() => {
    if (!isOpen) return;

    // Store the currently focused element to restore later
    previousActiveElement.current = document.activeElement as HTMLElement;

    // Add keyboard event listener
    document.addEventListener('keydown', handleKeyDown);

    // Focus the first focusable element in the modal
    const timeoutId = setTimeout(() => {
      if (modalRef.current) {
        const focusableElements = modalRef.current.querySelectorAll(FOCUSABLE_SELECTOR);
        const firstElement = focusableElements[0] as HTMLElement | undefined;
        if (firstElement) {
          firstElement.focus();
        } else {
          // If no focusable element, focus the modal itself
          modalRef.current.focus();
        }
      }
    }, 0);

    // Cleanup
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      clearTimeout(timeoutId);

      // Restore focus to the previously focused element
      if (previousActiveElement.current && typeof previousActiveElement.current.focus === 'function') {
        previousActiveElement.current.focus();
      }
    };
  }, [isOpen, handleKeyDown]);

  return {
    modalRef,
    titleId,
    descriptionId,
  };
}

/**
 * Props to spread onto the modal dialog container for accessibility.
 * Use this with the modalRef from useAccessibleModal.
 */
export function getModalAriaProps(titleId: string, descriptionId?: string) {
  return {
    role: 'dialog' as const,
    'aria-modal': true as const,
    'aria-labelledby': titleId,
    ...(descriptionId && { 'aria-describedby': descriptionId }),
    tabIndex: -1, // Allow modal to receive focus if no focusable children
  };
}
