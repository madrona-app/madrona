import { useState, useEffect, useMemo, useCallback } from 'react';
import Checkbox from '../../components/Checkbox';
import { useParams, Navigate } from 'react-router-dom';
import { ShieldCheck, Search, ChevronRight, ChevronDown, Info } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import { useAuth } from '../../hooks/useAuth';
import { getDefaultLandingPath } from '../../hooks/useActiveProduct';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RoleInfo {
  role_id: string;
  role_key: string;
  display_name: string;
}

interface PermissionInfo {
  permission_id: string;
  permission_key: string;
  display_name: string;
  description: string;
  roles: string[]; // role_keys
}

interface ScopeGroup {
  scope: string;
  permissions: PermissionInfo[];
}

interface MatrixResponse {
  roles: RoleInfo[];
  scopes: ScopeGroup[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scopeLabel(scope: string): string {
  return scope
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PermissionManagementPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { user, applications } = useAuth();

  const [data, setData] = useState<MatrixResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedScopes, setExpandedScopes] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Set<string>>(new Set()); // "role_id:permission_id"
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);

  const isPlatformAdmin = user?.permissions?.includes('platform.admin');

  // ---- data loading ----

  const loadMatrix = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch<MatrixResponse>('/platform/permissions-matrix');
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load permissions matrix');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isPlatformAdmin) loadMatrix();
  }, [isPlatformAdmin, loadMatrix]);

  // ---- search & filtering ----

  const filteredScopes = useMemo(() => {
    if (!data) return [];
    const q = searchQuery.toLowerCase().trim();
    if (!q) return data.scopes;

    return data.scopes
      .map((sg) => ({
        ...sg,
        permissions: sg.permissions.filter(
          (p) =>
            p.display_name.toLowerCase().includes(q) ||
            p.permission_key.toLowerCase().includes(q) ||
            p.description.toLowerCase().includes(q)
        ),
      }))
      .filter((sg) => sg.permissions.length > 0);
  }, [data, searchQuery]);

  // Auto-expand scopes when searching
  useEffect(() => {
    if (searchQuery.trim()) {
      setExpandedScopes(new Set(filteredScopes.map((s) => s.scope)));
    }
  }, [searchQuery, filteredScopes]);

  // ---- auth gate ----

  if (!isPlatformAdmin) {
    return <Navigate to={orgId ? getDefaultLandingPath(orgId, applications) : '/'} replace />;
  }

  // ---- toggle helpers ----

  const toggleScope = (scope: string) => {
    setExpandedScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  };

  const togglePermission = async (roleId: string, permissionId: string, currentlyGranted: boolean) => {
    if (!data) return;
    const key = `${roleId}:${permissionId}`;
    if (pending.has(key)) return;

    // Optimistic update
    setPending((prev) => new Set(prev).add(key));
    setData((prev) => {
      if (!prev) return prev;
      const role = prev.roles.find((r) => r.role_id === roleId);
      if (!role) return prev;
      return {
        ...prev,
        scopes: prev.scopes.map((sg) => ({
          ...sg,
          permissions: sg.permissions.map((p) => {
            if (p.permission_id !== permissionId) return p;
            const roles = currentlyGranted
              ? p.roles.filter((rk) => rk !== role.role_key)
              : [...p.roles, role.role_key];
            return { ...p, roles };
          }),
        })),
      };
    });

    try {
      if (currentlyGranted) {
        await apiFetch('/platform/role-permissions', {
          method: 'DELETE',
          body: JSON.stringify({ role_id: roleId, permission_id: permissionId }),
        });
      } else {
        await apiFetch('/platform/role-permissions', {
          method: 'POST',
          body: JSON.stringify({ role_id: roleId, permission_id: permissionId }),
        });
      }
    } catch (err) {
      // Revert on error
      setData((prev) => {
        if (!prev) return prev;
        const role = prev.roles.find((r) => r.role_id === roleId);
        if (!role) return prev;
        return {
          ...prev,
          scopes: prev.scopes.map((sg) => ({
            ...sg,
            permissions: sg.permissions.map((p) => {
              if (p.permission_id !== permissionId) return p;
              const roles = currentlyGranted
                ? [...p.roles, role.role_key]
                : p.roles.filter((rk) => rk !== role.role_key);
              return { ...p, roles };
            }),
          })),
        };
      });
      setError(err instanceof Error ? err.message : 'Failed to update permission');
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  // ---- render ----

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64" role="status" aria-live="polite">
        <MadronaLoader />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="p-6">
        <div className="bg-semantic-error/10 text-semantic-error rounded-lg p-4">{error}</div>
      </div>
    );
  }

  if (!data) return null;

  const roles = data.roles;

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <ShieldCheck className="h-6 w-6 text-bark" />
        <h1 className="text-2xl font-semibold text-ink">Permission Management</h1>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 bg-semantic-error/10 text-semantic-error rounded-lg p-3 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-semantic-error hover:text-semantic-error/80 ml-2">
            &times;
          </button>
        </div>
      )}

      {/* Search */}
      <div className="relative mb-4 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-archive" />
        <input
          type="text"
          placeholder="Search permissions..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2 border border-lichen rounded-lg bg-parchment text-ink placeholder:text-archive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
        />
      </div>

      {/* Matrix table */}
      <div className="border border-lichen rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-forest text-parchment">
              <th className="text-left px-4 py-3 font-medium sticky left-0 bg-forest z-10 min-w-[280px]">
                Permission
              </th>
              {roles.map((r) => (
                <th key={r.role_id} className="px-3 py-3 font-medium text-center whitespace-nowrap min-w-[110px]">
                  {r.display_name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredScopes.map((sg) => {
              const isExpanded = expandedScopes.has(sg.scope);
              const grantedCount = sg.permissions.reduce(
                (acc, p) => acc + p.roles.length,
                0
              );
              const totalSlots = sg.permissions.length * roles.length;

              return (
                <ScopeSection
                  key={sg.scope}
                  scope={sg.scope}
                  permissions={sg.permissions}
                  roles={roles}
                  isExpanded={isExpanded}
                  grantedCount={grantedCount}
                  totalSlots={totalSlots}
                  onToggleScope={() => toggleScope(sg.scope)}
                  onTogglePermission={togglePermission}
                  pending={pending}
                  tooltip={tooltip}
                  setTooltip={setTooltip}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {filteredScopes.length === 0 && searchQuery && (
        <div className="text-center text-archive py-8">No permissions match &ldquo;{searchQuery}&rdquo;</div>
      )}

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 max-w-xs bg-ink text-parchment text-xs rounded px-3 py-2 shadow-lg pointer-events-none"
          style={{ left: tooltip.x, top: tooltip.y - 8, transform: 'translateY(-100%)' }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ScopeSection sub-component
// ---------------------------------------------------------------------------

function ScopeSection({
  scope,
  permissions,
  roles,
  isExpanded,
  grantedCount,
  totalSlots,
  onToggleScope,
  onTogglePermission,
  pending,
  tooltip: _tooltip,
  setTooltip,
}: {
  scope: string;
  permissions: PermissionInfo[];
  roles: RoleInfo[];
  isExpanded: boolean;
  grantedCount: number;
  totalSlots: number;
  onToggleScope: () => void;
  onTogglePermission: (roleId: string, permId: string, granted: boolean) => void;
  pending: Set<string>;
  tooltip: { text: string; x: number; y: number } | null;
  setTooltip: (t: { text: string; x: number; y: number } | null) => void;
}) {
  return (
    <>
      {/* Scope header row */}
      <tr
        className="bg-forest/90 text-parchment cursor-pointer select-none hover:bg-forest transition-colors"
        onClick={onToggleScope}
      >
        <td className="px-4 py-2 font-medium sticky left-0 bg-forest/90 z-10">
          <div className="flex items-center gap-2">
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 flex-shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 flex-shrink-0" />
            )}
            <span>{scopeLabel(scope)}</span>
            <span className="text-xs opacity-70 font-normal ml-1">
              {grantedCount}/{totalSlots}
            </span>
          </div>
        </td>
        {roles.map((r) => (
          <td key={r.role_id} />
        ))}
      </tr>

      {/* Permission rows */}
      {isExpanded &&
        permissions.map((p, idx) => {
          const isEven = idx % 2 === 0;
          return (
            <tr key={p.permission_id} className={isEven ? 'bg-parchment' : 'bg-stone/30'}>
              <td className={`px-4 py-2 sticky left-0 z-10 ${isEven ? 'bg-parchment' : 'bg-stone/30'}`}>
                <div className="flex items-center gap-1.5">
                  <span className="text-ink">{p.display_name}</span>
                  {p.description && (
                    <button
                      className="text-archive hover:text-bark flex-shrink-0"
                      onMouseEnter={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setTooltip({ text: p.description, x: rect.left, y: rect.top });
                      }}
                      onMouseLeave={() => setTooltip(null)}
                    >
                      <Info className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <span className="text-archive text-xs ml-1 hidden lg:inline">{p.permission_key}</span>
                </div>
              </td>
              {roles.map((r) => {
                const granted = p.roles.includes(r.role_key);
                const cellKey = `${r.role_id}:${p.permission_id}`;
                const isPending = pending.has(cellKey);
                return (
                  <td key={r.role_id} className="text-center px-3 py-2">
                    <Checkbox
                      checked={granted}
                      disabled={isPending}
                      onChange={() => onTogglePermission(r.role_id, p.permission_id, granted)}
                      className="disabled:opacity-40 cursor-pointer disabled:cursor-wait"
                    />
                  </td>
                );
              })}
            </tr>
          );
        })}
    </>
  );
}
