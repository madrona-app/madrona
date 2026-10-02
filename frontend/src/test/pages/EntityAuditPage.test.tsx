import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import EntityAuditPage from '../../pages/admin/EntityAuditPage';
import * as api from '../../lib/api';

vi.mock('../../lib/api', () => ({
  getEntityAuditEvents: vi.fn(),
  getEntityAuditEventDetail: vi.fn(),
}));

const mockGetEvents = vi.mocked(api.getEntityAuditEvents);

function renderPage(orgId = 'org-1') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/admin/audit`]}>
        <Routes>
          <Route path="/organizations/:orgId/admin/audit" element={<EntityAuditPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EntityAuditPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders page header', async () => {
      mockGetEvents.mockResolvedValue({ items: [], total: 0 } as any);

      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Change History/i })).toBeInTheDocument();
      });
    });

    it('renders filters', async () => {
      mockGetEvents.mockResolvedValue({ items: [], total: 0 } as any);

      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/Filters/i)).toBeInTheDocument();
      });
    });
  });

  describe('loading state', () => {
    it('shows loading skeleton', async () => {
      mockGetEvents.mockImplementation(() => new Promise(() => {}));

      const { container } = renderPage();

      await waitFor(() => {
        expect(container.querySelector('.animate-pulse')).not.toBeNull();
      });
    });
  });

  describe('empty state', () => {
    it('shows no events message when none', async () => {
      mockGetEvents.mockResolvedValue({ items: [], total: 0 } as any);

      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/No events found/i)).toBeInTheDocument();
      });
    });

    it('shows filtered empty message when filters applied', async () => {
      mockGetEvents.mockResolvedValue({ items: [], total: 0 } as any);

      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/No events found/i)).toBeInTheDocument();
      });

      // Apply a filter
      const entityTypeSelect = screen.getAllByRole('combobox')[0];
      fireEvent.change(entityTypeSelect, { target: { value: 'collection_object' } });

      await waitFor(() => {
        expect(screen.getByText(/No events match the current filters/i)).toBeInTheDocument();
      });
    });
  });

  describe('with data', () => {
    const events = {
      items: [
        {
          event_id: 'e-1',
          entity_id: 'obj-123',
          entity_type: 'collection_object',
          entity_display_key: 'Test Object',
          change_type: 'created',
          changed_at: '2026-04-01T12:00:00Z',
          changed_by_id: 'user-1',
          changed_by_name: 'Jane Doe',
          changed_by_email: 'jane@example.com',
          changed_fields: [],
          summary: 'Created object',
        },
      ],
      total: 1,
    };

    it('renders event rows', async () => {
      mockGetEvents.mockResolvedValue(events as any);

      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Test Object')).toBeInTheDocument();
      });
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    });

    it('shows change type badge', async () => {
      mockGetEvents.mockResolvedValue(events as any);

      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Created')).toBeInTheDocument();
      });
    });
  });

  describe('error state', () => {
    it('shows error when load fails', async () => {
      mockGetEvents.mockRejectedValue(new Error('Failed'));

      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/Failed to load audit events/i)).toBeInTheDocument();
      });
    });
  });

  describe('filters', () => {
    beforeEach(() => {
      mockGetEvents.mockResolvedValue({ items: [], total: 0 } as any);
    });

    it('clears filters when Clear button clicked', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/No events found/i)).toBeInTheDocument();
      });

      const entityTypeSelect = screen.getAllByRole('combobox')[0];
      fireEvent.change(entityTypeSelect, { target: { value: 'collection_object' } });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Clear filters/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Clear filters/i }));

      expect((screen.getAllByRole('combobox')[0] as HTMLSelectElement).value).toBe('');
    });

    it('changes change-type filter', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/No events found/i)).toBeInTheDocument();
      });

      const changeTypeSelect = screen.getAllByRole('combobox')[1];
      fireEvent.change(changeTypeSelect, { target: { value: 'created' } });

      expect((changeTypeSelect as HTMLSelectElement).value).toBe('created');
    });
  });
});
