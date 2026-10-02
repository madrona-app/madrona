import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StatusBar } from '../../../pages/collections/LoanOutWorkspacePage/StatusBar';
import type { ExistingLoan } from '../../../pages/collections/LoanOutWorkspacePage/types';

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

function makeLoan(overrides: Partial<ExistingLoan> = {}): ExistingLoan {
  return {
    loan_out_id: 'loan-1',
    created_at: '2024-01-01T00:00:00Z',
    status: 'requested',
    ...overrides,
  };
}

describe('StatusBar (loan out)', () => {
  it('renders the status pill label', () => {
    render(
      <StatusBar
        existingLoan={makeLoan({ status: 'requested' })}
        purposeLabel="Exhibition"
        onStatusChange={vi.fn()}
        isStatusPending={false}
      />
    );
    expect(screen.getByText('Requested')).toBeInTheDocument();
  });

  it('renders purpose label and insurance value when present', () => {
    render(
      <StatusBar
        existingLoan={makeLoan({ insurance_value_total: 50000, insurance_currency: 'USD' })}
        purposeLabel="Exhibition"
        onStatusChange={vi.fn()}
        isStatusPending={false}
      />
    );
    expect(screen.getByText('Exhibition')).toBeInTheDocument();
    expect(screen.getByText(/USD/)).toBeInTheDocument();
  });

  it('renders primary forward action: Approve when requested', () => {
    const onStatusChange = vi.fn();
    render(
      <StatusBar
        existingLoan={makeLoan({ status: 'requested' })}
        purposeLabel="Exhibition"
        onStatusChange={onStatusChange}
        isStatusPending={false}
      />
    );
    const btn = screen.getByRole('button', { name: /^approve$/i });
    fireEvent.click(btn);
    expect(onStatusChange).toHaveBeenCalledWith('approved');
  });

  it('renders forward action: Mark On Loan when in_transit', () => {
    const onStatusChange = vi.fn();
    render(
      <StatusBar
        existingLoan={makeLoan({ status: 'in_transit' })}
        purposeLabel="Exhibition"
        onStatusChange={onStatusChange}
        isStatusPending={false}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /mark on loan/i }));
    expect(onStatusChange).toHaveBeenCalledWith('on_loan');
  });

  it('renders forward action: Schedule Return when on_loan', () => {
    const onStatusChange = vi.fn();
    render(
      <StatusBar
        existingLoan={makeLoan({ status: 'on_loan' })}
        purposeLabel="Exhibition"
        onStatusChange={onStatusChange}
        isStatusPending={false}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /schedule return/i }));
    expect(onStatusChange).toHaveBeenCalledWith('return_scheduled');
  });

  it('renders forward action: Close Loan when returned', () => {
    const onStatusChange = vi.fn();
    render(
      <StatusBar
        existingLoan={makeLoan({ status: 'returned' })}
        purposeLabel="Exhibition"
        onStatusChange={onStatusChange}
        isStatusPending={false}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /close loan/i }));
    expect(onStatusChange).toHaveBeenCalledWith('closed');
  });

  it('does not render a primary action for declined / closed (no forward transition)', () => {
    render(
      <StatusBar
        existingLoan={makeLoan({ status: 'closed' })}
        purposeLabel="Exhibition"
        onStatusChange={vi.fn()}
        isStatusPending={false}
      />
    );
    expect(screen.queryByRole('button', { name: /approve|mark|schedule|close loan|send agreement/i })).toBeNull();
  });

  it('disables primary forward button while pending', () => {
    render(
      <StatusBar
        existingLoan={makeLoan({ status: 'requested' })}
        purposeLabel="Exhibition"
        onStatusChange={vi.fn()}
        isStatusPending={true}
      />
    );
    expect(screen.getByRole('button', { name: /^approve$/i })).toBeDisabled();
  });

  it('forwards isPending flag and currentStatus to dropdown', () => {
    render(
      <StatusBar
        existingLoan={makeLoan({ status: 'requested' })}
        purposeLabel="Exhibition"
        onStatusChange={vi.fn()}
        isStatusPending={true}
      />
    );
    const dropdown = screen.getByTestId('change-status-dropdown');
    expect(dropdown.getAttribute('data-current')).toBe('requested');
    expect(dropdown.getAttribute('data-pending')).toBe('true');
  });
});
