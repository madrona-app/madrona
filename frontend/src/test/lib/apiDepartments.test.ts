import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as apiClient from '../../lib/apiClient';
import {
  getDepartments,
  getDepartment,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  getDepartmentMembers,
  addDepartmentMember,
  updateDepartmentMember,
  removeDepartmentMember,
  getUserDepartments,
} from '../../lib/api/departments';

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  getCsrfToken: vi.fn(),
  getFriendlyErrorMessage: vi.fn(),
  API_BASE_URL: '/api',
}));

describe('api/departments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('getDepartments', () => {
    it('fetches departments with active_only=true by default', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce([]);
      await getDepartments('org-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/departments?active_only=true',
      );
    });

    it('passes active_only=false when requested', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce([]);
      await getDepartments('org-1', false);
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/departments?active_only=false',
      );
    });
  });

  describe('getDepartment', () => {
    it('fetches single department', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await getDepartment('org-1', 'dept-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/departments/dept-1',
      );
    });
  });

  describe('createDepartment', () => {
    it('POSTs department data', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await createDepartment('org-1', { name: 'IT', code: 'IT' });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/departments',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'IT', code: 'IT' }),
        }),
      );
    });
  });

  describe('updateDepartment', () => {
    it('PUTs partial department update', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await updateDepartment('org-1', 'dept-1', { name: 'New Name' });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/departments/dept-1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ name: 'New Name' }),
        }),
      );
    });
  });

  describe('deleteDepartment', () => {
    it('issues DELETE request', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ message: 'ok' });
      await deleteDepartment('org-1', 'dept-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/departments/dept-1',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  describe('getDepartmentMembers', () => {
    it('fetches member list', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce([]);
      await getDepartmentMembers('org-1', 'dept-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/departments/dept-1/members',
      );
    });
  });

  describe('addDepartmentMember', () => {
    it('POSTs to members endpoint', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await addDepartmentMember('org-1', 'dept-1', {
        user_id: 'u-1',
        role: 'curator',
      });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/departments/dept-1/members',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ user_id: 'u-1', role: 'curator' }),
        }),
      );
    });
  });

  describe('updateDepartmentMember', () => {
    it('PUTs membership update', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({});
      await updateDepartmentMember('org-1', 'dept-1', 'mem-1', {
        is_primary: true,
      });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/departments/dept-1/members/mem-1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ is_primary: true }),
        }),
      );
    });
  });

  describe('removeDepartmentMember', () => {
    it('DELETEs membership', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ message: 'ok' });
      await removeDepartmentMember('org-1', 'dept-1', 'mem-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/departments/dept-1/members/mem-1',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  describe('getUserDepartments', () => {
    it('fetches user-scoped departments', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce([]);
      await getUserDepartments('org-1', 'user-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/users/user-1/departments',
      );
    });
  });
});
