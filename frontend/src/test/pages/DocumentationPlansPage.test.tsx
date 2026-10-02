import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DocumentationPlansPage from '../../pages/collections/DocumentationPlansPage';
import * as api from '../../lib/api';

vi.mock('../../lib/api', () => ({
  getDocumentationPlans: vi.fn(),
}));

const mockGetDocumentationPlans = vi.mocked(api.getDocumentationPlans);

function renderPage(orgId = 'org-1') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/collections/documentation-plans`]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/documentation-plans"
            element={<DocumentationPlansPage />}
          />
          <Route
            path="/organizations/:orgId/collections/documentation-plans/create"
            element={<div>Create Plan</div>}
          />
          <Route
            path="/organizations/:orgId/collections/documentation-plans/:id"
            element={<div>Plan Detail</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('DocumentationPlansPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders heading', async () => {
    mockGetDocumentationPlans.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Documentation Plans' })).toBeInTheDocument();
    });
  });

  it('shows empty state when no plans', async () => {
    mockGetDocumentationPlans.mockResolvedValue({ items: [], total: 0 } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('No documentation plans found')).toBeInTheDocument();
    });
  });

  it('renders a plan row with title', async () => {
    mockGetDocumentationPlans.mockResolvedValue({
      items: [
        {
          plan_id: 'p-1',
          plan_number: 'DP-2024-001',
          title: 'Annual Cataloging Plan',
          plan_type: 'cataloging',
          status: 'active',
          start_date: '2024-01-01',
          end_date: '2024-12-31',
          next_review_date: '2024-06-30',
        },
      ],
      total: 1,
    } as never);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Annual Cataloging Plan')).toBeInTheDocument();
    });
    expect(screen.getByText('DP-2024-001')).toBeInTheDocument();
  });

  it('shows error state on failure', async () => {
    mockGetDocumentationPlans.mockRejectedValue(new Error('Network error'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/error loading documentation plans/i)).toBeInTheDocument();
    });
  });

});
