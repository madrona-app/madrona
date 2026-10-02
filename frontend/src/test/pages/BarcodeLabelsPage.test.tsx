import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BarcodeLabelsPage from '../../pages/collections/BarcodeLabelsPage';
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
      <MemoryRouter initialEntries={[`/organizations/${orgId}/collections/barcodes/labels`]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/barcodes/labels"
            element={<BarcodeLabelsPage />}
          />
          <Route
            path="/organizations/:orgId/collections/barcodes/labels/create"
            element={<div>Create Label</div>}
          />
          <Route
            path="/organizations/:orgId/collections/barcodes/labels/:id"
            element={<div>Label Detail</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const emptyResponse = {
  items: [],
  summary: { total_active: 0, printed: 0, unprinted: 0, void: 0 },
  total: 0,
};

describe('BarcodeLabelsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders heading', async () => {
    mockApiFetch.mockResolvedValue(emptyResponse as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Barcode Labels' })).toBeInTheDocument();
    });
  });

  it('shows first-time empty state', async () => {
    mockApiFetch.mockResolvedValue(emptyResponse as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/no barcode labels yet/i)).toBeInTheDocument();
    });
  });

  it('renders a label row', async () => {
    mockApiFetch.mockResolvedValue({
      items: [
        {
          label_id: 'l-1',
          barcode_value: 'BC-001',
          entity_type: 'collection_object',
          entity_id: 'obj-1',
          entity_summary: { name: 'Bronze Statue' },
          format: 'CODE128',
          status: 'active',
          print_count: 1,
          created_at: '2024-04-01T00:00:00Z',
        },
      ],
      summary: { total_active: 1, printed: 1, unprinted: 0, void: 0 },
      total: 1,
    } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('BC-001')).toBeInTheDocument();
    });
    expect(screen.getByText('Bronze Statue')).toBeInTheDocument();
  });

  it('shows error state on failure', async () => {
    mockApiFetch.mockRejectedValue(new Error('Server fault'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/error loading barcode labels/i)).toBeInTheDocument();
    });
  });

  it('renders generate labels CTA', async () => {
    mockApiFetch.mockResolvedValue(emptyResponse as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /generate labels/i })).toBeInTheDocument();
    });
  });

  it('updates query string when entity_type filter changes', async () => {
    mockApiFetch.mockResolvedValue(emptyResponse as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Barcode Labels' })).toBeInTheDocument();
    });

    const entitySelect = screen.getByDisplayValue('All Entity Types');
    fireEvent.change(entitySelect, { target: { value: 'crate' } });

    await waitFor(() => {
      const lastCall = mockApiFetch.mock.calls[mockApiFetch.mock.calls.length - 1]?.[0];
      expect(lastCall).toContain('entity_type=crate');
    });
  });
});
