import { useState, useEffect, useCallback } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import {
  Users,
  UserCog,
  AlertTriangle,
  Settings,
  Pencil,
  RotateCcw,
  Check,
  X,
  Shield,
  Plus,
  Lock,
  Copy,
  Trash2,
} from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import RoleEditorSlideOver from '../../components/admin/RoleEditorSlideOver';
import { listCustomRoles, createCustomRole, deleteCustomRole } from '../../lib/api/admin';
import type { CustomRoleDetail } from '../../lib/api/admin';
import { useAuth } from '../../hooks/useAuth';
import { getDefaultLandingPath } from '../../hooks/useActiveProduct';
import { RoleColumn } from '../../components/roles/RoleColumn';
import { UserRoleCardOverlay, type OrgUser } from '../../components/roles/UserRoleCard';
import { FieldAccessMatrix } from '../../components/admin/FieldAccessMatrix';
import { logger } from '../../lib/logger';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import ConfirmDialog from '../../components/ConfirmDialog';

interface Role {
  role_id: string;
  role_key: string;
  display_name: string;
  description?: string | null;
}

interface RoleLabel {
  role_key: string;
  display_name: string;
  default_name: string;
  is_custom: boolean;
  app_key?: string | null;
  is_app_custom?: boolean;
}

interface AppRole {
  role_id: string;
  role_key: string;
  role_display_name: string;
}

interface UserWithAppRoles extends OrgUser {
  app_roles?: Record<string, AppRole>;
}

const APP_TABS = [
  { key: 'bridge', label: 'Bridge', description: 'Data pipelines and connectors' },
  { key: 'collections', label: 'Collections', description: 'Collection management' },
  { key: 'media', label: 'Media', description: 'Digital asset management' },
] as const;

type AppKey = (typeof APP_TABS)[number]['key'];

// Roles available for app-level assignment (excluding admin)
const APP_ROLES = ['registrar', 'curator', 'publisher', 'viewer'];

