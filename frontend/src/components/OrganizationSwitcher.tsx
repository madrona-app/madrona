import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';
import type { Organization } from '../contexts/AuthContext';
import { Building2, Check, LogOut, User, Settings } from 'lucide-react';
import { logger } from '../lib/logger';
import { MadronaLoader } from './ui/MadronaLoader';

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
                : 'text-accessible-gray hover:text-ink'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
};

export const OrganizationSwitcher: React.FC = () => {
  const auth = useAuth();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const handleSwitchOrg = async (orgId: string) => {
    if (isSwitching || orgId === auth.activeOrganizationId) return;
    
    setIsSwitching(true);
    setIsOpen(false);
    
    try {
      // POST /me/active-organization, then GET /me to refresh
      await auth.setActiveOrganization(orgId);
      
      // Reload the page to refresh all org-scoped data
      // In the future, we can use React Query to invalidate specific queries
      window.location.reload();
    } catch (err) {
      logger.error('Failed to switch organization:', err);
      setIsSwitching(false);
      showToast({
        type: 'error',
        title: 'Failed to switch organization',
        message: 'Please try again or contact support if the problem persists.',
      });
    }
  };

  const handleLogout = async () => {
    setIsOpen(false);
    try {
      await auth.logout();
      navigate('/sign-in');
    } catch (err) {
      logger.error('Logout error:', err);
      // Still redirect even if logout fails
      navigate('/sign-in');
    }
  };

  if (auth.isLoading || !auth.user) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-sm text-archive">
        <MadronaLoader variant="dots" />
      </div>
    );
  }

  const activeOrg = auth.memberships.find(
    (org) => org.organization_id === auth.activeOrganizationId
  );

  if (!activeOrg) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-sm text-archive">
        <User size={16} />
        <span>No organization</span>
      </div>
    );
  }

  const hasMultipleOrgs = auth.memberships.length > 1;

  const getRoleBadgeColor = (role: string) => {
    switch (role.toLowerCase()) {
      case 'owner':
        return 'bg-forest/10 text-forest';
      case 'admin':
        return 'bg-semantic-info/10 text-semantic-info';
      case 'member':
        return 'bg-semantic-success/10 text-semantic-success';
      case 'viewer':
        return 'bg-stone text-ink';
      default:
        return 'bg-stone text-ink';
    }
  };

  return (
    <div className="relative" ref={dropdownRef} style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={isSwitching}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '6px 12px',
          fontSize: '13px',
          fontWeight: 300, // Reduced from 400
          color: 'rgba(243, 236, 221, 0.65)', // Slightly more muted
          background: 'transparent',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          transition: 'all 0.15s ease',
          height: '32px' // Fixed height for optical alignment
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
          e.currentTarget.style.color = 'rgba(243, 236, 221, 0.85)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = 'rgba(243, 236, 221, 0.65)';
        }}
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-label="User menu"
      >
        <User size={13} style={{ opacity: 0.55 }} />
        <span className="hidden sm:inline">{auth.user.name}</span>
      </button>

      {isOpen && (
        <div 
          className="absolute right-0 w-72 bg-parchment rounded-lg shadow-lg border border-lichen py-1 z-50"
          style={{ 
            top: 'calc(100% + 1px)', // Align with nav bar bottom edge (accounts for 1px border)
            marginTop: 0 // Remove default mt-2 offset
          }}
        >
          {/* User Info Section */}
          <div className="px-4 py-3 border-b border-lichen">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-semantic-info/10 rounded-full flex items-center justify-center">
                <User size={20} className="text-semantic-info" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate" style={{ fontWeight: 400, color: 'rgb(var(--color-accessible-gray))' }}>{auth.user.name}</p>
                <p className="text-xs truncate" style={{ color: 'rgb(var(--color-archive))' }}>{auth.user.email}</p>
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
                        isActive ? 'bg-semantic-info/10 cursor-default' : ''
                      }`}
                    >
                      <div className="flex flex-col items-start flex-1 min-w-0">
                        <div className="flex items-center gap-2 w-full">
                          <span className={`font-medium truncate ${isActive ? 'text-semantic-info' : 'text-ink'}`}>
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
                      {isActive && <Check size={14} className="text-semantic-info flex-shrink-0 ml-2" />}
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
              onClick={handleLogout}
              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-semantic-error hover:bg-semantic-error/20 transition-colors"
            >
              <LogOut size={16} />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
