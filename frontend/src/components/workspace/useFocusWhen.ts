import { useEffect } from 'react';
import type { RefObject } from 'react';

/**
 * Move focus to `ref` when `active` becomes true.
 *
 * Replaces `autoFocus` for two cases:
 * - the initial focus of a dialog that should land on a field rather than
 *   on the first focusable element (useAccessibleModal focuses that one in a
 *   zero-delay timeout; this timeout is queued after it, so it wins when the
 *   hook is called after useAccessibleModal);
 * - an inline editor that replaces the button which had focus, so focus is
 *   not dropped to the document body.
 */
export function useFocusWhen(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  options: { select?: boolean } = {}
) {
  const { select = false } = options;
  useEffect(() => {
    if (!active) return;
    const timeoutId = setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      if (select && el instanceof HTMLInputElement) el.select();
    }, 0);
    return () => clearTimeout(timeoutId);
  }, [ref, active, select]);
}
