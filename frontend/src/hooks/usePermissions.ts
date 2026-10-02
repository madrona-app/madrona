import { useAuth } from './useAuth';

/**
 * Hook to check user permissions in the active organization.
 * 
 * Permissions are fetched from the backend and stored in AuthContext.
 * UI should use these permission checks to hide/disable actions the user cannot perform.
 * 
 * IMPORTANT: Frontend checks are for UX only. Backend always enforces permissions.
 * 
 * FUTURE-PROOFING DESIGN:
 * 
 * When new permissions are added:
 * 1. Backend adds permission to Permission enum
 * 2. Backend migration assigns permission to appropriate roles
 * 3. GET /me returns new permission in user.permissions array
 * 4. Frontend checks hasPermission('new.permission') immediately
 * 5. Feature shows/hides automatically based on permission
 * 
 * Graceful handling:
 * - If permission not in user.permissions → hasPermission() returns false
 * - Feature remains hidden until backend grants permission
 * - No frontend errors if permission doesn't exist yet
 * - Backward compatible (old permissions continue working)
 * 
 * Profile switching (future):
 * - When org switches profile, role labels change but permissions stay same
 * - user.role_label updates, user.permissions unchanged
 * - No frontend code changes needed for profile switches
 * 
 * See docs/RBAC_MIGRATION_DESIGN.md for detailed design.
 * 
 * @returns Object with permission checking functions
 */
export function usePermissions() {
  const { user, isPlatformAdmin, roleOverride } = useAuth();

  // User.permissions is defined in AuthContext (string[] of permission keys)
  const permissions = user?.permissions ?? [];

  // Platform admins bypass all permission checks unless simulating a lower role.
  // This mirrors the backend's platform_admin_bypass in require_permission() (auth.py:589).
  // When role override is active, permissions reflect the override role via /me.
  const bypassAll = isPlatformAdmin && !roleOverride;

  /**
   * Check if user has a specific permission.
   *
   * @param permission - Permission key (e.g., "data.view", "runs.execute")
   * @returns True if user has the permission
   *
   * @example
   * const { hasPermission } = usePermissions();
   * {hasPermission('runs.execute') && <ExecuteButton />}
   */
  const hasPermission = (permission?: string): boolean => {
    if (bypassAll) return true;
    if (permission === undefined) return false;
    return permissions.includes(permission);
  };

  /**
   * Check if user has ANY of the specified permissions.
   *
   * @param requiredPermissions - Array of permission keys
   * @returns True if user has at least one permission
   *
   * @example
   * const { hasAnyPermission } = usePermissions();
   * {hasAnyPermission(['data.export', 'data.manage']) && <ExportButton />}
   */
  const hasAnyPermission = (requiredPermissions: string[]): boolean => {
    if (bypassAll) return true;
    return requiredPermissions.some(permission => permissions.includes(permission));
  };

  /**
   * Check if user has ALL of the specified permissions.
   *
   * @param requiredPermissions - Array of permission keys
   * @returns True if user has all permissions
   *
   * @example
   * const { hasAllPermissions } = usePermissions();
   * {hasAllPermissions(['data.view', 'data.export']) && <AdvancedExport />}
   */
  const hasAllPermissions = (requiredPermissions: string[]): boolean => {
    if (bypassAll) return true;
    return requiredPermissions.every(permission => permissions.includes(permission));
  };

  return {
    permissions,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
  };
}
