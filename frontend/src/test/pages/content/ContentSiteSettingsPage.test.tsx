import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ContentSiteSettingsPage from '../../../pages/content/ContentSiteSettingsPage';
import * as discoverApi from '../../../lib/api/discover';
import * as contentApi from '../../../lib/api/content';
import * as useAuthHook from '../../../hooks/useAuth';

vi.mock('../../../lib/api/discover', () => ({
  getDiscoverConfig: vi.fn(),
  updateDiscoverConfig: vi.fn(),
}));

vi.mock('../../../lib/api/content', () => ({
  listPages: vi.fn(),
  listRedirects: vi.fn(),
  createRedirect: vi.fn(),
  updateRedirect: vi.fn(),
  deleteRedirect: vi.fn(),
  // MenuBuilder calls these:
  getMenu: vi.fn(),
  saveMenu: vi.fn(),
  getPageTree: vi.fn(),
  listCategories: vi.fn(),
}));

vi.mock('../../../hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../../components/content/MediaPickerModal', () => ({
  MediaPickerModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div role="dialog">picker</div> : null,
}));

vi.mock('../../../pages/content/components/MenuBuilder', () => ({
  MenuBuilder: ({ location }: { location: string }) => (
    <div data-testid={`menu-builder-${location}`} />
  ),
}));

const mockGetConfig = vi.mocked(discoverApi.getDiscoverConfig);
const mockListPages = vi.mocked(contentApi.listPages);
const mockListRedirects = vi.mocked(contentApi.listRedirects);
const mockUseAuth = vi.mocked(useAuthHook.useAuth);

function setupAuth() {
  mockUseAuth.mockReturnValue({
    memberships: [{ organization_id: 'org-1', slug: 'my-org', name: 'Test Org' }],
    applications: [{ key: 'discover', enabled: true, status: 'active' }],
    user: null,
    isLoading: false,
  } as unknown as ReturnType<typeof useAuthHook.useAuth>);
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/organizations/org-1/content/settings']}>
        <Routes>
          <Route
            path="/organizations/:orgId/content/settings"
            element={<ContentSiteSettingsPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ContentSiteSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth();
    mockListPages.mockResolvedValue({ items: [], total: 0 } as never);
    mockListRedirects.mockResolvedValue({ items: [] } as never);
  });

  it('shows loader while config is loading', () => {
    mockGetConfig.mockReturnValue(new Promise(() => {}) as never);
    renderPage();
    // MadronaLoader renders role="status" with aria-label "Loading"
    expect(screen.getByRole('status', { name: /Loading/i })).toBeInTheDocument();
  });

  it('renders the main heading and key sections after config loads', async () => {
    mockGetConfig.mockResolvedValue({
      primary_color: 'rgb(var(--color-forest))',
      accent_color: 'rgb(var(--color-copper))',
      footer_text: '',
      social_links: [],
    } as never);

    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Site Settings' }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText('Branding')).toBeInTheDocument();
    expect(screen.getByText('Public Site URL')).toBeInTheDocument();
    expect(screen.getByText('Homepage')).toBeInTheDocument();
  });

  it('shows the public URL based on the org slug', async () => {
    mockGetConfig.mockResolvedValue({} as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/\/c\/my-org/)).toBeInTheDocument();
    });
  });

  it('renders header and footer MenuBuilder placeholders', async () => {
    mockGetConfig.mockResolvedValue({} as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('menu-builder-header')).toBeInTheDocument();
    });
    expect(screen.getByTestId('menu-builder-footer')).toBeInTheDocument();
  });

  it('Save buttons are disabled until a field becomes dirty', async () => {
    mockGetConfig.mockResolvedValue({
      primary_color: '#000000',
    } as never);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Site Settings' }),
      ).toBeInTheDocument();
    });
    const saveBtns = screen.getAllByRole('button', { name: /^Save$/ });
    expect(saveBtns.length).toBeGreaterThan(0);
    saveBtns.forEach((btn) => expect(btn).toBeDisabled());
  });
});
