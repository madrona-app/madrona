import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RoleOverrideBanner } from '../../components/RoleOverrideBanner';

const { useAuthMock, apiFetchMock, setRoleOverrideMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  apiFetchMock: vi.fn(),
  setRoleOverrideMock: vi.fn(),
}));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: useAuthMock,
}));

vi.mock('../../lib/apiClient', () => ({
  apiFetch: apiFetchMock,
}));

function setAuth(opts: {
  isPlatformAdmin?: boolean;
  roleOverride?: string | null;
  activeOrgId?: string;
} = {}) {
  useAuthMock.mockReturnValue({
    isPlatformAdmin: opts.isPlatformAdmin ?? true,
    roleOverride: opts.roleOverride ?? null,
    setRoleOverride: setRoleOverrideMock,
    user: { active_organization_id: opts.activeOrgId ?? 'org-1' },
  });
}

describe('RoleOverrideBanner', () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    apiFetchMock.mockReset();
    setRoleOverrideMock.mockReset();
    apiFetchMock.mockResolvedValue({ roles: [] });
  });

  it('renders nothing when not a platform admin', () => {
    setAuth({ isPlatformAdmin: false });
    const { container } = render(<RoleOverrideBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the floating "Test Role" button when no override active', () => {
    setAuth({ roleOverride: null });
    render(<RoleOverrideBanner />);
    expect(screen.getByText('Test Role')).toBeInTheDocument();
  });

  it('renders the warning banner when override is active', () => {
    setAuth({ roleOverride: 'curator' });
    render(<RoleOverrideBanner />);
    expect(screen.getByText(/Viewing as:/)).toBeInTheDocument();
    expect(screen.getByText('Curator')).toBeInTheDocument();
  });

  it('mode="banner" shows nothing when no override is active', () => {
    setAuth({ roleOverride: null });
    const { container } = render(<RoleOverrideBanner mode="banner" />);
    expect(container.firstChild).toBeNull();
  });

  it('mode="button" shows nothing when override is active', () => {
    setAuth({ roleOverride: 'curator' });
    const { container } = render(<RoleOverrideBanner mode="button" />);
    expect(container.firstChild).toBeNull();
  });

  it('clicking the floating button opens the role list', () => {
    setAuth({ roleOverride: null });
    render(<RoleOverrideBanner />);
    fireEvent.click(screen.getByText('Test Role'));
    // Multiple "Curator" entries should appear (in dropdown) + bottom panel
    expect(screen.getByText('Administrator')).toBeInTheDocument();
    expect(screen.getByText('Registrar')).toBeInTheDocument();
  });

  it('selecting a role from the dropdown calls setRoleOverride', async () => {
    setAuth({ roleOverride: null });
    setRoleOverrideMock.mockResolvedValue(undefined);
    render(<RoleOverrideBanner />);
    fireEvent.click(screen.getByText('Test Role'));
    fireEvent.click(screen.getByText('Administrator'));
    expect(setRoleOverrideMock).toHaveBeenCalledWith('admin');
  });

  it('clicking Clear in the active banner clears the override', async () => {
    setAuth({ roleOverride: 'curator' });
    setRoleOverrideMock.mockResolvedValue(undefined);
    render(<RoleOverrideBanner />);
    fireEvent.click(screen.getByTitle('Clear role override'));
    expect(setRoleOverrideMock).toHaveBeenCalledWith(null);
  });

  it('clicking Change in active banner opens role picker', () => {
    setAuth({ roleOverride: 'admin' });
    render(<RoleOverrideBanner />);
    fireEvent.click(screen.getByText('Change'));
    // The dropdown adds extra system roles
    expect(screen.getByText('Registrar')).toBeInTheDocument();
    expect(screen.getByText('Viewer')).toBeInTheDocument();
  });

  it('renders the "Permissions are restricted" hint when override is active', () => {
    setAuth({ roleOverride: 'admin' });
    render(<RoleOverrideBanner />);
    expect(
      screen.getByText(/Permissions are restricted to this role/),
    ).toBeInTheDocument();
  });
});
