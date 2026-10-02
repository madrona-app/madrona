import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ApprovalsPage from '../../pages/work/ApprovalsPage';
import * as apiClientModule from '../../lib/apiClient';

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
}));

// Controllable permission gate: approval.approver_permission → canAct.
let canActMock = true;
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: () => canActMock }),
}));

const mockApiFetch = vi.mocked(apiClientModule.apiFetch);

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderApprovalsPage(orgId = 'org-123') {
  const qc = createQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/approvals`]}>
        <Routes>
          <Route
            path="/organizations/:orgId/approvals"
            element={<ApprovalsPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const mockPendingApproval = {
  request_id: 'req-1',
  entity_type: 'loan_out',
  entity_id: 'loan-1',
  rule_description: 'Loan exceeds 30 days',
  requester_id: 'user-1',
  requester_name: 'Alice Curator',
  requested_action: { action: 'submit' },
  created_at: '2026-04-20T10:00:00Z',
  status: 'pending',
  approver_permission: 'collections.create',
};

const mockHistoryApproval = {
  request_id: 'req-2',
  entity_type: 'acquisition',
  entity_id: 'acq-1',
  rule_description: 'High-value acquisition over $50,000',
  requester_id: 'user-2',
  requester_name: 'Bob Registrar',
  requested_action: { action: 'submit' },
  created_at: '2026-04-15T10:00:00Z',
  status: 'approved',
  reviewed_by: 'user-3',
  reviewer_name: 'Carol Director',
  reviewed_at: '2026-04-16T10:00:00Z',
  review_note: 'Approved with conditions',
};

describe('ApprovalsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canActMock = true;
    // Default: awaiting-you count of 0 + empty list for every view
    mockApiFetch.mockImplementation((path: string) => {
      if (path.includes('/approvals/count')) {
        return Promise.resolve({ count: 0 }) as unknown as ReturnType<
          typeof apiClientModule.apiFetch
        >;
      }
      if (path.includes('/approvals?status=')) {
        return Promise.resolve({ items: [], total: 0 }) as unknown as ReturnType<
          typeof apiClientModule.apiFetch
        >;
      }
      return Promise.resolve({}) as unknown as ReturnType<typeof apiClientModule.apiFetch>;
    });
  });

  describe('loading and basic render', () => {
    it('renders the Approvals heading', async () => {
      renderApprovalsPage();
      expect(
        screen.getByRole('heading', { name: 'Approvals' })
      ).toBeInTheDocument();
    });

    it('renders Awaiting you, All pending, and History tabs', async () => {
      renderApprovalsPage();
      expect(screen.getByRole('button', { name: /awaiting you/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /all pending/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /history/i })).toBeInTheDocument();
    });

    it('shows loading state initially', () => {
      mockApiFetch.mockImplementation(() => new Promise(() => {}));
      renderApprovalsPage();
      // MadronaLoader (inline) exposes role="status" with the label.
      expect(screen.getByRole('status', { name: /loading approvals/i })).toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('shows awaiting-you empty state by default', async () => {
      renderApprovalsPage();
      await waitFor(() => {
        expect(screen.getByText('Nothing awaiting you')).toBeInTheDocument();
      });
    });

    it('shows pending empty state on All pending tab', async () => {
      renderApprovalsPage();
      await waitFor(() => {
        expect(screen.getByText('Nothing awaiting you')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: /all pending/i }));
      await waitFor(() => {
        expect(screen.getByText('No pending approvals')).toBeInTheDocument();
      });
    });

    it('shows history empty state on history tab', async () => {
      renderApprovalsPage();
      await waitFor(() => {
        expect(screen.getByText('Nothing awaiting you')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: /history/i }));
      await waitFor(() => {
        expect(screen.getByText('No completed approvals yet')).toBeInTheDocument();
      });
    });
  });

  describe('awaiting-you approvals list', () => {
    beforeEach(() => {
      mockApiFetch.mockImplementation((path: string) => {
        if (path.includes('/approvals/count')) {
          return Promise.resolve({ count: 1 }) as unknown as ReturnType<
            typeof apiClientModule.apiFetch
          >;
        }
        if (path.includes('status=pending')) {
          return Promise.resolve({
            items: [mockPendingApproval],
            total: 1,
          }) as unknown as ReturnType<typeof apiClientModule.apiFetch>;
        }
        if (path.includes('status=reviewed')) {
          return Promise.resolve({ items: [], total: 0 }) as unknown as ReturnType<
            typeof apiClientModule.apiFetch
          >;
        }
        return Promise.resolve({}) as unknown as ReturnType<typeof apiClientModule.apiFetch>;
      });
    });

    it('renders the rule description', async () => {
      renderApprovalsPage();
      await waitFor(() => {
        expect(screen.getByText('Loan exceeds 30 days')).toBeInTheDocument();
      });
    });

    it('renders requester name', async () => {
      renderApprovalsPage();
      await waitFor(() => {
        expect(screen.getByText('Alice Curator')).toBeInTheDocument();
      });
    });

    it('shows the entity type as a badge', async () => {
      renderApprovalsPage();
      await waitFor(() => {
        expect(screen.getByText('Loan Out')).toBeInTheDocument();
      });
    });

    it('renders Approve and Reject action buttons', async () => {
      renderApprovalsPage();
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^approve$/i })).toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: /^reject$/i })).toBeInTheDocument();
    });

    it('shows the awaiting-you count badge', async () => {
      renderApprovalsPage();
      await waitFor(() => {
        const mineTab = screen.getByRole('button', { name: /awaiting you/i });
        expect(mineTab.textContent).toContain('1');
      });
    });
  });

  describe('entity link routing', () => {
    function mockPending(entity: { entity_type: string; entity_id: string }) {
      mockApiFetch.mockImplementation((path: string) => {
        if (path.includes('/approvals/count')) {
          return Promise.resolve({ count: 1 }) as unknown as ReturnType<typeof apiClientModule.apiFetch>;
        }
        if (path.includes('status=pending')) {
          return Promise.resolve({
            items: [{ ...mockPendingApproval, ...entity }],
            total: 1,
          }) as unknown as ReturnType<typeof apiClientModule.apiFetch>;
        }
        return Promise.resolve({ items: [], total: 0 }) as unknown as ReturnType<
          typeof apiClientModule.apiFetch
        >;
      });
    }

    it('routes an agent_draft approval to the Drafts inbox (not a dead record route)', async () => {
      mockPending({ entity_type: 'agent_draft', entity_id: 'dr-9' });
      renderApprovalsPage();
      const link = (await screen.findByText('Agent Draft')).closest('a');
      expect(link).toHaveAttribute(
        'href',
        '/organizations/org-123/collections/work/drafts?draft=dr-9',
      );
    });

    it('routes a record approval to its collections workspace', async () => {
      mockPending({ entity_type: 'loan_out', entity_id: 'loan-1' });
      renderApprovalsPage();
      const link = (await screen.findByText('Loan Out')).closest('a');
      expect(link).toHaveAttribute('href', '/organizations/org-123/collections/loans-out/loan-1');
    });

    it('routes a collection_object approval to /objects, not a guessed plural', async () => {
      // The old map keyed on 'object' while the entity_type is
      // 'collection_object', so the commonest type of all fell through to the
      // pluralising fallback and linked to /collections/collection-objects.
      mockPending({ entity_type: 'collection_object', entity_id: 'obj-1' });
      renderApprovalsPage();
      const link = (await screen.findByText('Collection Object')).closest('a');
      expect(link).toHaveAttribute('href', '/organizations/org-123/collections/objects/obj-1');
    });

    it.each([
      ['media_publish', 'Media Publish'],
      ['media_review', 'Media Review'],
      ['media_metadata', 'Media Metadata'],
    ])('routes %s to the media asset it carries', async (entityType, label) => {
      // These carry a media_id (draft factory id_attr), and used to link to
      // /collections/media-publishs and friends.
      mockPending({ entity_type: entityType, entity_id: 'med-1' });
      renderApprovalsPage();
      const link = (await screen.findByText(label)).closest('a');
      expect(link).toHaveAttribute('href', '/organizations/org-123/media/med-1');
    });

    it.each([
      ['media_rights', 'Media Rights'],
      ['media_consent', 'Media Consent'],
      ['location', 'Location'],
    ])('renders %s unlinked rather than inventing a URL', async (entityType, label) => {
      // No addressable route exists for these; a badge with no link beats a
      // link to a 404.
      mockPending({ entity_type: entityType, entity_id: 'x-1' });
      renderApprovalsPage();
      const badge = await screen.findByText(label);
      expect(badge.closest('a')).toBeNull();
    });

    it('never links an unknown entity type', async () => {
      mockPending({ entity_type: 'something_new', entity_id: 'n-1' });
      renderApprovalsPage();
      const badge = await screen.findByText('Something New');
      expect(badge.closest('a')).toBeNull();
    });
  });

  describe('permission gating', () => {
    beforeEach(() => {
      mockApiFetch.mockImplementation((path: string) => {
        if (path.includes('/approvals/count')) {
          return Promise.resolve({ count: 1 }) as unknown as ReturnType<
            typeof apiClientModule.apiFetch
          >;
        }
        if (path.includes('status=pending')) {
          return Promise.resolve({
            items: [mockPendingApproval],
            total: 1,
          }) as unknown as ReturnType<typeof apiClientModule.apiFetch>;
        }
        return Promise.resolve({}) as unknown as ReturnType<typeof apiClientModule.apiFetch>;
      });
    });

    it('shows Assign, Approve, Reject when the user holds the permission', async () => {
      canActMock = true;
      renderApprovalsPage();
      await waitFor(() => {
        expect(screen.getByText('Loan exceeds 30 days')).toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: /^assign$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^approve$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^reject$/i })).toBeInTheDocument();
    });

    it('hides actions and shows view-only when the user lacks the permission', async () => {
      canActMock = false;
      renderApprovalsPage();
      await waitFor(() => {
        expect(screen.getByText('Loan exceeds 30 days')).toBeInTheDocument();
      });
      expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^reject$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^assign$/i })).not.toBeInTheDocument();
      expect(screen.getByText('View only')).toBeInTheDocument();
    });
  });

  describe('review interaction', () => {
    beforeEach(() => {
      mockApiFetch.mockImplementation((path: string) => {
        if (path.includes('/approvals/count')) {
          return Promise.resolve({ count: 1 }) as unknown as ReturnType<
            typeof apiClientModule.apiFetch
          >;
        }
        if (path.includes('status=pending')) {
          return Promise.resolve({
            items: [mockPendingApproval],
            total: 1,
          }) as unknown as ReturnType<typeof apiClientModule.apiFetch>;
        }
        return Promise.resolve({}) as unknown as ReturnType<typeof apiClientModule.apiFetch>;
      });
    });

    it('opens inline review form when Approve clicked', async () => {
      renderApprovalsPage();
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^approve$/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /^approve$/i }));

      expect(
        screen.getByPlaceholderText(/add a note/i)
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /confirm approve/i })
      ).toBeInTheDocument();
    });

    it('opens inline review form when Reject clicked', async () => {
      renderApprovalsPage();
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^reject$/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /^reject$/i }));

      expect(
        screen.getByRole('button', { name: /confirm reject/i })
      ).toBeInTheDocument();
    });

    it('cancels review form on Cancel click', async () => {
      renderApprovalsPage();
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^approve$/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /^approve$/i }));
      expect(
        screen.getByRole('button', { name: /confirm approve/i })
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

      expect(
        screen.queryByRole('button', { name: /confirm approve/i })
      ).not.toBeInTheDocument();
    });
  });

  describe('history tab', () => {
    beforeEach(() => {
      mockApiFetch.mockImplementation((path: string) => {
        if (path.includes('/approvals/count')) {
          return Promise.resolve({ count: 0 }) as unknown as ReturnType<
            typeof apiClientModule.apiFetch
          >;
        }
        if (path.includes('status=pending')) {
          return Promise.resolve({ items: [], total: 0 }) as unknown as ReturnType<
            typeof apiClientModule.apiFetch
          >;
        }
        if (path.includes('status=reviewed')) {
          return Promise.resolve({
            items: [mockHistoryApproval],
            total: 1,
          }) as unknown as ReturnType<typeof apiClientModule.apiFetch>;
        }
        return Promise.resolve({}) as unknown as ReturnType<typeof apiClientModule.apiFetch>;
      });
    });

    it('renders an Approved badge in history', async () => {
      renderApprovalsPage();
      await waitFor(() => {
        expect(screen.getByText('Nothing awaiting you')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /history/i }));

      await waitFor(() => {
        expect(screen.getByText('Approved')).toBeInTheDocument();
      });
    });

    it('renders reviewer name in history', async () => {
      renderApprovalsPage();
      await waitFor(() => {
        expect(screen.getByText('Nothing awaiting you')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /history/i }));

      await waitFor(() => {
        expect(screen.getByText('by Carol Director')).toBeInTheDocument();
      });
    });
  });
});
