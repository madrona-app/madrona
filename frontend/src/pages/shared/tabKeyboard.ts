import type { KeyboardEvent } from 'react';

/**
 * Arrow-key handling for a WAI-ARIA tablist with automatic activation.
 * Left/Right (and Home/End) move to and select the neighbouring tab, then move
 * focus to it. Tab buttons use roving tabindex: only the selected tab is in the
 * Tab order (tabIndex 0), the others are -1.
 *
 * `tabId(key)` must return the DOM id of the tab button for `key`.
 */
export function handleTabListKeyDown<K extends string>(
  event: KeyboardEvent<HTMLElement>,
  keys: readonly K[],
  current: K,
  select: (key: K) => void,
  tabId: (key: K) => string,
): void {
  const index = keys.indexOf(current);
  let next: number | null = null;
  switch (event.key) {
    case 'ArrowRight':
      next = (index + 1) % keys.length;
      break;
    case 'ArrowLeft':
      next = (index - 1 + keys.length) % keys.length;
      break;
    case 'Home':
      next = 0;
      break;
    case 'End':
      next = keys.length - 1;
      break;
    default:
      return;
  }
  event.preventDefault();
  const key = keys[next];
  select(key);
  document.getElementById(tabId(key))?.focus();
}
