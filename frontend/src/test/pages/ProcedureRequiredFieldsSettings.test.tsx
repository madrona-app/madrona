import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { checkA11y } from '../a11y';
import ProcedureEnforcementSettingsPage from '../../pages/collections/ProcedureEnforcementSettingsPage';
import * as apiClientModule from '../../lib/apiClient';

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
  getFriendlyErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong'),
}));

vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn(), dismissToast: vi.fn(), toasts: [] }),
}));

const mockApiFetch = vi.mocked(apiClientModule.apiFetch);

const acquisitionBase = {
  enabled: true,
  label: 'Acquisition',
  requirement_count: 6,
  blocking_count: 6,
  supports_org_required_fields: true,
  first_status: 'proposed',
  baseline_required_fields: [
    { id: 'acquisition_method', label: 'Acquisition method', fields: ['acquisition_method'], required_for_statuses: ['approved'] },
    { id: 'source_id', label: 'Source', fields: ['source_id'], required_for_statuses: ['approved'] },
  ],
};

const eligible = [
  { field: 'credit_line', label: 'Credit line' },
  { field: 'funding_source', label: 'Funding source' },
];

function settings(added: Array<{ field: string; label: string }> = []) {
  return {
    procedures: {
      acquisition: {
        ...acquisitionBase,
        org_required_fields: added,
        eligible_fields: eligible.filter((f) => !added.some((a) => a.field === f.field)),
      },
      movement: {
        enabled: false,
        label: 'Movement',
        requirement_count: 3,
        blocking_count: 1,
        supports_org_required_fields: false,
        first_status: 'planned',
        baseline_required_fields: [
          { id: 'to_location', label: 'Destination location', fields: ['to_location_id'], required_for_statuses: ['completed'] },
        ],
        org_required_fields: [],
        eligible_fields: [],
      },
    },
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/organizations/org-1/collections/config/procedure']}>
        <Routes>
          <Route path="/organizations/:orgId/collections/config/procedure" element={<ProcedureEnforcementSettingsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function acquisitionSection() {
  return screen.getByRole('region', { name: 'Acquisition required fields' });
}

describe('Procedure required fields settings', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
  });

  it('lists the fixed fields and labelled add controls, with no a11y violations', async () => {
    mockApiFetch.mockResolvedValueOnce(settings([{ field: 'credit_line', label: 'Credit line' }]));
    const { container } = renderPage();
    const section = await screen.findByRole('region', { name: 'Acquisition required fields' });

    const fixed = within(section).getByRole('list', { name: 'Fixed required fields' });
    expect(within(fixed).getByText('Acquisition method')).toBeInTheDocument();
    expect(within(fixed).getByText('Source')).toBeInTheDocument();
    // Fixed fields have no remove control
    expect(within(section).queryByRole('button', { name: /Remove required field Acquisition method/ })).toBeNull();

    const addedList = within(section).getByRole('list', { name: 'Added by your organization' });
    expect(within(addedList).getByText('Credit line')).toBeInTheDocument();
    expect(
      within(section).getByRole('button', { name: 'Remove required field Credit line from Acquisition' }),
    ).toBeInTheDocument();

    const select = within(section).getByRole('combobox', { name: 'Field to require' });
    expect(select).toHaveAccessibleDescription(/move on from Proposed/);
    expect(within(select).getByRole('option', { name: 'Funding source' })).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: 'Add required field to Acquisition' })).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Enforce Acquisition' })).toHaveAttribute('aria-pressed', 'true');

    const results = await checkA11y(container);
    expect(results.violations).toEqual([]);
  });

  it('adds a field, announces it and returns focus to the field select', async () => {
    const user = userEvent.setup();
    mockApiFetch.mockResolvedValueOnce(settings());
    renderPage();
    await screen.findByRole('region', { name: 'Acquisition required fields' });

    const updated = settings([{ field: 'credit_line', label: 'Credit line' }]).procedures.acquisition;
    mockApiFetch.mockResolvedValueOnce({ procedure_type: 'acquisition', ...updated });
    mockApiFetch.mockResolvedValue(settings([{ field: 'credit_line', label: 'Credit line' }]));

    const section = acquisitionSection();
    await user.selectOptions(within(section).getByRole('combobox', { name: 'Field to require' }), 'credit_line');
    await user.click(within(section).getByRole('button', { name: 'Add required field to Acquisition' }));

    expect(mockApiFetch).toHaveBeenCalledWith(
      '/organizations/org-1/settings/procedure-enforcement/acquisition/required-fields',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ field: 'credit_line' }) }),
    );
    expect(
      await within(acquisitionSection()).findByRole('button', { name: 'Remove required field Credit line from Acquisition' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Credit line is now required for Acquisition.');
    await waitFor(() =>
      expect(within(acquisitionSection()).getByRole('combobox', { name: 'Field to require' })).toHaveFocus(),
    );
  });

  it('removes an added field, announces it and moves focus to the next remove button', async () => {
    const user = userEvent.setup();
    const both = [
      { field: 'credit_line', label: 'Credit line' },
      { field: 'funding_source', label: 'Funding source' },
    ];
    mockApiFetch.mockResolvedValueOnce(settings(both));
    renderPage();
    await screen.findByRole('region', { name: 'Acquisition required fields' });

    const after = settings([both[1]]).procedures.acquisition;
    mockApiFetch.mockResolvedValueOnce({ procedure_type: 'acquisition', ...after });
    mockApiFetch.mockResolvedValue(settings([both[1]]));

    await user.click(screen.getByRole('button', { name: 'Remove required field Credit line from Acquisition' }));
    expect(mockApiFetch).toHaveBeenCalledWith(
      '/organizations/org-1/settings/procedure-enforcement/acquisition/required-fields/credit_line',
      { method: 'DELETE' },
    );
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Remove required field Credit line from Acquisition' })).toBeNull(),
    );
    expect(screen.getByRole('status')).toHaveTextContent('Credit line is no longer required for Acquisition.');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Remove required field Funding source from Acquisition' })).toHaveFocus(),
    );
  });

  it('removing the last added field moves focus to the field select', async () => {
    const user = userEvent.setup();
    mockApiFetch.mockResolvedValueOnce(settings([{ field: 'credit_line', label: 'Credit line' }]));
    renderPage();
    await screen.findByRole('region', { name: 'Acquisition required fields' });
    mockApiFetch.mockResolvedValueOnce({ procedure_type: 'acquisition', ...settings().procedures.acquisition });
    mockApiFetch.mockResolvedValue(settings());

    await user.click(screen.getByRole('button', { name: 'Remove required field Credit line from Acquisition' }));
    await waitFor(() =>
      expect(within(acquisitionSection()).getByRole('combobox', { name: 'Field to require' })).toHaveFocus(),
    );
    expect(within(acquisitionSection()).getByText('None added')).toBeInTheDocument();
  });

  it('adding with no field chosen marks the select invalid and keeps focus there', async () => {
    const user = userEvent.setup();
    mockApiFetch.mockResolvedValueOnce(settings());
    const { container } = renderPage();
    await screen.findByRole('region', { name: 'Acquisition required fields' });
    const section = acquisitionSection();
    await user.click(within(section).getByRole('button', { name: 'Add required field to Acquisition' }));

    const select = within(section).getByRole('combobox', { name: 'Field to require' });
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toHaveAccessibleDescription(/Choose a field to add/);
    expect(select).toHaveFocus();
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    const results = await checkA11y(container);
    expect(results.violations).toEqual([]);
  });

  it('shows a server rejection next to the select', async () => {
    const user = userEvent.setup();
    mockApiFetch.mockResolvedValueOnce(settings());
    renderPage();
    await screen.findByRole('region', { name: 'Acquisition required fields' });
    mockApiFetch.mockRejectedValueOnce(new Error("'credit_line' is already required by your organization"));
    const section = acquisitionSection();
    await user.selectOptions(within(section).getByRole('combobox', { name: 'Field to require' }), 'credit_line');
    await user.click(within(section).getByRole('button', { name: 'Add required field to Acquisition' }));
    const select = within(section).getByRole('combobox', { name: 'Field to require' });
    await waitFor(() => expect(select).toHaveAttribute('aria-invalid', 'true'));
    expect(select).toHaveAccessibleDescription(/already required/);
  });

  it('procedures without server-side checks show their fixed fields but no add control', async () => {
    mockApiFetch.mockResolvedValueOnce(settings());
    renderPage();
    const section = await screen.findByRole('region', { name: 'Movement required fields' });
    expect(within(section).getByText('Destination location')).toBeInTheDocument();
    expect(within(section).queryByRole('combobox')).toBeNull();
    expect(within(section).getByText(/not available for this procedure/)).toBeInTheDocument();
  });
});
