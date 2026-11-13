import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuditCheckList } from '../../pages/collections/AuditCampaignWorkspacePage/AuditCheckList';
import { buildCheckListCsv } from '../../pages/collections/AuditCampaignWorkspacePage/checkListCsv';
import type { AuditCheckList as CheckListData, AuditCheckListItem } from '../../lib/api';
import * as api from '../../lib/api';
import { checkA11y } from '../a11y';

vi.mock('../../lib/api', () => ({
  getAuditCheckList: vi.fn(),
  generateAuditCheckList: vi.fn(),
  recordAuditCheck: vi.fn(),
  updateAuditCampaign: vi.fn(),
  getLocationOptions: vi.fn(),
}));

const mocked = {
  get: vi.mocked(api.getAuditCheckList),
  generate: vi.mocked(api.generateAuditCheckList),
  record: vi.mocked(api.recordAuditCheck),
  update: vi.mocked(api.updateAuditCampaign),
  locations: vi.mocked(api.getLocationOptions),
};

function item(over: Partial<AuditCheckListItem> = {}): AuditCheckListItem {
  return {
    result_id: 'r1',
    check_sequence: 1,
    object_id: 'o1',
    object_number: 'A.001',
    title: 'Banner',
    expected_location_id: 'l1',
    expected_location_name: 'Store A',
    expected_location_path: 'MAIN/A',
    actual_location_id: null,
    actual_location_name: null,
    actual_location_path: null,
    current_location_id: 'l1',
    outcome: 'pending',
    result_status: 'pending',
    checked_at: null,
    checked_by: null,
    note: null,
    follow_up_action: null,
    ...over,
  };
}

function list(items: AuditCheckListItem[], over: Partial<CheckListData> = {}): CheckListData {
  const checked = items.filter(i => i.outcome !== 'pending').length;
  return {
    audit_id: 'c1',
    generated_at: items.length ? '2026-11-13T10:00:00Z' : null,
    generated_by: null,
    seed: items.length ? 1234 : null,
    params: items.length ? { population_count: 40 } : null,
    total: items.length,
    checked,
    counts: {},
    items,
    limit: 5000,
    offset: 0,
    ...over,
  };
}

const campaign = {
  audit_id: 'c1',
  title: 'Spring spot check',
  audit_number: 'AUD-7',
  status: 'in_progress',
  sample_method: 'random',
  sample_size: 2,
  target_locations: [{ location_id: 'l1', include_children: true, label: 'Store A' }],
  target_object_types: [],
};

function renderList(props: Partial<React.ComponentProps<typeof AuditCheckList>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuditCheckList orgId="org-1" campaign={campaign} canEdit {...props} />
    </QueryClientProvider>,
  );
}

const twoItems = [
  item(),
  item({ result_id: 'r2', check_sequence: 2, object_id: 'o2', object_number: 'A.002', title: 'Quilt' }),
];

describe('AuditCheckList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.locations.mockResolvedValue({
      items: [
        { location_id: 'l1', name: 'Store A', path: 'MAIN/A' },
        { location_id: 'l9', name: 'Offsite', path: 'OFF' },
      ],
    });
  });

  it('generates a list and announces it', async () => {
    mocked.get.mockResolvedValue(list([]));
    mocked.generate.mockResolvedValue(list(twoItems));
    const { container } = renderList();

    const button = await screen.findByRole('button', { name: /generate check list/i });
    fireEvent.click(button);

    await waitFor(() => expect(mocked.generate).toHaveBeenCalledWith('org-1', 'c1', { replace: false }));
    const table = await screen.findByRole('table', { name: /check list for spring spot check: 0 of 2 checked/i });
    expect(within(table).getAllByRole('columnheader').map(h => h.textContent)).toContain('Expected location');
    expect(within(table).getByRole('rowheader', { name: 'A.001' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Check list generated: 2 objects to check.');
    expect(screen.getByText('1234')).toBeInTheDocument();

    const results = await checkA11y(container);
    expect(results.violations).toEqual([]);
  });

  it('records a check with an announced, pressed button', async () => {
    mocked.get.mockResolvedValue(list(twoItems));
    mocked.record.mockResolvedValue(item({ outcome: 'found', result_status: 'verified' }));
    const { container } = renderList();

    const group = await screen.findByRole('group', { name: 'Record result for A.001' });
    const found = within(group).getByRole('button', { name: 'Found: A.001' });
    expect(found).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(found);

    await waitFor(() => expect(mocked.record).toHaveBeenCalledWith('org-1', 'c1', 'r1', { outcome: 'found', actual_location_id: null }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('A.001 recorded as found. 1 of 2 checked.'));
    expect(within(group).getByRole('button', { name: 'Found: A.001' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: 'Clear result for A.001' })).toBeInTheDocument();

    const results = await checkA11y(container);
    expect(results.violations).toEqual([]);
  });

  it('asks for confirmation before replacing and blocks once checks start', async () => {
    mocked.get.mockResolvedValue(list(twoItems));
    const { unmount } = renderList();
    fireEvent.click(await screen.findByRole('button', { name: /replace check list/i }));
    expect(await screen.findByRole('dialog', { name: 'Replace check list?' })).toBeInTheDocument();
    expect(mocked.generate).not.toHaveBeenCalled();
    unmount();

    mocked.get.mockResolvedValue(list([item({ outcome: 'found', result_status: 'verified' }), twoItems[1]]));
    renderList();
    const replace = await screen.findByRole('button', { name: /replace check list/i });
    expect(replace).toBeDisabled();
    expect(replace).toHaveAccessibleDescription(/1 check has been recorded/);
  });

  it('wrong location requires a found location', async () => {
    mocked.get.mockResolvedValue(list(twoItems));
    mocked.record.mockResolvedValue(item({ outcome: 'wrong_location', result_status: 'discrepancy', actual_location_id: 'l9', actual_location_name: 'Offsite' }));
    renderList();

    fireEvent.click(await screen.findByRole('button', { name: 'Wrong location: A.001' }));
    const dialog = await screen.findByRole('dialog', { name: 'Wrong location: A.001' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save result' }));
    const select = within(dialog).getByRole('combobox', { name: /found location/i });
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toHaveAccessibleDescription(/choose the location where the object was found/i);

    const results = await checkA11y(dialog);
    expect(results.violations).toEqual([]);

    await within(dialog).findByRole('option', { name: 'Offsite (OFF)' });
    fireEvent.change(select, { target: { value: 'l9' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save result' }));
    await waitFor(() => expect(mocked.record).toHaveBeenCalledWith('org-1', 'c1', 'r1', { outcome: 'wrong_location', actual_location_id: 'l9' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('A.001 recorded as wrong location: found in offsite.');
  });

  it('builds a CSV with quoting and a formula guard', () => {
    const csv = buildCheckListCsv([item({ title: '=HYPERLINK("x")', note: 'a, b' })]);
    const [header, row] = csv.trim().split('\r\n');
    expect(header).toBe('Sequence,Object number,Title,Expected location,Expected location path,Result,Found location,Checked at,Note');
    expect(row).toBe(`1,A.001,"'=HYPERLINK(""x"")",Store A,MAIN/A,Not checked,,,"a, b"`);
  });
});
