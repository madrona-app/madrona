import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  DaysRemainingAlert,
  MissingInsuranceAlert,
} from '../../../pages/collections/LoanOutWorkspacePage/AlertBanners';
import type { ExistingLoan } from '../../../pages/collections/LoanOutWorkspacePage/types';

function makeLoan(overrides: Partial<ExistingLoan> = {}): ExistingLoan {
  return {
    loan_out_id: 'loan-1',
    created_at: '2024-01-01T00:00:00Z',
    status: 'on_loan',
    ...overrides,
  };
}

describe('DaysRemainingAlert', () => {
  it('renders nothing when status is not on_loan', () => {
    const { container } = render(
      <DaysRemainingAlert existingLoan={makeLoan({ status: 'approved', loan_end_date: '2099-01-01' })} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when loan_end_date is missing', () => {
    const { container } = render(
      <DaysRemainingAlert existingLoan={makeLoan({ loan_end_date: null })} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when more than 30 days remain', () => {
    // a date 60 days in the future
    const future = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    const { container } = render(
      <DaysRemainingAlert existingLoan={makeLoan({ loan_end_date: future.toISOString().slice(0, 10) })} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when end_date is in the past (overdue)', () => {
    const past = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const { container } = render(
      <DaysRemainingAlert existingLoan={makeLoan({ loan_end_date: past.toISOString().slice(0, 10) })} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders day-count alert when within 30 days', () => {
    const soon = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    render(
      <DaysRemainingAlert existingLoan={makeLoan({ loan_end_date: soon.toISOString().slice(0, 10) })} />
    );
    expect(screen.getByText(/days remaining/i)).toBeInTheDocument();
    expect(screen.getByText(/Coordinate return with borrower/i)).toBeInTheDocument();
  });
});

describe('MissingInsuranceAlert', () => {
  it('renders nothing when status is not on_loan', () => {
    const { container } = render(
      <MissingInsuranceAlert existingLoan={makeLoan({ status: 'approved' })} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when certificate has been received', () => {
    const { container } = render(
      <MissingInsuranceAlert existingLoan={makeLoan({ certificate_of_insurance_received: true })} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders alert when on_loan and no certificate', () => {
    render(
      <MissingInsuranceAlert existingLoan={makeLoan({ certificate_of_insurance_received: false })} />
    );
    expect(screen.getByText('Missing Certificate of Insurance')).toBeInTheDocument();
    expect(screen.getByText(/Request certificate from borrower/i)).toBeInTheDocument();
  });

  it('treats null certificate flag as missing', () => {
    render(
      <MissingInsuranceAlert existingLoan={makeLoan({ certificate_of_insurance_received: null })} />
    );
    expect(screen.getByText('Missing Certificate of Insurance')).toBeInTheDocument();
  });
});
