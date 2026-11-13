/**
 * RowActionMenu — "more actions" menu button for list/card rows.
 *
 * WAI-ARIA menu button pattern: the trigger exposes aria-haspopup="menu" and
 * aria-expanded; items are role="menuitem", reached with Arrow keys / Home /
 * End; Escape (or choosing an item) closes the menu and returns focus to the
 * trigger; Tab or a click outside closes it.
 */

import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { MoreVertical } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface RowActionMenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  destructive?: boolean;
  hidden?: boolean;
}

interface RowActionMenuProps {
  /** Accessible name of the trigger, e.g. "Actions for Standard template" */
  label: string;
  items: RowActionMenuItem[];
  /** Tailwind width class for the popup */
  widthClassName?: string;
}

export function RowActionMenu({ label, items, widthClassName = 'w-40' }: RowActionMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const baseId = useId();
  const visible = items.filter((i) => !i.hidden);

  useEffect(() => {
    if (!isOpen) return;
    itemRefs.current[0]?.focus();
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [isOpen]);

  const close = () => {
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setIsOpen(true);
    }
  };

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const els = itemRefs.current.filter(Boolean) as HTMLButtonElement[];
    const idx = els.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      els[(idx + 1) % els.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      els[(idx - 1 + els.length) % els.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      els[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      els[els.length - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      setIsOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        id={`${baseId}-trigger`}
        onClick={() => setIsOpen((o) => !o)}
        onKeyDown={onTriggerKeyDown}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? `${baseId}-menu` : undefined}
        className="p-1 text-archive hover:text-ink rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
      >
        <MoreVertical size={16} aria-hidden="true" />
      </button>

      {isOpen && (
        <div
          id={`${baseId}-menu`}
          role="menu"
          tabIndex={-1}
          aria-labelledby={`${baseId}-trigger`}
          onKeyDown={onMenuKeyDown}
          className={cn(
            'absolute right-0 top-8 bg-parchment border border-lichen rounded-lg shadow-lg z-20',
            widthClassName,
          )}
        >
          {visible.map((item, i) => (
            <button
              key={item.label}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                close();
                item.onSelect();
              }}
              className={cn(
                'w-full px-3 py-2 text-left text-sm hover:bg-stone/50 focus-visible:outline-none focus-visible:bg-stone/50 flex items-center gap-2',
                item.destructive && 'text-semantic-error',
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default RowActionMenu;
