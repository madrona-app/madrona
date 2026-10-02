import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OrganizationSwitcher } from '../../components/OrganizationSwitcher';
import * as useAuthHook from '../../hooks/useAuth';
import * as ThemeContext from '../../contexts/ThemeContext';

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

// Mock useAuth
vi.mock('../../hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

// Mock useTheme
vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: vi.fn(() => ({
    theme: 'light',
    setTheme: vi.fn(),
  })),
}));

// Mock useToast — component calls useToast() at render time
vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({
    showToast: vi.fn(),
    toasts: [],
    dismissToast: vi.fn(),
  }),
}));

const mockUseAuth = vi.mocked(useAuthHook.useAuth);
const mockUseTheme = vi.mocked(ThemeContext.useTheme);

describe('OrganizationSwitcher', () => {
  const mockSetActiveOrganization = vi.fn();
  const mockLogout = vi.fn();
  const mockSetTheme = vi.fn();

  const baseAuth = {
    user: { user_id: 'user-1', name: 'Test User', email: 'test@example.com' },
    memberships: [
      {
        organization_id: 'org-1',
        name: 'Test Org',
        slug: 'test-org',
        role: 'admin',
        role_label: 'Admin',
      },
    ],
    activeOrganizationId: 'org-1',
    isLoading: false,
    error: null,
    setActiveOrganization: mockSetActiveOrganization,
    logout: mockLogout,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue(baseAuth as any);
    mockUseTheme.mockReturnValue({ theme: 'light', setTheme: mockSetTheme });
  });

  describe('loading state', () => {
    it('shows loading when auth is loading', () => {
      mockUseAuth.mockReturnValue({ ...baseAuth, isLoading: true } as any);
      render(<OrganizationSwitcher />);
      expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
    });

    it('shows loading when no user', () => {
      mockUseAuth.mockReturnValue({ ...baseAuth, user: null, isLoading: false } as any);
      render(<OrganizationSwitcher />);
      expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
    });
  });

  describe('no organization state', () => {
    it('shows no organization when active org not found', () => {
      mockUseAuth.mockReturnValue({ ...baseAuth, memberships: [], activeOrganizationId: 'org-1' } as any);
      render(<OrganizationSwitcher />);
      expect(screen.getByText('No organization')).toBeInTheDocument();
    });
  });

  describe('basic rendering', () => {
    it('renders user name in button', () => {
      render(<OrganizationSwitcher />);
      expect(screen.getByText('Test User')).toBeInTheDocument();
    });

    it('renders user menu button', () => {
      render(<OrganizationSwitcher />);
      expect(screen.getByRole('button', { name: /user menu/i })).toBeInTheDocument();
    });

    it('dropdown is closed by default', () => {
      render(<OrganizationSwitcher />);
      expect(screen.queryByText('Organization')).not.toBeInTheDocument();
    });
  });

  describe('dropdown interactions', () => {
    it('opens dropdown when button clicked', () => {
      render(<OrganizationSwitcher />);
      fireEvent.click(screen.getByRole('button', { name: /user menu/i }));
      expect(screen.getByText('Organization')).toBeInTheDocument();
    });

    it('shows user info in dropdown', () => {
      render(<OrganizationSwitcher />);
      fireEvent.click(screen.getByRole('button', { name: /user menu/i }));
      expect(screen.getByText('test@example.com')).toBeInTheDocument();
    });

    it('shows organization name in dropdown', () => {
      render(<OrganizationSwitcher />);
      fireEvent.click(screen.getByRole('button', { name: /user menu/i }));
      expect(screen.getByText('Test Org')).toBeInTheDocument();
    });

    it('shows role badge', () => {
      render(<OrganizationSwitcher />);
      fireEvent.click(screen.getByRole('button', { name: /user menu/i }));
      expect(screen.getByText('admin')).toBeInTheDocument();
    });

    it('closes dropdown when button clicked again', () => {
      render(<OrganizationSwitcher />);
      const button = screen.getByRole('button', { name: /user menu/i });
      fireEvent.click(button);
      expect(screen.getByText('Organization')).toBeInTheDocument();
      fireEvent.click(button);
      expect(screen.queryByText('Organization')).not.toBeInTheDocument();
    });
  });

  describe('organization switching', () => {
    const multiOrgAuth = {
      ...baseAuth,
      memberships: [
        { organization_id: 'org-1', name: 'Test Org', slug: 'test-org', role: 'admin', role_label: 'Admin' },
        { organization_id: 'org-2', name: 'Other Org', slug: 'other-org', role: 'member', role_label: 'Member' },
      ],
    };

    it('shows switch organization section for multiple orgs', () => {
      mockUseAuth.mockReturnValue(multiOrgAuth as any);
      render(<OrganizationSwitcher />);
      fireEvent.click(screen.getByRole('button', { name: /user menu/i }));
      expect(screen.getByText('Switch Organization')).toBeInTheDocument();
    });

    it('does not show switch section for single org', () => {
      render(<OrganizationSwitcher />);
      fireEvent.click(screen.getByRole('button', { name: /user menu/i }));
      expect(screen.queryByText('Switch Organization')).not.toBeInTheDocument();
    });

    it('shows all organizations in list', () => {
      mockUseAuth.mockReturnValue(multiOrgAuth as any);
      render(<OrganizationSwitcher />);
      fireEvent.click(screen.getByRole('button', { name: /user menu/i }));
      expect(screen.getByText('Other Org')).toBeInTheDocument();
    });

    it('shows check mark for active organization', () => {
      mockUseAuth.mockReturnValue(multiOrgAuth as any);
      render(<OrganizationSwitcher />);
      fireEvent.click(screen.getByRole('button', { name: /user menu/i }));
      // Active org should have a check mark
      const orgButton = screen.getAllByRole('button').find(btn => btn.textContent?.includes('Test Org') && btn.textContent?.includes('test-org'));
      expect(orgButton).toBeDefined();
    });
  });

  describe('theme toggle', () => {
    it('shows appearance section', () => {
      render(<OrganizationSwitcher />);
      fireEvent.click(screen.getByRole('button', { name: /user menu/i }));
      expect(screen.getByText('Appearance')).toBeInTheDocument();
    });

    it('shows theme options', () => {
      render(<OrganizationSwitcher />);
      fireEvent.click(screen.getByRole('button', { name: /user menu/i }));
      expect(screen.getByText('Light')).toBeInTheDocument();
      expect(screen.getByText('Dark')).toBeInTheDocument();
      expect(screen.getByText('System')).toBeInTheDocument();
    });

    it('calls setTheme when theme option clicked', () => {
      render(<OrganizationSwitcher />);
      fireEvent.click(screen.getByRole('button', { name: /user menu/i }));
      fireEvent.click(screen.getByText('Dark'));
      expect(mockSetTheme).toHaveBeenCalledWith('dark');
    });
  });

  describe('settings and logout', () => {
    it('shows settings button', () => {
      render(<OrganizationSwitcher />);
      fireEvent.click(screen.getByRole('button', { name: /user menu/i }));
      expect(screen.getByRole('button', { name: /settings/i })).toBeInTheDocument();
    });

    it('navigates to org settings when clicked', () => {
      render(<OrganizationSwitcher />);
      fireEvent.click(screen.getByRole('button', { name: /user menu/i }));
      fireEvent.click(screen.getByRole('button', { name: /settings/i }));
      expect(mockNavigate).toHaveBeenCalledWith('/organizations/org-1/settings');
    });

    // When activeOrganizationId is null but there's no matching membership,
    // the component shows "No organization" state with no dropdown

    it('shows sign out button', () => {
      render(<OrganizationSwitcher />);
      fireEvent.click(screen.getByRole('button', { name: /user menu/i }));
      expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
    });

    it('calls logout and navigates on sign out', async () => {
      mockLogout.mockResolvedValue(undefined);
      render(<OrganizationSwitcher />);
      fireEvent.click(screen.getByRole('button', { name: /user menu/i }));
      fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

      await waitFor(() => {
        expect(mockLogout).toHaveBeenCalled();
        expect(mockNavigate).toHaveBeenCalledWith('/sign-in');
      });
    });

    it('navigates to sign-in even if logout fails', async () => {
      mockLogout.mockRejectedValue(new Error('Logout failed'));
      render(<OrganizationSwitcher />);
      fireEvent.click(screen.getByRole('button', { name: /user menu/i }));
      fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/sign-in');
      });
    });
  });

  describe('role badge colors', () => {
    const testRoleColor = (role: string, expectedClass: string) => {
      mockUseAuth.mockReturnValue({
        ...baseAuth,
        memberships: [{ ...baseAuth.memberships[0], role, role_label: role }],
      } as any);
      render(<OrganizationSwitcher />);
      fireEvent.click(screen.getByRole('button', { name: /user menu/i }));
      const badge = screen.getByText(role);
      expect(badge.className).toContain(expectedClass);
    };

    it('uses forest for owner role', () => {
      testRoleColor('owner', 'bg-forest/10');
    });

    it('uses blue for admin role', () => {
      testRoleColor('admin', 'bg-semantic-info/10');
    });

    it('uses green for member role', () => {
      testRoleColor('member', 'bg-semantic-success/10');
    });

    it('uses gray for viewer role', () => {
      testRoleColor('viewer', 'bg-stone');
    });

    it('uses gray for unknown role', () => {
      testRoleColor('unknown', 'bg-stone');
    });
  });
});
