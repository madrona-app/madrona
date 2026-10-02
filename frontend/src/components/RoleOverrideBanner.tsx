/**
 * RoleOverrideBanner - Sticky banner for platform admins to test permissions as different roles.
 *
 * Only renders when the user is a platform admin. Shows a role selector dropdown
 * and a prominent banner when an override is active.
 * Supports both system roles and org-scoped custom roles.
 */

import { useState } from 'react';
import { Shield, ChevronDown, X } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { cn } from '../lib/utils';
import { apiFetch } from '../lib/apiClient';

const SYSTEM_ROLES = [
  { key: 'admin', label: 'Administrator' },
  { key: 'registrar', label: 'Registrar' },
  { key: 'curator', label: 'Curator' },
  { key: 'publisher', label: 'Publisher' },
  { key: 'viewer', label: 'Viewer' },
] as const;

interface CustomRoleOption {
  role_id: string;
  display_name: string;
}

interface RoleOverrideBannerProps {
  /** 'banner' renders the top warning bar when override is active.
   *  'button' renders the floating toggle button when no override is active.
   *  Omit for both (legacy). */
  mode?: 'banner' | 'button';
}

export function RoleOverrideBanner({ mode }: RoleOverrideBannerProps = {}) {
  const { isPlatformAdmin, roleOverride, setRoleOverride, user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [customRoles, setCustomRoles] = useState<CustomRoleOption[]>([]);

  // Fetch custom roles lazily — only when dropdown is opened
  const activeOrgId = user?.active_organization_id;
  const [hasFetchedRoles, setHasFetchedRoles] = useState(false);
  const fetchCustomRoles = () => {
    if (hasFetchedRoles || !activeOrgId || !isPlatformAdmin) return;
    if (user?.role_testing_enabled === false) return;
    setHasFetchedRoles(true);
    apiFetch<{ roles: Array<{ role_id: string; display_name: string; is_system: boolean; is_active: boolean }> }>(
      `/organizations/${activeOrgId}/custom-roles`
    ).then(data => {
      setCustomRoles(
        (data.roles || [])
          .filter(r => !r.is_system && r.is_active)
          .map(r => ({ role_id: r.role_id, display_name: r.display_name }))
      );
    }).catch(() => {});
  };

  // Org setting: when role testing is off the server ignores
  // X-Role-Override entirely, so the affordance must go too — otherwise the
  // picker appears to work and silently changes nothing.
  if (!isPlatformAdmin || user?.role_testing_enabled === false) return null;

  // When mode is specified, only render the relevant part
  if (mode === 'banner' && !roleOverride) return null;
  if (mode === 'button' && roleOverride) return null;

  const activeLabel = roleOverride
    ? SYSTEM_ROLES.find(r => r.key === roleOverride)?.label
      ?? customRoles.find(r => r.role_id === roleOverride)?.display_name
      ?? roleOverride
    : null;

  const handleSelect = async (roleKey: string) => {
    setIsOpen(false);
    setIsLoading(true);
    try {
      await setRoleOverride(roleKey);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClear = async () => {
    setIsLoading(true);
    try {
      await setRoleOverride(null);
    } finally {
      setIsLoading(false);
    }
  };

  // Active override banner
  if (roleOverride) {
    return (
      <div className="bg-semantic-warning/15 border-b border-semantic-warning/30 px-4 py-2">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Shield size={16} className="text-semantic-warning shrink-0" />
            <span className="text-sm text-ink">
              Viewing as: <strong>{activeLabel}</strong>
            </span>
            <span className="text-xs text-archive hidden sm:inline">
              — Permissions are restricted to this role. Admin panel access is unaffected.
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Change role dropdown */}
            <div className="relative">
              <button
                onClick={() => { fetchCustomRoles(); setIsOpen(!isOpen); }}
                disabled={isLoading}
                className={cn(
                  'flex items-center gap-1 px-2 py-1 text-xs rounded border transition-colors',
                  'border-semantic-warning/30 text-ink hover:bg-semantic-warning/10',
                  isLoading && 'opacity-50 cursor-not-allowed',
                )}
              >
                Change
                <ChevronDown size={12} className={cn('transition-transform', isOpen && 'rotate-180')} />
              </button>
              {isOpen && (
                <>
                  <div role="presentation" className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 w-56 bg-parchment border border-lichen rounded-lg shadow-lg z-50 py-1">
                    {SYSTEM_ROLES.map(role => (
                      <button
                        key={role.key}
                        onClick={() => handleSelect(role.key)}
                        className={cn(
                          'w-full text-left px-3 py-2 text-sm hover:bg-stone/50 transition-colors',
                          role.key === roleOverride ? 'text-bark font-medium bg-bark/5' : 'text-ink',
                        )}
                      >
                        {role.label}
                      </button>
                    ))}
                    {customRoles.length > 0 && (
                      <>
                        <div className="border-t border-lichen my-1" />
                        <div className="px-3 py-1 text-xs text-archive">Custom Roles</div>
                        {customRoles.map(role => (
                          <button
                            key={role.role_id}
                            onClick={() => handleSelect(role.role_id)}
                            className={cn(
                              'w-full text-left px-3 py-2 text-sm hover:bg-stone/50 transition-colors',
                              role.role_id === roleOverride ? 'text-bark font-medium bg-bark/5' : 'text-ink',
                            )}
                          >
                            {role.display_name}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
            {/* Clear override */}
            <button
              onClick={handleClear}
              disabled={isLoading}
              className={cn(
                'p-1 rounded hover:bg-semantic-warning/20 text-semantic-warning transition-colors',
                isLoading && 'opacity-50 cursor-not-allowed',
              )}
              title="Clear role override"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Inactive state: compact toggle in corner (only for platform admins)
  return (
    <div className="relative">
      <button
        onClick={() => { fetchCustomRoles(); setIsOpen(!isOpen); }}
        className="fixed bottom-4 right-4 z-40 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-forest text-parchment shadow-lg hover:bg-forest/90 transition-colors text-sm"
        title="Test permissions as a different role"
      >
        <Shield size={14} />
        <span className="hidden sm:inline">Test Role</span>
      </button>
      {isOpen && (
        <>
          <div role="presentation" className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="fixed bottom-14 right-4 z-50 w-56 bg-parchment border border-lichen rounded-lg shadow-lg py-1">
            <div className="px-3 py-2 border-b border-lichen">
              <p className="text-xs font-medium text-ink">View as role</p>
              <p className="text-xs text-archive mt-0.5">Test what users with this role can see and do</p>
            </div>
            {SYSTEM_ROLES.map(role => (
              <button
                key={role.key}
                onClick={() => handleSelect(role.key)}
                className="w-full text-left px-3 py-2 text-sm text-ink hover:bg-stone/50 transition-colors"
              >
                {role.label}
              </button>
            ))}
            {customRoles.length > 0 && (
              <>
                <div className="border-t border-lichen my-1" />
                <div className="px-3 py-1 text-xs text-archive">Custom Roles</div>
                {customRoles.map(role => (
                  <button
                    key={role.role_id}
                    onClick={() => handleSelect(role.role_id)}
                    className="w-full text-left px-3 py-2 text-sm text-ink hover:bg-stone/50 transition-colors"
                  >
                    {role.display_name}
                  </button>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
