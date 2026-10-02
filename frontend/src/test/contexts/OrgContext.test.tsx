import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { OrgProvider } from '../../contexts/OrgContext';
import { useOrganization } from '../../contexts/useOrganization';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Mock auth context
const mockSetActiveOrganization = vi.fn();
const mockAuthContext = {
  user: {
    user_id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    active_organization_id: 'org-1',
    permissions: ['data.view'],
    role_label: 'Viewer',
    organizations: [
      {
        organization_id: 'org-1',
        name: 'Test Org',
        slug: 'test-org',
        timezone: 'America/New_York',
        role: 'member',
        role_label: 'Viewer',
      },
      {
        organization_id: 'org-2',
        name: 'Another Org',
        slug: 'another-org',
        timezone: 'UTC',
        role: 'admin',
        role_label: 'Admin',
      },
    ],
  },
  isLoading: false,
  isAuthenticated: true,
  setActiveOrganization: mockSetActiveOrganization,
};

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => mockAuthContext,
}));

// Suppress console logs during tests
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

beforeEach(() => {
  console.log = vi.fn();
  console.warn = vi.fn();
  console.error = vi.fn();
  vi.clearAllMocks();
  localStorageMock.clear();
  // Reset mock auth
  mockAuthContext.user = {
    user_id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    active_organization_id: 'org-1',
    permissions: ['data.view'],
    role_label: 'Viewer',
    organizations: [
      {
        organization_id: 'org-1',
        name: 'Test Org',
        slug: 'test-org',
        timezone: 'America/New_York',
        role: 'member',
        role_label: 'Viewer',
      },
      {
        organization_id: 'org-2',
        name: 'Another Org',
        slug: 'another-org',
        timezone: 'UTC',
        role: 'admin',
        role_label: 'Admin',
      },
    ],
  };
  mockAuthContext.isLoading = false;
});

afterEach(() => {
  console.log = originalConsoleLog;
  console.warn = originalConsoleWarn;
  console.error = originalConsoleError;
  vi.resetAllMocks();
});

// Test component that uses the Org context
function OrgConsumer() {
  const org = useOrganization();
  return (
    <div>
      <span data-testid="loading">{org.isLoading.toString()}</span>
      <span data-testid="active-org-id">{org.activeOrganizationId || 'none'}</span>
      <span data-testid="active-org-name">{org.activeOrganization?.organization_name || 'none'}</span>
      <span data-testid="org-count">{org.organizations.length}</span>
      <span data-testid="error">{org.error?.message || 'none'}</span>
      <button onClick={() => org.setActiveOrganizationId('org-2')}>Switch to Org 2</button>
      <button onClick={() => org.refreshOrganizations()}>Refresh</button>
    </div>
  );
}

