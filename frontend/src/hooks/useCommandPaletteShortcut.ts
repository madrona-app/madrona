/**
 * Global Cmd+K / Ctrl+K listener that toggles the command palette.
 *
 * Intentionally does NOT bail when focus is inside an input — that's
 * standard platform behavior (GitHub, Linear, VS Code all swallow Cmd+K
 * from text fields). Esc closing is handled by `useAccessibleModal`
 * inside the palette itself.
 */

import { useEffect } from 'react';

export function useCommandPaletteShortcut(onToggle: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Cmd+K on Mac, Ctrl+K elsewhere. `metaKey` is Cmd on Mac, Windows key
      // on others; we accept either modifier so cross-OS users can muscle
      // memory either combo.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onToggle();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onToggle]);
}
