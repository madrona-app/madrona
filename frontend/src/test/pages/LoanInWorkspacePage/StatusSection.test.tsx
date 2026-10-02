import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  WorkflowProgressIndicator,
  DaysRemainingAlert,
  StatusBar,
} from '../../../pages/collections/LoanInWorkspacePage/StatusSection';
import type { LoanIn } from '../../../lib/schemas';
import type { FormData } from '../../../pages/collections/LoanInWorkspacePage/types';
import { defaultFormData } from '../../../pages/collections/LoanInWorkspacePage/types';

// Stub ChangeStatusDropdown — internal popover behavior isn't the SUT here.
vi.mock('../../../components/collections/ChangeStatusDropdown', () => ({
  ChangeStatusDropdown: ({ currentStatus, onStatusChange, isPending }: {
    currentStatus: string;
    onStatusChange: (s: string) => void;
    isPending: boolean;
  }) => (
    <div data-testid="change-status-dropdown" data-current={currentStatus} data-pending={String(isPending)}>
      <button onClick={() => onStatusChange('cancelled')}>Stub Cancel</button>
    </div>
  ),
}));

function makeLoan(overrides: Partial<LoanIn> = {}): LoanIn {
  return {
    loan_in_id: 'loan-1',
    organization_id: 'org-1',
    loan_number: 'LI-2024-001',
    status: 'requested',
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  } as LoanIn;
}

const baseFormData: FormData = { ...defaultFormData };

function makeMutation(overrides: Record<string, unknown> = {}) {
  return {
    mutate: vi.fn(),
    isPending: false,
    isSuccess: false,
    isError: false,
    isIdle: true,
    data: undefined,
    error: null,
    reset: vi.fn(),
    status: 'idle',
    failureCount: 0,
    failureReason: null,
    submittedAt: 0,
    variables: undefined,
    context: undefined,
    isPaused: false,
    mutateAsync: vi.fn(),
    ...overrides,
  } as never;
}

function renderStatusBar(overrides: Partial<Parameters<typeof StatusBar>[0]> = {}) {
  const handleStatusAdvancement = vi.fn();
  const handleDelete = vi.fn();
  const statusMutation = makeMutation();
  const deleteMutation = makeMutation();
  const props = {
    orgId: 'org-1',
    loanId: 'loan-1',
    loan: makeLoan(),
    formData: baseFormData,
    daysRemaining: null,
    statusMutation,
    deleteMutation,
    handleStatusAdvancement,
    handleDelete,
    purposeLabel: 'Exhibition',
    ...overrides,
  };
  const utils = render(
    <MemoryRouter>
      <StatusBar {...props} />
    </MemoryRouter>
  );
  return { ...utils, ...props };
}

