import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApprovalCountBadge } from '../../../components/work/ApprovalCountBadge';

const { useOrganizationMock, apiFetchMock } = vi.hoisted(() => ({
  useOrganizationMock: vi.fn(),
  apiFetchMock: vi.fn(),
}));

vi.mock('../../../contexts/useOrganization', () => ({
  useOrganization: useOrganizationMock,
}));

vi.mock('../../../lib/apiClient', () => ({
  apiFetch: apiFetchMock,
}));

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderBadge(props: { className?: string } = {}) {
  return render(
    <QueryClientProvider client={createClient()}>
      <ApprovalCountBadge {...props} />
    </QueryClientProvider>,
  );
}

describe('ApprovalCountBadge', () => {
  beforeEach(() => {
    useOrganizationMock.mockReset();
    apiFetchMock.mockReset();
    useOrganizationMock.mockReturnValue({
      activeOrganization: { organization_id: 'org-1' },
    });
  });

  it('renders nothing when count is zero', async () => {
    apiFetchMock.mockResolvedValue({ count: 0 });
    const { container } = renderBadge();
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it('renders the count when greater than zero', async () => {
    apiFetchMock.mockResolvedValue({ count: 4 });
    renderBadge();
    expect(await screen.findByText('4')).toBeInTheDocument();
  });

  it('shows "99+" when count exceeds 99', async () => {
    apiFetchMock.mockResolvedValue({ count: 250 });
    renderBadge();
    expect(await screen.findByText('99+')).toBeInTheDocument();
  });

  it('uses singular noun in aria-label when count is 1', async () => {
    apiFetchMock.mockResolvedValue({ count: 1 });
    renderBadge();
    expect(await screen.findByLabelText('1 approval awaiting you')).toBeInTheDocument();
  });

  it('uses plural noun in aria-label otherwise', async () => {
    apiFetchMock.mockResolvedValue({ count: 5 });
    renderBadge();
    expect(await screen.findByLabelText('5 approvals awaiting you')).toBeInTheDocument();
  });

  it('forwards className', async () => {
    apiFetchMock.mockResolvedValue({ count: 2 });
    renderBadge({ className: 'extra-class' });
    const el = await screen.findByText('2');
    expect(el).toHaveClass('extra-class');
  });

  it('renders nothing when there is no active organization', () => {
    useOrganizationMock.mockReturnValue({ activeOrganization: null });
    const { container } = renderBadge();
    expect(container.firstChild).toBeNull();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('hits the right URL', async () => {
    apiFetchMock.mockResolvedValue({ count: 1 });
    renderBadge();
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    expect(apiFetchMock).toHaveBeenCalledWith('/organizations/org-1/approvals/count?mine=true');
  });
});
