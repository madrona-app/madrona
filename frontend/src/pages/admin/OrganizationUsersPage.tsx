import { useState, useEffect } from 'react';
import Checkbox from '../../components/Checkbox';
import { useParams, Navigate } from 'react-router-dom';
import { Users, UserPlus, Mail, Shield, Ban, RotateCcw, X, AlertTriangle, Settings2 } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import { useAuth } from '../../hooks/useAuth';
import { getDefaultLandingPath } from '../../hooks/useActiveProduct';
import AppRolesModal from '../../components/admin/AppRolesModal';
import { logger } from '../../lib/logger';
import { useToast } from '../../contexts/ToastContext';
import { formatDateShort } from '@/lib/formatters';

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

interface UserDepartment {
  department_id: string;
  department_name: string;
  department_code: string;
  department_color: string | null;
  role: string;
  is_primary: boolean;
}

interface OrgUser {
  user_id: string;
  email: string;
  name?: string;
  role_id: string;
  role_key: string;
  role_display_name: string;
  status: 'active' | 'deactivated';
  user_status: 'active' | 'invited' | 'suspended';
  created_at: string;
  app_roles?: Record<string, AppRoleData>;
  department_memberships?: UserDepartment[];
}

interface InviteUserForm {
  email: string;
  name?: string;
  role_id: string;
  is_admin: boolean;
  app_roles: Record<string, string>; // app_key -> role_id
}

const APP_KEYS = ['bridge', 'collections', 'media', 'reports'] as const;

