import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DownloadRequestsPage from '../../../pages/media/DownloadRequestsPage';
import * as api from '../../../lib/api';

vi.mock('../../../lib/api', () => ({
  listDownloadRequests: vi.fn(),
}));

const mockListDownloadRequests = vi.mocked(api.listDownloadRequests);

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderPage(orgId: string | undefined = 'org-123') {
  const queryClient = createTestQueryClient();
  const path = orgId
    ? `/organizations/${orgId}/media/download-requests`
    : '/no-org/download-requests';
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/organizations/:orgId/media/download-requests"
            element={<DownloadRequestsPage />}
          />
          <Route path="/no-org/download-requests" element={<DownloadRequestsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const sampleRequest = {
  request_id: 'req-1',
  request_number: 'DR-2025-0001',
  requester_name: 'Alice Doe',
  requester_email: 'alice@example.com',
  requester_institution: 'University of Examples',
  intended_use: 'Editorial publication',
  purpose: 'editorial',
  status: 'submitted',
  derivative_type_requested: 'web',
  item_count: 4,
  created_at: '2025-01-15T10:00:00Z',
};

describe('DownloadRequestsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the page heading and description', async () => {
    mockListDownloadRequests.mockResolvedValue({ items: [], total: 0 } as any);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /download requests/i })
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText(/review and manage media download requests/i)
    ).toBeInTheDocument();
  });

  it('shows loading state initially', () => {
    mockListDownloadRequests.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByRole('heading', { name: /download requests/i })).toBeInTheDocument();
    // Search input always renders
    expect(
      screen.getByPlaceholderText(/search by request number/i)
    ).toBeInTheDocument();
  });

  it('shows error message on API failure', async () => {
    mockListDownloadRequests.mockRejectedValue(new Error('API down'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/failed to load requests/i)).toBeInTheDocument();
    });
  });

  it('shows empty state when no requests exist', async () => {
    mockListDownloadRequests.mockResolvedValue({ items: [], total: 0 } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/no download requests yet/i)).toBeInTheDocument();
    });
  });

  it('renders rows for each request', async () => {
    mockListDownloadRequests.mockResolvedValue({
      items: [sampleRequest],
      total: 1,
    } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('DR-2025-0001')).toBeInTheDocument();
    });
    expect(screen.getByText('Alice Doe')).toBeInTheDocument();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    expect(screen.getByText('University of Examples')).toBeInTheDocument();
    expect(screen.getByText('4 items')).toBeInTheDocument();
  });

  it('filters requests by status when select changes', async () => {
    mockListDownloadRequests.mockResolvedValue({ items: [], total: 0 } as any);
    renderPage();
    await waitFor(() => {
      expect(mockListDownloadRequests).toHaveBeenCalledWith(
        'org-123',
        expect.objectContaining({ limit: 100 })
      );
    });
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'approved' } });
    await waitFor(() => {
      expect(mockListDownloadRequests).toHaveBeenCalledWith(
        'org-123',
        expect.objectContaining({ status: ['approved'] })
      );
    });
  });

  it('client-side filters by search query', async () => {
    mockListDownloadRequests.mockResolvedValue({
      items: [
        sampleRequest,
        {
          ...sampleRequest,
          request_id: 'req-2',
          request_number: 'DR-2025-0002',
          requester_name: 'Bob Other',
          requester_email: 'bob@example.com',
        },
      ],
      total: 2,
    } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('DR-2025-0001')).toBeInTheDocument();
    });
    expect(screen.getByText('DR-2025-0002')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/search by request number/i), {
      target: { value: 'Alice' },
    });

    expect(screen.getByText('DR-2025-0001')).toBeInTheDocument();
    expect(screen.queryByText('DR-2025-0002')).not.toBeInTheDocument();
  });

  it('shows "no results" filter message when search matches nothing', async () => {
    mockListDownloadRequests.mockResolvedValue({
      items: [sampleRequest],
      total: 1,
    } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('DR-2025-0001')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByPlaceholderText(/search by request number/i), {
      target: { value: 'no-such-thing' },
    });
    expect(
      screen.getByText(/no requests match your filters/i)
    ).toBeInTheDocument();
  });

  it('row links to the request workspace', async () => {
    mockListDownloadRequests.mockResolvedValue({
      items: [sampleRequest],
      total: 1,
    } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('DR-2025-0001')).toBeInTheDocument();
    });
    const link = screen.getByText('DR-2025-0001').closest('a');
    expect(link).toHaveAttribute(
      'href',
      '/organizations/org-123/media/download-requests/req-1'
    );
  });

  it('shows footer count when results exist', async () => {
    mockListDownloadRequests.mockResolvedValue({
      items: [sampleRequest],
      total: 1,
    } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/showing 1 of 1 requests/i)).toBeInTheDocument();
    });
  });
});
