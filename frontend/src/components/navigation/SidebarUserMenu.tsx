import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../contexts/ThemeContext';
import { useSidebar } from '../../contexts/SidebarContext';
import type { Organization } from '../../contexts/AuthContext';
import { Building2, Check, LogOut, ShieldCheck, User, Settings, ChevronUp } from 'lucide-react';
import { logger } from '../../lib/logger';

// Internal ThemeToggle component
const ThemeToggle: React.FC = () => {
  const { theme, setTheme } = useTheme();

  const options: Array<{ value: 'light' | 'dark' | 'system'; label: string }> = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'system', label: 'System' },
  ];

  return (
    <div className="px-4 py-2">
      <div className="flex gap-1 bg-stone rounded-md p-1">
        {options.map((option) => (
          <button
            key={option.value}
            onClick={() => setTheme(option.value)}
            className={`flex-1 px-3 py-1.5 text-xs font-medium rounded transition-colors ${
              theme === option.value
                ? 'bg-parchment text-ink shadow-sm'
                : 'text-archive hover:text-ink'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
};

export function SidebarUserMenu() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { isCollapsed } = useSidebar();
  const [isOpen, setIsOpen] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const handleSwitchOrg = async (orgId: string) => {
    if (isSwitching || orgId === auth.activeOrganizationId) return;

    setIsSwitching(true);
    setIsOpen(false);

    try {
      await auth.setActiveOrganization(orgId);
      window.location.reload();
    } catch (err) {
      logger.error('Failed to switch organization:', err);
      setIsSwitching(false);
    }
  };

  const handleLogout = async () => {
    setIsOpen(false);
    try {
      await auth.logout();
      navigate('/sign-in');
    } catch (err) {
      logger.error('Logout error:', err);
      navigate('/sign-in');
    }
  };

  if (auth.isLoading || !auth.user) {
    return (
      <div className="sidebar-user-menu-trigger">
        <User size={18} className="sidebar-nav-item-icon" />
        <span className="sidebar-nav-item-label">Loading...</span>
      </div>
    );
  }

  const activeOrg = auth.memberships.find(
    (org) => org.organization_id === auth.activeOrganizationId
  );

  if (!activeOrg) {
    return (
      <div className="sidebar-user-menu-trigger">
        <User size={18} className="sidebar-nav-item-icon" />
        <span className="sidebar-nav-item-label">No organization</span>
      </div>
    );
  }

  const hasMultipleOrgs = auth.memberships.length > 1;

  const getRoleBadgeColor = (role: string) => {
    switch (role.toLowerCase()) {
      case 'owner':
        return 'bg-semantic-info/15 text-semantic-info';
      case 'admin':
        return 'bg-bark/10 text-bark';
      case 'member':
        return 'bg-semantic-success/15 text-semantic-success';
      case 'viewer':
        return 'bg-stone text-archive';
      default:
        return 'bg-stone text-archive';
    }
  };

  return (
    <div className="sidebar-user-menu" ref={menuRef}>
      {/* Trigger button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={isSwitching}
        className={`sidebar-user-menu-trigger ${isOpen ? 'sidebar-user-menu-trigger--active' : ''}`}
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-label="User menu"
      >
        <div className="sidebar-user-avatar">
          {auth.user.avatar_url ? (
            <img
              src={auth.user.avatar_url}
              alt={auth.user.name}
              className="w-full h-full object-cover rounded-full"
            />
          ) : (
            <User size={16} />
          )}
        </div>
        <div className="sidebar-user-info">
          <span className="sidebar-user-name">{auth.user.name}</span>
          <span className="sidebar-user-org">{activeOrg.name}</span>
        </div>
        <ChevronUp
          size={14}
          className={`sidebar-user-chevron ${isOpen ? 'sidebar-user-chevron--open' : ''}`}
        />
        {isCollapsed && (
          <span className="sidebar-tooltip" role="tooltip">
            {auth.user.name}
          </span>
        )}
      </button>

      {/* Dropdown menu - opens upward */}
      {isOpen && (
        <div className="sidebar-user-dropdown">
          {/* User Info Section */}
          <div className="px-4 py-3 border-b border-lichen">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-stone rounded-full flex items-center justify-center overflow-hidden">
                {auth.user.avatar_url ? (
                  <img
                    src={auth.user.avatar_url}
                    alt={auth.user.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <User size={20} className="text-forest" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink truncate">
                  {auth.user.name}
                </p>
                <p className="text-xs text-archive truncate">
                  {auth.user.email}
                </p>
              </div>
            </div>
          </div>

          {/* Current Organization Section */}
          <div className="px-4 py-3 border-b border-lichen">
            <div className="flex items-start gap-2 mb-1">
              <Building2 size={14} className="text-archive mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-archive uppercase tracking-wide mb-1">
                  Organization
                </p>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-ink truncate">{activeOrg.name}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${getRoleBadgeColor(activeOrg.role)}`}>
                    {activeOrg.role}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Organization Switcher (only if multiple orgs) */}
          {hasMultipleOrgs && (
            <div className="py-1 border-b border-lichen">
              <div className="px-4 py-2">
                <p className="text-xs font-semibold text-archive uppercase tracking-wide mb-2">
                  Switch Organization
                </p>
              </div>
              <div className="max-h-48 overflow-y-auto">
                {auth.memberships.map((org: Organization) => {
                  const isActive = org.organization_id === auth.activeOrganizationId;

                  return (
                    <button
                      key={org.organization_id}
                      onClick={() => handleSwitchOrg(org.organization_id)}
                      disabled={isSwitching || isActive}
                      className={`w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-stone transition-colors disabled:opacity-50 ${
                        isActive ? 'bg-bark/10 cursor-default' : ''
                      }`}
                    >
                      <div className="flex flex-col items-start flex-1 min-w-0">
                        <div className="flex items-center gap-2 w-full">
                          <span className={`font-medium truncate ${isActive ? 'text-bark' : 'text-ink'}`}>
                            {org.name}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${getRoleBadgeColor(org.role)}`}>
                            {org.role_label}
                          </span>
                        </div>
                        <span className="text-xs text-archive truncate">
                          {org.slug}
                        </span>
                      </div>
                      {isActive && <Check size={14} className="text-bark flex-shrink-0 ml-2" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Appearance Section */}
          <div className="py-1 border-b border-lichen">
            <div className="px-4 py-2">
              <p className="text-xs font-semibold text-archive uppercase tracking-wide mb-2">
                Appearance
              </p>
            </div>
            <ThemeToggle />
          </div>

          {/* Settings & Logout Section */}
          <div className="py-1">
            <button
              onClick={() => {
                setIsOpen(false);
                if (auth.activeOrganizationId) {
                  navigate(`/organizations/${auth.activeOrganizationId}/settings`);
                } else {
                  navigate('/settings');
                }
              }}
              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-ink hover:bg-stone transition-colors"
            >
              <Settings size={16} />
              <span>Settings</span>
            </button>
            <button
              onClick={() => {
                setIsOpen(false);
                navigate('/account/security');
              }}
              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-ink hover:bg-stone transition-colors"
            >
              <ShieldCheck size={16} />
              <span>Security</span>
            </button>
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-semantic-error hover:bg-semantic-error/10 transition-colors"
            >
              <LogOut size={16} />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
