import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ApprovalsPage from '../../pages/work/ApprovalsPage';
import * as apiClientModule from '../../lib/apiClient';
import { checkA11y, formatViolations } from '../a11y';

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: () => true }),
}));

const mockApiFetch = vi.mocked(apiClientModule.apiFetch);

const pending = {
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

const reviewed = {
  ...pending,
  request_id: 'req-2',
  status: 'approved',
  reviewer_name: 'Carol Director',
  reviewed_at: '2026-04-21T10:00:00Z',
  review_note: 'Fine',
};

function respond(path: string): unknown {
  if (path.includes('/approvals/count')) return { count: 1 };
  if (path.includes('/assignees')) return { assignees: [{ user_id: 'u9', display_name: 'Dana Approver' }] };
  if (path.includes('status=reviewed')) return { items: [reviewed], total: 1 };
  if (path.includes('status=pending')) return { items: [pending], total: 1 };
  return {};
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/organizations/org-1/approvals']}>
        <Routes>
          <Route path="/organizations/:orgId/approvals" element={<ApprovalsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ApprovalsPage accessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockImplementation(
      (path: string) => Promise.resolve(respond(path)) as ReturnType<typeof apiClientModule.apiFetch>
    );
  });

  it('review queue: tabs, table and row actions have no axe violations', async () => {
    const { container } = renderPage();
    await screen.findByText('Loan exceeds 30 days');

    expect(screen.getByRole('tablist', { name: 'Approval views' })).toBeInTheDocument();
    const mine = screen.getByRole('tab', { name: /awaiting you/i });
    expect(mine).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', mine.id);

    expect(screen.getByRole('table', { name: 'Approvals awaiting you' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader')).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'Approve' })).toHaveAccessibleDescription('Loan exceeds 30 days');

    const results = await checkA11y(container);
    expect(results.violations, formatViolations(results)).toEqual([]);
  });

  it('arrow keys move between tabs', async () => {
    renderPage();
    await screen.findByText('Loan exceeds 30 days');
    const mine = screen.getByRole('tab', { name: /awaiting you/i });
    mine.focus();
    fireEvent.keyDown(mine, { key: 'ArrowRight' });
    const pendingTab = screen.getByRole('tab', { name: /all pending/i });
    expect(pendingTab).toHaveAttribute('aria-selected', 'true');
    expect(pendingTab).toHaveFocus();
    fireEvent.keyDown(pendingTab, { key: 'End' });
    expect(screen.getByRole('tab', { name: /history/i })).toHaveFocus();
  });

  it('inline review: note field is labelled, focused, and has no axe violations', async () => {
    const { container } = renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    const note = screen.getByRole('textbox', { name: 'Approval note (optional)' });
    await waitFor(() => expect(note).toHaveFocus());
    expect(screen.getByRole('button', { name: 'Confirm Approve' })).toBeInTheDocument();
    const results = await checkA11y(container);
    expect(results.violations, formatViolations(results)).toEqual([]);
  });

  it('assign picker and history view have no axe violations', async () => {
    const { container } = renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Assign' }));
    expect(await screen.findByRole('group', { name: 'Assign approver' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dana Approver' })).toHaveFocus());
    let results = await checkA11y(container);
    expect(results.violations, formatViolations(results)).toEqual([]);

    fireEvent.click(screen.getByRole('tab', { name: /history/i }));
    await screen.findByText('by Carol Director');
    expect(screen.getByRole('table', { name: 'Approval history' })).toBeInTheDocument();
    results = await checkA11y(container);
    expect(results.violations, formatViolations(results)).toEqual([]);
  });
});
