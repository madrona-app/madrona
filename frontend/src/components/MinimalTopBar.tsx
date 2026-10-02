import { Menu } from 'lucide-react';
import { useSidebar } from '../contexts/SidebarContext';
import { ActiveContextIndicator } from './ActiveContextIndicator';
import { ProductSwitcher } from './navigation/ProductSwitcher';
import { NotificationBell } from './NotificationBell';

export function MinimalTopBar() {
  const { isMobileOpen, toggleMobileOpen } = useSidebar();

  return (
    <header className="topbar-minimal">
      {/* Mobile hamburger menu - only visible on mobile */}
      <button
        onClick={toggleMobileOpen}
        className="topbar-hamburger sm:hidden"
        aria-label="Open navigation menu"
        aria-expanded={isMobileOpen}
        aria-controls="mobile-nav-drawer"
      >
        <Menu size={24} />
      </button>

      {/* Product switcher - shows "Madrona · Product ▾" */}
      <div className="hidden sm:flex items-center">
        <ProductSwitcher />
      </div>

      {/* Right side: notifications + active context */}
      <div className="flex items-center gap-2 ml-auto">
        {/* Notification bell */}
        <NotificationBell />

        {/* Active context indicator - shows current object/workspace on desktop */}
        <div className="hidden sm:flex items-center">
          <ActiveContextIndicator />
        </div>
      </div>
    </header>
  );
}
