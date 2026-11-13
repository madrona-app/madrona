import type { KeyboardEvent } from 'react';

/**
 * Keyboard handler for a WAI-ARIA tablist (automatic activation).
 *
 * Attach as onKeyDown to each role="tab" button. Left/Right (and Up/Down) move
 * between tabs, Home/End jump to the first/last tab; the newly focused tab is
 * activated through `onSelect`. Focus moves to the matching `[role="tab"]`
 * inside the closest role="tablist" ancestor.
 */
export function handleTabListKeyDown<T extends string>(
  event: KeyboardEvent<HTMLElement>,
  ids: readonly T[],
  activeId: T,
  onSelect: (id: T) => void
) {
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
  if (!keys.includes(event.key) || ids.length === 0) return;
  event.preventDefault();

  const current = Math.max(0, ids.indexOf(activeId));
  let next = current;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % ids.length;
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (current - 1 + ids.length) % ids.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = ids.length - 1;

  onSelect(ids[next]);
  const list = event.currentTarget.closest('[role="tablist"]');
  const tabs = list?.querySelectorAll<HTMLElement>('[role="tab"]');
  tabs?.[next]?.focus();
}
