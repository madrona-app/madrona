import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LoanOutDispatchDialog } from '../../../pages/collections/LoanOutWorkspacePage/LoanOutDispatchDialog';
import type { LoanObject } from '../../../pages/collections/LoanOutWorkspacePage/types';

function makeObject(overrides: Partial<LoanObject> = {}): LoanObject {
  return {
    loan_object_id: 'lo-1',
    loan_out_id: 'loan-1',
    organization_id: 'org-1',
    object_id: 'obj-1',
    ...overrides,
  };
}

describe('LoanOutDispatchDialog', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <LoanOutDispatchDialog
        isOpen={false}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        loanObjects={[]}
        orgId="org-1"
        loanId="loan-1"
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the dialog header when open', () => {
    render(
      <LoanOutDispatchDialog
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        loanObjects={[]}
        orgId="org-1"
        loanId="loan-1"
      />
    );
    expect(screen.getAllByText('Dispatch Loan').length).toBeGreaterThan(0);
  });

  it('shows "no objects" when none provided', () => {
    render(
      <LoanOutDispatchDialog
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        loanObjects={[]}
        orgId="org-1"
        loanId="loan-1"
      />
    );
    expect(screen.getByText('No objects on this loan')).toBeInTheDocument();
  });

  it('shows fraction of objects with condition reports', () => {
    render(
      <LoanOutDispatchDialog
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        loanObjects={[
          makeObject({ loan_object_id: 'a', condition_report_out_id: 'cr-1' }),
          makeObject({ loan_object_id: 'b' }),
          makeObject({ loan_object_id: 'c' }),
        ]}
        orgId="org-1"
        loanId="loan-1"
      />
    );
    expect(screen.getByText(/1 of 3 objects have a condition report/i)).toBeInTheDocument();
    // Warning hint visible
    expect(screen.getByText(/Condition reports can be linked from the Objects section/i)).toBeInTheDocument();
  });

  it('does not show warning when all objects have condition reports', () => {
    render(
      <LoanOutDispatchDialog
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        loanObjects={[
          makeObject({ loan_object_id: 'a', condition_report_out_id: 'cr-1' }),
          makeObject({ loan_object_id: 'b', condition_report_out_id: 'cr-2' }),
        ]}
        orgId="org-1"
        loanId="loan-1"
      />
    );
    expect(screen.queryByText(/Condition reports can be linked from the Objects section/i)).toBeNull();
  });

  it('lists side effects of dispatching', () => {
    render(
      <LoanOutDispatchDialog
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        loanObjects={[]}
        orgId="org-1"
        loanId="loan-1"
      />
    );
    expect(screen.getByText('Create an object exit record')).toBeInTheDocument();
    expect(screen.getByText('Record a movement for each object')).toBeInTheDocument();
  });

  it('calls onClose when Cancel clicked', () => {
    const onClose = vi.fn();
    render(
      <LoanOutDispatchDialog
        isOpen={true}
        onClose={onClose}
        onConfirm={vi.fn()}
        loanObjects={[]}
        orgId="org-1"
        loanId="loan-1"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onConfirm when Dispatch button clicked', () => {
    const onConfirm = vi.fn();
    render(
      <LoanOutDispatchDialog
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={onConfirm}
        loanObjects={[]}
        orgId="org-1"
        loanId="loan-1"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /dispatch loan/i }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('shows loading state and disables actions when isLoading', () => {
    render(
      <LoanOutDispatchDialog
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        loanObjects={[]}
        orgId="org-1"
        loanId="loan-1"
        isLoading
      />
    );
    expect(screen.getByText(/Dispatching\.\.\./i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeDisabled();
  });
});
