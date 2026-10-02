import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ShipmentsPage from '../../pages/collections/ShipmentsPage';
import * as apiClient from '../../lib/apiClient';

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
}));

const mockApiFetch = vi.mocked(apiClient.apiFetch);

function renderPage(orgId = 'org-1') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/collections/shipments`]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/shipments"
            element={<ShipmentsPage />}
          />
          <Route
            path="/organizations/:orgId/collections/shipments/create"
            element={<div>Create Shipment</div>}
          />
          <Route
            path="/organizations/:orgId/collections/shipments/:id"
            element={<div>Shipment Detail</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const emptyResponse = {
  items: [],
  summary: { total: 0, in_transit: 0, delayed: 0, completed: 0 },
  total: 0,
};

describe('ShipmentsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders heading', async () => {
    mockApiFetch.mockResolvedValue(emptyResponse as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Shipments' })).toBeInTheDocument();
    });
  });

  it('shows first-time empty state when no shipments', async () => {
    mockApiFetch.mockResolvedValue(emptyResponse as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'No shipments yet.' })).toBeInTheDocument();
    });
  });

  it('renders shipment row with key fields', async () => {
    mockApiFetch.mockResolvedValue({
      items: [
        {
          shipment_id: 's-1',
          shipment_number: 'SHP-2024-001',
          shipment_type: 'outgoing',
          shipment_type_label: 'Outgoing',
          direction: 'out',
          direction_label: 'Outgoing',
          purpose: 'loan',
          purpose_label: 'Loan',
          status: 'in_transit',
          status_label: 'In Transit',
          ship_from_address: null,
          ship_to_address: null,
          estimated_dispatch_date: '2024-06-01',
          actual_dispatch_date: null,
          item_count: 5,
          created_at: '2024-05-01T00:00:00Z',
        },
      ],
      summary: { total: 1, in_transit: 1, delayed: 0, completed: 0 },
      total: 1,
    } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('SHP-2024-001')).toBeInTheDocument();
    });
    // "In Transit" appears in stat card too; assert at least one is present
    expect(screen.getAllByText('In Transit').length).toBeGreaterThanOrEqual(1);
  });

  it('shows error state on failure', async () => {
    mockApiFetch.mockRejectedValue(new Error('Backend down'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/error loading shipments/i)).toBeInTheDocument();
    });
  });

  it('renders new shipment link', async () => {
    mockApiFetch.mockResolvedValue(emptyResponse as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /new shipment/i })).toBeInTheDocument();
    });
  });

  it('passes status filter into URL when changed', async () => {
    mockApiFetch.mockResolvedValue(emptyResponse as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Shipments' })).toBeInTheDocument();
    });

    const statusSelect = screen.getByDisplayValue('All Statuses');
    fireEvent.change(statusSelect, { target: { value: 'in_transit' } });

    await waitFor(() => {
      const lastCallUrl = mockApiFetch.mock.calls[mockApiFetch.mock.calls.length - 1]?.[0];
      expect(lastCallUrl).toContain('status=in_transit');
    });
  });
});
