import { useState, useEffect, useRef, useId } from 'react';
import type { KeyboardEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ChecklistItemStatus } from './types';
import { STATUS_CONFIG } from './constants';

export interface StatusOptionConfig {
  label: string;
  icon: LucideIcon;
  color: string;
  bgColor: string;
}

interface StatusDropdownProps<S extends string> {
  currentStatus: S;
  onStatusChange: (status: S) => void;
  /** Status options; defaults to the checklist item statuses */
  config?: Record<S, StatusOptionConfig>;
  disabled?: boolean;
  /** id of a visible label ("Status") to prefix the button's accessible name */
  labelledBy?: string;
  /** Accessible label prefix when there is no visible label (e.g. the item title) */
  label?: string;
}

/**
 * Status menu button (WAI-ARIA menu button pattern): the trigger has
 * aria-haspopup="menu"/aria-expanded; options are menuitemradio items reached
 * with the arrow keys, Home/End; Escape closes and returns focus to the trigger.
 */
export function StatusDropdown<S extends string = ChecklistItemStatus>({
  currentStatus,
  onStatusChange,
  config: configMap = STATUS_CONFIG as unknown as Record<S, StatusOptionConfig>,
  disabled,
  labelledBy,
  label,
}: StatusDropdownProps<S>) {
  const statuses = Object.entries(configMap) as [S, StatusOptionConfig][];
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const baseId = useId();
  const buttonId = `${baseId}-button`;
  const menuId = `${baseId}-menu`;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Move focus into the menu when it opens, onto the checked item.
  useEffect(() => {
    if (!isOpen) return;
    const idx = Math.max(0, Object.keys(configMap).indexOf(currentStatus));
    itemRefs.current[idx]?.focus();
  }, [isOpen, currentStatus, configMap]);

  const close = (restoreFocus: boolean) => {
    setIsOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  };

  const handleTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setIsOpen(true);
    }
  };

  const handleMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = itemRefs.current.filter(Boolean) as HTMLButtonElement[];
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        items[(idx + 1) % items.length]?.focus();
        break;
      case 'ArrowUp':
        e.preventDefault();
        items[(idx - 1 + items.length) % items.length]?.focus();
        break;
      case 'Home':
        e.preventDefault();
        items[0]?.focus();
        break;
      case 'End':
        e.preventDefault();
        items[items.length - 1]?.focus();
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        close(true);
        break;
      case 'Tab':
        setIsOpen(false);
        break;
    }
  };

  const config = configMap[currentStatus];
  const StatusIcon = config.icon;

  return (
    <div ref={dropdownRef} className="relative">
      <button
        ref={buttonRef}
        id={buttonId}
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        onKeyDown={handleTriggerKeyDown}
        disabled={disabled}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-sm font-medium rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 ${config.bgColor} ${config.color} ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-80 cursor-pointer'
        }`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        aria-labelledby={labelledBy ? `${labelledBy} ${buttonId}` : undefined}
        aria-label={!labelledBy && label ? `${label}: status ${config.label}` : undefined}
      >
        <StatusIcon className="w-3.5 h-3.5" aria-hidden="true" />
        {config.label}
        {!disabled && <ChevronDown className="w-3 h-3 ml-0.5" aria-hidden="true" />}
      </button>
      {isOpen && (
        <div
          id={menuId}
          role="menu"
          tabIndex={-1}
          aria-labelledby={buttonId}
          onKeyDown={handleMenuKeyDown}
          className="absolute z-20 mt-1 w-40 bg-parchment border border-lichen rounded-lg shadow-lg py-1"
        >
          {statuses.map(([status, cfg], i) => {
            const Icon = cfg.icon;
            return (
              <button
                key={status}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={status === currentStatus}
                tabIndex={-1}
                onClick={() => {
                  onStatusChange(status);
                  close(true);
                }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-stone focus-visible:outline-none focus-visible:bg-stone ${
                  status === currentStatus ? 'bg-stone/50' : ''
                }`}
              >
                <Icon className={`w-4 h-4 ${cfg.color}`} aria-hidden="true" />
                {cfg.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
