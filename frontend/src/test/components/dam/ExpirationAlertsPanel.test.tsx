import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ExpirationAlertsPanel } from '../../../components/dam/ExpirationAlertsPanel';

const {
  listExpirationAlertsMock,
  getExpirationAlertsSummaryMock,
  dismissExpirationAlertMock,
  acknowledgeExpirationAlertMock,
} = vi.hoisted(() => ({
  listExpirationAlertsMock: vi.fn(),
  getExpirationAlertsSummaryMock: vi.fn(),
  dismissExpirationAlertMock: vi.fn(),
  acknowledgeExpirationAlertMock: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  listExpirationAlerts: listExpirationAlertsMock,
  getExpirationAlertsSummary: getExpirationAlertsSummaryMock,
  dismissExpirationAlert: dismissExpirationAlertMock,
  acknowledgeExpirationAlert: acknowledgeExpirationAlertMock,
}));

vi.mock('@/lib/formatters', () => ({
  formatDateShort: (s: string) => `short:${s}`,
}));

function createClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderPanel(props: Partial<Parameters<typeof ExpirationAlertsPanel>[0]> = {}) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={createClient()}>
        <ExpirationAlertsPanel organizationId="org-1" {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('ExpirationAlertsPanel', () => {
  beforeEach(() => {
    listExpirationAlertsMock.mockReset();
    getExpirationAlertsSummaryMock.mockReset();
    dismissExpirationAlertMock.mockReset();
    acknowledgeExpirationAlertMock.mockReset();
  });

  it('renders the all-clear empty state when total_active is zero', async () => {
    getExpirationAlertsSummaryMock.mockResolvedValue({ total_active: 0, by_severity: {} });
    listExpirationAlertsMock.mockResolvedValue({ items: [] });
    renderPanel();
    await waitFor(() => expect(screen.getByText('No expiration alerts')).toBeInTheDocument());
  });

  it('shows summary badges per severity', async () => {
    getExpirationAlertsSummaryMock.mockResolvedValue({
      total_active: 6,
      by_severity: { critical: 2, urgent: 3, warning: 1 },
    });
    listExpirationAlertsMock.mockResolvedValue({ items: [] });
    renderPanel();
    await waitFor(() => screen.getByText('2 Critical'));
    expect(screen.getByText('2 Critical')).toBeInTheDocument();
    expect(screen.getByText('3 Urgent')).toBeInTheDocument();
    expect(screen.getByText('1 Warning')).toBeInTheDocument();
  });

  it('renders an alert with the correct title and severity badge', async () => {
    getExpirationAlertsSummaryMock.mockResolvedValue({
      total_active: 1,
      by_severity: { critical: 1 },
    });
    listExpirationAlertsMock.mockResolvedValue({
      items: [
        {
          alert_id: 'a-1',
          alert_type: 'rights',
          severity: 'critical',
          media_id: 'm-1',
          media_title: 'My Photo',
          media_filename: 'photo.jpg',
          expiry_date: '2026-05-01',
          days_until_expiry: 3,
        },
      ],
    });
    renderPanel();
    await waitFor(() => screen.getByText('My Photo'));
    expect(screen.getByText('My Photo')).toBeInTheDocument();
    expect(screen.getByText('Rights')).toBeInTheDocument();
    expect(screen.getByText(/3 days remaining/)).toBeInTheDocument();
    expect(screen.getByText(/short:2026-05-01/)).toBeInTheDocument();
  });

  it('falls back to filename when title missing', async () => {
    getExpirationAlertsSummaryMock.mockResolvedValue({ total_active: 1, by_severity: { warning: 1 } });
    listExpirationAlertsMock.mockResolvedValue({
      items: [
        {
          alert_id: 'a-1',
          alert_type: 'consent',
          severity: 'warning',
          media_id: 'm-1',
          media_title: null,
          media_filename: 'fallback.jpg',
          expiry_date: null,
          days_until_expiry: 1,
        },
      ],
    });
    renderPanel();
    await waitFor(() => screen.getByText('fallback.jpg'));
    // Singular "1 day"
    expect(screen.getByText(/1 day remaining/)).toBeInTheDocument();
    // Consent badge instead of Rights
    expect(screen.getByText('Consent')).toBeInTheDocument();
  });

  it('triggers acknowledge mutation when the eye button is clicked', async () => {
    getExpirationAlertsSummaryMock.mockResolvedValue({ total_active: 1, by_severity: { warning: 1 } });
    listExpirationAlertsMock.mockResolvedValue({
      items: [
        {
          alert_id: 'a-1',
          alert_type: 'consent',
          severity: 'warning',
          media_id: 'm-1',
          media_title: 'X',
          expiry_date: null,
          days_until_expiry: 5,
        },
      ],
    });
    acknowledgeExpirationAlertMock.mockResolvedValue({});
    renderPanel();
    await waitFor(() => screen.getByText('X'));
    fireEvent.click(screen.getByTitle('Acknowledge'));
    await waitFor(() => expect(acknowledgeExpirationAlertMock).toHaveBeenCalledWith('org-1', 'a-1'));
  });

  it('triggers dismiss mutation when the X button is clicked', async () => {
    getExpirationAlertsSummaryMock.mockResolvedValue({ total_active: 1, by_severity: { urgent: 1 } });
    listExpirationAlertsMock.mockResolvedValue({
      items: [
        {
          alert_id: 'a-1',
          alert_type: 'rights',
          severity: 'urgent',
          media_id: 'm-1',
          media_title: 'Y',
          expiry_date: null,
          days_until_expiry: 2,
        },
      ],
    });
    dismissExpirationAlertMock.mockResolvedValue({});
    renderPanel();
    await waitFor(() => screen.getByText('Y'));
    fireEvent.click(screen.getByTitle('Dismiss'));
    await waitFor(() => expect(dismissExpirationAlertMock).toHaveBeenCalledWith('org-1', 'a-1'));
  });

  it('shows "View all" link in compact mode when total > 5', async () => {
    getExpirationAlertsSummaryMock.mockResolvedValue({ total_active: 12, by_severity: { warning: 12 } });
    listExpirationAlertsMock.mockResolvedValue({ items: [] });
    renderPanel({ compact: true });
    await waitFor(() => expect(screen.getByText('View all 12 alerts')).toBeInTheDocument());
  });
});
