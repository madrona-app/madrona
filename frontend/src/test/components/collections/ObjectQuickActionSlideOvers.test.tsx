import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import {
  ConditionReportSlideOver,
  IncidentReportSlideOver,
  ConservationSlideOver,
} from '../../../components/collections/ObjectQuickActionSlideOvers';

const apiMocks = vi.hoisted(() => ({
  createConditionReportMock: vi.fn(),
  createIncidentReportMock: vi.fn(),
  createConservationTreatmentMock: vi.fn(),
  createValuationMock: vi.fn(),
  createLoanOutMock: vi.fn(),
  createUseRequestMock: vi.fn(),
  addLoanOutObjectMock: vi.fn(),
  addIncidentObjectMock: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  createConditionReport: apiMocks.createConditionReportMock,
  createIncidentReport: apiMocks.createIncidentReportMock,
  createConservationTreatment: apiMocks.createConservationTreatmentMock,
  createValuation: apiMocks.createValuationMock,
  createLoanOut: apiMocks.createLoanOutMock,
  createUseRequest: apiMocks.createUseRequestMock,
  addLoanOutObject: apiMocks.addLoanOutObjectMock,
  addIncidentObject: apiMocks.addIncidentObjectMock,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => apiMocks.navigateMock,
  };
});

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function wrap(ui: React.ReactElement) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={createClient()}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('ConditionReportSlideOver', () => {
  beforeEach(() => {
    apiMocks.createConditionReportMock.mockReset();
  });

  it('renders the title and report type select', () => {
    wrap(
      <ConditionReportSlideOver
        isOpen
        onClose={() => {}}
        organizationId="org-1"
        objectId="obj-1"
      />,
    );
    expect(screen.getByText('New Condition Report')).toBeInTheDocument();
  });

  it('disables Create Report when no overall condition is selected', () => {
    wrap(
      <ConditionReportSlideOver
        isOpen
        onClose={() => {}}
        organizationId="org-1"
        objectId="obj-1"
      />,
    );
    const create = screen.getByRole('button', { name: /Create Report/i });
    expect(create).toBeDisabled();
  });

  it('shows the subtitle with object number when provided', () => {
    wrap(
      <ConditionReportSlideOver
        isOpen
        onClose={() => {}}
        organizationId="org-1"
        objectId="obj-1"
        objectNumber="O-1"
        objectTitle="My Painting"
      />,
    );
    expect(screen.getByText('O-1: My Painting')).toBeInTheDocument();
  });

  it('renders all condition options', () => {
    wrap(
      <ConditionReportSlideOver
        isOpen
        onClose={() => {}}
        organizationId="org-1"
        objectId="obj-1"
      />,
    );
    expect(screen.getByText('Excellent')).toBeInTheDocument();
    expect(screen.getByText('Good')).toBeInTheDocument();
    expect(screen.getByText('Fair')).toBeInTheDocument();
    expect(screen.getByText('Poor')).toBeInTheDocument();
    expect(screen.getByText('Unacceptable')).toBeInTheDocument();
  });

  it('clicking a condition enables the Create button', () => {
    wrap(
      <ConditionReportSlideOver
        isOpen
        onClose={() => {}}
        organizationId="org-1"
        objectId="obj-1"
      />,
    );
    fireEvent.click(screen.getByText('Good'));
    const create = screen.getByRole('button', { name: /Create Report/i });
    expect(create).not.toBeDisabled();
  });

  it('Cancel button calls onClose', () => {
    const onClose = vi.fn();
    wrap(
      <ConditionReportSlideOver
        isOpen
        onClose={onClose}
        organizationId="org-1"
        objectId="obj-1"
      />,
    );
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('IncidentReportSlideOver', () => {
  beforeEach(() => {
    apiMocks.createIncidentReportMock.mockReset();
    apiMocks.addIncidentObjectMock.mockReset();
  });

  it('renders the Report Incident title', () => {
    wrap(
      <IncidentReportSlideOver
        isOpen
        onClose={() => {}}
        organizationId="org-1"
        objectId="obj-1"
      />,
    );
    // Title and button both say "Report Incident"
    expect(screen.getAllByText('Report Incident').length).toBeGreaterThanOrEqual(1);
  });

  it('disables submit when description is empty', () => {
    wrap(
      <IncidentReportSlideOver
        isOpen
        onClose={() => {}}
        organizationId="org-1"
        objectId="obj-1"
      />,
    );
    expect(screen.getByRole('button', { name: /Report Incident/ })).toBeDisabled();
  });

  it('renders an alert about reporting incidents', () => {
    wrap(
      <IncidentReportSlideOver
        isOpen
        onClose={() => {}}
        organizationId="org-1"
        objectId="obj-1"
      />,
    );
    expect(screen.getByText(/Report any damage, loss, theft/)).toBeInTheDocument();
  });
});

describe('ConservationSlideOver', () => {
  beforeEach(() => {
    apiMocks.createConservationTreatmentMock.mockReset();
  });

  it('renders the New Conservation Treatment title', () => {
    wrap(
      <ConservationSlideOver
        isOpen
        onClose={() => {}}
        organizationId="org-1"
        objectId="obj-1"
      />,
    );
    expect(screen.getByText('New Conservation Treatment')).toBeInTheDocument();
  });

  it('shows priority options', () => {
    wrap(
      <ConservationSlideOver
        isOpen
        onClose={() => {}}
        organizationId="org-1"
        objectId="obj-1"
      />,
    );
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBeGreaterThanOrEqual(2);
  });

  it('Create Treatment button starts enabled (no required fields beyond defaults)', () => {
    wrap(
      <ConservationSlideOver
        isOpen
        onClose={() => {}}
        organizationId="org-1"
        objectId="obj-1"
      />,
    );
    const create = screen.getByRole('button', { name: /Create Treatment/i });
    expect(create).not.toBeDisabled();
  });
});
