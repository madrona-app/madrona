import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BulkActionDialog from '../../../components/workspaces/BulkActionDialog';
import { checkA11y, formatViolations } from '../../a11y';

vi.mock('../../../contexts/useOrganization', () => ({
  useOrganization: () => ({ activeOrganization: { organization_id: 'org-1' } }),
}));

const api = vi.hoisted(() => ({
  listBulkActions: vi.fn(),
  previewBulkAction: vi.fn(),
  validateBulkAction: vi.fn(),
  executeBulkAction: vi.fn(),
  getLocations: vi.fn(),
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
];

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
});
