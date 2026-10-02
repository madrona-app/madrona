import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TeamShareSelector } from '../../../components/dam/TeamShareSelector';

const { getOrganizationUsersMock, getRolesMock } = vi.hoisted(() => ({
  getOrganizationUsersMock: vi.fn(),
  getRolesMock: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  getOrganizationUsers: getOrganizationUsersMock,
  getRoles: getRolesMock,
}));

vi.mock('../../../components/ui/MadronaLoader', () => ({
  MadronaLoader: () => <div data-testid="loader" />,
}));

function createClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderSelector(props: Partial<Parameters<typeof TeamShareSelector>[0]> = {}) {
  return render(
    <QueryClientProvider client={createClient()}>
      <TeamShareSelector
        organizationId="org-1"
        onSelect={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe('TeamShareSelector', () => {
  beforeEach(() => {
    getOrganizationUsersMock.mockReset();
    getRolesMock.mockReset();
  });

  it('renders the Users tab by default with loaded users', async () => {
    getOrganizationUsersMock.mockResolvedValue({
      users: [
        { user_id: 'u-1', email: 'alice@example.com', name: 'Alice' },
        { user_id: 'u-2', email: 'bob@example.com', name: null },
      ],
    });
    renderSelector();
    await waitFor(() => screen.getByText('Alice'));
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('bob@example.com')).toBeInTheDocument();
  });

  it('filters users by search', async () => {
    getOrganizationUsersMock.mockResolvedValue({
      users: [
        { user_id: 'u-1', email: 'alice@example.com', name: 'Alice' },
        { user_id: 'u-2', email: 'bob@example.com', name: 'Bob' },
      ],
    });
    renderSelector();
    await waitFor(() => screen.getByText('Alice'));
    fireEvent.change(screen.getByPlaceholderText('Search users...'), {
      target: { value: 'bob' },
    });
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('switches to roles tab and loads roles', async () => {
    getRolesMock.mockResolvedValue({
      roles: [
        { role_id: 'r-1', role_key: 'admin', display_name: 'Administrator', description: 'Full access' },
      ],
    });
    renderSelector();
    fireEvent.click(screen.getByText('Roles'));
    await waitFor(() => screen.getByText('Administrator'));
    expect(screen.getByText('Administrator')).toBeInTheDocument();
    expect(screen.getByText('Full access')).toBeInTheDocument();
  });

  it('shows the no-users empty state', async () => {
    getOrganizationUsersMock.mockResolvedValue({ users: [] });
    renderSelector();
    await waitFor(() => screen.getByText('No users found'));
  });

  it('reveals the Permission selector and Add button only after selecting a user', async () => {
    getOrganizationUsersMock.mockResolvedValue({
      users: [{ user_id: 'u-1', email: 'alice@example.com', name: 'Alice' }],
    });
    const onSelect = vi.fn();
    renderSelector({ onSelect });
    await waitFor(() => screen.getByText('Alice'));

    // Confirm UI is hidden until a principal is selected
    expect(screen.queryByText('Add')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Alice'));
    expect(screen.getByText('Add')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Add'));
    expect(onSelect).toHaveBeenCalledWith('user', 'u-1', 'Alice', 'viewer');
  });

  it('uses the selected role when confirming', async () => {
    getOrganizationUsersMock.mockResolvedValue({
      users: [{ user_id: 'u-1', email: 'alice@example.com', name: 'Alice' }],
    });
    const onSelect = vi.fn();
    renderSelector({ onSelect });
    await waitFor(() => screen.getByText('Alice'));
    fireEvent.click(screen.getByText('Alice'));

    fireEvent.change(screen.getByDisplayValue('Viewer - Can view'), {
      target: { value: 'editor' },
    });
    fireEvent.click(screen.getByText('Add'));
    expect(onSelect).toHaveBeenCalledWith('user', 'u-1', 'Alice', 'editor');
  });
});
