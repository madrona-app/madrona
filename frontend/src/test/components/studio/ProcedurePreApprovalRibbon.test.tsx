import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProcedurePreApprovalRibbon } from '../../../components/studio/ProcedurePreApprovalRibbon';
import type { ProcedureValidation } from '../../../lib/api/drafts';

function val(over: Partial<ProcedureValidation> = {}): ProcedureValidation {
  return {
    procedure_type: 'acquisition',
    procedure_label: 'Acquisition',
    procedure: 'Acquisition',
    evaluated_status: 'proposed',
    blocking_total: 0,
    blocking_met: 0,
    passed: true,
    missing: [],
    ...over,
  };
}

describe('ProcedurePreApprovalRibbon', () => {
  it('is NEUTRAL (no validated claim) when nothing was checked at the proposal stage', () => {
    render(<ProcedurePreApprovalRibbon procedure={val()} />);
    expect(screen.getByText('Acquisition')).toBeInTheDocument();
    expect(screen.getByText(/follows the procedure/)).toBeInTheDocument();
    // Must NOT assert a validation that didn't happen.
    expect(screen.queryByText(/validated/)).not.toBeInTheDocument();
  });

  it('claims a pass only when real requirements were met', () => {
    render(<ProcedurePreApprovalRibbon procedure={val({
      procedure_label: 'Valuation', blocking_total: 5, blocking_met: 5, passed: true,
    })} />);
    expect(screen.getByText(/meets 5\/5 requirements/)).toBeInTheDocument();
  });

  it('lists the unmet requirements on expand when not passed', () => {
    render(<ProcedurePreApprovalRibbon procedure={val({
      procedure_label: 'Valuation', blocking_total: 5, blocking_met: 3, passed: false,
      missing: [
        { id: 'valuation_amount', label: 'Valuation amount' },
        { id: 'valuation_date', label: 'Valuation date' },
      ],
    })} />);
    expect(screen.getByText(/2 requirements to resolve/)).toBeInTheDocument();
    // Collapsed by default; expand reveals the specifics.
    expect(screen.queryByText('Valuation amount')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Valuation amount')).toBeInTheDocument();
    expect(screen.getByText('Valuation date')).toBeInTheDocument();
  });
});
