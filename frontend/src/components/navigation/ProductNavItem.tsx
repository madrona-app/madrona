import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useSidebar } from '../../contexts/SidebarContext';
import { buildPath, isPathActive, type NavItem, type NavIcon } from '../../lib/navigationConfig';
import { TaskCountBadge } from '../work/MyTasks';
import { ApprovalCountBadge } from '../work/ApprovalCountBadge';
import { DraftsCountBadge } from '../work/DraftsCountBadge';
import { PlanCountBadge } from '../work/PlanCountBadge';

const NAV_ITEM_STORAGE_KEY = 'madrona.sidebar.navItems';

// Map badge IDs to components
function NavBadge({ badgeId }: { badgeId: NavItem['badgeId'] }) {
  if (badgeId === 'task-count') return <TaskCountBadge className="ml-auto" />;
  if (badgeId === 'approval-count') return <ApprovalCountBadge className="ml-auto" />;
  if (badgeId === 'draft-count') return <DraftsCountBadge className="ml-auto" />;
  if (badgeId === 'plan-count') return <PlanCountBadge className="ml-auto" />;
  return null;
}

interface ProductNavItemProps {
  item: NavItem;
  orgId: string | null | undefined;
  /** Sibling items rendered alongside this one, for longest-prefix-wins matching. */
  siblings?: NavItem[];
}

