import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Stub heavy children before importing SUTs
vi.mock('../../../components/collections/SignedDocumentSlot', () => ({
  SignedDocumentSlot: ({ title }: { title: string }) => (
    <div data-testid="signed-document-slot">{title}</div>
  ),
  default: ({ title }: { title: string }) => (
    <div data-testid="signed-document-slot">{title}</div>
  ),
}));

import { DatesSection } from '../../../pages/collections/LoanOutWorkspacePage/DatesSection';
import { NotesSection } from '../../../pages/collections/LoanOutWorkspacePage/NotesSection';
import { VenueSection } from '../../../pages/collections/LoanOutWorkspacePage/VenueSection';
import { InsuranceSection } from '../../../pages/collections/LoanOutWorkspacePage/InsuranceSection';
import { FacilitySection } from '../../../pages/collections/LoanOutWorkspacePage/FacilitySection';
import { ClosingSection } from '../../../pages/collections/LoanOutWorkspacePage/ClosingSection';
import { AgreementSection } from '../../../pages/collections/LoanOutWorkspacePage/AgreementSection';
import { LoanDetailsSection } from '../../../pages/collections/LoanOutWorkspacePage/LoanDetailsSection';
import { BorrowerSection } from '../../../pages/collections/LoanOutWorkspacePage/BorrowerSection';
import { defaultFormData } from '../../../pages/collections/LoanOutWorkspacePage/constants';
import type { FormData, ExistingLoan, Contact } from '../../../pages/collections/LoanOutWorkspacePage/types';

const baseFormData: FormData = { ...defaultFormData } as FormData;

