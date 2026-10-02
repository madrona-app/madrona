import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Renders children into document.body via a React portal.
 * Use this to wrap any modal/dialog backdrop so it covers the full
 * viewport regardless of parent scroll containers or stacking contexts.
 */
export function ModalPortal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}
