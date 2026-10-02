import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AcquisitionsPage from '../../pages/collections/AcquisitionsPage';
import * as api from '../../lib/api';

// These pages embed StartProcedure, which reads app access to hide
// itself when Guide is unavailable. useAuth throws without a provider.
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ hasAppAccess: () => true }),
}));

vi.mock('../../lib/api', () => ({
  getAcquisitions: vi.fn(),
}));

const mockGetAcquisitions = vi.mocked(api.getAcquisitions);

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderPage(orgId = 'org-123') {
  const qc = createQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/collections/acquisitions`]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/acquisitions"
            element={<AcquisitionsPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const sampleAcquisitions = {
  total: 3,
  items: [
    {
      acquisition_id: 'acq-1',
      acquisition_number: 'ACQ-2024-001',
      acquisition_method: 'gift',
      source_name: 'Jane Donor',
      acquisition_date: '2024-01-15',
      cost: 5000,
      cost_currency: 'USD',
      status: 'completed',
    },
    {
      acquisition_id: 'acq-2',
      acquisition_number: 'ACQ-2024-002',
      acquisition_method: 'purchase',
      source_name: 'Auction House',
      acquisition_date: '2024-02-20',
      cost: 12500,
      cost_currency: 'USD',
      status: 'pending_approval',
    },
    {
      acquisition_id: 'acq-3',
      acquisition_number: 'ACQ-2024-003',
      acquisition_method: 'bequest',
      status: 'proposed',
    },
  ],
};

describe('AcquisitionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('shows loading state on initial render', () => {
    mockGetAcquisitions.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(
      screen.queryByRole('heading', { name: /^acquisitions$/i }),
    ).not.toBeInTheDocument();
  });

  it('renders header and acquisition rows once data loads', async () => {
    mockGetAcquisitions.mockResolvedValue(sampleAcquisitions as any);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /^acquisitions$/i }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText('ACQ-2024-001')).toBeInTheDocument();
    expect(screen.getByText('ACQ-2024-002')).toBeInTheDocument();
    expect(screen.getByText('ACQ-2024-003')).toBeInTheDocument();
  });

  it('displays the correct total count', async () => {
    mockGetAcquisitions.mockResolvedValue(sampleAcquisitions as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('3 acquisitions')).toBeInTheDocument();
    });
  });

  it('shows "No acquisitions yet" empty state when total is 0', async () => {
    mockGetAcquisitions.mockResolvedValue({ total: 0, items: [] } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByText(/no acquisitions yet/i).length).toBeGreaterThan(0);
    });
  });

  it('renders error state when query fails', async () => {
    mockGetAcquisitions.mockRejectedValue(new Error('connection failed'));
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText(/error loading acquisitions: connection failed/i),
      ).toBeInTheDocument();
    });
  });

  it('shows new acquisition link', async () => {
    mockGetAcquisitions.mockResolvedValue(sampleAcquisitions as any);
    renderPage();
    await waitFor(() => {
      const links = screen.getAllByRole('link', { name: /new acquisition/i });
      expect(links[0]).toHaveAttribute(
        'href',
        '/organizations/org-123/collections/acquisitions/create',
      );
    });
  });

  it('updates status filter and triggers query', async () => {
    mockGetAcquisitions.mockResolvedValue(sampleAcquisitions as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('ACQ-2024-001')).toBeInTheDocument();
    });
    const statusSelect = screen.getAllByRole('combobox')[0];
    fireEvent.change(statusSelect, { target: { value: 'proposed' } });
    await waitFor(() => {
      expect(mockGetAcquisitions).toHaveBeenCalledWith(
        'org-123',
        expect.objectContaining({ status: 'proposed' }),
      );
    });
  });

  it('shows summary stats', async () => {
    mockGetAcquisitions.mockResolvedValue(sampleAcquisitions as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Total')).toBeInTheDocument();
    });
    expect(screen.getAllByText('Pending').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Completed').length).toBeGreaterThan(0);
    expect(screen.getByText('Total Value')).toBeInTheDocument();
  });

  it('typing in search updates input value', async () => {
    mockGetAcquisitions.mockResolvedValue(sampleAcquisitions as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/search acquisitions/i)).toBeInTheDocument();
    });
    const input = screen.getByPlaceholderText(/search acquisitions/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'gift' } });
    expect(input.value).toBe('gift');
  });
});
