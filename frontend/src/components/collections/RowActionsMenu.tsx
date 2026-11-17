import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { MoreVertical, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface RowAction {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  destructive?: boolean;
}

interface RowActionsMenuProps {
  /** Name of the row the actions apply to, e.g. "Part 2" -> "Actions for Part 2" */
  targetLabel: string;
  actions: RowAction[];
  /** Controlled open state (optional; uncontrolled when omitted) */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Extra classes for the trigger (e.g. hover-reveal) */
  triggerClassName?: string;
  /** Extra classes for the menu panel (z-index, radius) */
  menuClassName?: string;
  /** Classes for each item (padding) */
  itemClassName?: string;
}

/**
 * "More actions" menu for a row (WAI-ARIA menu button pattern).
 *
 * The trigger exposes aria-haspopup/aria-expanded. Opening it focuses the
 * first item; Up/Down/Home/End move between items; Escape closes and
 * returns focus to the trigger; Tab closes and moves on. A transparent
 * overlay closes it on an outside click.
 */
export function RowActionsMenu({
  targetLabel,
  actions,
  open,
  onOpenChange,
  triggerClassName,
  menuClassName,
  itemClassName = 'px-3 py-2',
}: RowActionsMenuProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isOpen = open ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (open === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const label = `Actions for ${targetLabel}`;

  useEffect(() => {
    if (isOpen) {
      menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    }
  }, [isOpen]);

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  const handleMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []
    );
    const index = items.indexOf(document.activeElement as HTMLElement);
    const focusAt = (i: number) => items[(i + items.length) % items.length]?.focus();
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusAt(index + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusAt(index - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusAt(0);
        break;
      case 'End':
        e.preventDefault();
        focusAt(items.length - 1);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        close(true);
        break;
      case 'Tab':
        close(false);
        break;
    }
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(!isOpen)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        aria-label={label}
        className={cn(
          'p-1.5 text-archive hover:text-forest rounded hover:bg-stone/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2',
          isOpen && 'opacity-100',
          triggerClassName
        )}
      >
        <MoreVertical size={16} aria-hidden="true" />
      </button>

      {isOpen && (
        <>
          {/* Click-outside catcher; keyboard users close with Escape or Tab. */}
          <div className="fixed inset-0 z-10" aria-hidden="true" onClick={() => close(false)} />
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            tabIndex={-1}
            aria-label={label}
            onKeyDown={handleMenuKeyDown}
            className={cn(
              'absolute right-0 top-full mt-1 z-20 bg-parchment border border-lichen rounded-lg shadow-lg py-1 min-w-[140px]',
              menuClassName
            )}
          >
            {actions.map(({ label: actionLabel, icon: Icon, onSelect, destructive }) => (
              <button
                key={actionLabel}
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  setOpen(false);
                  onSelect();
                }}
                className={cn(
                  'w-full text-left flex items-center gap-2 text-sm focus-visible:outline-none',
                  destructive
                    ? 'text-semantic-error hover:bg-semantic-error/10 focus-visible:bg-semantic-error/10'
                    : 'text-forest hover:bg-stone/30 focus-visible:bg-stone/30',
                  itemClassName
                )}
              >
                <Icon size={14} aria-hidden="true" />
                {actionLabel}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
