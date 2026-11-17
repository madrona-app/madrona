import { useEffect, useRef } from 'react';

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
  /**
   * Element to focus when the modal opens (e.g. the first form field).
   * Defaults to the first focusable element, or the container if none.
   */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
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

// Open modals, innermost last. Only the top one handles Escape and Tab, so a
// dialog opened from inside another closes on its own Escape and leaves the
// outer one open.
const openModals: symbol[] = [];

export function useAccessibleModal({
  isOpen,
  onClose,
  titlePrefix,
  initialFocusRef,
}: UseAccessibleModalOptions): UseAccessibleModalReturn {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  // Read through refs so a parent passing an inline onClose (or ref) does not
  // re-run the effect, which would restore and re-take focus on every render.
  const onCloseRef = useRef(onClose);
  const initialFocusRefRef = useRef(initialFocusRef);
  useEffect(() => {
    onCloseRef.current = onClose;
    initialFocusRefRef.current = initialFocusRef;
  });

  // Generate unique IDs
  const titleId = `${titlePrefix}-title`;
  const descriptionId = `${titlePrefix}-description`;

  useEffect(() => {
    if (!isOpen) return;
    const token = Symbol(titlePrefix);
    openModals.push(token);

    // Store the currently focused element to restore later
    previousActiveElement.current = document.activeElement as HTMLElement;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (openModals[openModals.length - 1] !== token) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        onCloseRef.current();
        return;
      }
      // Focus trap
      if (event.key === 'Tab' && modalRef.current) {
        const focusableElements = modalRef.current.querySelectorAll(FOCUSABLE_SELECTOR);
        const firstElement = focusableElements[0] as HTMLElement | undefined;
        const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement | undefined;
        if (!firstElement || !lastElement) return;
        if (event.shiftKey) {
          if (document.activeElement === firstElement) {
            event.preventDefault();
            lastElement.focus();
          }
        } else if (document.activeElement === lastElement) {
          event.preventDefault();
          firstElement.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    const timeoutId = setTimeout(() => {
      const preferred = initialFocusRefRef.current?.current;
      if (preferred) {
        preferred.focus();
        return;
      }
      if (modalRef.current) {
        const firstElement = modalRef.current.querySelector(FOCUSABLE_SELECTOR) as HTMLElement | null;
        (firstElement ?? modalRef.current).focus();
      }
    }, 0);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      clearTimeout(timeoutId);
      const i = openModals.indexOf(token);
      if (i >= 0) openModals.splice(i, 1);
      // Restore focus to the previously focused element
      if (previousActiveElement.current && typeof previousActiveElement.current.focus === 'function') {
        previousActiveElement.current.focus();
      }
    };
  }, [isOpen, titlePrefix]);

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
