import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import GlobalWorkPage from '../../pages/work/GlobalWorkPage';
import * as api from '../../lib/api';
import * as useActiveProductHook from '../../hooks/useActiveProduct';
import { AuthContext } from '../../contexts/AuthContext';

vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof api>('../../lib/api');
  return {
    ...actual,
    listTasks: vi.fn(),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
  };
});

vi.mock('../../hooks/useActiveProduct', () => ({
  useActiveProduct: vi.fn(),
}));

vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn(), toasts: [], dismissToast: vi.fn() }),
}));

// Mock CreateTaskSlideOver to keep tests focused
vi.mock('../../components/work/CreateTaskSlideOver', () => ({
  CreateTaskSlideOver: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="create-task-slide-over">Create Task</div> : null,
}));

const mockListTasks = vi.mocked(api.listTasks);
const mockUpdateTask = vi.mocked(api.updateTask);
const mockUseActiveProduct = vi.mocked(useActiveProductHook.useActiveProduct);

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderGlobalWorkPage(orgId = 'org-123') {
  const qc = createQueryClient();
  const user = {
    user_id: 'user-1',
    email: 'me@example.com',
    name: 'Test User',
    organizations: [{ organization_id: orgId, name: 'Test Org' }],
  };
  const authValue = {
    user,
    activeOrganizationId: orgId,
    isLoading: false,
    isInitialized: true,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
    setActiveOrganization: vi.fn(),
  } as unknown as React.ContextType<typeof AuthContext>;

  return render(
    <QueryClientProvider client={qc}>
      <AuthContext.Provider value={authValue}>
        <MemoryRouter initialEntries={[`/organizations/${orgId}/work`]}>
          <Routes>
            <Route
              path="/organizations/:orgId/work"
              element={<GlobalWorkPage />}
            />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>
  );
}

const mockTask = {
  task_id: 'task-1',
  organization_id: 'org-123',
  title: 'Catalog new acquisition',
  description: 'Add object to system',
  status: 'todo' as const,
  priority: 'normal',
  due_date: null,
  assigned_user_id: 'user-1',
  assigned_user_name: 'Test User',
  related_entity_type: 'object',
  related_entity_id: 'obj-1',
  app_context: 'collections',
  created_by: 'user-1',
  created_by_name: 'Test User',
  created_at: '2026-04-20T10:00:00Z',
  updated_at: '2026-04-20T10:00:00Z',
};

