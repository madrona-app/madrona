import React from 'react';
import { vi } from 'vitest';
import { render, type RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext, type AuthContextValue, type User } from '../../contexts/AuthContext';

/**
 * Mock WebSocket context value for testing
 */
interface MockWebSocketContextValue {
  isConnected: boolean;
  subscribeToRun: (runId: string) => void;
  unsubscribeFromRun: (runId: string) => void;
  subscribeToPipeline: (pipelineId: string) => void;
  unsubscribeFromPipeline: (pipelineId: string) => void;
  on: <T>(event: string, handler: (data: T) => void) => () => void;
  off: (event: string, handler: (data: unknown) => void) => void;
}

/**
 * Create a mock WebSocket context for testing
 */
export function createMockWebSocketContext(
  overrides: Partial<MockWebSocketContextValue> = {}
): MockWebSocketContextValue {
  return {
    isConnected: false,
    subscribeToRun: vi.fn(),
    unsubscribeFromRun: vi.fn(),
    subscribeToPipeline: vi.fn(),
    unsubscribeFromPipeline: vi.fn(),
    on: vi.fn(() => vi.fn()),
    off: vi.fn(),
    ...overrides,
  };
}

/**
 * Create a mock user for testing
 */
export function createMockUser(overrides: Partial<User> = {}): User {
  return {
    user_id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    timezone: 'America/New_York',
    active_organization_id: 'org-1',
    permissions: ['data.view', 'runs.view'],
    role_label: 'Viewer',
    is_platform_admin: false,
    applications: [],
    organizations: [
      {
        organization_id: 'org-1',
        name: 'Test Org',
        slug: 'test-org',
        timezone: 'America/New_York',
        role: 'member',
        role_label: 'Viewer',
      },
    ],
    ...overrides,
  };
}

/**
 * Create a mock admin user for testing
 */
export function createMockAdminUser(overrides: Partial<User> = {}): User {
  return createMockUser({
    permissions: [
      'data.view',
      'data.export',
      'data.manage',
      'runs.view',
      'runs.execute',
      'pipelines.view',
      'pipelines.manage',
      'settings.view',
      'settings.manage',
    ],
    role_label: 'Admin',
    is_platform_admin: false,
    applications: [],
    organizations: [
      {
        organization_id: 'org-1',
        name: 'Test Org',
        slug: 'test-org',
        timezone: 'America/New_York',
        role: 'admin',
        role_label: 'Admin',
      },
    ],
    ...overrides,
  });
}

/**
 * Create a mock auth context for testing
 */
export function createMockAuthContext(
  overrides: Partial<AuthContextValue> = {}
): AuthContextValue {
  const user = overrides.user !== undefined ? overrides.user : createMockUser();
  return {
    user,
    memberships: user?.organizations ?? [],
    applications: user?.applications ?? [],
    activeOrganizationId: user?.active_organization_id ?? null,
    isPlatformAdmin: user?.is_platform_admin ?? false,
    isLoading: false,
    isAuthenticated: !!user,
    error: null,
    hasAppAccess: vi.fn().mockReturnValue(true),
    refreshMe: vi.fn().mockResolvedValue(undefined),
    setActiveOrganization: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/**
 * Options for renderWithProviders
 */
interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  /** Initial route for MemoryRouter */
  initialRoute?: string;
  /** Auth context overrides */
  authContext?: Partial<AuthContextValue>;
  /** Pre-configured query client (optional) */
  queryClient?: QueryClient;
}

/**
 * Render component with all common providers for testing.
 * Includes QueryClientProvider, AuthContext, and MemoryRouter.
 */
export function renderWithProviders(
  ui: React.ReactElement,
  options: RenderWithProvidersOptions = {}
) {
  const {
    initialRoute = '/',
    authContext = {},
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
        mutations: {
          retry: false,
        },
      },
    }),
    ...renderOptions
  } = options;

  const mockAuthContext = createMockAuthContext(authContext);

  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={mockAuthContext}>
          <MemoryRouter initialEntries={[initialRoute]}>
            {children}
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>
    );
  }

  return {
    ...render(ui, { wrapper: Wrapper, ...renderOptions }),
    queryClient,
    authContext: mockAuthContext,
  };
}

/**
 * Create a QueryClient configured for testing
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
