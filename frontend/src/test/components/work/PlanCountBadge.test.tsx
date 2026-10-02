import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PlanCountBadge } from '../../../components/work/PlanCountBadge';

const { useOrganizationMock, apiFetchMock, hasAppAccessMock } = vi.hoisted(() => ({
  useOrganizationMock: vi.fn(),
  apiFetchMock: vi.fn(),
  hasAppAccessMock: vi.fn(() => true),
}));

vi.mock('../../../contexts/useOrganization', () => ({
  useOrganization: useOrganizationMock,
}));

vi.mock('../../../lib/apiClient', () => ({
  apiFetch: apiFetchMock,
}));

// The badge reads app access to avoid polling an agent endpoint that 503s
// when Guide is off; useAuth throws outside an AuthProvider.
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ hasAppAccess: hasAppAccessMock }),
}));

function renderBadge(props: { className?: string } = {}) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PlanCountBadge {...props} />
    </QueryClientProvider>,
  );
}

describe('PlanCountBadge', () => {
  beforeEach(() => {
    useOrganizationMock.mockReset();
    apiFetchMock.mockReset();
    hasAppAccessMock.mockReset();
    hasAppAccessMock.mockReturnValue(true);
    useOrganizationMock.mockReturnValue({ activeOrganization: { organization_id: 'org-1' } });
  });

  it('renders nothing when no plans await the user', async () => {
    apiFetchMock.mockResolvedValue({ count: 0 });
    const { container } = renderBadge();
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it('renders the count when plans await the user', async () => {
    apiFetchMock.mockResolvedValue({ count: 3 });
    renderBadge();
    expect(await screen.findByText('3')).toBeInTheDocument();
  });

  it('clamps to "99+" above 99', async () => {
    apiFetchMock.mockResolvedValue({ count: 130 });
    renderBadge();
    expect(await screen.findByText('99+')).toBeInTheDocument();
  });

  it('uses a singular aria-label for one plan', async () => {
    apiFetchMock.mockResolvedValue({ count: 1 });
    renderBadge();
    expect(await screen.findByLabelText('1 plan awaiting you')).toBeInTheDocument();
  });

  it('uses a plural aria-label otherwise', async () => {
    apiFetchMock.mockResolvedValue({ count: 2 });
    renderBadge();
    expect(await screen.findByLabelText('2 plans awaiting you')).toBeInTheDocument();
  });

  it('renders nothing without an active organization', () => {
    useOrganizationMock.mockReturnValue({ activeOrganization: null });
    const { container } = renderBadge();
    expect(container.firstChild).toBeNull();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('hits the agent plans count endpoint', async () => {
    apiFetchMock.mockResolvedValue({ count: 1 });
    renderBadge();
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    expect(apiFetchMock).toHaveBeenCalledWith('/organizations/org-1/agent/plans/count');
  });

  it('does not poll the agent endpoint when Guide is unavailable', async () => {
    hasAppAccessMock.mockReturnValue(false);
    useOrganizationMock.mockReturnValue({ activeOrganization: { organization_id: 'org-1' } });
    renderBadge();
    // Guide off: the endpoint 503s, so the query must never run.
    await waitFor(() => expect(apiFetchMock).not.toHaveBeenCalled());
    expect(screen.queryByLabelText(/awaiting you/i)).not.toBeInTheDocument();
  });
});