function makeLoan(overrides: Partial<ExistingLoan> = {}): ExistingLoan {
  return {
    loan_out_id: 'loan-1',
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('DatesSection (LoanOut)', () => {
  it('renders three editable date fields in edit mode', () => {
    const onUpdate = vi.fn();
    render(
      <DatesSection
        formData={baseFormData}
        existingLoan={undefined}
        isCreateMode
        isExpanded
        isEditing
        order={undefined}
        onToggle={vi.fn()}
        onUpdateField={onUpdate}
        onFieldBlur={vi.fn()}
      />
    );
    // Labels visible
    expect(screen.getByText('Request Date')).toBeInTheDocument();
    expect(screen.getByText('Loan Start Date')).toBeInTheDocument();
    expect(screen.getByText('Loan End Date')).toBeInTheDocument();
  });

  it('emits onUpdateField when user changes start date', () => {
    const onUpdate = vi.fn();
    render(
      <DatesSection
        formData={baseFormData}
        existingLoan={undefined}
        isCreateMode
        isExpanded
        isEditing
        order={undefined}
        onToggle={vi.fn()}
        onUpdateField={onUpdate}
        onFieldBlur={vi.fn()}
      />
    );
    const input = screen.getByLabelText(/loan start date/i);
    fireEvent.change(input, { target: { value: '2025-05-01' } });
    expect(onUpdate).toHaveBeenCalledWith('loan_start_date', '2025-05-01');
  });

  it('shows actual dispatch and return dates for existing loans', () => {
    render(
      <DatesSection
        formData={baseFormData}
        existingLoan={makeLoan({
          actual_dispatch_date: '2024-02-01',
          actual_return_date: '2024-12-01',
          renewal_count: 1,
          max_renewals: 3,
        })}
        isCreateMode={false}
        isExpanded
        isEditing={false}
        order={undefined}
        onToggle={vi.fn()}
        onUpdateField={vi.fn()}
        onFieldBlur={vi.fn()}
      />
    );
    expect(screen.getByText('Actual Dispatch Date')).toBeInTheDocument();
    expect(screen.getByText('Actual Return Date')).toBeInTheDocument();
    expect(screen.getByText('Renewals')).toBeInTheDocument();
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
  });

  it('hides historical block in create mode', () => {
    render(
      <DatesSection
        formData={baseFormData}
        existingLoan={undefined}
        isCreateMode
        isExpanded
        isEditing
        order={undefined}
        onToggle={vi.fn()}
        onUpdateField={vi.fn()}
        onFieldBlur={vi.fn()}
      />
    );
    expect(screen.queryByText('Renewals')).toBeNull();
  });
});

describe('NotesSection (LoanOut)', () => {
  it('renders the loan_note value', () => {
    render(
      <NotesSection
        formData={{ ...baseFormData, loan_note: 'Handle with care' }}
        isExpanded
        isEditing
        order={undefined}
        onToggle={vi.fn()}
        onUpdateField={vi.fn()}
        onFieldBlur={vi.fn()}
      />
    );
    expect(screen.getByDisplayValue('Handle with care')).toBeInTheDocument();
  });

  it('forwards textarea changes to onUpdateField', () => {
    const onUpdate = vi.fn();
    render(
      <NotesSection
        formData={baseFormData}
        isExpanded
        isEditing
        order={undefined}
        onToggle={vi.fn()}
        onUpdateField={onUpdate}
        onFieldBlur={vi.fn()}
      />
    );
    const textarea = screen.getByLabelText(/loan notes/i);
    fireEvent.change(textarea, { target: { value: 'New note' } });
    expect(onUpdate).toHaveBeenCalledWith('loan_note', 'New note');
  });
});

describe('VenueSection (LoanOut)', () => {
  it('renders all venue fields in edit mode', () => {
    render(
      <VenueSection
        formData={baseFormData}
        isExpanded
        isEditing
        order={undefined}
        onToggle={vi.fn()}
        onUpdateField={vi.fn()}
        onFieldBlur={vi.fn()}
      />
    );
    expect(screen.getByLabelText(/venue name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/street address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^city$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/state\/province/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/postal code/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^country$/i)).toBeInTheDocument();
  });

  it('updates city via onUpdateField', () => {
    const onUpdate = vi.fn();
    render(
      <VenueSection
        formData={baseFormData}
        isExpanded
        isEditing
        order={undefined}
        onToggle={vi.fn()}
        onUpdateField={onUpdate}
        onFieldBlur={vi.fn()}
      />
    );
    fireEvent.change(screen.getByLabelText(/^city$/i), { target: { value: 'Berlin' } });
    expect(onUpdate).toHaveBeenCalledWith('venue_city', 'Berlin');
  });
});

describe('InsuranceSection (LoanOut)', () => {
  it('renders insurance fields and currency dropdown', () => {
    render(
      <InsuranceSection
        formData={baseFormData}
        isExpanded
        isEditing
        order={undefined}
        onToggle={vi.fn()}
        onUpdateField={vi.fn()}
        onFieldBlur={vi.fn()}
        isRestricted={() => false}
      />
    );
    expect(screen.getByLabelText(/insurance value/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^currency$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/coverage type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/insurance requirements/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/certificate of insurance received/i)).toBeInTheDocument();
  });

  it('updates currency via onUpdateField', () => {
    const onUpdate = vi.fn();
    render(
      <InsuranceSection
        formData={baseFormData}
        isExpanded
        isEditing
        order={undefined}
        onToggle={vi.fn()}
        onUpdateField={onUpdate}
        onFieldBlur={vi.fn()}
        isRestricted={() => false}
      />
    );
    fireEvent.change(screen.getByLabelText(/^currency$/i), { target: { value: 'GBP' } });
    expect(onUpdate).toHaveBeenCalledWith('insurance_currency', 'GBP');
  });

  it('marks insurance_value_total as restricted when isRestricted returns true', () => {
    render(
      <InsuranceSection
        formData={baseFormData}
        isExpanded
        isEditing
        order={undefined}
        onToggle={vi.fn()}
        onUpdateField={vi.fn()}
        onFieldBlur={vi.fn()}
        isRestricted={(field) => field === 'insurance_value_total'}
      />
    );
    // Restricted placeholder text should appear
    expect(screen.getAllByText(/Restricted/i).length).toBeGreaterThanOrEqual(1);
  });
});

describe('FacilitySection (LoanOut)', () => {
  it('renders all facility checkboxes and report date', () => {
    render(
      <FacilitySection
        formData={baseFormData}
        isExpanded
        isEditing
        order={undefined}
        onToggle={vi.fn()}
        onUpdateField={vi.fn()}
        onFieldBlur={vi.fn()}
      />
    );
    expect(screen.getByLabelText(/facility report received/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/report approved/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/security conditions confirmed/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/report date/i)).toBeInTheDocument();
  });

  it('toggles facility_report_received', () => {
    const onUpdate = vi.fn();
    render(
      <FacilitySection
        formData={baseFormData}
        isExpanded
        isEditing
        order={undefined}
        onToggle={vi.fn()}
        onUpdateField={onUpdate}
        onFieldBlur={vi.fn()}
      />
    );
    fireEvent.click(screen.getByLabelText(/facility report received/i));
    expect(onUpdate).toHaveBeenCalledWith('facility_report_received', true);
  });
});

describe('AgreementSection (LoanOut)', () => {
  it('renders all three editable agreement fields', () => {
    render(
      <AgreementSection
        formData={baseFormData}
        isExpanded
        isEditing
        order={undefined}
        onToggle={vi.fn()}
        onUpdateField={vi.fn()}
        onFieldBlur={vi.fn()}
        organizationId="org-1"
        loanId="loan-1"
      />
    );
    expect(screen.getByLabelText(/agreement reference/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^signed date$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/document location/i)).toBeInTheDocument();
  });

  it('updates document_location via onUpdateField', () => {
    const onUpdate = vi.fn();
    render(
      <AgreementSection
        formData={baseFormData}
        isExpanded
        isEditing
        order={undefined}
        onToggle={vi.fn()}
        onUpdateField={onUpdate}
        onFieldBlur={vi.fn()}
        organizationId="org-1"
        loanId="loan-1"
      />
    );
    fireEvent.change(screen.getByLabelText(/document location/i), { target: { value: 'Drawer 5' } });
    expect(onUpdate).toHaveBeenCalledWith('document_location', 'Drawer 5');
  });

  it('renders SignedDocumentSlot when loanId is set', () => {
    render(
      <AgreementSection
        formData={baseFormData}
        isExpanded
        isEditing
        order={undefined}
        onToggle={vi.fn()}
        onUpdateField={vi.fn()}
        onFieldBlur={vi.fn()}
        organizationId="org-1"
        loanId="loan-1"
      />
    );
    expect(screen.getByTestId('signed-document-slot')).toBeInTheDocument();
  });

  it('hides SignedDocumentSlot in create mode (no loanId)', () => {
    render(
      <AgreementSection
        formData={baseFormData}
        isExpanded
        isEditing
        order={undefined}
        onToggle={vi.fn()}
        onUpdateField={vi.fn()}
        onFieldBlur={vi.fn()}
        organizationId="org-1"
        loanId={undefined}
      />
    );
    expect(screen.queryByTestId('signed-document-slot')).toBeNull();
  });
});

describe('LoanDetailsSection (LoanOut)', () => {
  const purposeOptions = [
    { value: 'exhibition', label: 'Exhibition' },
    { value: 'research', label: 'Research' },
  ];

  it('renders loan purpose select and exhibition title', () => {
    render(
      <LoanDetailsSection
        formData={baseFormData}
        isExpanded
        isEditing
        order={undefined}
        onToggle={vi.fn()}
        onUpdateField={vi.fn()}
        onFieldBlur={vi.fn()}
        loanPurposeOptions={purposeOptions}
        isRestricted={() => false}
        orgId="org-1"
      />
    );
    expect(screen.getByLabelText(/loan purpose/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/exhibition title/i)).toBeInTheDocument();
  });

  it('updates loan_purpose when select changes', () => {
    const onUpdate = vi.fn();
    render(
      <LoanDetailsSection
        formData={baseFormData}
        isExpanded
        isEditing
        order={undefined}
        onToggle={vi.fn()}
        onUpdateField={onUpdate}
        onFieldBlur={vi.fn()}
        loanPurposeOptions={purposeOptions}
        isRestricted={() => false}
        orgId="org-1"
      />
    );
    fireEvent.change(screen.getByLabelText(/loan purpose/i), { target: { value: 'research' } });
    expect(onUpdate).toHaveBeenCalledWith('loan_purpose', 'research');
  });

  it('marks loan_conditions as restricted when isRestricted returns true', () => {
    render(
      <LoanDetailsSection
        formData={baseFormData}
        isExpanded
        isEditing
        order={undefined}
        onToggle={vi.fn()}
        onUpdateField={vi.fn()}
        onFieldBlur={vi.fn()}
        loanPurposeOptions={purposeOptions}
        isRestricted={(field) => field === 'loan_conditions'}
        orgId="org-1"
      />
    );
    expect(screen.getAllByText(/Restricted/i).length).toBeGreaterThanOrEqual(1);
  });
});

describe('BorrowerSection (LoanOut)', () => {
  const makeContact = (overrides: Partial<Contact> = {}): Contact => ({
    contact_id: 'b-1',
    name: 'Some Borrower',
    organization_name: 'Some Org',
    ...overrides,
  });

  it('renders search prompt when no borrower selected (edit mode)', () => {
    const onOpenSelector = vi.fn();
    render(
      <BorrowerSection
        formData={baseFormData}
        borrowerContact={undefined}
        borrowerContactPerson={undefined}
        isExpanded
        isEditing
        order={undefined}
        onToggle={vi.fn()}
        onUpdateField={vi.fn()}
        onFieldBlur={vi.fn()}
        onOpenSelector={onOpenSelector}
        onOpenContactPersonSelector={vi.fn()}
        isRestricted={() => false}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /search or create borrowing institution/i }));
    expect(onOpenSelector).toHaveBeenCalled();
  });

  it('shows selected borrower name when borrower_id and contact loaded', () => {
    render(
      <BorrowerSection
        formData={{ ...baseFormData, borrower_id: 'b-1' }}
        borrowerContact={makeContact({ name: 'Tate Modern', organization_name: 'Tate' })}
        borrowerContactPerson={undefined}
        isExpanded
        isEditing
        order={undefined}
        onToggle={vi.fn()}
        onUpdateField={vi.fn()}
        onFieldBlur={vi.fn()}
        onOpenSelector={vi.fn()}
        onOpenContactPersonSelector={vi.fn()}
        isRestricted={() => false}
      />
    );
    expect(screen.getByText('Tate Modern')).toBeInTheDocument();
    expect(screen.getByText('(Tate)')).toBeInTheDocument();
  });

  it('clears borrower_id when remove button clicked', () => {
    const onUpdateField = vi.fn();
    const { container } = render(
      <BorrowerSection
        formData={{ ...baseFormData, borrower_id: 'b-1' }}
        borrowerContact={makeContact()}
        borrowerContactPerson={undefined}
        isExpanded
        isEditing
        order={undefined}
        onToggle={vi.fn()}
        onUpdateField={onUpdateField}
        onFieldBlur={vi.fn()}
        onOpenSelector={vi.fn()}
        onOpenContactPersonSelector={vi.fn()}
        isRestricted={() => false}
      />
    );
    // The X (remove) button is the button inside the chip with semantic-error hover
    const removeBtn = container.querySelector('button.hover\\:text-semantic-error') as HTMLButtonElement | null;
    expect(removeBtn).toBeTruthy();
    fireEvent.click(removeBtn!);
    expect(onUpdateField).toHaveBeenCalledWith('borrower_id', '');
  });

  it('renders "Not specified" view-mode placeholder when no contact', () => {
    render(
      <BorrowerSection
        formData={baseFormData}
        borrowerContact={undefined}
        borrowerContactPerson={undefined}
        isExpanded
        isEditing={false}
        order={undefined}
        onToggle={vi.fn()}
        onUpdateField={vi.fn()}
        onFieldBlur={vi.fn()}
        onOpenSelector={vi.fn()}
        onOpenContactPersonSelector={vi.fn()}
        isRestricted={() => false}
      />
    );
    expect(screen.getAllByText('Not specified').length).toBeGreaterThanOrEqual(1);
  });

  it('hides contact person block when isRestricted returns true', () => {
    render(
      <BorrowerSection
        formData={baseFormData}
        borrowerContact={undefined}
        borrowerContactPerson={undefined}
        isExpanded
        isEditing
        order={undefined}
        onToggle={vi.fn()}
        onUpdateField={vi.fn()}
        onFieldBlur={vi.fn()}
        onOpenSelector={vi.fn()}
        onOpenContactPersonSelector={vi.fn()}
        isRestricted={(field) => field === 'borrower_contact'}
      />
    );
    expect(screen.queryByText('Contact Person')).toBeNull();
  });
});

describe('ClosingSection (LoanOut)', () => {
  it('renders closing checklist items', () => {
    render(
      <ClosingSection
        formData={baseFormData}
        isExpanded
        isEditing
        order={undefined}
        onToggle={vi.fn()}
        onUpdateField={vi.fn()}
        onFieldBlur={vi.fn()}
      />
    );
    expect(screen.getByLabelText(/invoice sent to borrower/i)).toBeInTheDocument();
  });

  it('toggles closing_invoice_sent when checkbox clicked', () => {
    const onUpdate = vi.fn();
    render(
      <ClosingSection
        formData={baseFormData}
        isExpanded
        isEditing
        order={undefined}
        onToggle={vi.fn()}
        onUpdateField={onUpdate}
        onFieldBlur={vi.fn()}
      />
    );
    fireEvent.click(screen.getByLabelText(/invoice sent to borrower/i));
    expect(onUpdate).toHaveBeenCalledWith('closing_invoice_sent', true);
  });
});
