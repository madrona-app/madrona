import { useEffect, useRef, type RefObject } from 'react';

const FIELD_SELECTOR =
  'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([disabled]), select:not([disabled]), textarea:not([disabled])';
const FALLBACK_SELECTOR = 'input:not([disabled]), button:not([disabled]), [href]';

/**
 * When a panel swaps its content (search -> create -> details) the control
 * the user activated is removed and keyboard focus falls back to <body>.
 * Call this with the view key: whenever it changes (not on first render),
 * focus moves to the first text-like field inside `containerRef`.
 *
 * This replaces `autoFocus` on the fields of the newly shown view, which
 * would also fire on first mount.
 */
export function useFocusFirstFieldOnViewChange(
  containerRef: RefObject<HTMLElement | null>,
  view: string
) {
  const previousView = useRef(view);
  useEffect(() => {
    if (previousView.current === view) return;
    previousView.current = view;
    const container = containerRef.current;
    if (!container) return;
    const target =
      container.querySelector<HTMLElement>(FIELD_SELECTOR) ??
      container.querySelector<HTMLElement>(FALLBACK_SELECTOR);
    target?.focus();
  }, [view, containerRef]);
}