describe('OrgContext', () => {
  describe('useOrganization hook', () => {
    it('throws error when used outside provider', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        render(<OrgConsumer />);
      }).toThrow('useOrganization must be used within an OrgProvider');

      spy.mockRestore();
    });

    it('returns context when used inside provider', () => {
      render(
        <OrgProvider>
          <OrgConsumer />
        </OrgProvider>
      );

      expect(screen.getByTestId('active-org-id')).toBeInTheDocument();
    });
  });

  describe('OrgProvider', () => {
    describe('initialization', () => {
      it('loads organizations from auth context', async () => {
        render(
          <OrgProvider>
            <OrgConsumer />
          </OrgProvider>
        );

        await waitFor(() => {
          expect(screen.getByTestId('loading')).toHaveTextContent('false');
        });

        expect(screen.getByTestId('org-count')).toHaveTextContent('2');
      });

      it('sets active organization from auth context', async () => {
        render(
          <OrgProvider>
            <OrgConsumer />
          </OrgProvider>
        );

        await waitFor(() => {
          expect(screen.getByTestId('active-org-id')).toHaveTextContent('org-1');
        });

        expect(screen.getByTestId('active-org-name')).toHaveTextContent('Test Org');
      });

      it('saves active organization to localStorage', async () => {
        render(
          <OrgProvider>
            <OrgConsumer />
          </OrgProvider>
        );

        await waitFor(() => {
          expect(screen.getByTestId('active-org-id')).toHaveTextContent('org-1');
        });

        expect(localStorageMock.setItem).toHaveBeenCalledWith('madrona.active_org_id', 'org-1');
      });

      it('restores active organization from localStorage if auth has no active org', async () => {
        mockAuthContext.user!.active_organization_id = null;
        localStorageMock.getItem.mockReturnValue('org-2');

        render(
          <OrgProvider>
            <OrgConsumer />
          </OrgProvider>
        );

        await waitFor(() => {
          expect(screen.getByTestId('active-org-id')).toHaveTextContent('org-2');
        });
      });

      it('defaults to first organization if no saved org', async () => {
        mockAuthContext.user!.active_organization_id = null;
        localStorageMock.getItem.mockReturnValue(null);

        render(
          <OrgProvider>
            <OrgConsumer />
          </OrgProvider>
        );

        await waitFor(() => {
          expect(screen.getByTestId('active-org-id')).toHaveTextContent('org-1');
        });
      });

      it('handles no user (unauthenticated)', async () => {
        mockAuthContext.user = null as any;

        render(
          <OrgProvider>
            <OrgConsumer />
          </OrgProvider>
        );

        await waitFor(() => {
          expect(screen.getByTestId('loading')).toHaveTextContent('false');
        });

        expect(screen.getByTestId('org-count')).toHaveTextContent('0');
        expect(screen.getByTestId('active-org-id')).toHaveTextContent('none');
      });
    });

    describe('setActiveOrganizationId', () => {
      it('updates active organization', async () => {
        render(
          <OrgProvider>
            <OrgConsumer />
          </OrgProvider>
        );

        await waitFor(() => {
          expect(screen.getByTestId('active-org-id')).toHaveTextContent('org-1');
        });

        await act(async () => {
          screen.getByText('Switch to Org 2').click();
        });

        await waitFor(() => {
          expect(screen.getByTestId('active-org-id')).toHaveTextContent('org-2');
        });
      });

      it('saves to localStorage when switching', async () => {
        render(
          <OrgProvider>
            <OrgConsumer />
          </OrgProvider>
        );

        await waitFor(() => {
          expect(screen.getByTestId('active-org-id')).toHaveTextContent('org-1');
        });

        localStorageMock.setItem.mockClear();

        await act(async () => {
          screen.getByText('Switch to Org 2').click();
        });

        expect(localStorageMock.setItem).toHaveBeenCalledWith('madrona.active_org_id', 'org-2');
      });

      it('calls auth setActiveOrganization', async () => {
        render(
          <OrgProvider>
            <OrgConsumer />
          </OrgProvider>
        );

        await waitFor(() => {
          expect(screen.getByTestId('active-org-id')).toHaveTextContent('org-1');
        });

        await act(async () => {
          screen.getByText('Switch to Org 2').click();
        });

        expect(mockSetActiveOrganization).toHaveBeenCalledWith('org-2');
      });
    });

    describe('activeOrganization', () => {
      it('returns null when no active org', async () => {
        mockAuthContext.user = null as any;

        render(
          <OrgProvider>
            <OrgConsumer />
          </OrgProvider>
        );

        await waitFor(() => {
          expect(screen.getByTestId('loading')).toHaveTextContent('false');
        });

        expect(screen.getByTestId('active-org-name')).toHaveTextContent('none');
      });

      it('returns organization object for active org', async () => {
        render(
          <OrgProvider>
            <OrgConsumer />
          </OrgProvider>
        );

        await waitFor(() => {
          expect(screen.getByTestId('active-org-name')).toHaveTextContent('Test Org');
        });
      });
    });

    describe('loading state', () => {
      it('shows loading while auth is loading', async () => {
        mockAuthContext.isLoading = true;

        render(
          <OrgProvider>
            <OrgConsumer />
          </OrgProvider>
        );

        // Should still be loading because auth is loading
        expect(screen.getByTestId('loading')).toHaveTextContent('true');
      });
    });
  });
});