describe('WorkflowProgressIndicator', () => {
  it('renders nothing for cancelled status', () => {
    const { container } = render(<WorkflowProgressIndicator loan={makeLoan({ status: 'cancelled' })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the workflow strip and label heading', () => {
    render(<WorkflowProgressIndicator loan={makeLoan({ status: 'requested' })} />);
    expect(screen.getByText('Loan Workflow')).toBeInTheDocument();
  });

  it('renders all 5 phase labels', () => {
    render(<WorkflowProgressIndicator loan={makeLoan({ status: 'on_loan' })} />);
    // Each label is rendered in the strip
    ['Request', 'Agreement', 'Transit', 'Active', 'Closing'].forEach(label => {
      expect(screen.getByText(label)).toBeInTheDocument();
    });
  });

  it('shows hint text combining sub-status and guidance for requested', () => {
    render(<WorkflowProgressIndicator loan={makeLoan({ status: 'requested' })} />);
    expect(screen.getByText(/Awaiting approval/i)).toBeInTheDocument();
  });

  it('shows hint text for on_loan status', () => {
    render(<WorkflowProgressIndicator loan={makeLoan({ status: 'on_loan' })} />);
    expect(screen.getByText(/Objects currently on loan/i)).toBeInTheDocument();
  });

  it('shows hint text for closed status', () => {
    render(<WorkflowProgressIndicator loan={makeLoan({ status: 'closed' })} />);
    expect(screen.getByText(/Loan completed/i)).toBeInTheDocument();
  });
});

describe('DaysRemainingAlert', () => {
  it('renders nothing when daysRemaining is null', () => {
    const { container } = render(<DaysRemainingAlert daysRemaining={null} status="on_loan" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when status is not on_loan', () => {
    const { container } = render(<DaysRemainingAlert daysRemaining={5} status="approved" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when daysRemaining is more than 30', () => {
    const { container } = render(<DaysRemainingAlert daysRemaining={60} status="on_loan" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when daysRemaining is negative (overdue)', () => {
    const { container } = render(<DaysRemainingAlert daysRemaining={-5} status="on_loan" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders "expires today" when daysRemaining is 0', () => {
    render(<DaysRemainingAlert daysRemaining={0} status="on_loan" />);
    expect(screen.getByText('Loan expires today!')).toBeInTheDocument();
  });

  it('renders day count when 1-30 days remaining', () => {
    render(<DaysRemainingAlert daysRemaining={14} status="on_loan" />);
    expect(screen.getByText('14 days remaining')).toBeInTheDocument();
  });

  it('shows guidance about return / renewal', () => {
    render(<DaysRemainingAlert daysRemaining={5} status="on_loan" />);
    expect(screen.getByText(/Coordinate return or request renewal/i)).toBeInTheDocument();
  });
});

describe('StatusBar', () => {
  it('renders status pill with label', () => {
    renderStatusBar({ loan: makeLoan({ status: 'requested' }) });
    expect(screen.getByText('Requested')).toBeInTheDocument();
  });

  it('shows purpose label', () => {
    renderStatusBar({ purposeLabel: 'Research' });
    expect(screen.getByText('Research')).toBeInTheDocument();
  });

  it('shows Approve button when status is requested', () => {
    const { handleStatusAdvancement } = renderStatusBar({ loan: makeLoan({ status: 'requested' }) });
    const btn = screen.getByRole('button', { name: /approve/i });
    fireEvent.click(btn);
    expect(handleStatusAdvancement).toHaveBeenCalledWith('approved', 'Approved');
  });

  it('shows Mark Received button when status is approved', () => {
    const { handleStatusAdvancement } = renderStatusBar({ loan: makeLoan({ status: 'approved' }) });
    const btn = screen.getByRole('button', { name: /mark received/i });
    fireEvent.click(btn);
    expect(handleStatusAdvancement).toHaveBeenCalledWith('received', 'Received');
  });

  it('shows Mark On Loan button when status is received', () => {
    const { handleStatusAdvancement } = renderStatusBar({ loan: makeLoan({ status: 'received' }) });
    const btn = screen.getByRole('button', { name: /mark on loan/i });
    fireEvent.click(btn);
    expect(handleStatusAdvancement).toHaveBeenCalledWith('on_loan', 'On Loan');
  });

  it('shows Mark Returned button when status is on_loan', () => {
    const { handleStatusAdvancement } = renderStatusBar({ loan: makeLoan({ status: 'on_loan' }) });
    const btn = screen.getByRole('button', { name: /mark returned/i });
    fireEvent.click(btn);
    expect(handleStatusAdvancement).toHaveBeenCalledWith('returned', 'Returned');
  });

  it('shows Create Return Exit link when status is returned', () => {
    renderStatusBar({
      loan: makeLoan({ status: 'returned' }),
      formData: { ...baseFormData, lender_id: 'lender-1' },
    });
    const link = screen.getByRole('link', { name: /create return exit/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toContain('reference_type=loan_in');
    expect(link.getAttribute('href')).toContain('reference_id=loan-1');
    expect(link.getAttribute('href')).toContain('recipient_id=lender-1');
  });

  it('always renders the change status dropdown', () => {
    renderStatusBar({ loan: makeLoan({ status: 'requested' }) });
    expect(screen.getByTestId('change-status-dropdown')).toBeInTheDocument();
  });

  it('disables primary action while a status mutation is pending', () => {
    renderStatusBar({
      loan: makeLoan({ status: 'requested' }),
      statusMutation: makeMutation({ isPending: true, status: 'pending' }),
    });
    expect(screen.getByRole('button', { name: /approve/i })).toBeDisabled();
  });
});
