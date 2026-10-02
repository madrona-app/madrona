import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ScheduleCard from '../../components/ScheduleCard';

vi.mock('../../lib/api', () => ({
  getPipelineSchedule: vi.fn(),
  enablePipelineSchedule: vi.fn(),
  disablePipelineSchedule: vi.fn(),
  deletePipelineSchedule: vi.fn(),
}));

vi.mock('../../components/ScheduleModal', () => ({
  default: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div data-testid="schedule-modal" /> : null),
}));

vi.mock('../../contexts/useOrganization', () => ({
  useOrganization: () => ({ activeOrganizationId: 'org-1' }),
}));

const showToast = vi.fn();
vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast }),
}));

import {
  getPipelineSchedule,
  enablePipelineSchedule,
  disablePipelineSchedule,
  deletePipelineSchedule,
} from '../../lib/api';

const mockGet = vi.mocked(getPipelineSchedule);
const mockEnable = vi.mocked(enablePipelineSchedule);
const _mockDisable = vi.mocked(disablePipelineSchedule);
const _mockDelete = vi.mocked(deletePipelineSchedule);

function renderCard(props?: Partial<Parameters<typeof ScheduleCard>[0]>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ScheduleCard pipelineId="p-1" canEdit {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ScheduleCard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows loading state initially', () => {
    mockGet.mockReturnValue(new Promise(() => {}) as never);
    renderCard();
    expect(screen.getByText('Loading schedule...')).toBeInTheDocument();
  });

  it('shows empty state when no schedule', async () => {
    mockGet.mockResolvedValue({ schedule: null } as never);
    renderCard();
    await waitFor(() => {
      expect(screen.getByText('No schedule configured')).toBeInTheDocument();
    });
  });

  it('shows Create schedule button when canEdit and no schedule', async () => {
    mockGet.mockResolvedValue({ schedule: null } as never);
    renderCard({ canEdit: true });
    await waitFor(() => screen.getByText('Create schedule'));
  });

  it('hides Create schedule button when canEdit=false', async () => {
    mockGet.mockResolvedValue({ schedule: null } as never);
    renderCard({ canEdit: false });
    await waitFor(() => screen.getByText('No schedule configured'));
    expect(screen.queryByText('Create schedule')).not.toBeInTheDocument();
  });

  it('opens modal when Create schedule clicked', async () => {
    mockGet.mockResolvedValue({ schedule: null } as never);
    renderCard();
    await waitFor(() => screen.getByText('Create schedule'));
    fireEvent.click(screen.getByText('Create schedule'));
    expect(screen.getByTestId('schedule-modal')).toBeInTheDocument();
  });

  it('shows enabled status and frequency for time-based schedule', async () => {
    mockGet.mockResolvedValue({
      schedule: {
        type: 'time',
        time_hour: 9,
        time_minute: 30,
        timezone: 'UTC',
        enabled: true,
      },
    } as never);
    renderCard();
    await waitFor(() => {
      expect(screen.getByText('Enabled')).toBeInTheDocument();
      expect(screen.getByText('Daily at 09:30')).toBeInTheDocument();
      expect(screen.getByText('UTC')).toBeInTheDocument();
    });
  });

  it('shows interval frequency in display', async () => {
    mockGet.mockResolvedValue({
      schedule: { type: 'interval', every_n: 5, unit: 'minutes', timezone: 'UTC', enabled: false },
    } as never);
    renderCard();
    await waitFor(() => {
      expect(screen.getByText('Every 5 minutes')).toBeInTheDocument();
      expect(screen.getByText('Disabled')).toBeInTheDocument();
    });
  });

  it('shows Disable button when schedule is enabled', async () => {
    mockGet.mockResolvedValue({
      schedule: { type: 'interval', every_n: 1, unit: 'hours', timezone: 'UTC', enabled: true },
    } as never);
    renderCard();
    await waitFor(() => screen.getByText('Disable'));
  });

  it('opens confirm dialog when Disable is clicked', async () => {
    mockGet.mockResolvedValue({
      schedule: { type: 'interval', every_n: 1, unit: 'hours', timezone: 'UTC', enabled: true },
    } as never);
    renderCard();
    await waitFor(() => screen.getByText('Disable'));
    fireEvent.click(screen.getByText('Disable'));
    expect(screen.getByText('Disable Schedule')).toBeInTheDocument();
  });

  it('opens delete confirmation when Delete clicked', async () => {
    mockGet.mockResolvedValue({
      schedule: { type: 'interval', every_n: 1, unit: 'hours', timezone: 'UTC', enabled: true },
    } as never);
    renderCard();
    await waitFor(() => screen.getByText('Delete'));
    fireEvent.click(screen.getByText('Delete'));
    expect(screen.getByText('Delete Schedule')).toBeInTheDocument();
  });

  it('opens Enable confirmation dialog when Enable clicked', async () => {
    mockGet.mockResolvedValue({
      schedule: { type: 'interval', every_n: 1, unit: 'hours', timezone: 'UTC', enabled: false },
    } as never);
    mockEnable.mockResolvedValue({} as never);
    renderCard();
    await waitFor(() => screen.getByText('Enable'));
    fireEvent.click(screen.getByText('Enable'));
    expect(screen.getByText('Enable Schedule')).toBeInTheDocument();
  });
});
