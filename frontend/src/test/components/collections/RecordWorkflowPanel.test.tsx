import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RecordWorkflowPanel } from '../../../components/collections/RecordWorkflowPanel';
import { checkA11y } from '../../a11y';

const api = vi.hoisted(() => ({
  getObjectReviews: vi.fn(),
  listRecordFlags: vi.fn(),
  getObjectFlags: vi.fn(),
  getObjectCompleteness: vi.fn(),
  listReviewers: vi.fn(),
  submitForReview: vi.fn(),
  decideReview: vi.fn(),
  cancelReview: vi.fn(),
  setObjectFlags: vi.fn(),
}));
vi.mock('../../../lib/api/recordWorkflow', async (orig) => ({ ...(await orig<object>()), ...api }));
const auth = vi.hoisted(() => ({ user: { user_id: 'intern' } as { user_id: string } }));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => auth }));

const pendingReview = {
  review_id: 'r1', object_id: 'o1', status: 'pending', requested_by: 'intern', requested_by_name: 'Intern',
  requested_at: '2026-11-13T12:00:00Z', request_note: 'First pass', reviewer_id: 'archivist', reviewer_name: 'Archivist',
  decided_by: null, decided_by_name: null, decided_at: null, decision_note: null,
};

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RecordWorkflowPanel orgId="org" objectId="o1" canEdit />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = { user_id: 'intern' };
  api.listRecordFlags.mockResolvedValue([
    { flag_id: 'f1', key: 'on_view', label: 'On view', description: 'Currently exhibited', sort_order: 0, is_active: true, is_rule_managed: false },
    { flag_id: 'f2', key: 'heavy', label: 'Heavy', description: null, sort_order: 1, is_active: true, is_rule_managed: false },
    { flag_id: 'f3', key: 'ready', label: 'Ready to publish', description: null, sort_order: 2, is_active: true, is_rule_managed: true },
  ]);
  api.getObjectFlags.mockResolvedValue([{ flag_id: 'f3', key: 'ready', label: 'Ready to publish', source: 'rule', note: null, set_at: null, set_by: null }]);
  api.getObjectCompleteness.mockResolvedValue([
    { rule_id: 'c1', name: 'Ready to publish', flag_label: 'Ready to publish', required_for_publication: true, met: false, missing: ['Brief description is missing'] },
  ]);
  api.listReviewers.mockResolvedValue([{ user_id: 'archivist', name: 'Archivist' }]);
});

describe('RecordWorkflowPanel', () => {
  it('intern view: labelled submit form, flags fieldset, completeness, no axe violations', async () => {
    api.getObjectReviews.mockResolvedValue({ cataloging_status: 'in_progress', items: [], can_decide_admin: false });
    const { container } = renderPanel();
    expect(await screen.findByRole('heading', { level: 3, name: 'Review: In progress' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Record status' })).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: 'Archivist' })).toBeInTheDocument();
    expect(screen.getByLabelText('Reviewer')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Flags' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'On view' })).toHaveAccessibleDescription('Currently exhibited');
    // Rule-managed flags cannot be ticked by hand; they are reported in text.
    expect(screen.queryByRole('checkbox', { name: 'Ready to publish' })).not.toBeInTheDocument();
    expect(screen.getByText(/Set automatically by completeness rules: Ready to publish/)).toBeInTheDocument();
    expect(await screen.findByText('Brief description is missing')).toBeInTheDocument();
    expect((await checkA11y(container)).violations).toEqual([]);
  });

  it('submitting without a reviewer marks the select invalid and focuses it', async () => {
    api.getObjectReviews.mockResolvedValue({ cataloging_status: null, items: [], can_decide_admin: false });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Submit for review' }));
    const select = screen.getByLabelText('Reviewer');
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toHaveFocus();
    expect(select).toHaveAccessibleDescription('Choose who should review this record.');
    expect(api.submitForReview).not.toHaveBeenCalled();
  });

  it('submitting announces the outcome', async () => {
    api.getObjectReviews.mockResolvedValue({ cataloging_status: null, items: [], can_decide_admin: false });
    api.submitForReview.mockResolvedValue({ ...pendingReview });
    renderPanel();
    await screen.findByRole('option', { name: 'Archivist' });
    fireEvent.change(screen.getByLabelText('Reviewer'), { target: { value: 'archivist' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit for review' }));
    await waitFor(() => expect(api.submitForReview).toHaveBeenCalledWith('org', 'o1', 'archivist', ''));
    expect(await screen.findByText('Submitted for review. Archivist has been notified.')).toBeInTheDocument();
  });

  it('reviewer sees a decision fieldset; requesting changes requires a note', async () => {
    auth.user = { user_id: 'archivist' };
    api.getObjectReviews.mockResolvedValue({ cataloging_status: 'pending_review', items: [pendingReview], can_decide_admin: false });
    const { container } = renderPanel();
    expect(await screen.findByRole('heading', { level: 3, name: 'Review: In review' })).toBeInTheDocument();
    expect(screen.getByText(/Assigned to Archivist by Intern/)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Your decision' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Request changes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Record decision' }));
    const note = screen.getByRole('textbox', { name: /Review notes/ });
    expect(note).toHaveAttribute('aria-invalid', 'true');
    expect(note).toHaveFocus();
    expect(api.decideReview).not.toHaveBeenCalled();
    expect((await checkA11y(container)).violations).toEqual([]);
  });

  it('the submitter does not get a decision form', async () => {
    api.getObjectReviews.mockResolvedValue({ cataloging_status: 'pending_review', items: [pendingReview], can_decide_admin: false });
    renderPanel();
    await screen.findByRole('heading', { level: 3, name: 'Review: In review' });
    expect(screen.queryByRole('group', { name: 'Your decision' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel this review' })).toBeInTheDocument();
  });
});
