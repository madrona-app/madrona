import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ConditionReportLinker } from '../../../components/collections/ConditionReportLinker';

const { getObjectProceduresMock, createConditionReportMock, navigateMock } = vi.hoisted(() => ({
  getObjectProceduresMock: vi.fn(),
  createConditionReportMock: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  getObjectProcedures: getObjectProceduresMock,
  createConditionReport: createConditionReportMock,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function renderLinker(props: Partial<Parameters<typeof ConditionReportLinker>[0]> = {}) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={createClient()}>
        <ConditionReportLinker organizationId="org-1" objectId="obj-1" {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('ConditionReportLinker', () => {
  beforeEach(() => {
    getObjectProceduresMock.mockReset();
    createConditionReportMock.mockReset();
    navigateMock.mockReset();
  });

  it('renders the section header with count of zero when empty', async () => {
    getObjectProceduresMock.mockResolvedValue({ condition_reports: [] });
    renderLinker();
    await waitFor(() => screen.getByText('Condition Reports (0)'));
    expect(screen.getByText('Condition Reports (0)')).toBeInTheDocument();
  });

  it('shows empty-state copy when no reports exist', async () => {
    getObjectProceduresMock.mockResolvedValue({ condition_reports: [] });
    renderLinker();
    await waitFor(() => screen.getByText(/No condition reports for this object/));
    expect(screen.getByText(/No condition reports for this object/)).toBeInTheDocument();
  });

  it('renders Add Condition Report button only in edit mode', async () => {
    getObjectProceduresMock.mockResolvedValue({ condition_reports: [] });
    renderLinker({ isEditing: true });
    await waitFor(() => screen.getByText('Add Condition Report'));
    expect(screen.getByText('Add Condition Report')).toBeInTheDocument();
  });

  it('does not render Add button in read-only', async () => {
    getObjectProceduresMock.mockResolvedValue({ condition_reports: [] });
    renderLinker({ isEditing: false });
    await waitFor(() => screen.getByText(/No condition reports/));
    expect(screen.queryByText('Add Condition Report')).toBeNull();
  });

  it('renders condition report rows with type and examiner', async () => {
    getObjectProceduresMock.mockResolvedValue({
      condition_reports: [
        {
          report_id: 'r-1',
          report_number: 'CR-001',
          report_type: 'periodic',
          report_date: '2024-01-01',
          examiner_name: 'Conservator A',
          overall_condition: 'good',
        },
      ],
    });
    renderLinker();
    await waitFor(() => screen.getByText('CR-001'));
    expect(screen.getByText('CR-001')).toBeInTheDocument();
    expect(screen.getByText(/Conservator A/)).toBeInTheDocument();
    expect(screen.getByText('good')).toBeInTheDocument();
  });

  it('renders the count in the header when reports exist', async () => {
    getObjectProceduresMock.mockResolvedValue({
      condition_reports: [
        { report_id: 'r-1', report_number: 'CR-001', report_type: 'periodic' },
        { report_id: 'r-2', report_number: 'CR-002', report_type: 'damage' },
      ],
    });
    renderLinker();
    await waitFor(() => screen.getByText('Condition Reports (2)'));
    expect(screen.getByText('Condition Reports (2)')).toBeInTheDocument();
  });

  it('opens the create slide-over when Add is clicked', async () => {
    getObjectProceduresMock.mockResolvedValue({ condition_reports: [] });
    renderLinker({ isEditing: true });
    await waitFor(() => screen.getByText('Add Condition Report'));
    fireEvent.click(screen.getByText('Add Condition Report'));
    expect(await screen.findByRole('button', { name: /Create & Edit/ })).toBeInTheDocument();
  });

  it('handles report rendering when no examiner is set', async () => {
    getObjectProceduresMock.mockResolvedValue({
      condition_reports: [
        { report_id: 'r-1', report_number: 'CR-001', report_type: 'periodic' },
      ],
    });
    renderLinker();
    await waitFor(() => screen.getByText('CR-001'));
    expect(screen.getByText('CR-001')).toBeInTheDocument();
  });
});
