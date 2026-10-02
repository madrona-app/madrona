import { useState, useEffect, useCallback } from 'react';
import Checkbox from '../../components/Checkbox';
import { useParams, Navigate } from 'react-router-dom';
import {
  Building2,
  Plus,
  Pencil,
  Users,
  Ban,
  RotateCcw,
  X,
  AlertTriangle,
  Loader2,
  UserPlus,
  Trash2,
  Star,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useAccessibleModal, getModalAriaProps } from '../../hooks/useAccessibleModal';
import { getDefaultLandingPath } from '../../hooks/useActiveProduct';
import { apiFetch } from '../../lib/apiClient';
import { useToast } from '../../contexts/ToastContext';
import {
  getDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  getDepartmentMembers,
  addDepartmentMember,
  updateDepartmentMember,
  removeDepartmentMember,
} from '../../lib/api/departments';
import type { Department } from '../../lib/schemas';
import type { DepartmentMember } from '../../lib/api/departments';
import { logger } from '../../lib/logger';

// ============================================================================
// Types
// ============================================================================

interface OrgUser {
  user_id: string;
  email: string;
  name?: string;
}

interface DepartmentForm {
  name: string;
  code: string;
  description: string;
  color: string;
  parent_id: string;
  sort_order: number;
}

const EMPTY_FORM: DepartmentForm = {
  name: '',
  code: '',
  description: '',
  color: '',
  parent_id: '',
  sort_order: 0,
};

const DEPARTMENT_ROLES = ['admin', 'curator', 'editor', 'viewer'] as const;

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  curator: 'Curator',
  editor: 'Editor',
  viewer: 'Viewer',
};

const COLOR_PRESETS = [
  'rgb(var(--color-bark))', 'rgb(var(--color-copper))', 'rgb(var(--color-semantic-success))', 'rgb(var(--color-semantic-info))',
  '#6B4A6B', 'rgb(var(--color-forest))', 'rgb(var(--color-semantic-warning))', '#3B5E8E',
];

// ============================================================================
// Sub-components
// ============================================================================

