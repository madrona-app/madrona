import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BarcodeScansPage from '../../pages/collections/BarcodeScansPage';
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
      <MemoryRouter initialEntries={[`/organizations/${orgId}/collections/barcodes/scans`]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/barcodes/scans"
            element={<BarcodeScansPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('BarcodeScansPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders heading', async () => {
    mockApiFetch.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Barcode Scans' })).toBeInTheDocument();
    });
  });

  it('shows first-time empty state', async () => {
    mockApiFetch.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/no barcode scans yet/i)).toBeInTheDocument();
    });
  });

  it('renders a scan row', async () => {
    mockApiFetch.mockResolvedValue({
      items: [
        {
          scan_id: 's-1',
          barcode_value: 'BC-001',
          resolved_entity_type: 'collection_object',
          resolved_entity_type_label: 'Collection Object',
          resolved_entity_id: 'obj-1',
          action_type: 'verify',
          action_type_label: 'Verify',
          result_status: 'success',
          result_status_label: 'Success',
          device_name: 'Scanner A',
          scanned_at: '2024-04-01T12:00:00Z',
          scanned_by: 'user-1',
        },
      ],
      total: 1,
    } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('BC-001')).toBeInTheDocument();
    });
    expect(screen.getByText('Scanner A')).toBeInTheDocument();
    // "Success" appears as both <option> and result label
    expect(screen.getAllByText('Success').length).toBeGreaterThanOrEqual(1);
  });

  it('shows error state on failure', async () => {
    mockApiFetch.mockRejectedValue(new Error('Server crashed'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/error loading scan history/i)).toBeInTheDocument();
    });
  });

  it('updates query when result_status filter changes', async () => {
    mockApiFetch.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Barcode Scans' })).toBeInTheDocument();
    });

    const resultSelect = screen.getByDisplayValue('All Results');
    fireEvent.change(resultSelect, { target: { value: 'success' } });

    await waitFor(() => {
      const lastCall = mockApiFetch.mock.calls[mockApiFetch.mock.calls.length - 1]?.[0];
      expect(lastCall).toContain('result_status=success');
    });
  });
});
