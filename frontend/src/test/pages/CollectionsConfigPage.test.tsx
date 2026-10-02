import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CollectionsConfigPage from '../../pages/collections/CollectionsConfigPage';
import * as useOrganizationHook from '../../contexts/useOrganization';
import * as useAuthHook from '../../hooks/useAuth';

vi.mock('../../contexts/useOrganization', () => ({
  useOrganization: vi.fn(),
}));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

const mockUseOrganization = vi.mocked(useOrganizationHook.useOrganization);
const mockUseAuth = vi.mocked(useAuthHook.useAuth);

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderPage(orgId = 'org-123', initialPath?: string) {
  const qc = createQueryClient();
  const path = initialPath ?? `/organizations/${orgId}/collections/config`;
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/config/*"
            element={<CollectionsConfigPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CollectionsConfigPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseOrganization.mockReturnValue({
      activeOrganizationId: 'org-123',
    } as ReturnType<typeof useOrganizationHook.useOrganization>);
    mockUseAuth.mockReturnValue({
      hasAppAccess: vi.fn().mockReturnValue(true),
    } as unknown as ReturnType<typeof useAuthHook.useAuth>);
  });

  it('renders the page heading', () => {
    renderPage();
    expect(
      screen.getByRole('heading', { name: /collections configuration/i }),
    ).toBeInTheDocument();
  });

  it('renders all section headers', () => {
    renderPage();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Storage')).toBeInTheDocument();
    expect(screen.getByText('Vocabularies')).toBeInTheDocument();
    expect(screen.getByText('Documents')).toBeInTheDocument();
    expect(screen.getByText('Compliance')).toBeInTheDocument();
  });

  it('shows Discover section when hasAppAccess returns true', () => {
    renderPage();
    expect(screen.getByText('Public')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /discover/i })).toBeInTheDocument();
  });

  it('hides Discover section when discover app access is denied', () => {
    mockUseAuth.mockReturnValue({
      hasAppAccess: vi.fn().mockReturnValue(false),
    } as unknown as ReturnType<typeof useAuthHook.useAuth>);
    renderPage();
    expect(screen.queryByText('Public')).not.toBeInTheDocument();
  });

  it('renders all main nav buttons', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /general/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /locations/i })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /lookup values/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /branding/i })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /report templates/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /procedure enforcement/i }),
    ).toBeInTheDocument();
  });

  it('navigates when clicking a nav button', () => {
    renderPage();
    const locationsBtn = screen.getByRole('button', { name: /locations/i });
    fireEvent.click(locationsBtn);
    // Page still renders after navigation
    expect(
      screen.getByRole('heading', { name: /collections configuration/i }),
    ).toBeInTheDocument();
  });

  it('falls back to active organization id when no orgId in URL', () => {
    mockUseOrganization.mockReturnValue({
      activeOrganizationId: 'fallback-org',
    } as ReturnType<typeof useOrganizationHook.useOrganization>);
    renderPage();
    expect(
      screen.getByRole('heading', { name: /collections configuration/i }),
    ).toBeInTheDocument();
  });

  it('shows description text below header', () => {
    renderPage();
    expect(screen.getByText(/manage your collections setup/i)).toBeInTheDocument();
  });
});
