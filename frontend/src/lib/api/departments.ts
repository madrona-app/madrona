/**
 * Departments API — CRUD, membership management, and user department lookups.
 */
import { apiFetch, buildQueryString } from './_utils';
import type { Department } from '../schemas';

// ============================================================================
// Types for API responses (not in schemas since these are raw API shapes)
// ============================================================================

export interface DepartmentMember {
  membership_id: string;
  department_id: string;
  organization_id: string;
  user_id: string;
  role: string;
  is_primary: boolean;
  created_at: string | null;
}

export interface UserDepartment extends DepartmentMember {
  department_name: string;
  department_code: string;
  department_color: string | null;
}

// ============================================================================
// Department CRUD
// ============================================================================

export async function getDepartments(orgId: string, activeOnly = true): Promise<Department[]> {
  const qs = buildQueryString({ active_only: activeOnly });
  // Backend returns a raw array, not { departments: [...] }
  return apiFetch<Department[]>(`/organizations/${orgId}/departments${qs}`);
}

export async function getDepartment(orgId: string, deptId: string): Promise<Department> {
  return apiFetch<Department>(`/organizations/${orgId}/departments/${deptId}`);
}

export async function createDepartment(
  orgId: string,
  data: {
    name: string;
    code: string;
    description?: string;
    parent_id?: string;
    color?: string;
    sort_order?: number;
    head_user_id?: string;
    contact_email?: string;
    contact_phone?: string;
  },
): Promise<Department> {
  return apiFetch<Department>(`/organizations/${orgId}/departments`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateDepartment(
  orgId: string,
  deptId: string,
  data: Partial<{
    name: string;
    code: string;
    description: string;
    color: string;
    is_active: boolean;
    sort_order: number;
    parent_id: string | null;
    head_user_id: string | null;
    contact_email: string;
    contact_phone: string;
  }>,
): Promise<Department> {
  return apiFetch<Department>(`/organizations/${orgId}/departments/${deptId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteDepartment(orgId: string, deptId: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>(`/organizations/${orgId}/departments/${deptId}`, {
    method: 'DELETE',
  });
}

// ============================================================================
// Department Membership
// ============================================================================

export async function getDepartmentMembers(orgId: string, deptId: string): Promise<DepartmentMember[]> {
  // Backend returns a raw array
  return apiFetch<DepartmentMember[]>(`/organizations/${orgId}/departments/${deptId}/members`);
}

export async function addDepartmentMember(
  orgId: string,
  deptId: string,
  data: { user_id: string; role: string; is_primary?: boolean },
): Promise<DepartmentMember> {
  return apiFetch<DepartmentMember>(`/organizations/${orgId}/departments/${deptId}/members`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateDepartmentMember(
  orgId: string,
  deptId: string,
  membershipId: string,
  data: { role?: string; is_primary?: boolean },
): Promise<DepartmentMember> {
  return apiFetch<DepartmentMember>(
    `/organizations/${orgId}/departments/${deptId}/members/${membershipId}`,
    {
      method: 'PUT',
      body: JSON.stringify(data),
    },
  );
}

export async function removeDepartmentMember(
  orgId: string,
  deptId: string,
  membershipId: string,
): Promise<{ message: string }> {
  return apiFetch<{ message: string }>(
    `/organizations/${orgId}/departments/${deptId}/members/${membershipId}`,
    { method: 'DELETE' },
  );
}

// ============================================================================
// User-scoped department lookups
// ============================================================================

export async function getUserDepartments(orgId: string, userId: string): Promise<UserDepartment[]> {
  // Backend returns a raw array
  return apiFetch<UserDepartment[]>(`/organizations/${orgId}/users/${userId}/departments`);
}