describe('GlobalWorkPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseActiveProduct.mockReturnValue({
      activeProductId: 'collections',
      setActiveProductId: vi.fn(),
    } as ReturnType<typeof useActiveProductHook.useActiveProduct>);
  });

  describe('loading and basic render', () => {
    it('renders My Tasks heading', () => {
      mockListTasks.mockImplementation(() => new Promise(() => {}));
      renderGlobalWorkPage();
      expect(screen.getByRole('heading', { name: 'My Tasks' })).toBeInTheDocument();
    });

    it('shows Collections subtitle when active product is collections', () => {
      mockListTasks.mockImplementation(() => new Promise(() => {}));
      renderGlobalWorkPage();
      expect(
        screen.getByText(/Collections tasks requiring your attention/i)
      ).toBeInTheDocument();
    });

    it('shows Media subtitle when active product is media', () => {
      mockUseActiveProduct.mockReturnValue({
        activeProductId: 'media',
        setActiveProductId: vi.fn(),
      } as ReturnType<typeof useActiveProductHook.useActiveProduct>);
      mockListTasks.mockImplementation(() => new Promise(() => {}));
      renderGlobalWorkPage();
      expect(
        screen.getByText(/Media tasks requiring your attention/i)
      ).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('shows error message on API failure', async () => {
      mockListTasks.mockRejectedValue(new Error('Network error'));
      renderGlobalWorkPage();
      await waitFor(() => {
        expect(screen.getByText('Failed to load tasks')).toBeInTheDocument();
      });
    });
  });

  describe('empty state', () => {
    it('shows All caught up empty state', async () => {
      mockListTasks.mockResolvedValue({ items: [] });
      renderGlobalWorkPage();
      await waitFor(() => {
        expect(screen.getByText('All caught up')).toBeInTheDocument();
      });
    });

    it('shows create first task button when empty', async () => {
      mockListTasks.mockResolvedValue({ items: [] });
      renderGlobalWorkPage();
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /create your first task/i })
        ).toBeInTheDocument();
      });
    });
  });

  describe('task list', () => {
    beforeEach(() => {
      mockListTasks.mockResolvedValue({ items: [mockTask] });
    });

    it('renders task title', async () => {
      renderGlobalWorkPage();
      await waitFor(() => {
        expect(screen.getByText('Catalog new acquisition')).toBeInTheDocument();
      });
    });

    it('renders task description', async () => {
      renderGlobalWorkPage();
      await waitFor(() => {
        expect(screen.getByText('Add object to system')).toBeInTheDocument();
      });
    });

    it('shows assignee', async () => {
      renderGlobalWorkPage();
      await waitFor(() => {
        expect(screen.getByText(/Assigned to Test User/i)).toBeInTheDocument();
      });
    });

    it('shows count of tasks', async () => {
      renderGlobalWorkPage();
      await waitFor(() => {
        expect(screen.getByText('1 task')).toBeInTheDocument();
      });
    });

    it('renders New Task button', async () => {
      renderGlobalWorkPage();
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^new task$/i })).toBeInTheDocument();
      });
    });

    it('opens slide-over when New Task clicked', async () => {
      renderGlobalWorkPage();
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^new task$/i })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: /^new task$/i }));
      expect(screen.getByTestId('create-task-slide-over')).toBeInTheDocument();
    });
  });

  describe('product filtering', () => {
    it('filters tasks by media product', async () => {
      const collectionsTask = { ...mockTask, task_id: 't-c', app_context: 'collections' };
      const mediaTask = {
        ...mockTask,
        task_id: 't-m',
        title: 'Process media file',
        app_context: 'media',
        related_entity_type: 'media',
      };
      mockListTasks.mockResolvedValue({ items: [collectionsTask, mediaTask] });

      mockUseActiveProduct.mockReturnValue({
        activeProductId: 'media',
        setActiveProductId: vi.fn(),
      } as ReturnType<typeof useActiveProductHook.useActiveProduct>);

      renderGlobalWorkPage();

      await waitFor(() => {
        expect(screen.getByText('Process media file')).toBeInTheDocument();
      });
      expect(screen.queryByText('Catalog new acquisition')).not.toBeInTheDocument();
    });
  });

  describe('show completed toggle', () => {
    beforeEach(() => {
      mockListTasks.mockResolvedValue({ items: [mockTask] });
    });

    it('renders show completed checkbox', async () => {
      renderGlobalWorkPage();
      await waitFor(() => {
        expect(screen.getByText(/Show completed/i)).toBeInTheDocument();
      });
    });

    it('calls listTasks with includeCompleted when toggled', async () => {
      renderGlobalWorkPage();
      await waitFor(() => {
        expect(screen.getByText('Catalog new acquisition')).toBeInTheDocument();
      });

      expect(mockListTasks).toHaveBeenCalledWith('org-123', {
        includeCompleted: false,
      });

      const checkboxes = screen.getAllByRole('checkbox');
      fireEvent.click(checkboxes[0]);

      await waitFor(() => {
        expect(mockListTasks).toHaveBeenCalledWith('org-123', {
          includeCompleted: true,
        });
      });
    });
  });

  describe('status change', () => {
    beforeEach(() => {
      mockListTasks.mockResolvedValue({ items: [mockTask] });
      mockUpdateTask.mockResolvedValue(mockTask as never);
    });

    it('opens status dropdown when status icon clicked', async () => {
      renderGlobalWorkPage();
      await waitFor(() => {
        expect(screen.getByText('Catalog new acquisition')).toBeInTheDocument();
      });

      const statusButton = screen.getByTitle('Change status');
      fireEvent.click(statusButton);

      expect(screen.getByText('To Do')).toBeInTheDocument();
      expect(screen.getByText('In Progress')).toBeInTheDocument();
      expect(screen.getByText('Done')).toBeInTheDocument();
    });
  });
});
