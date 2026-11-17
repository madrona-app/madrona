import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuditCheckList } from '../../pages/collections/AuditCampaignWorkspacePage/AuditCheckList';
import { AuditBulkUpdate } from '../../pages/collections/AuditCampaignWorkspacePage/AuditBulkUpdate';
import type { AuditCheckListItem, AuditBulkUpdateResult } from '../../lib/api';
import * as api from '../../lib/api';
import { checkA11y } from '../a11y';

vi.mock('../../lib/api', () => ({
  getAuditCheckList: vi.fn(),
  generateAuditCheckList: vi.fn(),
  recordAuditCheck: vi.fn(),
  updateAuditCampaign: vi.fn(),
  getLocationOptions: vi.fn(),
  previewAuditBulkUpdate: vi.fn(),
  executeAuditBulkUpdate: vi.fn(),
}));

const workspaceDialog = vi.fn();
vi.mock('../../components/workspaces', () => ({
  AddToWorkspaceDialog: (props: { isOpen: boolean; objectIds: string[]; objectLabel?: string }) => {
    workspaceDialog(props);
    return props.isOpen ? <div role="dialog" aria-label="Add to workspace">{props.objectLabel}</div> : null;
  },
}));

const mocked = {
  get: vi.mocked(api.getAuditCheckList),
  preview: vi.mocked(api.previewAuditBulkUpdate),
  execute: vi.mocked(api.executeAuditBulkUpdate),
  locations: vi.mocked(api.getLocationOptions),
};

function item(n: number, over: Partial<AuditCheckListItem> = {}): AuditCheckListItem {
  return {
    result_id: `r${n}`, check_sequence: n, object_id: `o${n}`, object_number: `A.00${n}`, title: `Title ${n}`,
    expected_location_id: 'l1', expected_location_name: 'Store A', expected_location_path: 'MAIN/A',
    actual_location_id: null, actual_location_name: null, actual_location_path: null, current_location_id: 'l1',
    outcome: 'pending', result_status: 'pending', checked_at: null, checked_by: null, note: null, follow_up_action: null,
    ...over,
  };
}

const items = [
  item(1, { outcome: 'found', result_status: 'verified' }),
  item(2, { outcome: 'not_found', result_status: 'not_found' }),
  item(3, { outcome: 'wrong_location', result_status: 'discrepancy', actual_location_id: 'l9', actual_location_name: 'Offsite' }),
];

const campaign = { audit_id: 'c1', title: 'Spot check', audit_number: 'AUD-1', status: 'in_progress', sample_method: 'complete' };

function renderWithToolbar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuditCheckList
        orgId="org-1"
        campaign={campaign}
        canEdit
        renderSelectionToolbar={(ctx) => <AuditBulkUpdate orgId="org-1" campaignId="c1" {...ctx} />}
      />
    </QueryClientProvider>,
  );
}

const previewResult: AuditBulkUpdateResult = {
  audit_id: 'c1', update_location: true, mark_inventoried: true,
  rows: [{
    result_id: 'r3', object_id: 'o3', object_number: 'A.003', title: 'Title 3', outcome: 'wrong_location',
    current_location_name: 'Store A', found_location_name: 'Offsite',
    changes: ['Record a movement from Store A to Offsite.', 'Set last inventoried to 2026-11-13.'],
    skipped: [], status: null, message: null, movement_reference: null,
  }],
  location_update_count: 1, inventoried_count: 1, skipped_count: 0, executed: false,
};

describe('AuditBulkUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.locations.mockResolvedValue({ items: [] });
    mocked.get.mockResolvedValue({
      audit_id: 'c1', generated_at: '2026-11-13T10:00:00Z', generated_by: null, seed: 5, params: {},
      total: 3, checked: 3, counts: {}, items, limit: 5000, offset: 0,
    });
  });

  it('row selection is labelled, select-all reflects state, and the count is announced', async () => {
    const { container } = renderWithToolbar();
    const row = await screen.findByRole('checkbox', { name: 'Select A.001, Title 1' });
    const all = screen.getByRole('checkbox', { name: 'Select all 3 objects' }) as HTMLInputElement;
    expect(all.checked).toBe(false);

    fireEvent.click(row);
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('1 of 3 selected.');
    expect(all.indeterminate).toBe(true);
    expect(screen.getByText('1 of 3 selected')).toBeInTheDocument();

    fireEvent.click(all);
    expect(all.checked).toBe(true);
    expect(all.indeterminate).toBe(false);
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('All 3 selected.');

    const results = await checkA11y(container);
    expect(results.violations).toEqual([]);
  });

  it('previews then applies location and inventory updates for wrong-location results', async () => {
    mocked.preview.mockResolvedValue(previewResult);
    mocked.execute.mockResolvedValue({
      ...previewResult, executed: true,
      rows: [{ ...previewResult.rows[0], status: 'success', movement_reference: 'M.2026.0001' }],
    });
    renderWithToolbar();

    fireEvent.click(await screen.findByRole('button', { name: 'Select wrong location (1)' }));
    expect((screen.getByRole('checkbox', { name: 'Select A.003, Title 3' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'Select A.001, Title 1' }) as HTMLInputElement).checked).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Update records (1)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Update records from 1 result' });
    expect(within(dialog).getByRole('group', { name: 'Updates to apply' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Apply changes' })).toBeDisabled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Preview changes' }));
    await waitFor(() => expect(mocked.preview).toHaveBeenCalledWith('org-1', 'c1', {
      result_ids: ['r3'], update_location: true, mark_inventoried: true, reason: 'inventory',
    }));
    const table = await within(dialog).findByRole('table', { name: 'Preview of changes' });
    expect(within(table).getByRole('rowheader', { name: /A\.003/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('status')).toHaveTextContent('Preview: 1 location update and 1 inventoried date.');

    const results = await checkA11y(dialog);
    expect(results.violations).toEqual([]);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply changes' }));
    await waitFor(() => expect(mocked.execute).toHaveBeenCalled());
    await within(dialog).findByRole('table', { name: 'Applied changes' });
    expect(within(dialog).getByText('Movement M.2026.0001')).toBeInTheDocument();
    expect(within(dialog).getByRole('status')).toHaveTextContent('Applied: 1 location update and 1 inventoried date.');
  });

  it('sends the selected objects to a workspace', async () => {
    renderWithToolbar();
    fireEvent.click(await screen.findByRole('button', { name: 'Select all seen (2)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send to workspace (2)' }));
    expect(await screen.findByRole('dialog', { name: 'Add to workspace' })).toHaveTextContent('2 objects');
    const last = workspaceDialog.mock.calls.at(-1)![0];
    expect(last.objectIds).toEqual(['o1', 'o3']);
  });
});
