import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { X, Shield, HelpCircle, User, LogOut, Settings, Building2, Check, ChevronDown } from 'lucide-react';
import { useSidebar } from '../../contexts/SidebarContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../contexts/ThemeContext';
import { useActiveProduct, getProductLandingPath } from '../../hooks/useActiveProduct';
import { products, adminItems, buildPath, isPathActive } from '../../lib/navigationConfig';
import { Wordmark } from '../Wordmark';
import type { Organization } from '../../contexts/AuthContext';
import { MobileContextIndicator } from '../ActiveContextIndicator';
import { logger } from '../../lib/logger';

interface MobileNavDrawerProps {
  orgId: string | null | undefined;
}

export function MobileNavDrawer({ orgId }: MobileNavDrawerProps) {
  const { isMobileOpen, setMobileOpen } = useSidebar();
  const { hasPermission } = usePermissions();
  const location = useLocation();
  const navigate = useNavigate();
  const drawerRef = useRef<HTMLDivElement>(null);
  const auth = useAuth();
  const { theme, setTheme } = useTheme();
  const [isSwitching, setIsSwitching] = useState(false);
  const { activeProduct, activeProductId } = useActiveProduct();
  const [isProductSwitcherOpen, setIsProductSwitcherOpen] = useState(false);

  // Filter admin items by permissions
  const visibleAdminItems = adminItems.filter(item => hasPermission(item.requiresPermission));

  // Get active org
  const activeOrg = auth.memberships.find(
    (org) => org.organization_id === auth.activeOrganizationId
  );
  const hasMultipleOrgs = auth.memberships.length > 1;

  // Filter products by access
  const accessibleProducts = products.filter(product => {
    if (!product.appKey) return true;
    return auth.hasAppAccess(product.appKey);
  });

  // Guide is admin-only config (Corpus + Widget); non-admins get the assistant
  // via the ambient dock. Hide Guide from non-admins unless it's their only app
  // (standalone Guide org) so nobody is left with an empty switcher.
  const visibleProducts = hasPermission('org.manage_settings')
    ? accessibleProducts
    : accessibleProducts.filter(
        (p) => p.appKey !== 'guide' || accessibleProducts.length === 1,
      );

  const handleSwitchOrg = async (orgIdToSwitch: string) => {
    if (isSwitching || orgIdToSwitch === auth.activeOrganizationId) return;
    setIsSwitching(true);
    setMobileOpen(false);
    try {
      await auth.setActiveOrganization(orgIdToSwitch);
      window.location.reload();
    } catch (err) {
      logger.error('Failed to switch organization:', err);
      setIsSwitching(false);
    }
  };

  const handleLogout = async () => {
    setMobileOpen(false);
    try {
      await auth.logout();
      navigate('/sign-in');
    } catch (err) {
      logger.error('Logout error:', err);
      navigate('/sign-in');
    }
  };

  // Close drawer when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (drawerRef.current && !drawerRef.current.contains(event.target as Node)) {
        setMobileOpen(false);
      }
    };

    if (isMobileOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      // Prevent body scroll when drawer is open
      document.body.style.overflow = 'hidden';
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        document.body.style.overflow = '';
      };
    }
  }, [isMobileOpen, setMobileOpen]);

  // Close drawer on navigation
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname, setMobileOpen]);

  // Get visible items for the active product
  const visibleItems = activeProduct
    ? activeProduct.items.filter(item => {
        if (item.requiresApp && !auth.hasAppAccess(item.requiresApp)) return false;
        if (!item.requiresPermission) return true;
        return hasPermission(item.requiresPermission);
      })
    : [];

  if (!isMobileOpen) return null;

  return (
    <>
      {/* Overlay */}
      <div
        className="mobile-drawer-overlay sm:hidden"
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        id="mobile-nav-drawer"
        className="mobile-drawer sm:hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        data-product={activeProductId}
      >
        {/* Header */}
        <div className="flex items-center justify-between h-14 px-4 flex-shrink-0 border-b" style={{ borderColor: 'rgba(107, 122, 126, 0.3)' }}>
          <span className="text-2xl font-serif font-semibold text-parchment"><Wordmark /></span>
          <button
            onClick={() => setMobileOpen(false)}
            className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] -mr-2 text-parchment rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-parchment/40"
            style={{ background: 'transparent' }}
            aria-label="Close navigation menu"
          >
            <X size={24} />
          </button>
        </div>

        {/* Product Selector - dropdown instead of horizontal tabs */}
        <div className="flex-shrink-0 border-b" style={{ borderColor: 'rgba(107, 122, 126, 0.3)' }}>
          <button
            onClick={() => setIsProductSwitcherOpen(!isProductSwitcherOpen)}
            className="flex items-center justify-between w-full px-4 py-3 text-parchment transition-colors hover:bg-parchment/5"
            aria-expanded={isProductSwitcherOpen}
          >
            <div className="flex items-center gap-2">
              {activeProduct && (() => {
                const ActiveIcon = activeProduct.icon as React.ComponentType<{ size?: number; className?: string }>;
                return <ActiveIcon size={16} className="opacity-70" />;
              })()}
              <span className="font-serif font-semibold">{activeProduct?.label ?? 'Select Product'}</span>
            </div>
            <ChevronDown
              size={16}
              className={`opacity-50 transition-transform ${isProductSwitcherOpen ? 'rotate-180' : ''}`}
            />
          </button>
          {isProductSwitcherOpen && (
            <div className="pb-2 px-2">
              {visibleProducts.map(product => {
                const Icon = product.icon as React.ComponentType<{ size?: number; className?: string }>;
                const isActive = product.id === activeProductId;
                const path = orgId ? getProductLandingPath(product.id, orgId) : '/';

                return (
                  <Link
                    key={product.id}
                    to={path}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded text-sm no-underline transition-colors ${
                      isActive
                        ? 'bg-parchment/12 text-parchment font-medium'
                        : 'text-parchment/65 hover:text-parchment hover:bg-parchment/5'
                    }`}
                    onClick={() => {
                      setIsProductSwitcherOpen(false);
                      setMobileOpen(false);
                    }}
                  >
                    <Icon size={16} className={isActive ? 'opacity-100' : 'opacity-50'} />
                    <span>{product.label}</span>
                    {isActive && <Check size={14} className="ml-auto opacity-50" />}
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Active Context Indicator */}
        <div className="flex-shrink-0">
          <MobileContextIndicator />
        </div>

        {/* Navigation content - scoped to active product */}
        <nav className="flex-1 min-h-0 overflow-y-auto py-4">
          {/* Active product items */}
          {activeProduct && visibleItems.length > 0 && (
            <div className="mb-4">
              {visibleItems.map(item => {
                // Handle items with children (nested groups)
                if (item.children && item.children.length > 0) {
                  return (
                    <div key={item.id} className="mb-2">
                      {/* Group header */}
                      <div className="flex items-center gap-2 px-4 py-2">
                        {(() => {
                          const GroupIcon = item.icon as React.ComponentType<{ size?: number; className?: string }>;
                          return <GroupIcon size={14} className="opacity-50" />;
                        })()}
                        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'rgba(243, 236, 221, 0.4)' }}>
                          {item.label}
                        </span>
                      </div>
                      {/* Group items */}
                      {item.children
                        .filter(child => {
                          if (child.requiresApp && !auth.hasAppAccess(child.requiresApp)) return false;
                          if (!child.requiresPermission) return true;
                          return hasPermission(child.requiresPermission);
                        })
                        .filter(child => child.path)
                        .map(child => {
                          const path = buildPath(child.path!, orgId ?? '');
                          const isActive = isPathActive(child.path!, location.pathname, orgId ?? '', child.exact);
                          const ChildIcon = child.icon as React.ComponentType<{ size?: number; className?: string }>;

                          return (
                            <Link
                              key={child.id}
                              to={path}
                              className={`nav-mobile-item pl-8 ${isActive ? 'bg-parchment/12 border-l-[3px] border-l-copper font-medium' : ''}`}
                              onClick={() => setMobileOpen(false)}
                            >
                              <ChildIcon size={16} />
                              <span className="text-sm">{child.label}</span>
                            </Link>
                          );
                        })}
                    </div>
                  );
                }

                // Simple item without children
                if (!item.path) return null;

                const path = buildPath(item.path, orgId ?? '');
                const isActive = isPathActive(item.path, location.pathname, orgId ?? '', item.exact);
                const ItemIcon = item.icon as React.ComponentType<{ size?: number; className?: string }>;

                return (
                  <Link
                    key={item.id}
                    to={path}
                    className={`nav-mobile-item ${isActive ? 'bg-parchment/12 border-l-[3px] border-l-copper font-medium' : ''}`}
                    onClick={() => setMobileOpen(false)}
                  >
                    <ItemIcon size={18} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          )}

          {/* Admin section */}
          {visibleAdminItems.length > 0 && (
            <div className="mt-4 pt-4" style={{ borderTop: '1px solid rgba(107, 122, 126, 0.3)' }}>
              <div className="flex items-center gap-2 px-4 py-2">
                <Shield size={16} style={{ opacity: 0.7 }} />
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'rgba(243, 236, 221, 0.5)' }}>
                  Admin
                </span>
              </div>
              {visibleAdminItems.filter(item => item.path).map(item => {
                const path = buildPath(item.path!, orgId ?? '');
                const isActive = location.pathname.startsWith(path);
                const Icon = item.icon as React.ComponentType<{ size?: number; className?: string }>;

                return (
                  <Link
                    key={item.id}
                    to={path}
                    className={`nav-mobile-item ${isActive ? 'bg-parchment/12 border-l-[3px] border-l-copper font-medium' : ''}`}
                    onClick={() => setMobileOpen(false)}
                  >
                    <Icon size={18} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          )}

          {/* Help section */}
          <div className="mt-4 pt-4" style={{ borderTop: '1px solid rgba(107, 122, 126, 0.3)' }}>
            <div className="nav-mobile-section">Help</div>
            <a
              href="/docs/"
              className="nav-mobile-item"
              onClick={() => setMobileOpen(false)}
            >
              <HelpCircle size={18} />
              <span>Documentation</span>
            </a>
          </div>

          {/* User & Account section */}
          {auth.user && activeOrg && (
            <div className="mt-4 pt-4" style={{ borderTop: '1px solid rgba(107, 122, 126, 0.3)' }}>
              {/* User info */}
              <div className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center overflow-hidden" style={{ backgroundColor: 'rgba(255, 255, 255, 0.1)' }}>
                    {auth.user.avatar_url ? (
                      <img
                        src={auth.user.avatar_url}
                        alt={auth.user.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <User size={20} className="text-parchment" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-parchment truncate">{auth.user.name}</p>
                    <p className="text-xs truncate" style={{ color: 'rgba(243, 236, 221, 0.5)' }}>{auth.user.email}</p>
                  </div>
                </div>
              </div>

              {/* Current org */}
              <div className="px-4 py-2">
                <div className="flex items-center gap-2">
                  <Building2 size={14} style={{ color: 'rgba(243, 236, 221, 0.5)' }} />
                  <span className="text-xs" style={{ color: 'rgba(243, 236, 221, 0.5)' }}>Organization:</span>
                  <span className="text-xs text-parchment font-medium truncate">{activeOrg.name}</span>
                </div>
              </div>

              {/* Org switcher */}
              {hasMultipleOrgs && (
                <div className="px-4 py-2">
                  <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'rgba(243, 236, 221, 0.5)' }}>
                    Switch Organization
                  </p>
                  <div className="max-h-32 overflow-y-auto rounded" style={{ backgroundColor: 'rgba(0, 0, 0, 0.2)' }}>
                    {auth.memberships.map((org: Organization) => {
                      const isActive = org.organization_id === auth.activeOrganizationId;
                      return (
                        <button
                          key={org.organization_id}
                          onClick={() => handleSwitchOrg(org.organization_id)}
                          disabled={isSwitching || isActive}
                          className={`w-full flex items-center justify-between px-3 py-2 text-sm transition-colors disabled:opacity-50 ${
                            isActive ? 'bg-parchment/12' : 'hover:bg-parchment/5'
                          }`}
                          style={{ color: 'var(--color-parchment)' }}
                        >
                          <span className="truncate">{org.name}</span>
                          {isActive && <Check size={14} />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Theme toggle */}
              <div className="px-4 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'rgba(243, 236, 221, 0.5)' }}>
                  Appearance
                </p>
                <div className="flex gap-1 rounded-md p-1" style={{ backgroundColor: 'rgba(0, 0, 0, 0.2)' }}>
                  {(['light', 'dark', 'system'] as const).map((option) => (
                    <button
                      key={option}
                      onClick={() => setTheme(option)}
                      className={`flex-1 px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                        theme === option
                          ? 'bg-parchment text-ink'
                          : 'text-parchment/70 hover:text-parchment'
                      }`}
                    >
                      {option.charAt(0).toUpperCase() + option.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Settings & Logout */}
              <div className="mt-2">
                <button
                  onClick={() => {
                    setMobileOpen(false);
                    if (auth.activeOrganizationId) {
                      navigate(`/organizations/${auth.activeOrganizationId}/settings`);
                    } else {
                      navigate('/settings');
                    }
                  }}
                  className="nav-mobile-item w-full text-left"
                  style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  <Settings size={18} />
                  <span>Settings</span>
                </button>
                <button
                  onClick={handleLogout}
                  className="nav-mobile-item w-full text-left"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error)' }}
                >
                  <LogOut size={18} />
                  <span>Sign out</span>
                </button>
              </div>
            </div>
          )}
        </nav>
      </div>
    </>
  );
}
