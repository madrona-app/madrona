import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DepartmentManagementPage from '../../pages/admin/DepartmentManagementPage';
import * as useAuthHook from '../../hooks/useAuth';
import * as departmentsApi from '../../lib/api/departments';
import * as apiClient from '../../lib/apiClient';

vi.mock('../../hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../lib/api/departments', () => ({
  getDepartments: vi.fn(),
  createDepartment: vi.fn(),
  updateDepartment: vi.fn(),
  deleteDepartment: vi.fn(),
  getDepartmentMembers: vi.fn(),
  addDepartmentMember: vi.fn(),
  updateDepartmentMember: vi.fn(),
  removeDepartmentMember: vi.fn(),
}));

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn(), toasts: [], dismissToast: vi.fn() }),
}));

const mockUseAuth = vi.mocked(useAuthHook.useAuth);
const mockGetDepartments = vi.mocked(departmentsApi.getDepartments);
const mockCreateDepartment = vi.mocked(departmentsApi.createDepartment);
const mockApiFetch = vi.mocked(apiClient.apiFetch);

function setAuth(permissions: string[] = ['platform.admin']) {
  mockUseAuth.mockReturnValue({
    user: {
      user_id: 'user-1',
      name: 'Admin',
      email: 'admin@example.com',
      permissions,
    },
    memberships: [],
    activeOrganizationId: 'org-1',
    applications: [{ key: 'collections', enabled: true, status: 'active' }],
    isLoading: false,
    isAuthenticated: true,
    error: null,
  } as any);
}

function renderPage(orgId = 'org-1') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/admin/departments`]}>
        <Routes>
          <Route path="/organizations/:orgId/admin/departments" element={<DepartmentManagementPage />} />
          <Route path="/organizations/:orgId/collections/objects" element={<div>Collections Landing</div>} />
          <Route path="/organizations/:orgId/collections/*" element={<div>Collections Landing</div>} />
          <Route path="/" element={<div>Home</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DepartmentManagementPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue({ users: [] });
  });

  describe('permission gate', () => {
    it('redirects when user lacks departments.view', async () => {
      setAuth([]);
      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/Collections Landing|Home/i)).toBeInTheDocument();
      });
      expect(screen.queryByText(/Manage departments and control/i)).not.toBeInTheDocument();
    });

    it('renders for platform admin', async () => {
      setAuth(['platform.admin']);
      mockGetDepartments.mockResolvedValue([]);

      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Departments/i })).toBeInTheDocument();
      });
    });

    it('renders for users with departments.view permission', async () => {
      setAuth(['departments.view']);
      mockGetDepartments.mockResolvedValue([]);

      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Departments/i })).toBeInTheDocument();
      });
    });
  });

  describe('loading state', () => {
    it('shows loading message while fetching', async () => {
      setAuth(['platform.admin']);
      mockGetDepartments.mockImplementation(() => new Promise(() => {}));

      renderPage();
      expect(screen.getByText(/Loading departments/i)).toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('shows no departments message', async () => {
      setAuth(['platform.admin']);
      mockGetDepartments.mockResolvedValue([]);

      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/No departments found/i)).toBeInTheDocument();
      });
    });
  });

  describe('with data', () => {
    const mockDepartments = [
      {
        department_id: 'd-1',
        name: 'European Paintings',
        code: 'EUR-PAINT',
        description: 'European painting collection',
        depth: 0,
        path: 'EUR-PAINT',
        parent_id: null,
        color: 'rgb(var(--color-bark))',
        sort_order: 0,
        is_active: true,
        member_count: 5,
        organization_id: 'org-1',
      },
      {
        department_id: 'd-2',
        name: 'Sculpture',
        code: 'SCULPT',
        description: null,
        depth: 0,
        path: 'SCULPT',
        parent_id: null,
        color: null,
        sort_order: 1,
        is_active: true,
        member_count: 0,
        organization_id: 'org-1',
      },
    ];

    beforeEach(() => {
      setAuth(['platform.admin']);
      mockGetDepartments.mockResolvedValue(mockDepartments as any);
    });

    it('renders department names', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('European Paintings')).toBeInTheDocument();
      });
      expect(screen.getByText('Sculpture')).toBeInTheDocument();
    });

    it('renders department codes', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('EUR-PAINT')).toBeInTheDocument();
      });
    });

    it('shows status badge for active departments', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
      });
    });

    it('shows Create Department button for platform admin', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Create Department/i })).toBeInTheDocument();
      });
    });
  });

  describe('create department flow', () => {
    beforeEach(() => {
      setAuth(['platform.admin']);
      mockGetDepartments.mockResolvedValue([]);
    });

    it('opens create modal when Create Department clicked', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Create Department/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Create Department/i }));

      expect(screen.getByRole('heading', { name: /Create Department/i })).toBeInTheDocument();
      expect(screen.getByLabelText(/^Name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/^Code/i)).toBeInTheDocument();
    });

    it('calls createDepartment when form submitted', async () => {
      mockCreateDepartment.mockResolvedValue({ department_id: 'new' } as any);

      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Create Department/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Create Department/i }));

      fireEvent.change(screen.getByLabelText(/^Name/i), {
        target: { value: 'Photography' },
      });
      fireEvent.change(screen.getByLabelText(/^Code/i), {
        target: { value: 'PHOTO' },
      });

      // Find the submit button inside the modal
      const submitButtons = screen.getAllByRole('button', { name: /Create Department/i });
      // Last one is the submit button inside the modal
      fireEvent.click(submitButtons[submitButtons.length - 1]);

      await waitFor(() => {
        expect(mockCreateDepartment).toHaveBeenCalledWith(
          'org-1',
          expect.objectContaining({ name: 'Photography', code: 'PHOTO' }),
        );
      });
    });
  });

  describe('error state', () => {
    it('shows error when load fails', async () => {
      setAuth(['platform.admin']);
      mockGetDepartments.mockRejectedValue(new Error('Failed to fetch'));

      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/Failed to fetch/i)).toBeInTheDocument();
      });
    });
  });

  describe('status filter', () => {
    beforeEach(() => {
      setAuth(['platform.admin']);
      mockGetDepartments.mockResolvedValue([]);
    });

    it('renders status filter dropdown', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByLabelText(/Filter by status/i)).toBeInTheDocument();
      });
    });

    it('changes filter value', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByLabelText(/Filter by status/i)).toBeInTheDocument();
      });

      const filter = screen.getByLabelText(/Filter by status/i) as HTMLSelectElement;
      fireEvent.change(filter, { target: { value: 'inactive' } });
      expect(filter.value).toBe('inactive');
    });
  });
});
