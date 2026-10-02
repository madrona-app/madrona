import { useState, useEffect, useMemo, useCallback } from 'react';
import Checkbox from '../Checkbox';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Loader2, Users, Copy } from 'lucide-react';
import { SlideOver } from '../ui/SlideOver';
import {
  getRolePermissions,
  setRolePermissions,
  updateCustomRole,
} from '../../lib/api/admin';
import type { PermissionGroup, PermissionItem } from '../../lib/api/admin';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RoleEditorSlideOverProps {
  isOpen: boolean;
  onClose: () => void;
  organizationId: string;
  roleId: string | null;
  roleName?: string;
  isSystem: boolean;
  clonedFromName?: string | null;
  onSaved?: () => void;
}

type Tab = 'details' | 'permissions';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** "place_authorities" -> "Place Authorities" */
function formatScope(scope: string): string {
  return scope
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Build a flat Set of granted permission ids from the API response */
function grantedSet(groups: PermissionGroup[]): Set<string> {
  const s = new Set<string>();
  for (const g of groups) {
    for (const p of g.permissions) {
      if (p.granted) s.add(p.permission_id);
    }
  }
  return s;
}

/** Compare two sets for equality */
function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) {
    if (!b.has(v)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PermissionRow({
  permission,
  checked,
  disabled,
  onToggle,
}: {
  permission: PermissionItem;
  checked: boolean;
  disabled: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <label
      className={`flex items-start gap-3 py-2 px-3 rounded-sm ${
        disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:bg-stone/40'
      }`}
    >
      <Checkbox
        checked={checked}
        disabled={disabled}
        onChange={() => onToggle(permission.permission_id)}
        className="mt-0.5"
      />
      <div className="min-w-0">
        <span className="text-sm font-medium text-ink">{permission.display_name}</span>
        {permission.description && (
          <p className="text-xs text-archive mt-0.5 leading-relaxed">
            {permission.description}
          </p>
        )}
      </div>
    </label>
  );
}

function AccordionSection({
  group,
  grantedIds,
  disabled,
  onToggle,
  onSelectAll,
  onClearAll,
}: {
  group: PermissionGroup;
  grantedIds: Set<string>;
  disabled: boolean;
  onToggle: (id: string) => void;
  onSelectAll: (scope: string) => void;
  onClearAll: (scope: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const grantedCount = group.permissions.filter((p) =>
    grantedIds.has(p.permission_id),
  ).length;

  return (
    <div className="border border-lichen rounded-sm">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-stone/30 transition-colors focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 rounded-sm"
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown size={16} className="text-archive" />
          ) : (
            <ChevronRight size={16} className="text-archive" />
          )}
          <span className="text-sm font-semibold text-ink">
            {formatScope(group.scope)}
          </span>
        </div>
        <span className="text-xs text-archive">
          {grantedCount} / {group.permissions.length}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-lichen">
          {!disabled && (
            <div className="flex items-center gap-3 px-4 py-2 border-b border-lichen bg-stone/20">
              <button
                type="button"
                onClick={() => onSelectAll(group.scope)}
                className="text-xs font-medium text-bark hover:text-copper-dark transition-colors focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 rounded-sm"
              >
                Select all
              </button>
              <span className="text-lichen">|</span>
              <button
                type="button"
                onClick={() => onClearAll(group.scope)}
                className="text-xs font-medium text-bark hover:text-copper-dark transition-colors focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 rounded-sm"
              >
                Clear all
              </button>
            </div>
          )}
          <div className="px-1 py-1">
            {group.permissions.map((perm) => (
              <PermissionRow
                key={perm.permission_id}
                permission={perm}
                checked={grantedIds.has(perm.permission_id)}
                disabled={disabled}
                onToggle={onToggle}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function RoleEditorSlideOver({
  isOpen,
  onClose,
  organizationId,
  roleId,
  roleName,
  isSystem,
  clonedFromName,
  onSaved,
}: RoleEditorSlideOverProps) {
  // ----- local state -----
  const [activeTab, setActiveTab] = useState<Tab>('details');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [localGranted, setLocalGranted] = useState<Set<string>>(new Set());

  // ----- data fetching -----
  const permissionsQuery = useQuery({
    queryKey: ['role-permissions', organizationId, roleId],
    queryFn: () => getRolePermissions(organizationId, roleId!),
    enabled: isOpen && roleId !== null,
  });

  const groups: PermissionGroup[] = permissionsQuery.data?.groups ?? [];

  // seed local state when data arrives or panel opens
  useEffect(() => {
    if (permissionsQuery.data) {
      setLocalGranted(grantedSet(permissionsQuery.data.groups));
    }
  }, [permissionsQuery.data]);

  useEffect(() => {
    if (isOpen) {
      setActiveTab('details');
      setDisplayName(roleName ?? '');
      setDescription('');
    }
  }, [isOpen, roleName]);

  // ----- dirty tracking -----
  const serverGranted = useMemo(
    () => (permissionsQuery.data ? grantedSet(permissionsQuery.data.groups) : new Set<string>()),
    [permissionsQuery.data],
  );

  const detailsDirty = displayName !== (roleName ?? '');
  const permissionsDirty = !setsEqual(localGranted, serverGranted);
  const isDirty = detailsDirty || permissionsDirty;

  // ----- mutations -----
  const updateDetailsMutation = useMutation({
    mutationFn: (body: { display_name?: string; description?: string }) =>
      updateCustomRole(organizationId, roleId!, body),
  });

  const setPermissionsMutation = useMutation({
    mutationFn: (permissionIds: string[]) =>
      setRolePermissions(organizationId, roleId!, permissionIds),
  });

  const isSaving = updateDetailsMutation.isPending || setPermissionsMutation.isPending;

  const handleSave = useCallback(async () => {
    if (!roleId) return;

    try {
      const promises: Promise<unknown>[] = [];

      if (detailsDirty) {
        const body: { display_name?: string; description?: string } = {};
        if (displayName !== (roleName ?? '')) body.display_name = displayName;
        if (description) body.description = description;
        promises.push(updateDetailsMutation.mutateAsync(body));
      }

      if (permissionsDirty) {
        promises.push(setPermissionsMutation.mutateAsync([...localGranted]));
      }

      await Promise.all(promises);
      onSaved?.();
    } catch {
      // errors are surfaced through mutation state
    }
  }, [
    roleId,
    detailsDirty,
    permissionsDirty,
    displayName,
    description,
    roleName,
    localGranted,
    updateDetailsMutation,
    setPermissionsMutation,
    onSaved,
  ]);

  // ----- permission toggling -----
  const togglePermission = useCallback((id: string) => {
    setLocalGranted((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAllInScope = useCallback(
    (scope: string) => {
      const group = groups.find((g) => g.scope === scope);
      if (!group) return;
      setLocalGranted((prev) => {
        const next = new Set(prev);
        for (const p of group.permissions) next.add(p.permission_id);
        return next;
      });
    },
    [groups],
  );

  const clearAllInScope = useCallback(
    (scope: string) => {
      const group = groups.find((g) => g.scope === scope);
      if (!group) return;
      setLocalGranted((prev) => {
        const next = new Set(prev);
        for (const p of group.permissions) next.delete(p.permission_id);
        return next;
      });
    },
    [groups],
  );

  // ----- error display -----
  const saveError =
    updateDetailsMutation.error?.message ??
    setPermissionsMutation.error?.message ??
    null;

  // ----- render -----
  const footer = (
    <div className="flex items-center justify-between">
      <div className="text-sm text-archive">
        {isDirty && 'Unsaved changes'}
      </div>
      <div className="flex items-center gap-3">
        <button type="button" onClick={onClose} className="btn-secondary px-4 py-2 text-sm">
          Cancel
        </button>
        {!isSystem && (
          <button
            type="button"
            onClick={handleSave}
            disabled={!isDirty || isSaving}
            className="btn-primary px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <SlideOver
      isOpen={isOpen}
      onClose={onClose}
      title={roleName ?? 'Role'}
      subtitle={isSystem ? 'System role (read-only)' : 'Custom role'}
      width="xl"
      footer={footer}
    >
      {/* Tabs */}
      <div className="flex gap-1 border-b border-lichen -mx-6 px-6 mb-5">
        {(['details', 'permissions'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 rounded-t-sm ${
              activeTab === tab
                ? 'border-bark text-bark'
                : 'border-transparent text-archive hover:text-ink hover:border-stone'
            }`}
          >
            {tab === 'details' ? 'Details' : 'Permissions'}
          </button>
        ))}
      </div>

      {/* Error banner */}
      {saveError && (
        <div className="mb-4 p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-sm text-sm text-semantic-error">
          {saveError}
        </div>
      )}

      {/* Details tab */}
      {activeTab === 'details' && (
        <div className="space-y-5">
          {/* Display name */}
          <div>
            <label
              htmlFor="role-display-name"
              className="block text-sm font-medium text-ink mb-1.5"
            >
              Display Name
            </label>
            <input
              id="role-display-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={isSystem}
              className="w-full px-3 py-2 border border-lichen rounded-sm text-sm text-ink bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 disabled:bg-stone/30 disabled:cursor-not-allowed"
            />
          </div>

          {/* Description */}
          <div>
            <label
              htmlFor="role-description"
              className="block text-sm font-medium text-ink mb-1.5"
            >
              Description
            </label>
            <textarea
              id="role-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isSystem}
              rows={3}
              className="w-full px-3 py-2 border border-lichen rounded-sm text-sm text-ink bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 disabled:bg-stone/30 disabled:cursor-not-allowed resize-y"
            />
          </div>

          {/* Cloned-from badge */}
          {clonedFromName && (
            <div className="flex items-center gap-2">
              <Copy size={14} className="text-archive" />
              <span className="inline-flex items-center gap-1 text-xs font-medium text-archive bg-stone/40 px-2.5 py-1 rounded-full">
                Cloned from: {clonedFromName}
              </span>
            </div>
          )}

          {/* Member count */}
          {permissionsQuery.data && (
            <div className="flex items-center gap-2 text-sm text-archive">
              <Users size={16} />
              <span>
                {permissionsQuery.data.groups.reduce(
                  (acc, g) => acc + g.permissions.length,
                  0,
                )}{' '}
                permissions across {permissionsQuery.data.groups.length} scopes
              </span>
            </div>
          )}
        </div>
      )}

      {/* Permissions tab */}
      {activeTab === 'permissions' && (
        <div className="space-y-3">
          {permissionsQuery.isLoading && (
            <div className="flex items-center justify-center py-12 text-archive">
              <Loader2 size={24} className="animate-spin" />
            </div>
          )}

          {permissionsQuery.isError && (
            <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-sm text-sm text-semantic-error">
              Failed to load permissions.
            </div>
          )}

          {permissionsQuery.isSuccess && groups.length === 0 && (
            <p className="text-sm text-archive py-8 text-center">
              No permissions available.
            </p>
          )}

          {groups.map((group) => (
            <AccordionSection
              key={group.scope}
              group={group}
              grantedIds={localGranted}
              disabled={isSystem}
              onToggle={togglePermission}
              onSelectAll={selectAllInScope}
              onClearAll={clearAllInScope}
            />
          ))}
        </div>
      )}
    </SlideOver>
  );
}
