import { Link, NavLink } from 'react-router-dom';
import { PanelLeftClose, PanelLeft, Shield, Clock, Home } from 'lucide-react';
import { useSidebar } from '../contexts/SidebarContext';
import { usePermissions } from '../hooks/usePermissions';
import { useAuth } from '../hooks/useAuth';
import { useActiveProduct } from '../hooks/useActiveProduct';
import { useWork, filterRecentItemsByApp } from '../contexts/WorkContext';
import { ProductNavItem, AdminNavItem } from './navigation/ProductNavItem';
import { SidebarUserMenu } from './navigation/SidebarUserMenu';
import { SidebarRecentItems } from './navigation/SidebarRecentItems';
import { Wordmark } from './Wordmark';
import { adminItems } from '../lib/navigationConfig';

interface AppSidebarProps {
  orgId: string | null | undefined;
  onOpenChat?: () => void;
}

export function AppSidebar({ orgId, onOpenChat: _onOpenChat }: AppSidebarProps) {
  const { isCollapsed, toggleCollapsed, isSectionExpanded, toggleSection } = useSidebar();
  const { hasPermission } = usePermissions();
  const { hasAppAccess } = useAuth();
  const { activeProduct, activeProductId } = useActiveProduct();
  const { recentItems } = useWork();

  // Filter recent items to only show recents from the current app section
  const appRecentItems = filterRecentItemsByApp(recentItems, activeProductId);

  // Filter admin items by permissions
  const visibleAdminItems = adminItems.filter(item => hasPermission(item.requiresPermission));
  const isRecentExpanded = isSectionExpanded('recent');
  const isAdminExpanded = isSectionExpanded('admin');

  // Get visible items for the active product
  const visibleItems = activeProduct
    ? activeProduct.items.filter(item => {
        if (item.requiresApp && !hasAppAccess(item.requiresApp)) return false;
        if (!item.requiresPermission) return true;
        return hasPermission(item.requiresPermission);
      })
    : [];

  return (
    <aside
      className={`sidebar ${isCollapsed ? 'sidebar--collapsed' : 'sidebar--expanded'} hidden sm:flex`}
      aria-label="Main navigation"
      data-product={activeProduct?.id}
    >
      {/* Header with logo */}
      <div className="sidebar-header">
        <Link
          to={orgId ? `/organizations/${orgId}/home` : '/'}
          className="sidebar-logo flex items-center no-underline justify-center"
        >
          <span className="text-2xl font-serif font-semibold text-parchment">
            {isCollapsed ? 'M' : <Wordmark />}
          </span>
        </Link>
        {!isCollapsed && (
          <button
            onClick={toggleCollapsed}
            className="sidebar-collapse-toggle ml-auto"
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
          >
            <PanelLeftClose size={18} />
          </button>
        )}
      </div>

      {/* Expand button - shown when collapsed, positioned at sidebar edge */}
      {isCollapsed && (
        <button
          onClick={toggleCollapsed}
          className="sidebar-expand-button"
          aria-label="Expand sidebar"
          title="Expand sidebar"
        >
          <PanelLeft size={16} />
        </button>
      )}

      {/* Main navigation content - scoped to active product */}
      <div className="sidebar-content">
        {/* Home — always visible, cross-product landing */}
        {orgId && (
          <NavLink
            to={`/organizations/${orgId}/home`}
            viewTransition
            className={({ isActive }) =>
              `sidebar-nav-item${isActive ? ' sidebar-nav-item--active' : ''}`
            }
            end
          >
            <Home size={18} className="sidebar-nav-item-icon" />
            <span className="sidebar-nav-item-label">Home</span>
            {isCollapsed && (
              <span className="sidebar-tooltip" role="tooltip">
                Home
              </span>
            )}
          </NavLink>
        )}

        {activeProduct && visibleItems.length > 0 && (
          <div className="sidebar-product-scoped">
            {isCollapsed ? (
              /* Collapsed: show only nav items */
              <nav aria-label={`${activeProduct.label} navigation`}>
                {visibleItems.map(item => (
                  <ProductNavItem key={item.id} item={item} orgId={orgId} siblings={visibleItems} />
                ))}
              </nav>
            ) : (
              /* Expanded: show nav items without product header (it's in the top bar) */
              <nav aria-label={`${activeProduct.label} navigation`}>
                {visibleItems.map(item => (
                  <ProductNavItem key={item.id} item={item} orgId={orgId} siblings={visibleItems} />
                ))}
              </nav>
            )}
          </div>
        )}

        {/* Recent items section */}
        {appRecentItems.length > 0 && (
          <>
            <div className="sidebar-divider" />
            {isCollapsed ? (
              /* Collapsed: show clock icon with tooltip */
              <div className="sidebar-product-collapsed">
                <div className="sidebar-product-indicator" title="Recent">
                  <span className="sidebar-product-indicator-dot" />
                </div>
                <div className="sidebar-nav-item" title="Recent items">
                  <Clock size={18} className="sidebar-nav-item-icon" />
                  <span className="sidebar-nav-item-label">Recent</span>
                  <span className="sidebar-tooltip" role="tooltip">
                    Recent
                  </span>
                </div>
              </div>
            ) : (
              /* Expanded: collapsible header + recent items list */
              <div className="sidebar-product">
                <button
                  onClick={() => toggleSection('recent')}
                  className="sidebar-product-header w-full"
                  aria-expanded={isRecentExpanded}
                  aria-controls="recent-nav"
                >
                  <div className="flex items-center gap-2">
                    <Clock size={16} className="sidebar-nav-item-icon" />
                    <span className="sidebar-product-label">Recent</span>
                  </div>
                  <svg
                    className={`sidebar-product-chevron w-3.5 h-3.5 ${isRecentExpanded ? 'sidebar-product-chevron--expanded' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {isRecentExpanded && (
                  <div id="recent-nav">
                    <SidebarRecentItems recentItems={appRecentItems} limit={5} />
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Admin section */}
        {visibleAdminItems.length > 0 && (
          <>
            <div className="sidebar-divider" />
            {isCollapsed ? (
              /* Collapsed: show just nav items with subtle indicator */
              <div className="sidebar-product-collapsed">
                <div className="sidebar-product-indicator" title="Admin">
                  <span className="sidebar-product-indicator-dot" />
                </div>
                <nav aria-label="Admin navigation">
                  {visibleAdminItems.map(item => (
                    <AdminNavItem key={item.id} item={item} orgId={orgId} />
                  ))}
                </nav>
              </div>
            ) : (
              /* Expanded: show full header with toggle */
              <div className="sidebar-product">
                <button
                  onClick={() => toggleSection('admin')}
                  className="sidebar-product-header w-full"
                  aria-expanded={isAdminExpanded}
                  aria-controls="admin-nav"
                >
                  <div className="flex items-center gap-2">
                    <Shield size={16} className="sidebar-nav-item-icon" />
                    <span className="sidebar-product-label">Admin</span>
                  </div>
                  <svg
                    className={`sidebar-product-chevron w-3.5 h-3.5 ${isAdminExpanded ? 'sidebar-product-chevron--expanded' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {isAdminExpanded && (
                  <nav id="admin-nav" aria-label="Admin navigation">
                    {visibleAdminItems.map(item => (
                      <AdminNavItem key={item.id} item={item} orgId={orgId} />
                    ))}
                  </nav>
                )}
              </div>
            )}
          </>
        )}


      </div>

      {/* Footer with help and user menu */}
      <div className="sidebar-footer">
        {/* Ask Guide moved to floating button in AppShell */}

        {/* User menu with org switcher */}
        <div className="sidebar-divider" />
        <SidebarUserMenu />
      </div>
    </aside>
  );
}
