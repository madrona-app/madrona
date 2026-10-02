import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MyDownloadRequestsPage from '../../../pages/media/MyDownloadRequestsPage';
import * as api from '../../../lib/api';

vi.mock('../../../lib/api', () => ({
  listMyDownloadRequests: vi.fn(),
}));

const mockListMyDownloadRequests = vi.mocked(api.listMyDownloadRequests);

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
      <MemoryRouter initialEntries={[`/organizations/${orgId}/media/my-requests`]}>
        <Routes>
          <Route
            path="/organizations/:orgId/media/my-requests"
            element={<MyDownloadRequestsPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const baseRequest = {
  request_id: 'req-1',
  request_number: 'DR-2025-1000',
  requester_name: 'Me',
  requester_email: 'me@example.com',
  intended_use: 'Personal review',
  purpose: 'editorial',
  status: 'submitted',
  derivative_type_requested: 'web',
  item_count: 2,
  created_at: '2025-01-15T10:00:00Z',
};

describe('MyDownloadRequestsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it('renders the page heading', async () => {
    mockListMyDownloadRequests.mockResolvedValue({ items: [], total: 0 } as any);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /my download requests/i })
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/track your media download requests/i)).toBeInTheDocument();
  });

  it('shows loading state', () => {
    mockListMyDownloadRequests.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByText(/loading your requests/i)).toBeInTheDocument();
  });

  it('shows error state', async () => {
    mockListMyDownloadRequests.mockRejectedValue(new Error('API down'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/failed to load requests/i)).toBeInTheDocument();
    });
  });

  it('shows empty state when no requests', async () => {
    mockListMyDownloadRequests.mockResolvedValue({ items: [], total: 0 } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/no download requests yet/i)).toBeInTheDocument();
    });
    expect(
      screen.getByText(/select images from a collection/i)
    ).toBeInTheDocument();
  });

  it('groups pending requests under Pending', async () => {
    mockListMyDownloadRequests.mockResolvedValue({
      items: [
        { ...baseRequest, status: 'submitted' },
        { ...baseRequest, request_id: 'req-2', request_number: 'DR-2025-1001', status: 'review' },
      ],
      total: 2,
    } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('DR-2025-1000')).toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: /pending/i })).toBeInTheDocument();
    expect(screen.getByText('DR-2025-1001')).toBeInTheDocument();
  });

  it('groups fulfilled requests under Ready to Download', async () => {
    mockListMyDownloadRequests.mockResolvedValue({
      items: [
        {
          ...baseRequest,
          status: 'fulfilled',
          download_token: 'tok-abc-123',
          download_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        },
      ],
      total: 1,
    } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /ready to download/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /copy token/i })).toBeInTheDocument();
  });

  it('shows expired notice for fulfilled requests past expiry', async () => {
    mockListMyDownloadRequests.mockResolvedValue({
      items: [
        {
          ...baseRequest,
          status: 'fulfilled',
          download_token: 'tok-old',
          download_expires_at: new Date(Date.now() - 86_400_000).toISOString(),
        },
      ],
      total: 1,
    } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/download link expired on/i)).toBeInTheDocument();
    });
  });

  it('groups closed requests under Closed', async () => {
    mockListMyDownloadRequests.mockResolvedValue({
      items: [
        { ...baseRequest, status: 'denied', request_number: 'DR-2025-2000' },
        { ...baseRequest, request_id: 'req-3', status: 'cancelled', request_number: 'DR-2025-2001' },
      ],
      total: 2,
    } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /closed/i })).toBeInTheDocument();
    });
    expect(screen.getByText('DR-2025-2000')).toBeInTheDocument();
    expect(screen.getByText('DR-2025-2001')).toBeInTheDocument();
  });

  it('copies download token to clipboard when button clicked', async () => {
    mockListMyDownloadRequests.mockResolvedValue({
      items: [
        {
          ...baseRequest,
          status: 'fulfilled',
          download_token: 'tok-xyz-789',
          download_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        },
      ],
      total: 1,
    } as any);
    renderPage();
    const copyBtn = await screen.findByRole('button', { name: /copy token/i });
    fireEvent.click(copyBtn);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('tok-xyz-789');
    await waitFor(() => {
      expect(screen.getByText(/copied!/i)).toBeInTheDocument();
    });
  });
});
