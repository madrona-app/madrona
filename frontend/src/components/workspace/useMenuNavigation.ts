import { useCallback, useEffect } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';

const ITEM_SELECTOR = ['menuitem', 'menuitemradio', 'menuitemcheckbox']
  .map((role) => `[role="${role}"]:not([disabled]):not([aria-disabled="true"])`)
  .join(', ');

interface UseMenuNavigationOptions {
  isOpen: boolean;
  /** Element with role="menu" */
  menuRef: RefObject<HTMLElement | null>;
  /** The menu button; focus returns here on Escape */
  triggerRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}

/**
 * Keyboard behaviour for a menu button + menu (WAI-ARIA APG menu button):
 * focus moves to the first item on open; ArrowUp/ArrowDown/Home/End move
 * between items; Escape closes and returns focus to the trigger; Tab closes.
 *
 * Spread the returned `onKeyDown` onto the role="menu" element and give
 * each item role="menuitem" and tabIndex={-1}.
 */
export function useMenuNavigation({ isOpen, menuRef, triggerRef, onClose }: UseMenuNavigationOptions) {
  const getItems = useCallback(
    () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []),
    [menuRef]
  );

  useEffect(() => {
    if (!isOpen) return;
    const timeoutId = setTimeout(() => getItems()[0]?.focus(), 0);
    return () => clearTimeout(timeoutId);
  }, [isOpen, getItems]);

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      const items = getItems();
      const current = items.indexOf(document.activeElement as HTMLElement);
      const focusAt = (i: number) => {
        e.preventDefault();
        items[(i + items.length) % items.length]?.focus();
      };
      switch (e.key) {
        case 'ArrowDown':
          focusAt(current + 1);
          break;
        case 'ArrowUp':
          focusAt(current < 0 ? items.length - 1 : current - 1);
          break;
        case 'Home':
          focusAt(0);
          break;
        case 'End':
          focusAt(items.length - 1);
          break;
        case 'Escape':
          e.preventDefault();
          e.stopPropagation();
          onClose();
          triggerRef.current?.focus();
          break;
        case 'Tab':
          onClose();
          break;
      }
    },
    [getItems, onClose, triggerRef]
  );

  return { onKeyDown };
}
