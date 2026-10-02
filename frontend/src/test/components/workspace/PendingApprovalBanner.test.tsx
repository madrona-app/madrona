import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PendingApprovalBanner } from '../../../components/workspace/PendingApprovalBanner';

const { apiFetchMock, hasPermissionMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  hasPermissionMock: vi.fn(),
}));

vi.mock('../../../lib/apiClient', () => ({
  apiFetch: apiFetchMock,
}));

vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: hasPermissionMock }),
}));

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderBanner(extra: Partial<Parameters<typeof PendingApprovalBanner>[0]> = {}) {
  return render(
    <QueryClientProvider client={client()}>
      <PendingApprovalBanner
        visible
        entityType="loan_in"
        entityId="loan-1"
        orgId="org-1"
        {...extra}
      />
    </QueryClientProvider>,
  );
}

describe('PendingApprovalBanner', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    hasPermissionMock.mockReset();
    apiFetchMock.mockResolvedValue({
      items: [
        {
          request_id: 'r-1',
          entity_type: 'loan_in',
          entity_id: 'loan-1',
          rule_description: 'High value loan',
          approver_permission: 'loans.approve',
          status: 'pending',
        },
      ],
    });
  });

  it('renders nothing when not visible', () => {
    const { container } = renderBanner({ visible: false });
    expect(container.firstChild).toBeNull();
  });

  it('shows the pending headline', () => {
    hasPermissionMock.mockReturnValue(false);
    renderBanner();
    expect(screen.getByText('This record is pending approval')).toBeInTheDocument();
  });

  it('hides Approve/Reject buttons when user lacks the approver permission', async () => {
    hasPermissionMock.mockReturnValue(false);
    renderBanner();
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    expect(screen.queryByText('Approve')).toBeNull();
    expect(screen.queryByText('Reject')).toBeNull();
  });

  it('shows Approve/Reject when the user has the approver permission', async () => {
    hasPermissionMock.mockReturnValue(true);
    renderBanner();
    expect(await screen.findByText('Approve')).toBeInTheDocument();
    expect(await screen.findByText('Reject')).toBeInTheDocument();
  });

  it('clicking Approve reveals the note textarea and Confirm Approve', async () => {
    hasPermissionMock.mockReturnValue(true);
    renderBanner();
    fireEvent.click(await screen.findByText('Approve'));
    expect(screen.getByPlaceholderText(/Add a note/i)).toBeInTheDocument();
    expect(screen.getByText('Confirm Approve')).toBeInTheDocument();
  });

  it('clicking Reject reveals Confirm Reject', async () => {
    hasPermissionMock.mockReturnValue(true);
    renderBanner();
    fireEvent.click(await screen.findByText('Reject'));
    expect(screen.getByText('Confirm Reject')).toBeInTheDocument();
  });

  it('Cancel button returns to the initial Approve/Reject state', async () => {
    hasPermissionMock.mockReturnValue(true);
    renderBanner();
    fireEvent.click(await screen.findByText('Approve'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.getByText('Approve')).toBeInTheDocument();
  });

  it('Confirm Approve fires a POST with decision approved', async () => {
    hasPermissionMock.mockReturnValue(true);
    renderBanner();
    fireEvent.click(await screen.findByText('Approve'));
    fireEvent.click(screen.getByText('Confirm Approve'));
    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/organizations/org-1/approvals/r-1/review',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    const reviewCall = apiFetchMock.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('/review'),
    );
    expect(reviewCall).toBeDefined();
    expect(JSON.parse((reviewCall![1] as { body: string }).body)).toEqual({
      decision: 'approved',
      note: '',
    });
  });

  it('Confirm Reject sends decision rejected with the typed note', async () => {
    hasPermissionMock.mockReturnValue(true);
    renderBanner();
    fireEvent.click(await screen.findByText('Reject'));
    fireEvent.change(screen.getByPlaceholderText(/Add a note/i), {
      target: { value: 'Insufficient docs' },
    });
    fireEvent.click(screen.getByText('Confirm Reject'));
    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/organizations/org-1/approvals/r-1/review',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    const reviewCall = apiFetchMock.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('/review'),
    );
    expect(reviewCall).toBeDefined();
    expect(JSON.parse((reviewCall![1] as { body: string }).body)).toEqual({
      decision: 'rejected',
      note: 'Insufficient docs',
    });
  });
});
