import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MyLightboxSharesPage from '../../../pages/media/MyLightboxSharesPage';
import * as api from '../../../lib/api';

vi.mock('../../../lib/api', () => ({
  listMyPublicShares: vi.fn(),
  rotatePublicShareToken: vi.fn(),
  disablePublicSharing: vi.fn(),
}));

const mockListMyPublicShares = vi.mocked(api.listMyPublicShares);
const mockRotatePublicShareToken = vi.mocked(api.rotatePublicShareToken);
const mockDisablePublicSharing = vi.mocked(api.disablePublicSharing);

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderPage(orgId = 'org-123') {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/media/my-shares`]}>
        <Routes>
          <Route
            path="/organizations/:orgId/media/my-shares"
            element={<MyLightboxSharesPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('MyLightboxSharesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clipboard + confirm
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('shows loading state initially', () => {
    mockListMyPublicShares.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('shows error state on failed fetch', async () => {
    mockListMyPublicShares.mockRejectedValue(new Error('Boom'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/failed to load shares/i)).toBeInTheDocument();
      expect(screen.getByText(/boom/i)).toBeInTheDocument();
    });
  });

  it('renders empty state when no shares exist', async () => {
    mockListMyPublicShares.mockResolvedValue({ shares: [] } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/haven't created any public share links/i)).toBeInTheDocument();
    });
  });

  it('renders a row for each share link', async () => {
    mockListMyPublicShares.mockResolvedValue({
      shares: [
        {
          collection_id: 'col-1',
          name: 'Press Kit',
          item_count: 4,
          public_share_token: 'tok-abc',
          public_share_download_level: 'derivatives',
          public_share_has_password: true,
          public_share_expires_at: null,
          views: 10,
          downloads: 2,
          failed_auth: 0,
          last_accessed_at: null,
        },
        {
          collection_id: 'col-2',
          name: 'Board Assets',
          item_count: 1,
          public_share_token: 'tok-xyz',
          public_share_download_level: 'originals',
          public_share_has_password: false,
          public_share_expires_at: null,
          views: 0,
          downloads: 0,
          failed_auth: 0,
          last_accessed_at: null,
        },
      ],
    } as any);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Press Kit')).toBeInTheDocument();
    });
    expect(screen.getByText('Board Assets')).toBeInTheDocument();
    expect(screen.getByText('4 items')).toBeInTheDocument();
    expect(screen.getByText(/10 views/i)).toBeInTheDocument();
    expect(screen.getByText(/derivatives/i)).toBeInTheDocument();
    expect(screen.getByText(/originals/i)).toBeInTheDocument();
    expect(screen.getByText(/password/i)).toBeInTheDocument();
  });

  it('marks expired shares', async () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    mockListMyPublicShares.mockResolvedValue({
      shares: [
        {
          collection_id: 'col-1',
          name: 'Old Share',
          item_count: 2,
          public_share_token: 'tok-old',
          public_share_download_level: 'none',
          public_share_has_password: false,
          public_share_expires_at: past,
          views: 5,
          downloads: 1,
          failed_auth: 0,
          last_accessed_at: null,
        },
      ],
    } as any);

    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Old Share')).toBeInTheDocument();
    });
    expect(screen.getByText(/expired/i)).toBeInTheDocument();
  });

  it('copies share link to clipboard', async () => {
    mockListMyPublicShares.mockResolvedValue({
      shares: [
        {
          collection_id: 'col-1',
          name: 'Press Kit',
          item_count: 4,
          public_share_token: 'tok-abc',
          public_share_download_level: 'derivatives',
          public_share_has_password: false,
          public_share_expires_at: null,
          views: 0,
          downloads: 0,
          failed_auth: 0,
          last_accessed_at: null,
        },
      ],
    } as any);

    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Press Kit')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText(/copy share link for press kit/i));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('/share/collection/tok-abc')
    );
  });

  it('rotates token on confirm', async () => {
    mockListMyPublicShares.mockResolvedValue({
      shares: [
        {
          collection_id: 'col-1',
          name: 'Press Kit',
          item_count: 4,
          public_share_token: 'tok-abc',
          public_share_download_level: 'derivatives',
          public_share_has_password: false,
          public_share_expires_at: null,
          views: 0,
          downloads: 0,
          failed_auth: 0,
          last_accessed_at: null,
        },
      ],
    } as any);
    mockRotatePublicShareToken.mockResolvedValue({} as any);

    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Press Kit')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText(/rotate token for press kit/i));
    await waitFor(() => {
      expect(mockRotatePublicShareToken).toHaveBeenCalledWith('org-123', 'col-1');
    });
  });

  it('revokes share on confirm', async () => {
    mockListMyPublicShares.mockResolvedValue({
      shares: [
        {
          collection_id: 'col-1',
          name: 'Press Kit',
          item_count: 4,
          public_share_token: 'tok-abc',
          public_share_download_level: 'derivatives',
          public_share_has_password: false,
          public_share_expires_at: null,
          views: 0,
          downloads: 0,
          failed_auth: 0,
          last_accessed_at: null,
        },
      ],
    } as any);
    mockDisablePublicSharing.mockResolvedValue({} as any);

    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Press Kit')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText(/revoke share for press kit/i));
    await waitFor(() => {
      expect(mockDisablePublicSharing).toHaveBeenCalledWith('org-123', 'col-1');
    });
  });

  it('renders page heading', async () => {
    mockListMyPublicShares.mockResolvedValue({ shares: [] } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /my shared links/i })).toBeInTheDocument();
    });
  });
});
