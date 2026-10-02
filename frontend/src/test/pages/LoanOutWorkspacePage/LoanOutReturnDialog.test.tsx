import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LoanOutReturnDialog } from '../../../pages/collections/LoanOutWorkspacePage/LoanOutReturnDialog';
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

describe('LoanOutReturnDialog', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <LoanOutReturnDialog
        isOpen={false}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        loanObjects={[]}
        orgId="org-1"
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders header when open', () => {
    render(
      <LoanOutReturnDialog
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        loanObjects={[]}
        orgId="org-1"
      />
    );
    expect(screen.getAllByText('Mark Returned').length).toBeGreaterThan(0);
  });

  it('reports counts of return condition reports', () => {
    render(
      <LoanOutReturnDialog
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        loanObjects={[
          makeObject({ loan_object_id: 'a', condition_report_return_id: 'cr-r-1' }),
          makeObject({ loan_object_id: 'b' }),
        ]}
        orgId="org-1"
      />
    );
    expect(screen.getByText(/1 of 2 objects have a return condition report/i)).toBeInTheDocument();
  });

  it('hides the warning hint when all reports complete', () => {
    render(
      <LoanOutReturnDialog
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        loanObjects={[
          makeObject({ loan_object_id: 'a', condition_report_return_id: 'cr-r-1' }),
        ]}
        orgId="org-1"
      />
    );
    expect(screen.queryByText(/Return condition reports can be linked from the Objects section/i)).toBeNull();
  });

  it('shows warning hint when some return reports missing', () => {
    render(
      <LoanOutReturnDialog
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        loanObjects={[makeObject()]}
        orgId="org-1"
      />
    );
    expect(screen.getByText(/Return condition reports can be linked from the Objects section/i)).toBeInTheDocument();
  });

  it('triggers onConfirm on confirm click', () => {
    const onConfirm = vi.fn();
    render(
      <LoanOutReturnDialog
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={onConfirm}
        loanObjects={[]}
        orgId="org-1"
      />
    );
    // Find the primary action button in the footer
    const buttons = screen.getAllByRole('button');
    const confirmBtn = buttons.find(b => /mark returned/i.test(b.textContent || '') && b.className.includes('btn-primary'));
    expect(confirmBtn).toBeTruthy();
    fireEvent.click(confirmBtn!);
    expect(onConfirm).toHaveBeenCalled();
  });

  it('triggers onClose on cancel click', () => {
    const onClose = vi.fn();
    render(
      <LoanOutReturnDialog
        isOpen={true}
        onClose={onClose}
        onConfirm={vi.fn()}
        loanObjects={[]}
        orgId="org-1"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('disables cancel button while loading', () => {
    render(
      <LoanOutReturnDialog
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        loanObjects={[]}
        orgId="org-1"
        isLoading
      />
    );
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeDisabled();
  });
});
