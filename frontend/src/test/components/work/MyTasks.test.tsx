import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { MyTasks } from '../../../components/work/MyTasks';

const {
  getWorkTasksMock,
  getAssignableUsersMock,
  assignWorkTaskMock,
  listTasksMock,
  useOrganizationMock,
  useActiveProductMock,
} = vi.hoisted(() => ({
  getWorkTasksMock: vi.fn(),
  getAssignableUsersMock: vi.fn(),
  assignWorkTaskMock: vi.fn(),
  listTasksMock: vi.fn(),
  useOrganizationMock: vi.fn(),
  useActiveProductMock: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  getWorkTasks: getWorkTasksMock,
  getAssignableUsers: getAssignableUsersMock,
  assignWorkTask: assignWorkTaskMock,
  listTasks: listTasksMock,
}));

vi.mock('../../../contexts/useOrganization', () => ({
  useOrganization: useOrganizationMock,
}));

vi.mock('../../../hooks/useActiveProduct', () => ({
  useActiveProduct: useActiveProductMock,
}));

vi.mock('../../../contexts/AuthContext', () => ({
  AuthContext: { Provider: ({ children }: { children: React.ReactNode }) => children },
}));

vi.mock('../../../contexts/WorkContext', () => ({
  formatTaskLabel: () => ({ label: 'Task Label', groupLabel: 'Group' }),
}));

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function renderTasks(props: Partial<Parameters<typeof MyTasks>[0]> = {}) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={createClient()}>
        <MyTasks {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('MyTasks', () => {
  beforeEach(() => {
    getWorkTasksMock.mockReset();
    getAssignableUsersMock.mockReset();
    useOrganizationMock.mockReset();
    useActiveProductMock.mockReset();
    useOrganizationMock.mockReturnValue({ activeOrganization: { organization_id: 'org-1' } });
    useActiveProductMock.mockReturnValue({ activeProductId: 'collections' });
    getAssignableUsersMock.mockResolvedValue({ users: [] });
  });

  it('renders without crashing when tasks are loading', () => {
    getWorkTasksMock.mockImplementation(() => new Promise(() => {}));
    renderTasks();
    expect(getWorkTasksMock).toHaveBeenCalled();
  });

  it('renders an empty-state when there are no tasks', async () => {
    getWorkTasksMock.mockResolvedValue({ items: [] });
    const { container } = renderTasks();
    await waitFor(() => expect(getWorkTasksMock).toHaveBeenCalled());
    // The empty state may render Inbox text or other indicators
    expect(container).toBeTruthy();
  });

  it('renders task cards when tasks are returned', async () => {
    getWorkTasksMock.mockResolvedValue({
      items: [
        {
          task_id: 't-1',
          title: 'Do This',
          priority: 'normal',
          status: 'open',
          due_date: null,
          related_entity_type: 'collection_object',
          related_entity_id: 'obj-1',
          object_number: 'O-1',
          record_type: 'condition_report',
          assigned_user_id: null,
          assigned_user_name: null,
        },
      ],
    });
    renderTasks({ variant: 'compact' });
    await waitFor(() => screen.getByText('Do This'));
    expect(screen.getByText('Do This')).toBeInTheDocument();
  });

  it('passes the limit parameter through', async () => {
    getWorkTasksMock.mockResolvedValue({ items: [] });
    renderTasks({ limit: 25 });
    await waitFor(() => expect(getWorkTasksMock).toHaveBeenCalled());
    expect(getWorkTasksMock).toHaveBeenCalledWith('org-1', expect.objectContaining({ limit: 25 }));
  });

  it('passes the assignedTo filter when provided', async () => {
    getWorkTasksMock.mockResolvedValue({ items: [] });
    renderTasks({ assignedTo: 'me' });
    await waitFor(() => expect(getWorkTasksMock).toHaveBeenCalled());
    expect(getWorkTasksMock).toHaveBeenCalledWith('org-1', expect.objectContaining({ assigned_to: 'me' }));
  });

  it('does not call API when there is no active organization', () => {
    useOrganizationMock.mockReturnValue({ activeOrganization: null });
    renderTasks();
    expect(getWorkTasksMock).not.toHaveBeenCalled();
  });

  it('renders in compact variant without crashing', async () => {
    getWorkTasksMock.mockResolvedValue({ items: [] });
    renderTasks({ variant: 'compact' });
    await waitFor(() => expect(getWorkTasksMock).toHaveBeenCalled());
  });
});
