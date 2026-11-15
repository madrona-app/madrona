import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BulkActionDialog from '../../../components/workspaces/BulkActionDialog';
import { checkA11y, formatViolations } from '../../a11y';

vi.mock('../../../contexts/useOrganization', () => ({
  useOrganization: () => ({ activeOrganization: { organization_id: 'org-1' }, activeOrganizationId: 'org-1' }),
}));

const api = vi.hoisted(() => ({
  listBulkActions: vi.fn(),
  previewBulkAction: vi.fn(),
  validateBulkAction: vi.fn(),
  executeBulkAction: vi.fn(),
  getLocations: vi.fn(),
  getAllLookups: vi.fn(),
}));

vi.mock('../../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/api')>()),
  ...api,
}));

const ACTIONS = [
  {
    key: 'record_movement',
    label: 'Record Movement',
    description: 'Move objects to a new location',
    required_params: ['to_location_id', 'reason'],
    optional_params: ['movement_note'],
  },
  {
    key: 'schedule_condition_check',
    label: 'Schedule Condition Check',
    description: 'Schedule a check',
    required_params: ['check_type', 'due_date'],
    optional_params: ['priority', 'notes'],
  },
  {
    key: 'set_handling_requirements',
    label: 'Set Handling Requirements',
    description: 'Set handling flags',
    required_params: ['handling_requirements'],
    optional_params: ['handling_notes'],
  },
  {
    key: 'flag_for_conservation',
    label: 'Flag for Conservation',
    description: 'Mark objects as needing conservation attention',
    required_params: ['urgency', 'treatment_type'],
    optional_params: ['concern_description', 'assigned_to_user_id'],
  },
  {
    key: 'report_incident',
    label: 'Report Incident',
    description: 'Create an incident report linking all objects',
    required_params: ['incident_type', 'incident_description'],
    optional_params: ['incident_location_id'],
  },
  {
    key: 'create_condition_report',
    label: 'Create Condition Reports',
    description: 'Create condition reports for all objects',
    required_params: ['report_type'],
    optional_params: ['overall_condition', 'condition_summary', 'conservation_needed'],
  },
];

function lookupCategory(key: string, values: [string, string][], orgValue?: [string, string]) {
  const all = orgValue ? [...values, orgValue] : values;
  return {
    category_id: key, category_key: key, display_name: key, description: null,
    applicable_contexts: [], supports_icons: false,
    values: all.map(([value_key, label], i) => ({
      value_id: `${key}-${i}`, category_id: key, organization_id: orgValue && value_key === orgValue[0] ? 'org-1' : null,
      value_key, label, description: null, icon_name: null, sort_order: i,
      is_active: true, is_hidden: false, is_system: !(orgValue && value_key === orgValue[0]),
    })),
  };
}

const LOOKUPS = [
  lookupCategory('treatment_type', [['preventive', 'Preventive'], ['cleaning', 'Cleaning']], ['wet_cleaning', 'Wet cleaning']),
  lookupCategory('priority', [['urgent', 'Urgent'], ['low', 'Low']]),
  lookupCategory('incident_type', [['damage', 'Damage'], ['theft', 'Theft']], ['mould', 'Mould']),
  lookupCategory('report_type', [['periodic', 'Periodic'], ['intake', 'Intake']], ['tactile_check', 'Tactile check']),
  lookupCategory('condition', [['good', 'Good'], ['poor', 'Poor']]),
];

function optionLabels(select: HTMLElement) {
  return Array.from((select as HTMLSelectElement).options).map((o) => o.textContent);
}

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <BulkActionDialog isOpen onClose={vi.fn()} workspaceId="ws-1" workspaceName="Loan prep" objectCount={2} />
    </QueryClientProvider>
  );
}

async function openAction(label: string) {
  const utils = renderDialog();
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(label) }));
  await screen.findByRole('heading', { name: `Configure: ${label}` });
  return utils;
}

