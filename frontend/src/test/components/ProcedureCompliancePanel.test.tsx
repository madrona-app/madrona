import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProcedureCompliancePanel } from '../../components/collections/ProcedureCompliancePanel';
import type { SectionRequirements } from '../../lib/procedureValidation';

const SECTIONS: SectionRequirements[] = [
  {
    id: 'entry',
    title: 'Entry Info',
    procedureRef: 'Test',
    fields: [
      { field: 'entry_number', label: 'Entry number', required: true },
      { field: 'entry_date', label: 'Entry date', required: true },
    ],
  },
  {
    id: 'depositor',
    title: 'Depositor',
    procedureRef: 'Test',
    fields: [
      { field: 'depositor_name', label: 'Depositor name', required: true },
    ],
  },
];

function renderPanel(props: Partial<Parameters<typeof ProcedureCompliancePanel>[0]> = {}) {
  return render(
    <ProcedureCompliancePanel
      procedure="object_entry"
      sections={SECTIONS}
      record={{}}
      currentStatus="received"
      {...props}
    />,
  );
}

describe('ProcedureCompliancePanel', () => {
  it('uses the procedure label in the title', () => {
    renderPanel();
    expect(screen.getByText('Entry Requirements')).toBeInTheDocument();
  });

  it('uses "Loan Requirements" for loan_in procedure', () => {
    renderPanel({ procedure: 'loan_in' });
    expect(screen.getByText('Loan Requirements')).toBeInTheDocument();
  });

  it('shows "Not ready" status when sections have missing required fields', () => {
    renderPanel({ record: {} });
    expect(screen.getByText(/Not ready: /)).toBeInTheDocument();
  });

  it('shows "Ready for next step" when all section required fields are present (movement)', () => {
    // Use the built-in movement procedure with its full required field set —
    // ProcedureCompliancePanel computes overall readiness using the builtin
    // procedure sections, not the props.sections argument.
    renderPanel({
      procedure: 'movement',
      sections: [
        {
          id: 'object',
          title: 'Object',
          procedureRef: 'Test',
          fields: [{ field: 'object_id', label: 'Object', required: true }],
        },
        {
          id: 'movement',
          title: 'Movement Details',
          procedureRef: 'Test',
          fields: [
            { field: 'reason', label: 'Reason', required: true },
            { field: 'from_location_id', label: 'From location', required: false },
            { field: 'to_location_id', label: 'To location', required: true },
            { field: 'movement_date', label: 'Movement date', required: true },
            { field: 'status', label: 'Status', required: true },
          ],
        },
        {
          id: 'details',
          title: 'Handler & Notes',
          procedureRef: 'Test',
          fields: [
            { field: 'handler_id', label: 'Handler', required: false },
            { field: 'movement_note', label: 'Notes', required: false },
          ],
        },
      ],
      record: {
        object_id: 'o-1',
        reason: 'storage',
        to_location_id: 'loc-1',
        movement_date: '2024-01-01',
        status: 'in_transit',
      },
    });
    expect(screen.getByText('Ready for next step')).toBeInTheDocument();
  });

  it('renders rows for each section when expanded', () => {
    renderPanel({ defaultExpanded: true });
    expect(screen.getByText('Entry Info')).toBeInTheDocument();
    expect(screen.getByText('Depositor')).toBeInTheDocument();
  });

  it('forwards row clicks to onSectionClick with the section id', () => {
    const onSectionClick = vi.fn();
    renderPanel({ defaultExpanded: true, onSectionClick });
    fireEvent.click(screen.getByText('Entry Info'));
    expect(onSectionClick).toHaveBeenCalledWith('entry');
  });

  it('forwards Fix-blocker click to first incomplete section', () => {
    const onSectionClick = vi.fn();
    renderPanel({
      record: { entry_number: 'E-1', entry_date: '2024-01-01' }, // depositor_name missing
      onSectionClick,
    });
    // Fix blocker is rendered in the collapsed header
    fireEvent.click(screen.getByText('Fix blocker'));
    expect(onSectionClick).toHaveBeenCalledWith('depositor');
  });

  it('does not render Fix blocker when all required fields are present', () => {
    renderPanel({
      sections: [
        {
          id: 'entry',
          title: 'Entry Info',
          procedureRef: 'Test',
          fields: [{ field: 'entry_number', label: 'Entry number', required: true }],
        },
      ],
      record: { entry_number: 'E-1' },
    });
    expect(screen.queryByText('Fix blocker')).not.toBeInTheDocument();
  });
});
