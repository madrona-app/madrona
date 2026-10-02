import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WorkflowIndicator } from '../../../pages/collections/LoanOutWorkspacePage/WorkflowIndicator';

describe('WorkflowIndicator (loan out)', () => {
  it('renders nothing for cancelled status', () => {
    const { container } = render(<WorkflowIndicator status="cancelled" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for declined status', () => {
    const { container } = render(<WorkflowIndicator status="declined" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the strip for requested status', () => {
    render(<WorkflowIndicator status="requested" />);
    expect(screen.getByText('Loan Workflow')).toBeInTheDocument();
    expect(screen.getByText(/Awaiting approval/i)).toBeInTheDocument();
  });

  it('shows step labels for each workflow step', () => {
    render(<WorkflowIndicator status="approved" />);
    expect(screen.getByText('Requested')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('Agreement Sent')).toBeInTheDocument();
  });

  it('shows hint text for in_transit', () => {
    render(<WorkflowIndicator status="in_transit" />);
    expect(screen.getByText(/Objects in transit to borrower/i)).toBeInTheDocument();
  });

  it('shows hint text for on_loan', () => {
    render(<WorkflowIndicator status="on_loan" />);
    expect(screen.getByText(/Objects currently on loan/i)).toBeInTheDocument();
  });

  it('shows hint text for closed', () => {
    render(<WorkflowIndicator status="closed" />);
    expect(screen.getByText(/Loan completed/i)).toBeInTheDocument();
  });

  it('falls back to first step when status is unknown', () => {
    render(<WorkflowIndicator status="some_unknown_status" />);
    // Should still render
    expect(screen.getByText('Loan Workflow')).toBeInTheDocument();
  });
});
