import { useCallback, useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';

/**
 * Keyboard behaviour for a WAI-ARIA menu button.
 *
 * - Opening moves focus to the first enabled `[role="menuitem"]`.
 * - Up/Down move between items (wrapping); Home/End jump to the ends.
 * - Escape closes the menu and returns focus to the trigger.
 * - Tab closes the menu and lets focus move on normally.
 *
 * Put `triggerRef` on the button that opens the menu (with aria-haspopup="menu"
 * and aria-expanded), `menuRef` and `onMenuKeyDown` on the element with
 * role="menu", and role="menuitem" on each item.
 */
function menuItems(menu: HTMLElement | null): HTMLElement[] {
  return Array.from(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);
}

export function useActionMenu(
  /** Truthy while open; for per-row menus pass the open row's id so a change of row refocuses */
  openKey: string | boolean | null | undefined,
  onClose: () => void
) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (openKey) menuItems(menuRef.current)[0]?.focus();
  }, [openKey]);

  const closeAndRestoreFocus = useCallback(() => {
    onClose();
    triggerRef.current?.focus();
  }, [onClose]);

  const onMenuKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const list = menuItems(menuRef.current);
    const index = list.indexOf(document.activeElement as HTMLElement);
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        list[(index + 1) % list.length]?.focus();
        break;
      case 'ArrowUp':
        event.preventDefault();
        list[(index - 1 + list.length) % list.length]?.focus();
        break;
      case 'Home':
        event.preventDefault();
        list[0]?.focus();
        break;
      case 'End':
        event.preventDefault();
        list[list.length - 1]?.focus();
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        closeAndRestoreFocus();
        break;
      case 'Tab':
        onClose();
        break;
    }
  };

  return { triggerRef, menuRef, onMenuKeyDown, closeAndRestoreFocus };
}
