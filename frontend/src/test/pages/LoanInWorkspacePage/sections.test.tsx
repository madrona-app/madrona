import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DatesSection } from '../../../pages/collections/LoanInWorkspacePage/DatesSection';
import { ClosingSection } from '../../../pages/collections/LoanInWorkspacePage/ClosingSection';
import { LogisticsSection } from '../../../pages/collections/LoanInWorkspacePage/LogisticsSection';
import { defaultFormData } from '../../../pages/collections/LoanInWorkspacePage/types';
import type { FormData } from '../../../pages/collections/LoanInWorkspacePage/types';
import type { LoanIn } from '../../../lib/schemas';

const baseFormData: FormData = { ...defaultFormData };
const expandAll: Record<string, boolean> = {
  lender: true, details: true, dates: true, insurance: true, facility: true,
  shipments: true, agreement: true, 'document-location': true, 'loan-contact': true,
  notes: true, monitoring: true, closing: true, history: true, discussion: true,
  'lender-authorization': true, linkedEntry: true, linkedExit: true,
  'condition-reports': true, renewals: true, objects: true,
};
const sectionCompletions: Record<string, never> = {} as never;

const currencyOptions = [
  { value: 'USD', label: 'USD — US Dollar' },
  { value: 'EUR', label: 'EUR — Euro' },
];

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

describe('DatesSection (LoanIn)', () => {
  it('renders all four key dates with editable inputs', () => {
    render(
      <DatesSection
        formData={baseFormData}
        isEditing
        isCreateMode
        loan={undefined}
        expandedSections={expandAll}
        sectionCompletions={sectionCompletions}
        updateField={vi.fn()}
        toggleSection={vi.fn()}
        getSectionOrder={() => undefined}
      />
    );
    expect(screen.getByLabelText(/request date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/approval date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/loan start date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/loan end date/i)).toBeInTheDocument();
  });

  it('updates approval_date when changed', () => {
    const updateField = vi.fn();
    render(
      <DatesSection
        formData={baseFormData}
        isEditing
        isCreateMode
        loan={undefined}
        expandedSections={expandAll}
        sectionCompletions={sectionCompletions}
        updateField={updateField}
        toggleSection={vi.fn()}
        getSectionOrder={() => undefined}
      />
    );
    fireEvent.change(screen.getByLabelText(/approval date/i), { target: { value: '2025-01-15' } });
    expect(updateField).toHaveBeenCalledWith('approval_date', '2025-01-15');
  });
});

describe('ClosingSection (LoanIn)', () => {
  it('renders the invoice-sent checkbox', () => {
    render(
      <ClosingSection
        formData={baseFormData}
        isExpanded
        isEditing
        order={undefined}
        onToggle={vi.fn()}
        onUpdateField={vi.fn()}
      />
    );
    expect(screen.getByLabelText(/invoice sent/i)).toBeInTheDocument();
  });

  it('hides invoice details when invoice not sent', () => {
    render(
      <ClosingSection
        formData={baseFormData}
        isExpanded
        isEditing
        order={undefined}
        onToggle={vi.fn()}
        onUpdateField={vi.fn()}
      />
    );
    expect(screen.queryByLabelText(/invoice date/i)).toBeNull();
  });

  it('shows invoice details when closing_invoice_sent is true', () => {
    render(
      <ClosingSection
        formData={{ ...baseFormData, closing_invoice_sent: true }}
        isExpanded
        isEditing
        order={undefined}
        onToggle={vi.fn()}
        onUpdateField={vi.fn()}
      />
    );
    expect(screen.getByLabelText(/invoice date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/invoice reference/i)).toBeInTheDocument();
  });

  it('forwards checkbox toggle to onUpdateField', () => {
    const onUpdate = vi.fn();
    render(
      <ClosingSection
        formData={baseFormData}
        isExpanded
        isEditing
        order={undefined}
        onToggle={vi.fn()}
        onUpdateField={onUpdate}
      />
    );
    fireEvent.click(screen.getByLabelText(/^invoice sent$/i));
    expect(onUpdate).toHaveBeenCalledWith('closing_invoice_sent', true);
  });
});

describe('LogisticsSection (LoanIn)', () => {
  it('renders insurance, facility, shipping inputs', () => {
    render(
      <LogisticsSection
        formData={baseFormData}
        isEditing
        expandedSections={expandAll}
        updateField={vi.fn()}
        toggleSection={vi.fn()}
        getSectionOrder={() => undefined}
        currencyOptions={currencyOptions}
        isRestricted={() => false}
      />
    );
    expect(screen.getByLabelText(/insurance value/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^currency$/i)).toBeInTheDocument();
  });

  it('updates insurance_value', () => {
    const updateField = vi.fn();
    render(
      <LogisticsSection
        formData={baseFormData}
        isEditing
        expandedSections={expandAll}
        updateField={updateField}
        toggleSection={vi.fn()}
        getSectionOrder={() => undefined}
        currencyOptions={currencyOptions}
        isRestricted={() => false}
      />
    );
    fireEvent.change(screen.getByLabelText(/insurance value/i), { target: { value: '50000' } });
    expect(updateField).toHaveBeenCalledWith('insurance_value', '50000');
  });

  it('marks insurance_value as restricted when isRestricted returns true', () => {
    render(
      <LogisticsSection
        formData={baseFormData}
        isEditing
        expandedSections={expandAll}
        updateField={vi.fn()}
        toggleSection={vi.fn()}
        getSectionOrder={() => undefined}
        currencyOptions={currencyOptions}
        isRestricted={(field) => field === 'insurance_value'}
      />
    );
    expect(screen.getAllByText(/Restricted/i).length).toBeGreaterThanOrEqual(1);
  });
});

// avoid unused-import warning for makeLoan
void makeLoan;
