import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CratesPage from '../../pages/collections/CratesPage';
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
      <MemoryRouter initialEntries={[`/organizations/${orgId}/collections/crates`]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/crates"
            element={<CratesPage />}
          />
          <Route
            path="/organizations/:orgId/collections/crates/create"
            element={<div>Create Crate</div>}
          />
          <Route
            path="/organizations/:orgId/collections/crates/:id"
            element={<div>Crate Detail</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('CratesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders heading', async () => {
    mockApiFetch.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Crates' })).toBeInTheDocument();
    });
  });

  it('shows first-time empty state', async () => {
    mockApiFetch.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'No crates yet.' })).toBeInTheDocument();
    });
  });

  it('renders a crate row', async () => {
    mockApiFetch.mockResolvedValue({
      items: [
        {
          crate_id: 'cr-1',
          crate_number: 'CRT-001',
          height_cm: 100,
          width_cm: 50,
          depth_cm: 30,
          condition: 'good',
          condition_label: 'Good',
          location: { name: 'Storage A' },
          climate_controlled: true,
          is_active: true,
        },
      ],
      total: 1,
    } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('CRT-001')).toBeInTheDocument();
    });
    expect(screen.getByText('Storage A')).toBeInTheDocument();
  });

  it('shows error state on failure', async () => {
    mockApiFetch.mockRejectedValue(new Error('Backend down'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/error loading crates/i)).toBeInTheDocument();
    });
  });

  it('renders new crate CTA', async () => {
    mockApiFetch.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /new crate/i })).toBeInTheDocument();
    });
  });

  it('passes active filter to URL when changed', async () => {
    mockApiFetch.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Crates' })).toBeInTheDocument();
    });

    const filterSelect = screen.getByDisplayValue('Active');
    fireEvent.change(filterSelect, { target: { value: 'all' } });

    await waitFor(() => {
      const lastCall = mockApiFetch.mock.calls[mockApiFetch.mock.calls.length - 1]?.[0];
      expect(lastCall).toContain('active=all');
    });
  });
});