export default function OrganizationUsersPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { user, applications } = useAuth();
  const { showToast } = useToast();

  // Filter apps to only show enabled ones for this org
  const enabledAppKeys = applications
    .filter((app) => app.enabled && app.status === 'active')
    .map((app) => app.key)
    .filter((key): key is (typeof APP_KEYS)[number] => (APP_KEYS as readonly string[]).includes(key));

  const [users, setUsers] = useState<OrgUser[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modals
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [showDeactivateModal, setShowDeactivateModal] = useState(false);
  const [showReactivateModal, setShowReactivateModal] = useState(false);
  const [showAppRolesModal, setShowAppRolesModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<OrgUser | null>(null);

  // Forms
  const [inviteForm, setInviteForm] = useState<InviteUserForm>({
    email: '',
    role_id: '',
    is_admin: false,
    app_roles: {},
  });
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Filter
  const [statusFilter, setStatusFilter] = useState<'active' | 'deactivated' | 'all'>('active');

  // Check for RBAC permissions — platform admins get full access
  const isPlatformAdmin = user?.permissions?.includes('platform.admin');
  const hasManageMembers = isPlatformAdmin || user?.permissions?.includes('org.manage_members');
  const canInviteUsers = isPlatformAdmin || user?.permissions?.includes('org.users.create');
  const canUpdateUsers = isPlatformAdmin || user?.permissions?.includes('org.users.update');
  const canDeactivateUsers = isPlatformAdmin || user?.permissions?.includes('org.users.deactivate');
  const canManageRoles = isPlatformAdmin || user?.permissions?.includes('org.manage_roles');

  // Can perform any user management action (used for showing Actions column)
  const canManageUsers = canInviteUsers || canUpdateUsers || canDeactivateUsers || canManageRoles;

  useEffect(() => {
    if (orgId && hasManageMembers) {
      loadUsers();
      loadRoles();
    }
  }, [orgId, statusFilter, hasManageMembers]);

  // Redirect if not authorized (after all hooks)
  if (!hasManageMembers) {
    return <Navigate to={orgId ? getDefaultLandingPath(orgId, applications) : '/'} replace />;
  }

  const loadUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      // Include app_roles in the query
      const params = new URLSearchParams();
      if (statusFilter !== 'all') {
        params.set('status', statusFilter);
      }
      params.set('include_app_roles', 'true');
      params.set('include_departments', 'true');
      const query = params.toString() ? `?${params.toString()}` : '';
      const response = await apiFetch<{ users: OrgUser[] }>(`/organizations/${orgId}/users${query}`, { expectKeys: ['users'] });
      setUsers(response.users || []);
    } catch (err) {
      logger.error('Failed to load users:', err);
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const loadRoles = async () => {
    try {
      // Fetch available roles for this organization
      const response = await apiFetch<{ roles: Role[] }>(`/organizations/${orgId}/roles`, { expectKeys: ['roles'] });
      setRoles(response.roles || []);
    } catch (err) {
      logger.error('Failed to load roles:', err);
      // Set default roles if API fails
      setRoles([
        { role_id: '', role_key: 'org_member', display_name: 'Member' },
        { role_id: '', role_key: 'admin', display_name: 'Admin' }
      ]);
    }
  };

  const handleInviteUser = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate: either admin or at least one app role
    if (!inviteForm.email) return;
    if (!inviteForm.is_admin && Object.keys(inviteForm.app_roles).length === 0) {
      showToast({ type: 'warning', title: 'Please select at least one app role or make the user an Organization Admin' });
      return;
    }

    try {
      setSubmitting(true);

      // Find admin role_id if needed
      const orgAdminRole = roles.find((r) => r.role_key === 'admin');
      const viewerRole = roles.find((r) => r.role_key === 'viewer');

      // Create user with org membership
      const response = await apiFetch<{ user: { user_id: string } }>(`/organizations/${orgId}/users`, {
        method: 'POST',
        body: JSON.stringify({
          email: inviteForm.email,
          name: inviteForm.name,
          // If admin, use admin role; otherwise use viewer as base org role
          role_id: inviteForm.is_admin ? orgAdminRole?.role_id : viewerRole?.role_id,
        }),
      });

      // If not admin, set app-specific roles
      if (!inviteForm.is_admin && response.user?.user_id) {
        const userId = response.user.user_id;
        await Promise.all(
          Object.entries(inviteForm.app_roles).map(([appKey, roleId]) =>
            apiFetch(`/organizations/${orgId}/users/${userId}/app-roles/${appKey}`, {
              method: 'PUT',
              body: JSON.stringify({ role_id: roleId }),
            })
          )
        );
      }

      setShowInviteModal(false);
      setInviteForm({ email: '', role_id: '', is_admin: false, app_roles: {} });
      loadUsers();
    } catch (err) {
      logger.error('Failed to invite user:', err);
      showToast({ type: 'error', title: 'Failed to invite user', message: err instanceof Error ? err.message : undefined });
    } finally {
      setSubmitting(false);
    }
  };

  const handleChangeRole = async () => {
    if (!selectedUser || !selectedRoleId) return;

    try {
      setSubmitting(true);
      await apiFetch(`/organizations/${orgId}/users/${selectedUser.user_id}`, {
        method: 'PATCH',
        body: JSON.stringify({ role_id: selectedRoleId }),
      });
      
      setShowRoleModal(false);
      setSelectedUser(null);
      setSelectedRoleId('');
      loadUsers();
    } catch (err) {
      logger.error('Failed to change role:', err);
      showToast({ type: 'error', title: 'Failed to change role', message: err instanceof Error ? err.message : undefined });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeactivate = async () => {
    if (!selectedUser) return;

    try {
      setSubmitting(true);
      await apiFetch(`/organizations/${orgId}/users/${selectedUser.user_id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'deactivate' }),
      });
      
      setShowDeactivateModal(false);
      setSelectedUser(null);
      loadUsers();
    } catch (err) {
      logger.error('Failed to deactivate user:', err);
      showToast({ type: 'error', title: 'Failed to deactivate user', message: err instanceof Error ? err.message : undefined });
    } finally {
      setSubmitting(false);
    }
  };

  const handleReactivate = async () => {
    if (!selectedUser) return;

    try {
      setSubmitting(true);
      await apiFetch(`/organizations/${orgId}/users/${selectedUser.user_id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'reactivate' }),
      });
      
      setShowReactivateModal(false);
      setSelectedUser(null);
      loadUsers();
    } catch (err) {
      logger.error('Failed to reactivate user:', err);
      showToast({ type: 'error', title: 'Failed to reactivate user', message: err instanceof Error ? err.message : undefined });
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (membershipStatus: string, userStatus: string) => {
    if (membershipStatus === 'deactivated') {
      return <span className="px-2 py-1 text-xs font-medium rounded bg-stone text-ink">Deactivated</span>;
    }
    if (userStatus === 'invited') {
      return <span className="px-2 py-1 text-xs font-medium rounded bg-semantic-warning/10 text-semantic-warning">Invited</span>;
    }
    return <span className="px-2 py-1 text-xs font-medium rounded bg-semantic-success/10 text-semantic-success">Active</span>;
  };

  if (loading && users.length === 0) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-archive">Loading users...</div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex justify-between items-center">
        <div>
          <div className="flex items-center gap-3">
            <Users className="w-8 h-8 text-forest" />
            <h1 className="text-2xl font-semibold text-ink">Users</h1>
          </div>
          <p className="text-sm text-archive mt-1">Manage members of your organization</p>
        </div>
        {canInviteUsers && (
          <button
            onClick={() => setShowInviteModal(true)}
            className="btn-primary flex items-center space-x-2"
          >
            <UserPlus size={18} />
            <span>Invite User</span>
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 p-4 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-semantic-error">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="mb-4 flex items-center space-x-4">
        <div className="flex items-center space-x-2">
          <label htmlFor="user-status-filter" className="text-sm font-medium text-ink">Status:</label>
          <select
            id="user-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'active' | 'deactivated' | 'all')}
            className="px-3 py-1.5 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            aria-label="Filter by status"
          >
            <option value="active">Active</option>
            <option value="deactivated">Deactivated</option>
            <option value="all">All</option>
          </select>
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-parchment rounded-lg border border-lichen overflow-hidden">
        <table className="min-w-full divide-y divide-lichen">
          <thead className="bg-stone">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-archive uppercase tracking-wider">
                User
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-archive uppercase tracking-wider">
                Role
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-archive uppercase tracking-wider">
                App Roles
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-archive uppercase tracking-wider">
                Departments
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-archive uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-archive uppercase tracking-wider">
                Joined
              </th>
              {canManageUsers && (
                <th className="px-6 py-3 text-right text-xs font-medium text-archive uppercase tracking-wider">
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody className="bg-parchment divide-y divide-lichen">
            {users.length === 0 ? (
              <tr>
                <td colSpan={canManageUsers ? 7 : 6} className="px-6 py-8 text-center text-archive">
                  <Users className="mx-auto mb-2 text-archive" size={48} />
                  <p>No users found</p>
                </td>
              </tr>
            ) : (
              users.map((user, _index) => (
                <tr key={user.user_id} className="hover:bg-stone">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 h-10 w-10 rounded-full bg-primary-100 flex items-center justify-center">
                        <span className="text-primary-700 font-medium">
                          {user.name ? user.name[0].toUpperCase() : user.email[0].toUpperCase()}
                        </span>
                      </div>
                      <div className="ml-4">
                        <div className="text-sm font-medium text-ink">{user.name || 'No name'}</div>
                        <div className="text-sm text-archive">{user.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <Shield size={16} className="text-archive mr-2" />
                      <span className="text-sm text-ink">{user.role_display_name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1 items-center">
                      {user.app_roles && Object.keys(user.app_roles).length > 0 ? (
                        <>
                          {Object.entries(user.app_roles).map(([appKey, appRole]) => (
                            <span
                              key={appKey}
                              className="px-2 py-0.5 text-xs rounded bg-forest/10 text-forest"
                              title={`${appKey}: ${appRole.role_display_name}`}
                            >
                              {appKey.charAt(0).toUpperCase() + appKey.slice(1)}: {appRole.role_display_name}
                            </span>
                          ))}
                          {canManageRoles && (
                            <button
                              onClick={() => {
                                setSelectedUser(user);
                                setShowAppRolesModal(true);
                              }}
                              className="ml-1 text-archive hover:text-forest transition-colors"
                              title="Edit app roles"
                              aria-label="Edit app roles"
                            >
                              <Settings2 size={14} />
                            </button>
                          )}
                        </>
                      ) : (
                        <span className="text-xs text-archive flex items-center gap-1">
                          Using default
                          {canManageRoles && (
                            <button
                              onClick={() => {
                                setSelectedUser(user);
                                setShowAppRolesModal(true);
                              }}
                              className="ml-1 text-archive hover:text-forest transition-colors"
                              title="Configure app roles"
                              aria-label="Configure app roles"
                            >
                              <Settings2 size={14} />
                            </button>
                          )}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1">
                      {user.department_memberships && user.department_memberships.length > 0 ? (
                        user.department_memberships.map((dept) => (
                          <span
                            key={dept.department_id}
                            className="px-2 py-0.5 text-xs rounded bg-forest/10 text-forest flex items-center gap-1"
                            title={`${dept.department_name} (${dept.department_code}) — ${dept.role}${dept.is_primary ? ' (Primary)' : ''}`}
                          >
                            {dept.department_color && (
                              <span
                                className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                                style={{ backgroundColor: dept.department_color }}
                              />
                            )}
                            {dept.department_name}
                            {dept.is_primary && (
                              <span className="text-bark font-medium">*</span>
                            )}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-archive">None</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {getStatusBadge(user.status, user.user_status)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-archive">
                    {formatDateShort(user.created_at)}
                  </td>
                  {canManageUsers && (
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex justify-end space-x-2">
                        {user.status === 'active' && (
                          <>
                            <button
                              onClick={() => {
                                setSelectedUser(user);
                                setSelectedRoleId(user.role_id);
                                setShowRoleModal(true);
                              }}
                              className="text-primary hover:text-primary-dark"
                              title="Change role"
                              aria-label="Change role"
                            >
                              <Shield size={18} />
                            </button>
                            <button
                              onClick={() => {
                                setSelectedUser(user);
                                setShowDeactivateModal(true);
                              }}
                              className="text-semantic-error hover:text-semantic-error"
                              title="Deactivate user"
                              aria-label="Deactivate user"
                            >
                              <Ban size={18} />
                            </button>
                          </>
                        )}
                        {user.status === 'deactivated' && (
                          <button
                            onClick={() => {
                              setSelectedUser(user);
                              setShowReactivateModal(true);
                            }}
                            className="text-semantic-success hover:text-semantic-success"
                            title="Reactivate user"
                            aria-label="Reactivate user"
                          >
                            <RotateCcw size={18} />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Invite User Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-ink/50 flex items-center justify-center z-50">
          <div className="bg-parchment rounded-lg border border-lichen p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-serif font-bold text-ink">Invite User</h2>
              <button onClick={() => setShowInviteModal(false)} className="text-archive hover:text-archive" aria-label="Close invite modal">
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleInviteUser}>
              <div className="space-y-4">
                <div>
                  <label htmlFor="invite-user-email" className="block text-sm font-medium text-ink mb-1">
                    Email Address *
                  </label>
                  <input
                    id="invite-user-email"
                    type="email"
                    required
                    value={inviteForm.email}
                    onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                    className="w-full px-3 py-2 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                    placeholder="user@example.com"
                    aria-label="Email Address"
                  />
                </div>
                <div>
                  <label htmlFor="invite-user-name" className="block text-sm font-medium text-ink mb-1">
                    Name (Optional)
                  </label>
                  <input
                    id="invite-user-name"
                    type="text"
                    value={inviteForm.name || ''}
                    onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })}
                    className="w-full px-3 py-2 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                    placeholder="Jane Doe"
                    aria-label="Name"
                  />
                </div>

                {/* Organization Admin Toggle */}
                <div className="border border-semantic-warning/30 bg-semantic-warning/10 rounded-lg p-4">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <Checkbox
                      checked={inviteForm.is_admin}
                      onChange={(e) =>
                        setInviteForm({
                          ...inviteForm,
                          is_admin: e.target.checked,
                          app_roles: e.target.checked ? {} : inviteForm.app_roles,
                        })
                      }
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <Shield size={18} className="text-semantic-warning" />
                        <span className="font-medium text-semantic-warning">Organization Administrator</span>
                      </div>
                      <p className="text-xs text-semantic-warning mt-0.5">
                        Full access to all apps and organization settings
                      </p>
                    </div>
                  </label>
                </div>

                {/* App-specific Roles */}
                {!inviteForm.is_admin && (
                  <div>
                    <label className="block text-sm font-medium text-ink mb-2">
                      App Access & Roles
                    </label>
                    <p className="text-xs text-archive mb-3">
                      Select which apps this user can access and their role in each
                    </p>
                    <div className="space-y-2">
                      {enabledAppKeys.map((appKey) => {
                        const appRoles = roles.filter(
                          (r) => r.role_key !== 'admin'
                        );
                        const currentRoleId = inviteForm.app_roles[appKey] || '';

                        return (
                          <div
                            key={appKey}
                            className="flex items-center gap-3 p-3 border border-lichen rounded-lg"
                          >
                            <div className="flex-1">
                              <span className="font-medium text-ink capitalize">
                                {appKey}
                              </span>
                            </div>
                            <select
                              value={currentRoleId}
                              onChange={(e) => {
                                const newAppRoles = { ...inviteForm.app_roles };
                                if (e.target.value) {
                                  newAppRoles[appKey] = e.target.value;
                                } else {
                                  delete newAppRoles[appKey];
                                }
                                setInviteForm({ ...inviteForm, app_roles: newAppRoles });
                              }}
                              className="px-3 py-1.5 border border-lichen rounded-md text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                            >
                              <option value="">No access</option>
                              {appRoles.map((role) => (
                                <option key={role.role_id} value={role.role_id}>
                                  {role.display_name}
                                </option>
                              ))}
                            </select>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="bg-semantic-info/10 border border-semantic-info/30 rounded-lg p-3 text-sm text-semantic-info">
                  <Mail size={16} className="inline mr-2" />
                  An invitation email will be sent to this address.
                </div>
              </div>
              <div className="mt-6 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="px-4 py-2 border border-lichen rounded-md text-ink hover:bg-stone"
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={submitting}
                >
                  {submitting ? 'Sending...' : 'Send Invitation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Change Role Modal */}
      {showRoleModal && selectedUser && (
        <div className="fixed inset-0 bg-ink/50 flex items-center justify-center z-50">
          <div className="bg-parchment rounded-lg border border-lichen p-6 max-w-md w-full mx-4">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-serif font-bold text-ink">Change Role</h2>
              <button onClick={() => setShowRoleModal(false)} className="text-archive hover:text-archive" aria-label="Close role modal">
                <X size={24} />
              </button>
            </div>
            <div className="mb-4">
              <p className="text-sm text-archive">
                Change role for <strong>{selectedUser.email}</strong>
              </p>
            </div>
            <div className="mb-6">
              <label htmlFor="change-user-role" className="block text-sm font-medium text-ink mb-2">
                New Role
              </label>
              <select
                id="change-user-role"
                value={selectedRoleId}
                onChange={(e) => setSelectedRoleId(e.target.value)}
                className="w-full px-3 py-2 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                aria-label="New Role"
              >
                {roles.map((role) => (
                  <option key={role.role_id} value={role.role_id}>
                    {role.display_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowRoleModal(false)}
                className="px-4 py-2 border border-lichen rounded-md text-ink hover:bg-stone"
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                onClick={handleChangeRole}
                className="btn-primary"
                disabled={submitting}
              >
                {submitting ? 'Updating...' : 'Update Role'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deactivate Modal */}
      {showDeactivateModal && selectedUser && (
        <div className="fixed inset-0 bg-ink/50 flex items-center justify-center z-50">
          <div className="bg-parchment rounded-lg border border-lichen p-6 max-w-md w-full mx-4">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-serif font-bold text-semantic-error">Deactivate User</h2>
              <button onClick={() => setShowDeactivateModal(false)} className="text-archive hover:text-archive" aria-label="Close deactivate modal">
                <X size={24} />
              </button>
            </div>
            <div className="mb-6">
              <p className="text-sm text-archive mb-3">
                Are you sure you want to deactivate <strong>{selectedUser.email}</strong>?
              </p>
              <div className="bg-semantic-warning/10 border border-semantic-warning/30 rounded-lg p-3 text-sm text-semantic-warning">
                <AlertTriangle size={16} className="inline mr-2" />
                This user will immediately lose access to this organization.
                Their membership can be reactivated later.
              </div>
            </div>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowDeactivateModal(false)}
                className="px-4 py-2 border border-lichen rounded-md text-ink hover:bg-stone"
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                onClick={handleDeactivate}
                className="px-4 py-2 bg-semantic-error text-parchment rounded-md hover:bg-semantic-error/80"
                disabled={submitting}
              >
                {submitting ? 'Deactivating...' : 'Deactivate User'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reactivate Modal */}
      {showReactivateModal && selectedUser && (
        <div className="fixed inset-0 bg-ink/50 flex items-center justify-center z-50">
          <div className="bg-parchment rounded-lg border border-lichen p-6 max-w-md w-full mx-4">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-serif font-bold text-semantic-success">Reactivate User</h2>
              <button onClick={() => setShowReactivateModal(false)} className="text-archive hover:text-archive" aria-label="Close reactivate modal">
                <X size={24} />
              </button>
            </div>
            <div className="mb-6">
              <p className="text-sm text-archive mb-3">
                Reactivate <strong>{selectedUser.email}</strong>?
              </p>
              <div className="bg-semantic-success/10 border border-semantic-success/30 rounded-lg p-3 text-sm text-semantic-success">
                This user will regain access to this organization.
              </div>
            </div>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowReactivateModal(false)}
                className="px-4 py-2 border border-lichen rounded-md text-ink hover:bg-stone"
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                onClick={handleReactivate}
                className="px-4 py-2 bg-semantic-success text-parchment rounded-md hover:bg-semantic-success"
                disabled={submitting}
              >
                {submitting ? 'Reactivating...' : 'Reactivate User'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* App Roles Modal */}
      {selectedUser && orgId && (
        <AppRolesModal
          isOpen={showAppRolesModal}
          onClose={() => {
            setShowAppRolesModal(false);
            setSelectedUser(null);
            loadUsers(); // Refresh to get updated app roles
          }}
          user={selectedUser}
          roles={roles}
          orgId={orgId}
        />
      )}
    </div>
  );
}