function DepartmentFormModal({
  isOpen,
  onClose,
  onSubmit,
  initialData,
  departments,
  submitting,
  isEdit,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: DepartmentForm) => void;
  initialData: DepartmentForm;
  departments: Department[];
  submitting: boolean;
  isEdit: boolean;
}) {
  const { modalRef, titleId } = useAccessibleModal({
    isOpen,
    onClose,
    titlePrefix: isEdit ? 'edit-department' : 'create-department',
  });
  const [form, setForm] = useState<DepartmentForm>(initialData);

  useEffect(() => {
    if (isOpen) setForm(initialData);
  }, [isOpen, initialData]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-ink/50 flex items-center justify-center z-50" onClick={onClose} role="presentation">
      <div
        ref={modalRef}
        className="bg-parchment rounded-lg p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        {...getModalAriaProps(titleId)}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 id={titleId} className="text-xl font-serif font-bold text-ink">
            {isEdit ? 'Edit Department' : 'Create Department'}
          </h2>
          <button onClick={onClose} className="text-archive hover:text-ink" aria-label="Close">
            <X size={24} />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(form);
          }}
        >
          <div className="space-y-4">
            <div>
              <label htmlFor="dept-name" className="block text-sm font-medium text-ink mb-1">
                Name *
              </label>
              <input
                id="dept-name"
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                placeholder="e.g. European Paintings"
              />
            </div>
            <div>
              <label htmlFor="dept-code" className="block text-sm font-medium text-ink mb-1">
                Code *
              </label>
              <input
                id="dept-code"
                type="text"
                required
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                className="w-full px-3 py-2 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                placeholder="e.g. EUR-PAINT"
              />
            </div>
            <div>
              <label htmlFor="dept-desc" className="block text-sm font-medium text-ink mb-1">
                Description
              </label>
              <textarea
                id="dept-desc"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full px-3 py-2 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                rows={3}
                placeholder="Optional description"
              />
            </div>
            <div>
              <label htmlFor="dept-parent" className="block text-sm font-medium text-ink mb-1">
                Parent Department
              </label>
              <select
                id="dept-parent"
                value={form.parent_id}
                onChange={(e) => setForm({ ...form, parent_id: e.target.value })}
                className="w-full px-3 py-2 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              >
                <option value="">None (top-level)</option>
                {departments.map((d) => (
                  <option key={d.department_id} value={d.department_id}>
                    {'  '.repeat(d.depth)}{d.name} ({d.code})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Color</label>
              <div className="flex items-center gap-2 flex-wrap">
                {COLOR_PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setForm({ ...form, color: c })}
                    className={`w-7 h-7 rounded-full border-2 transition-all ${
                      form.color === c ? 'border-ink scale-110' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: c }}
                    aria-label={`Color ${c}`}
                  />
                ))}
                <button
                  type="button"
                  onClick={() => setForm({ ...form, color: '' })}
                  className={`w-7 h-7 rounded-full border-2 transition-all flex items-center justify-center ${
                    !form.color ? 'border-ink' : 'border-lichen'
                  }`}
                  aria-label="No color"
                >
                  <X size={12} className="text-archive" />
                </button>
              </div>
            </div>
            <div>
              <label htmlFor="dept-sort" className="block text-sm font-medium text-ink mb-1">
                Sort Order
              </label>
              <input
                id="dept-sort"
                type="number"
                value={form.sort_order}
                onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })}
                className="w-24 px-3 py-2 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              />
            </div>
          </div>
          <div className="mt-6 flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-lichen rounded-md text-ink hover:bg-stone"
              disabled={submitting}
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Department'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MembersPanel({
  isOpen,
  onClose,
  department,
  orgId,
}: {
  isOpen: boolean;
  onClose: () => void;
  department: Department | null;
  orgId: string;
}) {
  const { modalRef, titleId } = useAccessibleModal({
    isOpen,
    onClose,
    titlePrefix: 'dept-members',
  });

  const { user } = useAuth();
  const canManageMembers = user?.permissions?.includes('platform.admin') || user?.permissions?.includes('departments.manage_members');

  const [members, setMembers] = useState<DepartmentMember[]>([]);
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add member form
  const [addUserId, setAddUserId] = useState('');
  const [addRole, setAddRole] = useState<string>('viewer');
  const [addIsPrimary, setAddIsPrimary] = useState(false);

  const loadMembers = useCallback(async () => {
    if (!department) return;
    if (!canManageMembers) {
      setMembers([]);
      return;
    }
    try {
      setLoading(true);
      const data = await getDepartmentMembers(orgId, department.department_id);
      setMembers(data);
    } catch (err) {
      logger.error('Failed to load members:', err);
      setError('Failed to load members');
    } finally {
      setLoading(false);
    }
  }, [orgId, department, canManageMembers]);

  const loadOrgUsers = useCallback(async () => {
    try {
      const response = await apiFetch<{ users: OrgUser[] }>(`/organizations/${orgId}/users`, {
        expectKeys: ['users'],
      });
      setOrgUsers(response.users || []);
    } catch (err) {
      logger.error('Failed to load org users:', err);
    }
  }, [orgId]);

  useEffect(() => {
    if (isOpen && department) {
      loadMembers();
      loadOrgUsers();
      setAddUserId('');
      setAddRole('viewer');
      setAddIsPrimary(false);
      setError(null);
    }
  }, [isOpen, department, loadMembers, loadOrgUsers]);

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!department || !addUserId) return;
    try {
      setSubmitting(true);
      setError(null);
      await addDepartmentMember(orgId, department.department_id, {
        user_id: addUserId,
        role: addRole,
        is_primary: addIsPrimary,
      });
      setAddUserId('');
      setAddRole('viewer');
      setAddIsPrimary(false);
      await loadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add member');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRoleChange = async (member: DepartmentMember, newRole: string) => {
    if (!department) return;
    try {
      setError(null);
      await updateDepartmentMember(orgId, department.department_id, member.membership_id, {
        role: newRole,
      });
      await loadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update role');
    }
  };

  const handleSetPrimary = async (member: DepartmentMember) => {
    if (!department) return;
    try {
      setError(null);
      await updateDepartmentMember(orgId, department.department_id, member.membership_id, {
        is_primary: true,
      });
      await loadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set primary');
    }
  };

  const handleRemoveMember = async (member: DepartmentMember) => {
    if (!department) return;
    try {
      setError(null);
      await removeDepartmentMember(orgId, department.department_id, member.membership_id);
      await loadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove member');
    }
  };

  const memberUserIds = new Set(members.map((m) => m.user_id));
  const availableUsers = orgUsers.filter((u) => !memberUserIds.has(u.user_id));

  const getUserDisplay = (userId: string) => {
    const user = orgUsers.find((u) => u.user_id === userId);
    return user ? user.name || user.email : userId;
  };

  if (!isOpen || !department) return null;

  return (
    <div className="fixed inset-0 bg-ink/50 flex items-center justify-center z-50" onClick={onClose} role="presentation">
      <div
        ref={modalRef}
        className="bg-parchment rounded-lg w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        {...getModalAriaProps(titleId)}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-lichen">
          <div className="flex items-center justify-between">
            <div>
              <h2 id={titleId} className="text-lg font-semibold text-ink flex items-center gap-2">
                <Users size={20} className="text-forest" />
                Members of {department.name}
              </h2>
              <p className="text-sm text-archive mt-0.5">{department.code}</p>
            </div>
            <button onClick={onClose} className="text-archive hover:text-ink" aria-label="Close">
              <X size={24} />
            </button>
          </div>
        </div>

        {/* Add Member Form */}
        <div className="px-6 py-4 border-b border-lichen bg-stone/20">
          <form onSubmit={handleAddMember} className="flex items-end gap-3">
            <div className="flex-1">
              <label htmlFor="add-member-user" className="block text-xs font-medium text-archive mb-1">
                User
              </label>
              <select
                id="add-member-user"
                value={addUserId}
                onChange={(e) => setAddUserId(e.target.value)}
                className="w-full px-3 py-2 border border-lichen rounded-md text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              >
                <option value="">Select a user...</option>
                {availableUsers.map((u) => (
                  <option key={u.user_id} value={u.user_id}>
                    {u.name || u.email}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-32">
              <label htmlFor="add-member-role" className="block text-xs font-medium text-archive mb-1">
                Role
              </label>
              <select
                id="add-member-role"
                value={addRole}
                onChange={(e) => setAddRole(e.target.value)}
                className="w-full px-3 py-2 border border-lichen rounded-md text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              >
                {DEPARTMENT_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-1.5 pb-2 cursor-pointer">
              <Checkbox
                checked={addIsPrimary}
                onChange={(e) => setAddIsPrimary(e.target.checked)}
              />
              <span className="text-xs text-archive">Primary</span>
            </label>
            <button
              type="submit"
              disabled={submitting || !addUserId}
              className="btn-primary flex items-center gap-1.5 text-sm"
            >
              <UserPlus size={14} />
              Add
            </button>
          </form>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-6 mt-4 p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-sm text-semantic-error">
            {error}
          </div>
        )}

        {/* Members List */}
        <div className="px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-archive">
              <Loader2 size={20} className="animate-spin mr-2" />
              Loading members...
            </div>
          ) : members.length === 0 ? (
            <div className="text-center py-8 text-archive">
              <Users size={32} className="mx-auto mb-2 opacity-50" />
              <p>No members yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {members.map((member) => (
                <div
                  key={member.membership_id}
                  className="flex items-center gap-3 p-3 border border-lichen rounded-lg hover:bg-stone/20"
                >
                  <div className="flex-shrink-0 h-8 w-8 rounded-full bg-forest/10 flex items-center justify-center">
                    <span className="text-forest text-sm font-medium">
                      {getUserDisplay(member.user_id)[0]?.toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-ink truncate">
                      {getUserDisplay(member.user_id)}
                    </div>
                    {member.is_primary && (
                      <span className="inline-flex items-center gap-0.5 text-xs text-bark">
                        <Star size={10} className="fill-current" />
                        Primary
                      </span>
                    )}
                  </div>
                  <select
                    value={member.role}
                    onChange={(e) => handleRoleChange(member, e.target.value)}
                    className="px-2 py-1 border border-lichen rounded text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                    aria-label={`Role for ${getUserDisplay(member.user_id)}`}
                  >
                    {DEPARTMENT_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                  {!member.is_primary && (
                    <button
                      onClick={() => handleSetPrimary(member)}
                      className="text-archive hover:text-bark transition-colors"
                      title="Set as primary department"
                      aria-label="Set as primary"
                    >
                      <Star size={16} />
                    </button>
                  )}
                  <button
                    onClick={() => handleRemoveMember(member)}
                    className="text-archive hover:text-semantic-error transition-colors"
                    title="Remove member"
                    aria-label="Remove member"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-lichen flex justify-end">
          <button onClick={onClose} className="px-4 py-2 border border-lichen rounded-md text-ink hover:bg-stone">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Page
// ============================================================================

export default function DepartmentManagementPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { user, applications } = useAuth();
  const { showToast } = useToast();

  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Filters
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | 'all'>('active');

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeactivateModal, setShowDeactivateModal] = useState(false);
  const [showMembersPanel, setShowMembersPanel] = useState(false);
  const [selectedDepartment, setSelectedDepartment] = useState<Department | null>(null);

  // Deactivate modal
  const deactivateModal = useAccessibleModal({
    isOpen: showDeactivateModal,
    onClose: () => setShowDeactivateModal(false),
    titlePrefix: 'deactivate-dept',
  });

  // Permissions
  const isPlatformAdmin = user?.permissions?.includes('platform.admin');
  const canView = isPlatformAdmin || user?.permissions?.includes('departments.view');
  const canCreate = isPlatformAdmin || user?.permissions?.includes('departments.create');
  const canEdit = isPlatformAdmin || user?.permissions?.includes('departments.edit');
  const canDelete = isPlatformAdmin || user?.permissions?.includes('departments.delete');
  const canManageMembers = isPlatformAdmin || user?.permissions?.includes('departments.manage_members');

  const loadDepartments = useCallback(async () => {
    if (!orgId) return;
    try {
      setLoading(true);
      setError(null);
      const activeOnly = statusFilter === 'active';
      const data = await getDepartments(orgId, statusFilter !== 'all' ? activeOnly : false);
      // If showing inactive only, filter client-side
      if (statusFilter === 'inactive') {
        setDepartments(data.filter((d) => !d.is_active));
      } else {
        setDepartments(data);
      }
    } catch (err) {
      logger.error('Failed to load departments:', err);
      setError(err instanceof Error ? err.message : 'Failed to load departments');
    } finally {
      setLoading(false);
    }
  }, [orgId, statusFilter]);

  useEffect(() => {
    if (orgId && canView) {
      loadDepartments();
    }
  }, [orgId, canView, loadDepartments]);

  // Redirect if not authorized
  if (!canView) {
    return <Navigate to={orgId ? getDefaultLandingPath(orgId, applications) : '/'} replace />;
  }

  const handleCreate = async (form: DepartmentForm) => {
    if (!orgId) return;
    try {
      setSubmitting(true);
      await createDepartment(orgId, {
        name: form.name,
        code: form.code,
        description: form.description || undefined,
        parent_id: form.parent_id || undefined,
        color: form.color || undefined,
        sort_order: form.sort_order,
      });
      setShowCreateModal(false);
      loadDepartments();
    } catch (err) {
      logger.error('Failed to create department:', err);
      showToast({ type: 'error', title: 'Failed to create department', message: err instanceof Error ? err.message : undefined });
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = async (form: DepartmentForm) => {
    if (!orgId || !selectedDepartment) return;
    try {
      setSubmitting(true);
      await updateDepartment(orgId, selectedDepartment.department_id, {
        name: form.name,
        code: form.code,
        description: form.description || undefined,
        parent_id: form.parent_id || null,
        color: form.color || undefined,
        sort_order: form.sort_order,
      });
      setShowEditModal(false);
      setSelectedDepartment(null);
      loadDepartments();
    } catch (err) {
      logger.error('Failed to update department:', err);
      showToast({ type: 'error', title: 'Failed to update department', message: err instanceof Error ? err.message : undefined });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeactivate = async () => {
    if (!orgId || !selectedDepartment) return;
    try {
      setSubmitting(true);
      await deleteDepartment(orgId, selectedDepartment.department_id);
      setShowDeactivateModal(false);
      setSelectedDepartment(null);
      loadDepartments();
    } catch (err) {
      logger.error('Failed to deactivate department:', err);
      showToast({ type: 'error', title: 'Failed to deactivate department', message: err instanceof Error ? err.message : undefined });
    } finally {
      setSubmitting(false);
    }
  };

  const handleReactivate = async (dept: Department) => {
    if (!orgId) return;
    try {
      await updateDepartment(orgId, dept.department_id, { is_active: true });
      loadDepartments();
    } catch (err) {
      logger.error('Failed to reactivate department:', err);
      showToast({ type: 'error', title: 'Failed to reactivate department', message: err instanceof Error ? err.message : undefined });
    }
  };

  if (loading && departments.length === 0) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-archive">Loading departments...</div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex justify-between items-center">
        <div>
          <div className="flex items-center gap-3">
            <Building2 className="w-8 h-8 text-forest" />
            <h1 className="text-2xl font-semibold text-ink">Departments</h1>
          </div>
          <p className="text-sm text-archive mt-1">
            Manage departments and control record-level access
          </p>
        </div>
        {canCreate && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="btn-primary flex items-center space-x-2"
          >
            <Plus size={18} />
            <span>Create Department</span>
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
          <label htmlFor="dept-status-filter" className="text-sm font-medium text-ink">
            Status:
          </label>
          <select
            id="dept-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'active' | 'inactive' | 'all')}
            className="px-3 py-1.5 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            aria-label="Filter by status"
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </select>
        </div>
      </div>

      {/* Departments Table */}
      <div className="bg-parchment rounded-lg border border-lichen overflow-hidden">
        <table className="min-w-full divide-y divide-lichen">
          <thead className="bg-stone">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-archive uppercase tracking-wider">
                Department
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-archive uppercase tracking-wider">
                Code
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-archive uppercase tracking-wider">
                Description
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-archive uppercase tracking-wider">
                Members
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-archive uppercase tracking-wider">
                Status
              </th>
              {(canEdit || canDelete || canManageMembers) && (
                <th className="px-6 py-3 text-right text-xs font-medium text-archive uppercase tracking-wider">
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody className="bg-parchment divide-y divide-lichen">
            {departments.length === 0 ? (
              <tr>
                <td
                  colSpan={(canEdit || canDelete || canManageMembers) ? 6 : 5}
                  className="px-6 py-8 text-center text-archive"
                >
                  <Building2 className="mx-auto mb-2 text-archive" size={48} />
                  <p>No departments found</p>
                </td>
              </tr>
            ) : (
              departments.map((dept) => (
                <tr key={dept.department_id} className="hover:bg-stone/30">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      {dept.color && (
                        <span
                          className="inline-block w-3 h-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: dept.color }}
                        />
                      )}
                      <span
                        className="text-sm font-medium text-ink"
                        style={{ paddingLeft: dept.depth * 16 }}
                      >
                        {dept.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm text-archive font-mono">{dept.code}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-archive line-clamp-1">
                      {dept.description || '—'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm text-ink">{dept.member_count}</span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {dept.is_active ? (
                      <span className="px-2 py-1 text-xs font-medium rounded bg-semantic-success/10 text-semantic-success">
                        Active
                      </span>
                    ) : (
                      <span className="px-2 py-1 text-xs font-medium rounded bg-stone text-ink">
                        Inactive
                      </span>
                    )}
                  </td>
                  {(canEdit || canDelete || canManageMembers) && (
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <div className="flex justify-end space-x-2">
                        {canManageMembers && (
                          <button
                            onClick={() => {
                              setSelectedDepartment(dept);
                              setShowMembersPanel(true);
                            }}
                            className="text-archive hover:text-forest transition-colors"
                            title="Manage members"
                            aria-label="Manage members"
                          >
                            <Users size={18} />
                          </button>
                        )}
                        {canEdit && (
                          <button
                            onClick={() => {
                              setSelectedDepartment(dept);
                              setShowEditModal(true);
                            }}
                            className="text-archive hover:text-forest transition-colors"
                            title="Edit department"
                            aria-label="Edit department"
                          >
                            <Pencil size={18} />
                          </button>
                        )}
                        {dept.is_active && canDelete && (
                          <button
                            onClick={() => {
                              setSelectedDepartment(dept);
                              setShowDeactivateModal(true);
                            }}
                            className="text-archive hover:text-semantic-error transition-colors"
                            title="Deactivate department"
                            aria-label="Deactivate department"
                          >
                            <Ban size={18} />
                          </button>
                        )}
                        {!dept.is_active && canEdit && (
                          <button
                            onClick={() => handleReactivate(dept)}
                            className="text-archive hover:text-semantic-success transition-colors"
                            title="Reactivate department"
                            aria-label="Reactivate department"
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

      {/* Create Modal */}
      <DepartmentFormModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSubmit={handleCreate}
        initialData={EMPTY_FORM}
        departments={departments.filter((d) => d.is_active)}
        submitting={submitting}
        isEdit={false}
      />

      {/* Edit Modal */}
      {selectedDepartment && (
        <DepartmentFormModal
          isOpen={showEditModal}
          onClose={() => {
            setShowEditModal(false);
            setSelectedDepartment(null);
          }}
          onSubmit={handleEdit}
          initialData={{
            name: selectedDepartment.name,
            code: selectedDepartment.code,
            description: selectedDepartment.description || '',
            color: selectedDepartment.color || '',
            parent_id: selectedDepartment.parent_id || '',
            sort_order: selectedDepartment.sort_order,
          }}
          departments={departments.filter(
            (d) => d.is_active && d.department_id !== selectedDepartment.department_id,
          )}
          submitting={submitting}
          isEdit
        />
      )}

      {/* Deactivate Confirmation Modal */}
      {showDeactivateModal && selectedDepartment && (
        <div className="fixed inset-0 bg-ink/50 flex items-center justify-center z-50">
          <div
            ref={deactivateModal.modalRef}
            className="bg-parchment rounded-lg p-6 max-w-md w-full mx-4"
            {...getModalAriaProps(deactivateModal.titleId)}
          >
            <div className="flex justify-between items-center mb-4">
              <h2 id={deactivateModal.titleId} className="text-xl font-serif font-bold text-semantic-error">
                Deactivate Department
              </h2>
              <button
                onClick={() => setShowDeactivateModal(false)}
                className="text-archive hover:text-ink"
                aria-label="Close"
              >
                <X size={24} />
              </button>
            </div>
            <div className="mb-6">
              <p className="text-sm text-archive mb-3">
                Are you sure you want to deactivate <strong>{selectedDepartment.name}</strong>?
              </p>
              <div className="bg-semantic-warning/10 border border-semantic-warning/30 rounded-lg p-3 text-sm text-semantic-warning">
                <AlertTriangle size={16} className="inline mr-2" />
                Records assigned to this department will retain their assignment, but new records
                cannot be assigned to it. The department can be reactivated later.
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
                {submitting ? 'Deactivating...' : 'Deactivate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Members Panel */}
      {orgId && (
        <MembersPanel
          isOpen={showMembersPanel}
          onClose={() => {
            setShowMembersPanel(false);
            setSelectedDepartment(null);
            loadDepartments(); // Refresh member counts
          }}
          department={selectedDepartment}
          orgId={orgId}
        />
      )}
    </div>
  );
}