export default function RoleManagementPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { user, applications } = useAuth();

  // Filter tabs to only show apps the org has access to
  const enabledAppKeys = applications
    .filter((app) => app.enabled && app.status === 'active')
    .map((app) => app.key);

  const availableTabs = APP_TABS.filter((tab) => enabledAppKeys.includes(tab.key));

  const [users, setUsers] = useState<UserWithAppRoles[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [roleLabels, setRoleLabels] = useState<RoleLabel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeUser, setActiveUser] = useState<OrgUser | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [showLabelEditor, setShowLabelEditor] = useState(false);

  // Role testing ("Test Role"): org-level switch. When off the server
  // ignores X-Role-Override entirely, so this is a real control, not a
  // UI preference.
  const [roleTestingEnabled, setRoleTestingEnabled] = useState<boolean | null>(null);
  const [savingRoleTesting, setSavingRoleTesting] = useState(false);
  const [labelAppKey, setLabelAppKey] = useState<string>('');  // '' = org-wide
  const [editingRole, setEditingRole] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<AppKey>(() =>
    (availableTabs[0]?.key as AppKey) || 'bridge'
  );
  const [activeView, setActiveView] = useState<'roles' | 'field-access' | 'custom-roles'>('roles');
  const [selectedFieldAccessRole, setSelectedFieldAccessRole] = useState<string | null>(null);
  const [resetConfirmKey, setResetConfirmKey] = useState<string | null>(null);
  const [customRoles, setCustomRoles] = useState<CustomRoleDetail[]>([]);
  const [showRoleEditor, setShowRoleEditor] = useState(false);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [showCloneDialog, setShowCloneDialog] = useState(false);
  const [cloneSourceId, setCloneSourceId] = useState('');
  const [cloneName, setCloneName] = useState('');
  const [cloneDescription, setCloneDescription] = useState('');
  const [cloneSubmitting, setCloneSubmitting] = useState(false);
  const [deactivateRoleId, setDeactivateRoleId] = useState<string | null>(null);

  // Check for org.manage_members permission
  const hasManageMembers = user?.permissions?.includes('org.manage_members');
  const hasManageRoles = user?.permissions?.includes('org.manage_roles');

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const loadRoleLabels = async (appKey?: string) => {
    try {
      const effectiveAppKey = appKey ?? labelAppKey;
      const query = effectiveAppKey ? `?app_key=${effectiveAppKey}` : '';
      const labelsResponse = await apiFetch<{ role_labels: RoleLabel[] }>(
        `/organizations/${orgId}/role-labels${query}`,
        { expectKeys: ['role_labels'] },
      );
      setRoleLabels(labelsResponse.role_labels || []);
    } catch {
      // Ignore - user may not have permission
    }
  };

  useEffect(() => {
    if (orgId && hasManageMembers) {
      loadData();
    }
  }, [orgId, hasManageMembers]);

  // Reload labels when app context changes
  useEffect(() => {
    if (orgId && hasManageRoles && showLabelEditor) {
      loadRoleLabels(labelAppKey);
    }
  }, [labelAppKey]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [usersResponse, rolesResponse, customRolesResponse] = await Promise.all([
        apiFetch<{ users: UserWithAppRoles[] }>(
          `/organizations/${orgId}/users?status=active&include_app_roles=true`,
          { expectKeys: ['users'] },
        ),
        apiFetch<{ roles: Role[] }>(
          `/organizations/${orgId}/roles`,
          { expectKeys: ['roles'] },
        ),
        listCustomRoles(orgId!).catch(() => ({ roles: [] as CustomRoleDetail[] })),
      ]);

      setUsers(usersResponse.users || []);
      setRoles(rolesResponse.roles || []);
      setCustomRoles(customRolesResponse.roles || []);

      // Load role labels if user has manage_roles permission
      if (hasManageRoles) {
        await loadRoleLabels();
      }
    } catch (err) {
      logger.error('Failed to load data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  // Get org admins (shown at top)
  const orgAdmins = users.filter((u) => u.role_key === 'admin');

  // Get non-admin users
  const nonAdminUsers = users.filter((u) => u.role_key !== 'admin');

  // Get users by their role for the current app
  const getUsersByAppRole = useCallback(
    (roleKey: string): OrgUser[] => {
      return nonAdminUsers.filter((u) => {
        const appRole = u.app_roles?.[activeTab];
        if (appRole) {
          return appRole.role_key === roleKey;
        }
        // If no app-specific role, use their default org role
        return u.role_key === roleKey;
      });
    },
    [nonAdminUsers, activeTab]
  );

  // Get users with no role assigned for this app
  const getUsersWithNoAppRole = useCallback((): OrgUser[] => {
    return nonAdminUsers.filter((u) => {
      const appRole = u.app_roles?.[activeTab];
      // No app role and default role is not an app role
      return !appRole && !APP_ROLES.includes(u.role_key);
    });
  }, [nonAdminUsers, activeTab]);

  // These two must sit above the early returns below: hooks cannot be
  // called conditionally, and `if (loading)` / `if (!hasManageMembers)`
  // would otherwise change the hook count between renders.
  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    apiFetch(`/organizations/${orgId}/settings/role-testing`)
      .then((r: { enabled: boolean }) => { if (!cancelled) setRoleTestingEnabled(r.enabled); })
      .catch(() => { if (!cancelled) setRoleTestingEnabled(null); });
    return () => { cancelled = true; };
  }, [orgId]);

  const toggleRoleTesting = useCallback(async (next: boolean) => {
    if (!orgId) return;
    setSavingRoleTesting(true);
    try {
      const r = await apiFetch(`/organizations/${orgId}/settings/role-testing`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: next }),
      }) as { enabled: boolean };
      setRoleTestingEnabled(r.enabled);
      // /api/me carries role_testing_enabled; refresh so the Test Role
      // affordance appears or disappears without a manual reload.
      window.location.reload();
    } finally {
      setSavingRoleTesting(false);
    }
  }, [orgId]);

  // Redirect if not authorized
  if (!hasManageMembers) {
    return <Navigate to={orgId ? getDefaultLandingPath(orgId, applications) : '/'} replace />;
  }

  // Get app-specific roles (exclude admin)
  const appRoles = roles.filter((r) => APP_ROLES.includes(r.role_key));

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const draggedUser = users.find((u) => u.user_id === active.id);
    if (draggedUser) {
      setActiveUser(draggedUser);
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event;
    setOverId(over?.id as string | null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveUser(null);
    setOverId(null);

    if (!over) return;

    const draggedUserId = active.id as string;
    const draggedUser = users.find((u) => u.user_id === draggedUserId);
    if (!draggedUser) return;

    // Can't change admin roles here
    if (draggedUser.role_key === 'admin') {
      setError('Organization admins have full access to all apps');
      return;
    }

    // Determine target role
    let targetRoleId: string | null = null;
    let targetRoleKey: string | null = null;

    // Check if dropped on a column (role)
    const targetRole = appRoles.find((r) => r.role_id === over.id);
    if (targetRole) {
      targetRoleId = targetRole.role_id;
      targetRoleKey = targetRole.role_key;
    } else {
      // Check if dropped on a user - get their app role
      const targetUser = nonAdminUsers.find((u) => u.user_id === over.id);
      if (targetUser) {
        const targetAppRole = targetUser.app_roles?.[activeTab];
        if (targetAppRole) {
          targetRoleId = targetAppRole.role_id;
          targetRoleKey = targetAppRole.role_key;
        } else {
          // Use their default role if it's an app role
          const defaultRole = roles.find((r) => r.role_key === targetUser.role_key);
          if (defaultRole && APP_ROLES.includes(defaultRole.role_key)) {
            targetRoleId = defaultRole.role_id;
            targetRoleKey = defaultRole.role_key;
          }
        }
      }
    }

    if (!targetRoleId || !targetRoleKey) {
      return;
    }

    // Check if role is actually changing
    const currentAppRole = draggedUser.app_roles?.[activeTab];
    const currentRoleKey = currentAppRole?.role_key || draggedUser.role_key;
    if (currentRoleKey === targetRoleKey) {
      return; // No change needed
    }

    // Optimistic update
    const previousUsers = [...users];
    setUsers((prev) =>
      prev.map((u) => {
        if (u.user_id !== draggedUserId) return u;
        return {
          ...u,
          app_roles: {
            ...u.app_roles,
            [activeTab]: {
              role_id: targetRoleId!,
              role_key: targetRoleKey!,
              role_display_name:
                roles.find((r) => r.role_key === targetRoleKey)?.display_name || targetRoleKey!,
            },
          },
        };
      })
    );
    setError(null);

    try {
      await apiFetch(`/organizations/${orgId}/users/${draggedUserId}/app-roles/${activeTab}`, {
        method: 'PUT',
        body: JSON.stringify({ role_id: targetRoleId }),
      });
    } catch (err) {
      // Rollback on error
      setUsers(previousUsers);
      logger.error('Failed to update app role:', err);
      setError(err instanceof Error ? err.message : 'Failed to update role');
    }
  };

  const handleDragCancel = () => {
    setActiveUser(null);
    setOverId(null);
  };

  const startEditing = (roleKey: string, currentLabel: string) => {
    setEditingRole(roleKey);
    setEditValue(currentLabel);
  };

  const cancelEditing = () => {
    setEditingRole(null);
    setEditValue('');
  };

  const saveLabel = async (roleKey: string) => {
    if (!editValue.trim()) return;

    setSaving(true);
    try {
      await apiFetch(`/organizations/${orgId}/role-labels/${roleKey}`, {
        method: 'PUT',
        body: JSON.stringify({ label: editValue.trim(), app_key: labelAppKey || null }),
      });

      // Update local state
      setRoleLabels((prev) =>
        prev.map((rl) =>
          rl.role_key === roleKey
            ? { ...rl, display_name: editValue.trim(), is_custom: true }
            : rl
        )
      );

      // Also update roles display names
      setRoles((prev) =>
        prev.map((r) =>
          r.role_key === roleKey ? { ...r, display_name: editValue.trim() } : r
        )
      );

      setEditingRole(null);
      setEditValue('');
    } catch (err) {
      logger.error('Failed to save label:', err);
      setError(err instanceof Error ? err.message : 'Failed to save label');
    } finally {
      setSaving(false);
    }
  };

  const resetLabel = async (roleKey: string) => {
    setSaving(true);
    try {
      const query = labelAppKey ? `?app_key=${labelAppKey}` : '';
      const response = await apiFetch<{ display_name: string }>(
        `/organizations/${orgId}/role-labels/${roleKey}${query}`,
        { method: 'DELETE' }
      );

      // Update local state
      setRoleLabels((prev) =>
        prev.map((rl) =>
          rl.role_key === roleKey
            ? { ...rl, display_name: response.display_name, is_custom: false }
            : rl
        )
      );

      // Also update roles display names
      setRoles((prev) =>
        prev.map((r) =>
          r.role_key === roleKey ? { ...r, display_name: response.display_name } : r
        )
      );
    } catch (err) {
      logger.error('Failed to reset label:', err);
      setError(err instanceof Error ? err.message : 'Failed to reset label');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <MadronaLoader />
      </div>
    );
  }

  const unassignedUsers = getUsersWithNoAppRole();


  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <UserCog className="w-8 h-8 text-forest" />
            <h1 className="text-2xl font-semibold text-ink">Role Management</h1>
          </div>
          {hasManageRoles && (
            <button
              onClick={() => setShowLabelEditor(!showLabelEditor)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${
                showLabelEditor
                  ? 'bg-forest text-parchment border-forest'
                  : 'bg-parchment text-forest border-forest/30 hover:bg-forest/5'
              }`}
            >
              <Settings size={18} />
              Customize Labels
            </button>
          )}
        </div>
        <p className="text-sm text-archive mt-1">
          Manage user roles for each application
        </p>
      </div>

      {/* Role testing — org-level switch for the "Test Role" affordance.
          Admin-only: it changes what platform admins can do in this org. */}
      {hasManageRoles && roleTestingEnabled !== null && (
        <div className="mb-6 p-4 bg-parchment-warm border border-lichen rounded-institutional">
          <div className="flex items-start justify-between gap-6">
            <div>
              <h2 id="role-testing-label" className="text-sm font-semibold text-ink">
                Role testing
              </h2>
              <p className="text-sm text-archive mt-1 max-w-2xl">
                Lets platform administrators preview the app as another role
                without signing in as another person. Turn this off to remove
                the &ldquo;Test Role&rdquo; control entirely; permissions are
                then always evaluated from the signed-in account.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={roleTestingEnabled}
              aria-labelledby="role-testing-label"
              disabled={savingRoleTesting}
              onClick={() => toggleRoleTesting(!roleTestingEnabled)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                roleTestingEnabled ? 'bg-azurite' : 'bg-stone'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-parchment transition-transform ${
                  roleTestingEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
      )}

      {/* Organization Admins */}
      {orgAdmins.length > 0 && (
        <div className="mb-6 p-4 bg-semantic-warning/10 border border-semantic-warning/30 rounded-lg">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="w-5 h-5 text-semantic-warning" />
            <h2 className="font-semibold text-semantic-warning">Organization Administrators</h2>
            <span className="text-sm text-semantic-warning">
              (Full access to all apps)
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {orgAdmins.map((admin) => (
              <div
                key={admin.user_id}
                className="flex items-center gap-2 px-3 py-1.5 bg-parchment border border-semantic-warning/30 rounded-full text-sm"
              >
                <div className="w-6 h-6 rounded-full bg-semantic-warning/10 flex items-center justify-center text-semantic-warning text-xs font-medium">
                  {admin.name?.[0]?.toUpperCase() || admin.email[0].toUpperCase()}
                </div>
                <span className="text-ink">{admin.name || admin.email}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Role Label Editor */}
      {showLabelEditor && hasManageRoles && (
        <div className="mb-6 p-4 bg-parchment rounded-lg border border-lichen">
          <h2 className="text-lg font-semibold text-ink mb-3">Customize Role Display Names</h2>
          <p className="text-sm text-archive mb-4">
            Customize how role names appear in your organization. Set labels for all apps
            or override per application. Changes only affect display — permissions remain the same.
          </p>

          {/* App context tabs */}
          <div className="flex gap-1 mb-4 border-b border-lichen pb-2">
            <button
              onClick={() => setLabelAppKey('')}
              className={`px-3 py-1.5 text-sm rounded-t transition-colors ${
                labelAppKey === ''
                  ? 'bg-forest text-parchment font-medium'
                  : 'text-archive hover:text-ink hover:bg-stone/50'
              }`}
            >
              All Apps
            </button>
            {availableTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setLabelAppKey(tab.key)}
                className={`px-3 py-1.5 text-sm rounded-t transition-colors ${
                  labelAppKey === tab.key
                    ? 'bg-forest text-parchment font-medium'
                    : 'text-archive hover:text-ink hover:bg-stone/50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="space-y-2">
            {roleLabels
              .filter((rl) => APP_ROLES.includes(rl.role_key))
              .map((rl) => (
                <div
                  key={rl.role_key}
                  className="flex items-center gap-3 p-3 bg-parchment rounded-lg border border-lichen"
                >
                  <div className="flex-1">
                    {editingRole === rl.role_key ? (
                      <input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveLabel(rl.role_key);
                          if (e.key === 'Escape') cancelEditing();
                        }}
                        className="w-full px-3 py-1.5 border border-forest rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                        autoFocus
                        disabled={saving}
                      />
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-ink">{rl.display_name}</span>
                        {rl.is_app_custom && labelAppKey && (
                          <span className="px-2 py-0.5 text-xs bg-azurite/10 text-azurite rounded">
                            App Override
                          </span>
                        )}
                        {rl.is_custom && !rl.is_app_custom && (
                          <span className="px-2 py-0.5 text-xs bg-forest/10 text-forest rounded">
                            Custom
                          </span>
                        )}
                      </div>
                    )}
                    <div className="text-xs text-archive mt-0.5">
                      Internal: {rl.role_key}
                      {rl.is_custom && ` • Default: ${rl.default_name}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {editingRole === rl.role_key ? (
                      <>
                        <button
                          onClick={() => saveLabel(rl.role_key)}
                          disabled={saving || !editValue.trim()}
                          className="p-2 text-semantic-success hover:bg-semantic-success/10 rounded disabled:opacity-50"
                          title="Save"
                        >
                          <Check size={18} />
                        </button>
                        <button
                          onClick={cancelEditing}
                          disabled={saving}
                          className="p-2 text-archive hover:bg-stone rounded disabled:opacity-50"
                          title="Cancel"
                        >
                          <X size={18} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => startEditing(rl.role_key, rl.display_name)}
                          className="p-2 text-forest hover:bg-forest/10 rounded"
                          title="Edit label"
                        >
                          <Pencil size={18} />
                        </button>
                        {rl.is_custom && (
                          <button
                            onClick={() => setResetConfirmKey(rl.role_key)}
                            disabled={saving}
                            className="p-2 text-semantic-warning hover:bg-semantic-warning/10 rounded disabled:opacity-50"
                            title="Reset to default"
                          >
                            <RotateCcw size={18} />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="mb-4 p-4 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-semantic-error flex items-center gap-2">
          <AlertTriangle size={18} />
          {error}
        </div>
      )}

      {/* View Toggle */}
      {hasManageRoles && (
        <div className="mb-4 flex gap-2">
          <button
            onClick={() => setActiveView('roles')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeView === 'roles'
                ? 'bg-forest text-parchment'
                : 'bg-parchment text-ink border border-lichen hover:bg-stone'
            }`}
          >
            <Users size={16} className="inline mr-2" />
            Role Assignments
          </button>
          <button
            onClick={() => setActiveView('field-access')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeView === 'field-access'
                ? 'bg-forest text-parchment'
                : 'bg-parchment text-ink border border-lichen hover:bg-stone'
            }`}
          >
            <Shield size={16} className="inline mr-2" />
            Field Access
          </button>
          <button
            onClick={() => setActiveView('custom-roles')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeView === 'custom-roles'
                ? 'bg-forest text-parchment'
                : 'bg-parchment text-ink border border-lichen hover:bg-stone'
            }`}
          >
            <Copy size={16} className="inline mr-2" />
            Custom Roles
          </button>
        </div>
      )}

      {/* App Tabs (for role assignments view) */}
      {activeView === 'roles' && (
      <div className="mb-6">
        <div className="border-b border-lichen">
          <nav className="flex gap-1" aria-label="Application tabs">
            {availableTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.key
                    ? 'border-forest text-forest'
                    : 'border-transparent text-archive hover:text-ink hover:border-lichen'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
        <p className="text-sm text-archive mt-2">
          {availableTabs.find((t) => t.key === activeTab)?.description}
        </p>
      </div>
      )}

      {activeView === 'roles' && (
      /* DnD Context */
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {/* Role columns grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {appRoles.map((role, index) => (
            <RoleColumn
              key={role.role_id}
              role={role}
              users={getUsersByAppRole(role.role_key)}
              isOver={overId === role.role_id}
              dataTour={index === 0 ? 'role-column' : undefined}
              currentApp={activeTab}
              enabledApps={enabledAppKeys}
            />
          ))}
        </div>

        {/* Unassigned users */}
        {unassignedUsers.length > 0 && (
          <div className="mt-6 p-4 bg-stone border border-lichen rounded-lg">
            <h3 className="font-medium text-ink mb-3">
              No {availableTabs.find((t) => t.key === activeTab)?.label} Role Assigned
            </h3>
            <p className="text-sm text-archive mb-3">
              These users don't have access to {availableTabs.find((t) => t.key === activeTab)?.label}.
              Drag them to a role column to grant access.
            </p>
            <div className="flex flex-wrap gap-2">
              {unassignedUsers.map((u) => (
                <div
                  key={u.user_id}
                  className="flex items-center gap-2 px-3 py-1.5 bg-parchment border border-lichen rounded-lg text-sm cursor-grab"
                  draggable
                >
                  <div className="w-6 h-6 rounded-full bg-stone flex items-center justify-center text-accessible-gray text-xs font-medium">
                    {u.name?.[0]?.toUpperCase() || u.email[0].toUpperCase()}
                  </div>
                  <span className="text-ink">{u.name || u.email}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {appRoles.length === 0 && (
          <div className="text-center py-12 text-archive">
            <Users className="mx-auto mb-4 text-archive" size={48} />
            <p>No roles found</p>
          </div>
        )}

        {/* Drag overlay */}
        <DragOverlay>
          {activeUser ? <UserRoleCardOverlay user={activeUser} /> : null}
        </DragOverlay>
      </DndContext>
      )}

      {activeView === 'field-access' && (
      /* Field Access View */
      <div>
        {/* Role selector for field access */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-ink mb-2">
            Select a role to configure field access
          </label>
          <div className="flex flex-wrap gap-2">
            {appRoles.map((role) => (
              <button
                key={role.role_id}
                onClick={() => setSelectedFieldAccessRole(role.role_id)}
                className={`px-4 py-2 text-sm rounded-lg border transition-colors ${
                  selectedFieldAccessRole === role.role_id
                    ? 'bg-azurite/10 text-azurite border-azurite'
                    : 'bg-parchment text-ink border-lichen hover:border-bark hover:text-bark'
                }`}
              >
                {role.display_name}
              </button>
            ))}
          </div>
        </div>

        {selectedFieldAccessRole ? (
          <FieldAccessMatrix
            roleId={selectedFieldAccessRole}
            organizationId={orgId!}
          />
        ) : (
          <div className="text-center py-12">
            <Shield className="mx-auto mb-3 text-archive" size={40} />
            <p className="text-archive">Select a role above to configure field-level access.</p>
          </div>
        )}
      </div>
      )}

      {activeView === 'custom-roles' && (
      /* Custom Roles View */
      <div>
        <div className="flex items-center justify-between mb-6">
          <p className="text-sm text-archive">
            Clone system roles to create custom permission sets for your organization.
          </p>
          <button
            onClick={() => {
              setCloneSourceId('');
              setCloneName('');
              setCloneDescription('');
              setShowCloneDialog(true);
            }}
            className="flex items-center gap-2 bg-bark text-parchment hover:bg-copper-dark rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          >
            <Plus size={16} />
            Create Custom Role
          </button>
        </div>

        {/* System Roles */}
        <div className="mb-8">
          <h3 className="text-sm font-semibold text-archive uppercase tracking-wide mb-3">System Roles</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {customRoles.filter((r) => r.is_system).map((role) => (
              <div key={role.role_id} className="bg-parchment rounded-lg border border-lichen p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Lock size={14} className="text-archive" />
                    <h4 className="font-medium text-ink">{role.display_name}</h4>
                  </div>
                  <span className="px-2 py-0.5 text-xs bg-forest/10 text-forest rounded">System</span>
                </div>
                {role.description && (
                  <p className="text-sm text-archive mb-3">{role.description}</p>
                )}
                <div className="flex items-center gap-4 text-sm text-archive mb-3">
                  <span>{role.member_count} member{role.member_count !== 1 ? 's' : ''}</span>
                  <span>{role.permission_count} permission{role.permission_count !== 1 ? 's' : ''}</span>
                </div>
                <button
                  onClick={() => {
                    setEditingRoleId(role.role_id);
                    setShowRoleEditor(true);
                  }}
                  className="text-sm text-bark hover:text-copper-dark transition-colors"
                >
                  View Permissions
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Custom Roles */}
        <div>
          <h3 className="text-sm font-semibold text-archive uppercase tracking-wide mb-3">Custom Roles</h3>
          {customRoles.filter((r) => !r.is_system).length === 0 ? (
            <div className="text-center py-8 bg-parchment rounded-lg border border-dashed border-lichen">
              <Copy className="mx-auto mb-3 text-archive" size={32} />
              <p className="text-archive">No custom roles yet.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {customRoles.filter((r) => !r.is_system).map((role) => (
                <div key={role.role_id} className="bg-parchment rounded-lg border border-lichen p-4">
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="font-medium text-ink">{role.display_name}</h4>
                    <span className="px-2 py-0.5 text-xs bg-azurite/10 text-azurite rounded">Custom</span>
                  </div>
                  {role.description && (
                    <p className="text-sm text-archive mb-2">{role.description}</p>
                  )}
                  {role.cloned_from_name && (
                    <div className="mb-2">
                      <span className="px-2 py-0.5 text-xs bg-stone text-archive rounded">
                        Cloned from {role.cloned_from_name}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-4 text-sm text-archive mb-3">
                    <span>{role.member_count} member{role.member_count !== 1 ? 's' : ''}</span>
                    <span>{role.permission_count} permission{role.permission_count !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => {
                        setEditingRoleId(role.role_id);
                        setShowRoleEditor(true);
                      }}
                      className="text-sm text-bark hover:text-copper-dark transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setDeactivateRoleId(role.role_id)}
                      className="text-sm text-semantic-error hover:bg-semantic-error/10 px-2 py-1 rounded transition-colors"
                    >
                      <Trash2 size={14} className="inline mr-1" />
                      Deactivate
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      )}

      {/* Clone Role Dialog */}
      {showCloneDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40">
          <div className="bg-parchment rounded-lg border border-lichen shadow-lg w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-ink mb-4">Create Custom Role</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Clone from</label>
                <select
                  value={cloneSourceId}
                  onChange={(e) => setCloneSourceId(e.target.value)}
                  className="w-full px-3 py-2 border border-lichen rounded-lg bg-parchment text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                >
                  <option value="">Select a role...</option>
                  {customRoles.map((r) => (
                    <option key={r.role_id} value={r.role_id}>
                      {r.display_name}{r.is_system ? ' (System)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Display name</label>
                <input
                  type="text"
                  value={cloneName}
                  onChange={(e) => setCloneName(e.target.value)}
                  placeholder="e.g. Senior Registrar"
                  className="w-full px-3 py-2 border border-lichen rounded-lg bg-parchment text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Description</label>
                <textarea
                  value={cloneDescription}
                  onChange={(e) => setCloneDescription(e.target.value)}
                  rows={3}
                  placeholder="What makes this role different?"
                  className="w-full px-3 py-2 border border-lichen rounded-lg bg-parchment text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 resize-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowCloneDialog(false)}
                disabled={cloneSubmitting}
                className="px-4 py-2 text-sm text-ink border border-lichen rounded-lg hover:bg-stone transition-colors"
              >
                Cancel
              </button>
              <button
                disabled={!cloneName.trim() || cloneSubmitting}
                onClick={async () => {
                  setCloneSubmitting(true);
                  try {
                    await createCustomRole(orgId!, {
                      display_name: cloneName.trim(),
                      description: cloneDescription.trim() || undefined,
                      clone_from_role_id: cloneSourceId || undefined,
                    });
                    setShowCloneDialog(false);
                    // Refresh custom roles list
                    const refreshed = await listCustomRoles(orgId!);
                    setCustomRoles(refreshed.roles || []);
                  } catch (err) {
                    logger.error('Failed to create custom role:', err);
                    setError(err instanceof Error ? err.message : 'Failed to create role');
                  } finally {
                    setCloneSubmitting(false);
                  }
                }}
                className="flex items-center gap-2 bg-bark text-parchment hover:bg-copper-dark rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
              >
                {cloneSubmitting ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Role Editor Slide-Over */}
      <RoleEditorSlideOver
        isOpen={showRoleEditor}
        onClose={() => {
          setShowRoleEditor(false);
          setEditingRoleId(null);
        }}
        organizationId={orgId!}
        roleId={editingRoleId}
        roleName={customRoles.find((r) => r.role_id === editingRoleId)?.display_name}
        isSystem={customRoles.find((r) => r.role_id === editingRoleId)?.is_system ?? true}
        clonedFromName={customRoles.find((r) => r.role_id === editingRoleId)?.cloned_from_name}
        onSaved={async () => {
          const refreshed = await listCustomRoles(orgId!);
          setCustomRoles(refreshed.roles || []);
        }}
      />

      {/* Deactivate Confirm */}
      <ConfirmDialog
        isOpen={!!deactivateRoleId}
        onClose={() => setDeactivateRoleId(null)}
        onConfirm={async () => {
          if (!deactivateRoleId) return;
          try {
            await deleteCustomRole(orgId!, deactivateRoleId);
            setDeactivateRoleId(null);
            const refreshed = await listCustomRoles(orgId!);
            setCustomRoles(refreshed.roles || []);
          } catch (err) {
            logger.error('Failed to deactivate role:', err);
            setError(err instanceof Error ? err.message : 'Failed to deactivate role');
            setDeactivateRoleId(null);
          }
        }}
        title="Deactivate Role?"
        message="This role will be deactivated. Members currently assigned this role will fall back to their default permissions."
        confirmText="Deactivate"
        confirmStyle="danger"
      />

      <ConfirmDialog
        isOpen={!!resetConfirmKey}
        onClose={() => setResetConfirmKey(null)}
        onConfirm={() => {
          if (resetConfirmKey) resetLabel(resetConfirmKey);
          setResetConfirmKey(null);
        }}
        title="Reset Label?"
        message="This will revert to the default role name."
        confirmText="Reset"
        confirmStyle="primary"
      />
    </div>
  );
}
