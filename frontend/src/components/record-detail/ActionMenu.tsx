/**
 * ActionMenu - More dropdown menu for record detail pages
 *
 * Contains all available actions for the record, grouped by category.
 * Acts as a universal fallback for actions also shown in the right rail.
 *
 * @see /docs/record-detail-page-redesign.md
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  MoreHorizontal,
  ArrowRightLeft,
  ClipboardCheck,
  FileOutput,
  AlertTriangle,
  FileQuestion,
  Hammer,
  DollarSign,
  CheckSquare,
  History,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../../lib/utils';

// =============================================================================
// TYPES
// =============================================================================

export interface ActionMenuItem {
  id: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  variant?: 'default' | 'outline' | 'destructive';
  disabled?: boolean;
  /** Permission required for this action */
  permission?: string;
}

export interface ActionMenuGroup {
  id: string;
  label?: string;
  items: ActionMenuItem[];
}

export interface ActionMenuProps {
  /** Whether user can create tasks */
  canCreateTask?: boolean;
  /** Callback when Create Task is clicked */
  onCreateTask?: () => void;
  /** Whether user can view history */
  canViewHistory?: boolean;
  /** Callback when View History is clicked */
  onViewHistory?: () => void;
  /** Quick actions (same as right rail) */
  quickActions?: ActionMenuItem[];
  /** Additional custom action groups */
  customGroups?: ActionMenuGroup[];
  /** Button size variant */
  size?: 'sm' | 'md';
  /** Additional CSS classes for trigger button */
  className?: string;
}

// =============================================================================
// MENU GROUP COMPONENT
// =============================================================================

interface MenuGroupProps {
  group: ActionMenuGroup;
  onClose: () => void;
}

function MenuGroup({ group, onClose }: MenuGroupProps) {
  const handleItemClick = useCallback(
    (item: ActionMenuItem) => {
      if (item.disabled) return;
      item.onClick();
      onClose();
    },
    [onClose]
  );

  return (
    <div className="py-1">
      {group.label && (
        <div className="px-3 py-1.5 text-xs font-semibold text-archive uppercase tracking-wide">
          {group.label}
        </div>
      )}
      {group.items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            onClick={() => handleItemClick(item)}
            disabled={item.disabled}
            className={cn(
              'w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors text-left',
              item.variant === 'destructive'
                ? 'text-semantic-error hover:bg-semantic-error/10'
                : 'text-ink hover:bg-stone',
              item.disabled && 'opacity-50 cursor-not-allowed'
            )}
          >
            <Icon size={16} className="flex-shrink-0" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// =============================================================================
// ACTION MENU COMPONENT
// =============================================================================

export function ActionMenu({
  canCreateTask = false,
  onCreateTask,
  canViewHistory = false,
  onViewHistory,
  quickActions = [],
  customGroups = [],
  size = 'md',
  className,
}: ActionMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Close on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen]);

  const handleClose = useCallback(() => {
    setIsOpen(false);
  }, []);

  // Build action groups
  const groups: ActionMenuGroup[] = [];

  // Quick actions group (same as rail for discoverability)
  if (quickActions.length > 0) {
    groups.push({
      id: 'actions',
      label: 'Actions',
      items: quickActions,
    });
  }

  // Tasks & History group
  const utilityItems: ActionMenuItem[] = [];
  if (canCreateTask && onCreateTask) {
    utilityItems.push({
      id: 'create-task',
      label: 'Create Task',
      icon: CheckSquare,
      onClick: onCreateTask,
    });
  }
  if (canViewHistory && onViewHistory) {
    utilityItems.push({
      id: 'view-history',
      label: 'View History',
      icon: History,
      onClick: onViewHistory,
    });
  }
  if (utilityItems.length > 0) {
    groups.push({
      id: 'utility',
      items: utilityItems,
    });
  }

  // Custom groups
  groups.push(...customGroups);

  // Don't render if no actions available
  if (groups.length === 0) {
    return null;
  }

  const sizeClasses = size === 'sm' ? 'p-1.5' : 'p-2';
  const iconSize = size === 'sm' ? 16 : 18;

  return (
    <div className="relative" ref={menuRef}>
      {/* Trigger button */}
      <button
        ref={triggerRef}
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'tap-target rounded-lg border border-lichen transition-colors',
          'hover:bg-stone hover:border-bark/30',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2',
          isOpen && 'bg-stone border-bark/30',
          sizeClasses,
          className
        )}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label="More actions"
        title="More actions"
      >
        <MoreHorizontal size={iconSize} className="text-archive" />
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div
          className={cn(
            'absolute right-0 top-full mt-1 z-50',
            'min-w-[200px] max-w-[280px]',
            'bg-parchment rounded-lg shadow-lg border border-lichen',
            'py-1 overflow-hidden'
          )}
          role="menu"
          aria-orientation="vertical"
        >
          {groups.map((group, index) => (
            <div key={group.id}>
              {index > 0 && <div className="border-t border-lichen my-1" />}
              <MenuGroup group={group} onClose={handleClose} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// DEFAULT ACTION DEFINITIONS
// =============================================================================

/** Helper to build quick actions for ActionMenu from permission checks */
export function buildActionMenuItems(
  permissions: {
    canCreateMovement?: boolean;
    canCreateConditionReport?: boolean;
    canCreateLoanRequest?: boolean;
    canCreateIncident?: boolean;
    canCreateUseRequest?: boolean;
    canCreateConservation?: boolean;
    canCreateValuation?: boolean;
  },
  callbacks: {
    onMovementClick?: () => void;
    onConditionReportClick?: () => void;
    onLoanRequestClick?: () => void;
    onIncidentClick?: () => void;
    onUseRequestClick?: () => void;
    onConservationClick?: () => void;
    onValuationClick?: () => void;
  }
): ActionMenuItem[] {
  const items: ActionMenuItem[] = [];

  if (permissions.canCreateMovement && callbacks.onMovementClick) {
    items.push({
      id: 'movement',
      label: 'Record Movement',
      icon: ArrowRightLeft,
      onClick: callbacks.onMovementClick,
    });
  }

  if (permissions.canCreateConditionReport && callbacks.onConditionReportClick) {
    items.push({
      id: 'condition',
      label: 'Condition Report',
      icon: ClipboardCheck,
      onClick: callbacks.onConditionReportClick,
    });
  }

  if (permissions.canCreateLoanRequest && callbacks.onLoanRequestClick) {
    items.push({
      id: 'loan',
      label: 'Loan Request',
      icon: FileOutput,
      onClick: callbacks.onLoanRequestClick,
    });
  }

  if (permissions.canCreateIncident && callbacks.onIncidentClick) {
    items.push({
      id: 'incident',
      label: 'Report Incident',
      icon: AlertTriangle,
      onClick: callbacks.onIncidentClick,
    });
  }

  if (permissions.canCreateUseRequest && callbacks.onUseRequestClick) {
    items.push({
      id: 'use-request',
      label: 'Use Request',
      icon: FileQuestion,
      onClick: callbacks.onUseRequestClick,
    });
  }

  if (permissions.canCreateConservation && callbacks.onConservationClick) {
    items.push({
      id: 'conservation',
      label: 'Conservation',
      icon: Hammer,
      onClick: callbacks.onConservationClick,
    });
  }

  if (permissions.canCreateValuation && callbacks.onValuationClick) {
    items.push({
      id: 'valuation',
      label: 'Valuation',
      icon: DollarSign,
      onClick: callbacks.onValuationClick,
    });
  }

  return items;
}

export default ActionMenu;
