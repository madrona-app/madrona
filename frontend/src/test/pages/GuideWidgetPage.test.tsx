import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import GuideWidgetPage from '../../pages/guide/GuideWidgetPage';
import * as useOrganizationHook from '../../contexts/useOrganization';
import * as guideWidgetApi from '../../lib/api/guideWidget';

vi.mock('../../contexts/useOrganization', () => ({
  useOrganization: vi.fn(),
}));

vi.mock('../../lib/api/guideWidget', () => ({
  getWidgetSettings: vi.fn(),
  updateWidgetSettings: vi.fn(),
}));

const mockUseOrganization = vi.mocked(useOrganizationHook.useOrganization);
const mockGetSettings = vi.mocked(guideWidgetApi.getWidgetSettings);
const mockUpdateSettings = vi.mocked(guideWidgetApi.updateWidgetSettings);

const defaultSettings = {
  enabled: false,
  welcome_message: null,
  tier: 'core',
  max_widget_queries: 1000,
  widget_queries_this_month: 250,
};

function renderWidgetPage(slug: string | null = 'museum-of-art') {
  mockUseOrganization.mockReturnValue({
    activeOrganization: slug
      ? { organization_id: 'org-1', organization_slug: slug, name: 'Museum of Art' }
      : null,
    activeOrganizationId: 'org-1',
  } as ReturnType<typeof useOrganizationHook.useOrganization>);

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <GuideWidgetPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('GuideWidgetPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettings.mockResolvedValue(defaultSettings);
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    // The script host is deployment configuration; these tests model a
    // deployment that has configured one.
    vi.stubEnv('VITE_GUIDE_WIDGET_URL', 'https://widget.museum.example/widget.js');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders the page heading', () => {
    renderWidgetPage();
    expect(screen.getByRole('heading', { name: 'Widget & Embed' })).toBeInTheDocument();
  });

  it('shows embed code containing the org slug', () => {
    renderWidgetPage();
    expect(screen.getByText(/data-org="museum-of-art"/)).toBeInTheDocument();
  });

  it('points the embed code at the configured script, not a fixed host', () => {
    renderWidgetPage();
    expect(
      screen.getByText(/src="https:\/\/widget\.museum\.example\/widget\.js"/),
    ).toBeInTheDocument();
  });

  it('offers no embed code when no widget script is configured', () => {
    // Handing out a snippet with a guessed host would embed someone else's
    // server in a museum's website.
    vi.stubEnv('VITE_GUIDE_WIDGET_URL', '');
    renderWidgetPage();
    expect(screen.queryByText(/<script/)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/copy to clipboard/i)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/VITE_GUIDE_WIDGET_URL/);
  });

  it('falls back to placeholder slug when organization missing', () => {
    renderWidgetPage(null);
    expect(screen.getByText(/data-org="your-museum"/)).toBeInTheDocument();
  });

  it('renders How it works section with steps', () => {
    renderWidgetPage();
    expect(screen.getByRole('heading', { name: 'How it works' })).toBeInTheDocument();
    expect(screen.getByText(/visitors see a chat button/i)).toBeInTheDocument();
  });

  it('copies embed code to clipboard on copy button click', () => {
    renderWidgetPage();
    const copyBtn = screen.getByTitle(/copy to clipboard/i);
    fireEvent.click(copyBtn);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('data-org="museum-of-art"')
    );
  });

  it('loads settings and shows the usage meter', async () => {
    renderWidgetPage();
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: /enable visitor widget/i })).toBeInTheDocument();
    });
    expect(screen.getByText('250 / 1,000')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });

  it('unmetered cap renders without progress bar', async () => {
    mockGetSettings.mockResolvedValue({ ...defaultSettings, max_widget_queries: null });
    renderWidgetPage();
    await waitFor(() => {
      expect(screen.getByText(/unmetered/)).toBeInTheDocument();
    });
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('toggling and saving calls the update API', async () => {
    mockUpdateSettings.mockResolvedValue({ ...defaultSettings, enabled: true });
    renderWidgetPage();
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: /enable visitor widget/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('switch', { name: /enable visitor widget/i }));
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => {
      expect(mockUpdateSettings).toHaveBeenCalledWith({ enabled: true, welcome_message: null });
    });
  });

  it('cap reached shows the limit warning', async () => {
    mockGetSettings.mockResolvedValue({
      ...defaultSettings,
      widget_queries_this_month: 1000,
    });
    renderWidgetPage();
    await waitFor(() => {
      expect(screen.getByText(/limit reached/i)).toBeInTheDocument();
    });
  });
});