export function ProductNavItem({ item, orgId, siblings }: ProductNavItemProps) {
  const location = useLocation();
  const { isCollapsed, setCollapsed } = useSidebar();

  // Check if this item or any children are active
  const hasActiveChild = item.children?.some(child =>
    child.path ? isPathActive(child.path, location.pathname, orgId, child.exact) : false
  ) || false;

  // For parent items with children: only mark as directly active if EXACTLY on that path
  // (not when on a child path). This prevents parent from staying highlighted when child is active.
  let isDirectlyActive = false;
  if (item.path) {
    if (item.children && item.children.length > 0) {
      isDirectlyActive = buildPath(item.path, orgId) === location.pathname; // Exact match for parents with children
    } else {
      // Leaf item: prefix match, but longest-prefix-wins — don't light up when a
      // sibling has a more specific matching path (e.g. Insurance is a prefix of
      // Insurance/Indemnities, so both would otherwise highlight on the indemnity page).
      const active = isPathActive(item.path, location.pathname, orgId, item.exact);
      const myPathLen = buildPath(item.path, orgId).length;
      const shadowedBySibling = active && !!siblings?.some(sib =>
        sib.path && sib.id !== item.id
        && buildPath(sib.path, orgId).length > myPathLen
        && isPathActive(sib.path, location.pathname, orgId, sib.exact)
      );
      isDirectlyActive = active && !shadowedBySibling;
    }
  }

  const isActive = isDirectlyActive || hasActiveChild;

  // Expand state for items with children - persisted to localStorage
  const [isExpanded, setIsExpanded] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      const stored = localStorage.getItem(NAV_ITEM_STORAGE_KEY);
      if (stored) {
        const expandedItems = JSON.parse(stored) as string[];
        return expandedItems.includes(item.id);
      }
    } catch {
      // Ignore parse errors
    }
    // Default: all collapsed
    return false;
  });

  // Persist expanded state to localStorage
  useEffect(() => {
    if (!item.children || item.children.length === 0) return;
    try {
      const stored = localStorage.getItem(NAV_ITEM_STORAGE_KEY);
      const expandedItems: string[] = stored ? JSON.parse(stored) : [];
      const hasItem = expandedItems.includes(item.id);

      if (isExpanded && !hasItem) {
        localStorage.setItem(NAV_ITEM_STORAGE_KEY, JSON.stringify([...expandedItems, item.id]));
      } else if (!isExpanded && hasItem) {
        localStorage.setItem(NAV_ITEM_STORAGE_KEY, JSON.stringify(expandedItems.filter(id => id !== item.id)));
      }
    } catch {
      // Ignore storage errors
    }
  }, [isExpanded, item.id, item.children]);

  // Handle both Lucide icons (as components) and react-icons (as functions)
  const Icon = item.icon as React.ComponentType<{ size?: number; className?: string }>;

  // If item has children, render as expandable section
  if (item.children && item.children.length > 0) {
    return (
      <div className="sidebar-nav-group">
        {item.path ? (
          // Has both path and children - clickable link with expand toggle
          <div className="sidebar-nav-item-wrapper">
            <Link
              to={buildPath(item.path, orgId)}
              data-tour={item.dataTour}
              className={`sidebar-nav-item sidebar-nav-item--parent ${isDirectlyActive ? 'sidebar-nav-item--active' : ''}`}
              aria-current={isDirectlyActive ? 'page' : undefined}
            >
              <Icon size={16} className="sidebar-nav-item-icon" />
              <span className="sidebar-nav-item-label">{item.label}</span>
              {!isCollapsed && item.badgeId && <NavBadge badgeId={item.badgeId} />}
            </Link>
            {!isCollapsed && (
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="sidebar-nav-expand-btn"
                aria-expanded={isExpanded}
                aria-label={isExpanded ? 'Collapse' : 'Expand'}
              >
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            )}
            {isCollapsed && (
              <span className="sidebar-tooltip" role="tooltip">
                {item.label}
              </span>
            )}
          </div>
        ) : isCollapsed ? (
          // Collapsed: clicking section header expands sidebar and reveals children
          <button
            onClick={() => {
              setCollapsed(false);
              setIsExpanded(true);
            }}
            className={`sidebar-nav-item ${hasActiveChild ? 'sidebar-nav-item--active' : ''}`}
            aria-label={`Expand ${item.label}`}
          >
            <Icon size={16} className={`sidebar-nav-item-icon ${item.accent === 'studio' ? 'text-studio' : ''}`} />
            <span className={`sidebar-nav-item-label ${item.accent === 'studio' ? 'text-studio font-medium' : ''}`}>{item.label}</span>
            <span className="sidebar-tooltip" role="tooltip">
              {item.label}
            </span>
          </button>
        ) : (
          // Expanded: section header toggles children visibility
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="sidebar-nav-item sidebar-nav-item--section"
            aria-expanded={isExpanded}
            aria-label={`Toggle ${item.label || 'section'}`}
          >
            <Icon size={16} className={`sidebar-nav-item-icon ${item.accent === 'studio' ? 'text-studio' : ''}`} />
            <span className={`sidebar-nav-item-label ${item.accent === 'studio' ? 'text-studio font-medium' : ''}`}>{item.label}</span>
            {item.badgeId && <NavBadge badgeId={item.badgeId} />}
            <span className="sidebar-nav-expand-icon">
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
          </button>
        )}

        {/* Children */}
        {!isCollapsed && isExpanded && (
          <div className="sidebar-nav-children">
            {item.children.map(child => (
              <ProductNavItem key={child.id} item={child} orgId={orgId} siblings={item.children} />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Simple item without children
  if (!item.path) return null;

  const path = buildPath(item.path, orgId);

  return (
    <Link
      to={path}
      data-tour={item.dataTour}
      className={`sidebar-nav-item ${isActive ? 'sidebar-nav-item--active' : ''}`}
      aria-current={isActive ? 'page' : undefined}
    >
      <Icon size={16} className="sidebar-nav-item-icon" />
      <span className="sidebar-nav-item-label">{item.label}</span>
      {!isCollapsed && item.badgeId && <NavBadge badgeId={item.badgeId} />}
      {isCollapsed && (
        <span className="sidebar-tooltip" role="tooltip">
          {item.label}
        </span>
      )}
    </Link>
  );
}

interface AdminNavItemProps {
  item: {
    id: string;
    label: string;
    path: string;
    icon: NavIcon;
  };
  orgId: string | null | undefined;
}

export function AdminNavItem({ item, orgId }: AdminNavItemProps) {
  const location = useLocation();
  const { isCollapsed } = useSidebar();

  const path = buildPath(item.path, orgId);
  const isActive = location.pathname.startsWith(path);

  const Icon = item.icon as React.ComponentType<{ size?: number; className?: string }>;

  return (
    <Link
      to={path}
      className={`sidebar-nav-item ${isActive ? 'sidebar-nav-item--active' : ''}`}
      aria-current={isActive ? 'page' : undefined}
    >
      <Icon size={16} className="sidebar-nav-item-icon" />
      <span className="sidebar-nav-item-label">{item.label}</span>
      {isCollapsed && (
        <span className="sidebar-tooltip" role="tooltip">
          {item.label}
        </span>
      )}
    </Link>
  );
}