describe('BulkActionDialog accessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listBulkActions.mockResolvedValue({ workspace_id: 'ws-1', actions: ACTIONS });
    api.getLocations.mockResolvedValue({ items: [], total: 0 });
    api.getAllLookups.mockResolvedValue(LOOKUPS);
  });

  it('action picker: dialog is named and has no axe violations', async () => {
    const { baseElement } = renderDialog();
    await screen.findByRole('button', { name: /Record Movement/ });
    const dialog = screen.getByRole('dialog', { name: 'Bulk Action' });
    expect(dialog).toHaveAccessibleDescription('Loan prep (2 objects)');
    expect(screen.getByRole('button', { name: 'Close bulk action dialog' })).toBeInTheDocument();
    expect(screen.getByText(/Step 1 of 6/)).toBeInTheDocument();
    const results = await checkA11y(baseElement);
    expect(results.violations, formatViolations(results)).toEqual([]);
  });

  it('Record Movement: every field has a programmatic label', async () => {
    const { baseElement } = await openAction('Record Movement');
    expect(screen.getByRole('group', { name: /Destination Location/ })).toBeInTheDocument();
    const reason = screen.getByRole('combobox', { name: 'Reason' });
    expect(reason).toHaveAttribute('aria-required', 'true');
    expect(screen.getByRole('textbox', { name: 'Note (optional)' })).toBeInTheDocument();
    const results = await checkA11y(baseElement);
    expect(results.violations, formatViolations(results)).toEqual([]);
  });

  it('Schedule Condition Check: selects and date input are labelled', async () => {
    const { baseElement } = await openAction('Schedule Condition Check');
    expect(screen.getByRole('combobox', { name: 'Check Type' })).toHaveAttribute('aria-required', 'true');
    expect(screen.getByLabelText(/^Due Date/)).toHaveAttribute('type', 'date');
    expect(screen.getByRole('combobox', { name: 'Priority' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Notes (optional)' })).toBeInTheDocument();
    const results = await checkA11y(baseElement);
    expect(results.violations, formatViolations(results)).toEqual([]);
  });

  it('Set Handling Requirements: checkboxes are grouped under a legend', async () => {
    const { baseElement } = await openAction('Set Handling Requirements');
    const group = screen.getByRole('group', { name: /Handling Requirements/ });
    expect(group.tagName).toBe('FIELDSET');
    const gloves = screen.getByRole('checkbox', { name: 'Gloves Required' });
    fireEvent.click(gloves);
    expect(gloves).toBeChecked();
    expect(screen.getByRole('textbox', { name: 'Additional Notes (optional)' })).toBeInTheDocument();
    const results = await checkA11y(baseElement);
    expect(results.violations, formatViolations(results)).toEqual([]);
  });

  it('validation errors are announced and the preview/validate steps have no axe violations', async () => {
    api.previewBulkAction.mockResolvedValue({
      action: 'schedule_condition_check',
      action_label: 'Schedule Condition Check',
      workspace_id: 'ws-1',
      workspace_name: 'Loan prep',
      objects: [
        { object_id: 'o1', accession_number: '2020.1', title: 'Vase', thumbnail_url: null, warnings: ['On loan'] },
      ],
      total_count: 1,
      has_warnings: true,
    });
    api.validateBulkAction.mockResolvedValue({
      action: 'schedule_condition_check',
      action_valid: true,
      allowed: [],
      blocked: [{ object_id: 'o1', accession_number: '2020.1', title: 'Vase', reason: 'Locked' }],
      allowed_count: 0,
      blocked_count: 1,
    });
    const { baseElement } = await openAction('Schedule Condition Check');

    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(screen.getByRole('alert')).toHaveTextContent(/Missing required fields/);

    fireEvent.change(screen.getByRole('combobox', { name: 'Check Type' }), { target: { value: 'periodic' } });
    fireEvent.change(screen.getByLabelText(/^Due Date/), { target: { value: '2027-01-01' } });
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(await screen.findByRole('region', { name: 'Objects to be affected' })).toBeInTheDocument();
    let results = await checkA11y(baseElement);
    expect(results.violations, formatViolations(results)).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByRole('region', { name: 'Blocked objects' })).toBeInTheDocument());
    expect(screen.getByRole('checkbox', { name: /Skip blocked objects/ })).toBeChecked();
    results = await checkA11y(baseElement);
    expect(results.violations, formatViolations(results)).toEqual([]);
  });

  it("Flag for Conservation: choices are the organization's lookup values", async () => {
    const { baseElement } = await openAction('Flag for Conservation');
    const treatment = screen.getByRole('combobox', { name: 'Treatment Type' });
    expect(treatment).toHaveAttribute('aria-required', 'true');
    await waitFor(() => expect(optionLabels(treatment)).toContain('Wet cleaning'));
    expect(optionLabels(treatment)).not.toContain('Structural Damage');
    const urgency = screen.getByRole('combobox', { name: 'Urgency' });
    expect(optionLabels(urgency)).toEqual(['Select urgency...', 'Urgent', 'Low']);
    fireEvent.change(treatment, { target: { value: 'wet_cleaning' } });
    fireEvent.change(urgency, { target: { value: 'urgent' } });
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() =>
      expect(api.previewBulkAction).toHaveBeenCalledWith(
        'org-1', 'ws-1', 'flag_for_conservation',
        expect.objectContaining({ treatment_type: 'wet_cleaning', urgency: 'urgent' }),
      ),
    );
    const results = await checkA11y(baseElement);
    expect(results.violations, formatViolations(results)).toEqual([]);
  });

  it('Report Incident and Create Condition Reports offer lookup values; a refusal is announced', async () => {
    api.previewBulkAction.mockRejectedValueOnce(new Error('Unknown incident_type: mould'));
    const { baseElement } = await openAction('Report Incident');
    const type = screen.getByRole('combobox', { name: 'Incident Type' });
    await waitFor(() => expect(optionLabels(type)).toContain('Mould'));
    fireEvent.change(type, { target: { value: 'mould' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), { target: { value: 'Spores on frame' } });
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unknown incident_type: mould');
    const results = await checkA11y(baseElement);
    expect(results.violations, formatViolations(results)).toEqual([]);
  });

  it('Create Condition Reports: report type and condition come from lookups', async () => {
    const { baseElement } = await openAction('Create Condition Reports');
    const type = screen.getByRole('combobox', { name: 'Report Type' });
    await waitFor(() => expect(optionLabels(type)).toContain('Tactile check'));
    expect(optionLabels(screen.getByRole('combobox', { name: 'Overall Condition (optional)' }))).toEqual(
      ['To be determined...', 'Good', 'Poor'],
    );
    const results = await checkA11y(baseElement);
    expect(results.violations, formatViolations(results)).toEqual([]);
  });
});
