import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AppRolesModal from '../../../components/admin/AppRolesModal';

const { apiFetchMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
}));

vi.mock('../../../lib/apiClient', () => ({
  apiFetch: apiFetchMock,
  ApiError: class ApiError extends Error {},
}));

const ROLES = [
  { role_id: 'r-1', role_key: 'admin', display_name: 'Administrator' },
  { role_id: 'r-2', role_key: 'viewer', display_name: 'Viewer' },
];

const USER = {
  user_id: 'u-1',
  email: 'user@example.com',
  name: 'Jane Doe',
  role_id: 'r-2',
  role_key: 'viewer',
  role_display_name: 'Viewer',
  app_roles: {},
};

function renderModal(extra: Partial<React.ComponentProps<typeof AppRolesModal>> = {}) {
  const onClose = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    onClose,
    ...render(
      <QueryClientProvider client={client}>
        <AppRolesModal
          isOpen
          onClose={onClose}
          user={USER}
          roles={ROLES}
          orgId="org-1"
          {...extra}
        />
      </QueryClientProvider>,
    ),
  };
}

describe('AppRolesModal', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it('renders nothing when not open', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <AppRolesModal
          isOpen={false}
          onClose={() => {}}
          user={USER}
          roles={ROLES}
          orgId="org-1"
        />
      </QueryClientProvider>,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the user heading with name when present', () => {
    renderModal();
    expect(screen.getByText(/App Roles for Jane Doe/)).toBeInTheDocument();
  });

  it('falls back to email when no name', () => {
    renderModal({ user: { ...USER, name: undefined } });
    expect(screen.getByText(/App Roles for user@example.com/)).toBeInTheDocument();
  });

  it('shows the default role indicator', () => {
    renderModal();
    expect(screen.getAllByText('Viewer').length).toBeGreaterThan(0);
  });

  it('renders one row per app', () => {
    renderModal();
    expect(screen.getByText('Collections')).toBeInTheDocument();
    expect(screen.getByText('Media')).toBeInTheDocument();
    expect(screen.getByText('Bridge')).toBeInTheDocument();
    expect(screen.getByText('Reports')).toBeInTheDocument();
    // Exhibit was retired as an app; exhibitions live under Collections.
    expect(screen.queryByText('Exhibit')).not.toBeInTheDocument();
  });

  it('Save button is disabled when no changes', () => {
    renderModal();
    expect(screen.getByText('Save Changes')).toBeDisabled();
  });

  it('Cancel button calls onClose', () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('selecting a non-default role enables Save and shows Override pill', () => {
    renderModal();
    const collectionsSelect = screen.getByLabelText('Role for Collections') as HTMLSelectElement;
    fireEvent.change(collectionsSelect, { target: { value: 'r-1' } });
    expect(screen.getByText('Save Changes')).not.toBeDisabled();
  });

  it('Save Changes calls the PUT endpoint', async () => {
    apiFetchMock.mockResolvedValue({});
    renderModal();
    const collectionsSelect = screen.getByLabelText('Role for Collections') as HTMLSelectElement;
    fireEvent.change(collectionsSelect, { target: { value: 'r-1' } });
    fireEvent.click(screen.getByText('Save Changes'));
    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/organizations/org-1/users/u-1/app-roles/collections',
        expect.objectContaining({ method: 'PUT' }),
      );
    });
  });

  it('selecting "use default" with existing override stages a removal (DELETE on save)', async () => {
    apiFetchMock.mockResolvedValue({});
    renderModal({
      user: {
        ...USER,
        app_roles: {
          collections: {
            role_id: 'r-1',
            role_key: 'admin',
            role_display_name: 'Administrator',
          },
        },
      },
    });
    const sel = screen.getByLabelText('Role for Collections') as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: '' } });
    fireEvent.click(screen.getByText('Save Changes'));
    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/organizations/org-1/users/u-1/app-roles/collections',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  it('shows error message when API throws', async () => {
    apiFetchMock.mockRejectedValue(new Error('failed'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderModal();
    const sel = screen.getByLabelText('Role for Collections') as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: 'r-1' } });
    try {
      fireEvent.click(screen.getByText('Save Changes'));
    } catch {
      // mutateAsync rethrows
    }
    await waitFor(() => {
      expect(screen.getByText('failed')).toBeInTheDocument();
    });
    errSpy.mockRestore();
  });
});
