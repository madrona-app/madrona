import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { useAccessibleModal, getModalAriaProps } from '../../hooks/useAccessibleModal';
import {
  X, Loader2, AlertCircle, CheckCircle,
  Layers, Film, Workflow, BarChart3,
  RotateCcw
} from 'lucide-react';
import { ModalPortal } from '../ModalPortal';

interface Role {
  role_id: string;
  role_key: string;
  display_name: string;
}

interface AppRoleData {
  role_id: string;
  role_key: string;
  role_display_name: string;
}

interface OrgUser {
  user_id: string;
  email: string;
  name?: string;
  role_id: string;
  role_key: string;
  role_display_name: string;
  app_roles?: Record<string, AppRoleData>;
}

interface AppRolesModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: OrgUser;
  roles: Role[];
  orgId: string;
}

// App configuration
const APPS = [
  { key: 'collections', label: 'Collections', icon: Layers, description: 'Collection management' },
  { key: 'media', label: 'Media', icon: Film, description: 'Digital asset management' },
  { key: 'bridge', label: 'Bridge', icon: Workflow, description: 'Data integration' },
  { key: 'reports', label: 'Reports', icon: BarChart3, description: 'Reporting' },
] as const;

export default function AppRolesModal({
  isOpen,
  onClose,
  user,
  roles,
  orgId,
}: AppRolesModalProps) {
  const { modalRef, titleId, descriptionId } = useAccessibleModal({
    isOpen,
    onClose,
    titlePrefix: 'app-roles',
  });

  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pendingChanges, setPendingChanges] = useState<Record<string, string | null>>({});

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setPendingChanges({});
      setError(null);
      setSuccess(null);
    }
  }, [isOpen]);

  // Mutation to set an app role
  const setAppRoleMutation = useMutation({
    mutationFn: async ({ appKey, roleId }: { appKey: string; roleId: string }) => {
      return apiFetch(`/organizations/${orgId}/users/${user.user_id}/app-roles/${appKey}`, {
        method: 'PUT',
        body: JSON.stringify({ role_id: roleId }),
      });
    },
    onSuccess: (_data, variables) => {
      setSuccess(`Updated role for ${variables.appKey}`);
      queryClient.invalidateQueries({ queryKey: ['organization-users', orgId] });
      // Clear the pending change for this app
      setPendingChanges(prev => {
        const updated = { ...prev };
        delete updated[variables.appKey];
        return updated;
      });
      setTimeout(() => setSuccess(null), 2000);
    },
    onError: (err: ApiError) => {
      setError(err.message || 'Failed to update role');
    },
  });

  // Mutation to remove an app role override
  const removeAppRoleMutation = useMutation({
    mutationFn: async (appKey: string) => {
      return apiFetch(`/organizations/${orgId}/users/${user.user_id}/app-roles/${appKey}`, {
        method: 'DELETE',
      });
    },
    onSuccess: (_data, appKey) => {
      setSuccess(`Removed override for ${appKey} - using default`);
      queryClient.invalidateQueries({ queryKey: ['organization-users', orgId] });
      // Clear the pending change for this app
      setPendingChanges(prev => {
        const updated = { ...prev };
        delete updated[appKey];
        return updated;
      });
      setTimeout(() => setSuccess(null), 2000);
    },
    onError: (err: ApiError) => {
      setError(err.message || 'Failed to remove override');
    },
  });

  const handleRoleChange = (appKey: string, roleId: string) => {
    setError(null);

    if (roleId === '') {
      // User selected "Use default" - mark as null for removal
      setPendingChanges(prev => ({ ...prev, [appKey]: null }));
    } else {
      // User selected a specific role
      setPendingChanges(prev => ({ ...prev, [appKey]: roleId }));
    }
  };

  const handleSaveChanges = async () => {
    setError(null);

    try {
      for (const [appKey, roleId] of Object.entries(pendingChanges)) {
        if (roleId === null) {
          await removeAppRoleMutation.mutateAsync(appKey);
        } else {
          await setAppRoleMutation.mutateAsync({ appKey, roleId });
        }
      }
    } catch {
      // Mutation onError already surfaces the message via setError;
      // swallow here so the click handler doesn't produce an unhandled rejection.
    }
  };

  const getEffectiveRole = (appKey: string): { roleId: string; roleKey: string; displayName: string; isOverride: boolean } => {
    // Check pending changes first
    const pendingRoleId = pendingChanges[appKey];
    if (pendingRoleId !== undefined) {
      if (pendingRoleId === null) {
        // Pending removal - show default
        return {
          roleId: user.role_id,
          roleKey: user.role_key,
          displayName: user.role_display_name,
          isOverride: false,
        };
      }
      const role = roles.find(r => r.role_id === pendingRoleId);
      if (role) {
        return {
          roleId: role.role_id,
          roleKey: role.role_key,
          displayName: role.display_name,
          isOverride: true,
        };
      }
    }

    // Check existing overrides
    const existingOverride = user.app_roles?.[appKey];
    if (existingOverride) {
      return {
        roleId: existingOverride.role_id,
        roleKey: existingOverride.role_key,
        displayName: existingOverride.role_display_name,
        isOverride: true,
      };
    }

    // Default org role
    return {
      roleId: user.role_id,
      roleKey: user.role_key,
      displayName: user.role_display_name,
      isOverride: false,
    };
  };

  const getCurrentSelectValue = (appKey: string): string => {
    // Check pending changes first
    const pendingRoleId = pendingChanges[appKey];
    if (pendingRoleId !== undefined) {
      return pendingRoleId ?? '';
    }

    // Check existing overrides
    const existingOverride = user.app_roles?.[appKey];
    return existingOverride?.role_id ?? '';
  };

  const hasChanges = Object.keys(pendingChanges).length > 0;
  const isLoading = setAppRoleMutation.isPending || removeAppRoleMutation.isPending;

  if (!isOpen) return null;

  return (
    <ModalPortal>
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/50"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={modalRef}
        className="bg-parchment rounded-lg border border-lichen w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        {...getModalAriaProps(titleId, descriptionId)}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-lichen">
          <div className="flex items-center justify-between">
            <h2 id={titleId} className="text-lg font-semibold text-ink">
              App Roles for {user.name || user.email}
            </h2>
            <button
              onClick={onClose}
              className="text-archive hover:text-ink transition-colors"
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          <p id={descriptionId} className="text-sm text-archive">
            Set different roles for each app. Leave blank to use the default organization role.
          </p>

          {/* Default Role Info */}
          <div className="bg-stone/30 rounded-sm p-3 border border-lichen">
            <p className="text-xs font-medium text-archive uppercase tracking-wide mb-1">
              Default Organization Role
            </p>
            <p className="text-sm font-medium text-ink">
              {user.role_display_name}
            </p>
          </div>

          {/* App Role Selectors */}
          <div className="space-y-3">
            {APPS.map((app) => {
              const Icon = app.icon;
              const effectiveRole = getEffectiveRole(app.key);
              const selectValue = getCurrentSelectValue(app.key);
              const hasPendingChange = pendingChanges[app.key] !== undefined;

              return (
                <div
                  key={app.key}
                  className={`flex items-center gap-4 p-3 rounded-sm border ${
                    hasPendingChange ? 'border-bark bg-bark/5' : 'border-lichen'
                  }`}
                >
                  <div className="flex items-center gap-3 flex-shrink-0 w-28">
                    <Icon size={20} className="text-archive" />
                    <span className="font-medium text-ink">{app.label}</span>
                  </div>

                  <div className="flex-grow">
                    <select
                      value={selectValue}
                      onChange={(e) => handleRoleChange(app.key, e.target.value)}
                      disabled={isLoading}
                      className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark disabled:bg-stone/30 disabled:cursor-not-allowed"
                      aria-label={`Role for ${app.label}`}
                    >
                      <option value="">
                        Use default ({user.role_display_name})
                      </option>
                      {roles.map((role) => (
                        <option key={role.role_id} value={role.role_id}>
                          {role.display_name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Indicator */}
                  <div className="w-20 text-right flex-shrink-0">
                    {effectiveRole.isOverride ? (
                      <span className="text-xs text-bark font-medium">Override</span>
                    ) : (
                      <span className="text-xs text-archive">Default</span>
                    )}
                  </div>

                  {/* Reset button for existing overrides */}
                  {user.app_roles?.[app.key] && pendingChanges[app.key] === undefined && (
                    <button
                      onClick={() => handleRoleChange(app.key, '')}
                      disabled={isLoading}
                      className="text-archive hover:text-ink transition-colors flex-shrink-0"
                      aria-label={`Reset ${app.label} to default`}
                      title="Reset to default"
                    >
                      <RotateCcw size={16} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Error Message */}
          {error && (
            <div className="flex items-start gap-2 p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-sm">
              <AlertCircle size={18} className="text-semantic-error flex-shrink-0 mt-0.5" />
              <p className="text-sm text-semantic-error">{error}</p>
            </div>
          )}

          {/* Success Message */}
          {success && (
            <div className="flex items-start gap-2 p-3 bg-semantic-success/10 border border-semantic-success/30 rounded-sm">
              <CheckCircle size={18} className="text-semantic-success flex-shrink-0 mt-0.5" />
              <p className="text-sm text-semantic-success">{success}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-lichen flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2 border border-stone rounded-lg bg-parchment text-ink hover:bg-stone/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSaveChanges}
            disabled={isLoading || !hasChanges}
            className="px-4 py-2 bg-bark text-parchment rounded-sm hover:bg-bark/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isLoading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
