/**
 * Organization-added required fields on procedure forms: the marker and
 * aria-required reach the field, and a server refusal marks the fields
 * invalid, links them from an error summary that takes focus, and clears as
 * the user fills them in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import { checkA11y } from '../../a11y';
import { ApiError } from '../../../lib/apiClient';
import * as procedureHook from '../../../hooks/useProcedureRequirements';
import { EditableField, EditableSelect, WorkspaceSection } from '../../../components/workspace';
import {
  RequiredFieldsProvider,
} from '../../../components/workspace/RequiredFieldsContext';
import {
  useRevealSection,
  parseMissingRequirements,
} from '../../../components/workspace/requiredFields';

vi.mock('../../../hooks/useProcedureRequirements', () => ({
  useProcedureRequirements: vi.fn(),
}));

const mockUseProcedure = vi.mocked(procedureHook.useProcedureRequirements);

function setOrgFields(fields: Array<{ field: string; label: string }>) {
  mockUseProcedure.mockReturnValue({
    requirementGroups: [],
    statusOrder: ['proposed', 'approved'],
    procedureLabel: 'Acquisition',
    enforcementEnabled: true,
    orgRequiredFields: fields,
    isLoading: false,
    error: null,
  });
}

function missingError(fields: Array<{ field: string; label: string; source?: 'org' | 'baseline' }>) {
  return new ApiError('Cannot advance to approved: unmet requirements', 422, 'procedure_requirements_not_met', {
    procedure_type: 'acquisition',
    target_status: 'approved',
    missing_requirements: fields.map((f) => ({
      id: f.source === 'baseline' ? f.field : `org:${f.field}`,
      label: f.label,
      fields: [f.field],
      source: f.source ?? 'org',
    })),
    missing_fields: fields.map((f) => f.field),
  });
}

function Form({ error, collapsible = false }: { error?: ApiError; collapsible?: boolean }) {
  const [credit, setCredit] = useState('');
  const [method, setMethod] = useState('');
  const [expanded, setExpanded] = useState(!collapsible);
  const [isEditing, setIsEditing] = useState(true);
  const mutation = useMutation({
    mutationFn: async () => {
      throw error ?? new Error('no');
    },
  });
  useRevealSection((sectionId: string) => {
    if (sectionId === 'legal') {
      setExpanded(true);
      setIsEditing(true);
    }
  });
  return (
    <main>
      <h1>Acquisition</h1>
      <button type="button" onClick={() => mutation.mutate()}>Approve</button>
      <WorkspaceSection
        id="legal"
        title="Legal"
        isExpanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
        isEditing={isEditing}
      >
        <EditableField
          name="credit_line"
          label="Credit Line"
          value={credit}
          isEditing={isEditing}
          onChange={setCredit}
        />
        <EditableSelect
          name="acquisition_method"
          label="Acquisition Method"
          value={method}
          isEditing={isEditing}
          onChange={setMethod}
          options={[{ value: 'gift', label: 'Gift' }]}
          required
        />
        <EditableField name="provisos" label="Provisos" value="" isEditing={isEditing} onChange={() => {}} />
      </WorkspaceSection>
    </main>
  );
}

function renderForm(props: { error?: ApiError; collapsible?: boolean } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/organizations/org-1/acq']}>
        <Routes>
          <Route
            path="/organizations/:orgId/acq"
            element={
              <RequiredFieldsProvider procedureType="acquisition">
                <Form {...props} />
              </RequiredFieldsProvider>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RequiredFieldsProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setOrgFields([{ field: 'credit_line', label: 'Credit line' }]);
  });

  it('reads the organization from the route', () => {
    renderForm();
    expect(mockUseProcedure).toHaveBeenCalledWith('acquisition', 'org-1');
  });

  it('marks an org-added field required with the visible marker and aria-required', async () => {
    const { container } = renderForm();
    const credit = screen.getByRole('textbox', { name: /Credit Line/ });
    expect(credit).toHaveAttribute('aria-required', 'true');
    expect(credit).toBeRequired();
    // Org-added fields are required from the second status on, so they must
    // not block native submission of a new record.
    expect(credit).not.toHaveAttribute('required');
    const label = container.querySelector(`label[for="${credit.id}"]`)!;
    expect(label.textContent).toContain('*');

    // Fixed requirements keep their native required attribute.
    expect(screen.getByRole('combobox', { name: /Acquisition Method/ })).toHaveAttribute('required');

    // A field nobody required stays plain.
    const provisos = screen.getByRole('textbox', { name: 'Provisos' });
    expect(provisos).not.toBeRequired();
    expect(container.querySelector(`label[for="${provisos.id}"]`)!.textContent).not.toContain('*');

    expect(await checkA11y(container)).toHaveNoViolations();
  });

  it('marks an org-added select required', () => {
    setOrgFields([{ field: 'acquisition_method', label: 'Acquisition method' }]);
    renderForm();
    const select = screen.getByRole('combobox', { name: /Acquisition Method/ });
    // Both fixed and org-added: native required wins, no duplicate aria.
    expect(select).toHaveAttribute('required');
    expect(select).not.toHaveAttribute('aria-required');
  });

  it('marks the fields the server reports missing, focuses a summary and links to them', async () => {
    const error = missingError([
      { field: 'credit_line', label: 'Credit line' },
      { field: 'acquisition_method', label: 'Acquisition method', source: 'baseline' },
    ]);
    const { container } = renderForm({ error });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    const summary = await screen.findByRole('region', { name: /Status not changed to approved: 2 required fields are missing/ });
    await waitFor(() => expect(summary).toHaveFocus());

    const credit = screen.getByRole('textbox', { name: /Credit Line/ });
    expect(credit).toHaveAttribute('aria-invalid', 'true');
    expect(credit).toHaveAccessibleDescription('Credit line is required before the status can change to approved.');
    const method = screen.getByRole('combobox', { name: /Acquisition Method/ });
    expect(method).toHaveAttribute('aria-invalid', 'true');
    expect(method).toHaveAccessibleDescription('Acquisition method is required before the status can change to approved.');
    expect(screen.getByRole('textbox', { name: 'Provisos' })).not.toHaveAttribute('aria-invalid');

    fireEvent.click(screen.getByRole('button', { name: 'Credit line' }));
    expect(credit).toHaveFocus();

    expect(await checkA11y(container)).toHaveNoViolations();
  });

  it('clears a field error when the user fills it in, and the summary when all are fixed', async () => {
    renderForm({ error: missingError([{ field: 'credit_line', label: 'Credit line' }]) });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await screen.findByRole('region', { name: /1 required field is missing/ });

    const credit = screen.getByRole('textbox', { name: /Credit Line/ });
    fireEvent.change(credit, { target: { value: 'Gift of the donor' } });
    expect(credit).not.toHaveAttribute('aria-invalid');
    expect(credit).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByRole('region', { name: /required field/ })).not.toBeInTheDocument();
  });

  it('opens a collapsed section before focusing its field', async () => {
    const { container } = renderForm({
      error: missingError([{ field: 'credit_line', label: 'Credit line' }]),
      collapsible: true,
    });
    // Seen once so the provider learns its section, then collapsed.
    fireEvent.click(screen.getByRole('button', { name: 'Legal' }));
    expect(screen.getByRole('textbox', { name: /Credit Line/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Legal' }));
    expect(screen.queryByRole('textbox', { name: /Credit Line/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await screen.findByRole('region', { name: /1 required field is missing/ });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Credit line' }));
    });
    await waitFor(() => expect(screen.getByRole('textbox', { name: /Credit Line/ })).toHaveFocus());
    expect(await checkA11y(container)).toHaveNoViolations();
  });

  it('shows the message on a read-only field', async () => {
    function ReadOnly() {
      const m = useMutation({ mutationFn: async () => { throw missingError([{ field: 'credit_line', label: 'Credit line' }]); } });
      return (
        <>
          <button type="button" onClick={() => m.mutate()}>Approve</button>
          <EditableField name="credit_line" label="Credit Line" value="" isEditing={false} onChange={() => {}} />
        </>
      );
    }
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <RequiredFieldsProvider procedureType="acquisition" orgId="org-1">
            <ReadOnly />
          </RequiredFieldsProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Credit line is required before the status can change to approved.')).toBeInTheDocument();
  });

  it('ignores errors for another procedure and other error codes', () => {
    expect(parseMissingRequirements(new ApiError('x', 422, 'validation_error'), 'acquisition')).toBeNull();
    expect(parseMissingRequirements(missingError([{ field: 'a', label: 'A' }]), 'loan_out')).toBeNull();
    expect(parseMissingRequirements(missingError([{ field: 'a', label: 'A' }]), 'acquisition')?.requirements).toHaveLength(1);
  });

  it('leaves fields unchanged outside a provider', () => {
    render(<EditableField name="credit_line" label="Credit Line" value="" isEditing onChange={() => {}} />);
    const credit = screen.getByRole('textbox', { name: 'Credit Line' });
    expect(credit).not.toBeRequired();
    expect(credit).not.toHaveAttribute('aria-invalid');
  });
});
