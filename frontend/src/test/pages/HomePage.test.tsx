import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import HomePage from '../../pages/home/HomePage';
import * as useAuthHook from '../../hooks/useAuth';
import { WorkProvider } from '../../contexts/WorkContext';

vi.mock('../../hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../lib/navigationConfig', () => ({
  products: [
    { id: 'collections', label: 'Collections', icon: () => null },
    { id: 'bridge', label: 'Bridge', icon: () => null },
    { id: 'guide', label: 'Guide', icon: () => null },
  ],
}));

vi.mock('../../hooks/useActiveProduct', () => ({
  getProductLandingPath: (id: string, orgId: string) =>
    `/organizations/${orgId}/${id}`,
}));

const mockUseAuth = vi.mocked(useAuthHook.useAuth);

function renderHome(orgId = 'org-123', overrides: Partial<ReturnType<typeof useAuthHook.useAuth>> = {}) {
  mockUseAuth.mockReturnValue({
    user: {
      user_id: 'u-1',
      name: 'Alice Doe',
      email: 'a@example.com',
      organizations: [
        { organization_id: orgId, name: 'Test Org', slug: 'test-org' },
      ],
    },
    activeOrganizationId: orgId,
    applications: [
      { key: 'collections', enabled: true, status: 'active' },
      { key: 'bridge', enabled: true, status: 'active' },
    ],
    memberships: [],
    isLoading: false,
    ...overrides,
  } as unknown as ReturnType<typeof useAuthHook.useAuth>);

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <WorkProvider>
        <MemoryRouter initialEntries={[`/organizations/${orgId}/home`]}>
          <Routes>
            <Route path="/organizations/:orgId/home" element={<HomePage />} />
          </Routes>
        </MemoryRouter>
      </WorkProvider>
    </QueryClientProvider>
  );
}

describe('HomePage (V2 editorial dashboard)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders an editorial greeting with the user first name', () => {
    renderHome();
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toMatch(/Good (morning|afternoon|evening), Alice/);
  });

  it('falls back to greeting without a name when name is missing', () => {
    renderHome('org-123', {
      user: {
        user_id: 'u-1',
        name: '',
        email: 'a@example.com',
        organizations: [],
      } as never,
    });
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toMatch(/^Good (morning|afternoon|evening)\.?$/);
  });

  it('renders the V2 dashboard sections', () => {
    renderHome();
    // Attention queue shows its empty-state copy when there are no items
    expect(screen.getByText(/Nothing needs attention right now/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: "Today's pulse" })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'The workshop' })).toBeInTheDocument();
  });

  it('exposes the Guide hero with an accessible label', () => {
    renderHome();
    expect(screen.getByLabelText('Ask Guide')).toBeInTheDocument();
  });
});
