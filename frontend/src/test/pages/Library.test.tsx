import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LibraryRecordsPage from '../../pages/collections/LibraryRecordsPage';
import LibraryRecordPage from '../../pages/collections/LibraryRecordPage';
import * as libraryApi from '../../lib/api/library';
import * as collectionsApi from '../../lib/api/collections';
import * as authoritiesApi from '../../lib/api/authorities';
import * as reportsApi from '../../lib/api/reports';
import * as usePermissionsHook from '../../hooks/usePermissions';
import { checkA11y } from '../a11y';
import type { BibRecord } from '../../lib/api/library';

vi.mock('../../hooks/usePermissions', () => ({ usePermissions: vi.fn() }));
vi.mock('../../lib/api/library', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api/library')>();
  return {
    ...actual,
    getBibRecords: vi.fn(),
    getBibRecord: vi.fn(),
    createBibRecord: vi.fn(),
    updateBibRecord: vi.fn(),
    deleteBibRecord: vi.fn(),
    addBibHolding: vi.fn(),
    updateBibHolding: vi.fn(),
    deleteBibHolding: vi.fn(),
    addBibItem: vi.fn(),
    updateBibItem: vi.fn(),
    deleteBibItem: vi.fn(),
    addBibSubject: vi.fn(),
    removeBibSubject: vi.fn(),
    addBibName: vi.fn(),
    removeBibName: vi.fn(),
  };
});
vi.mock('../../lib/api/collections', () => ({ getLocations: vi.fn() }));
vi.mock('../../lib/api/reports', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api/reports')>();
  return { ...actual, getRecordAuditHistory: vi.fn() };
});
vi.mock('../../lib/api/authorities', () => ({ getSubjectAuthorities: vi.fn() }));
vi.mock('../../lib/api/constituents', () => ({ getConstituents: vi.fn() }));

const lib = vi.mocked(libraryApi);
const col = vi.mocked(collectionsApi);
const auth = vi.mocked(authoritiesApi);
const reports = vi.mocked(reportsApi);
const perms = vi.mocked(usePermissionsHook.usePermissions);

function grant(keys: string[] | 'all') {
  perms.mockReturnValue({
    hasPermission: vi.fn((k: string) => keys === 'all' || keys.includes(k)),
    hasAnyPermission: vi.fn().mockReturnValue(true),
    hasAllPermissions: vi.fn().mockReturnValue(true),
  } as never);
}

const RECORD: BibRecord = {
  bib_record_id: 'r1',
  organization_id: 'org-1',
  record_type: 'braille',
  title: 'Walking Alone and Marching Together',
  subtitle: 'A history of the organized blind movement',
  statement_of_responsibility: 'Floyd Matson',
  edition: null,
  place: 'Baltimore',
  publisher: 'National Federation of the Blind',
  date_display: '1990',
  date_earliest: 1990,
  date_latest: 1990,
  extent: '12 volumes of braille',
  series_statement: null,
  language: 'English',
  isbn: null,
  issn: null,
  lccn: null,
  oclc_number: null,
  call_number: 'HV1593 .M38 1990',
  format_notes: null,
  notes: null,
  holding_count: 1,
  item_count: 2,
  holdings: [{
    holding_id: 'h1', bib_record_id: 'r1', location_id: 'loc1', location_name: 'Stacks',
    call_number: 'TB HV1593', holdings_statement: 'v.1-12', shelving_notes: null,
    public_note: null, staff_note: null, created_at: null, updated_at: null,
    items: [
      { item_id: 'i1', holding_id: 'h1', barcode: 'T0001', copy_number: '1', enumeration: 'v.1', chronology: null,
        status: 'available', condition_note: null, collection_object_id: null, collection_object_number: null,
        created_at: null, updated_at: null },
      { item_id: 'i2', holding_id: 'h1', barcode: 'T0002', copy_number: '1', enumeration: 'v.2', chronology: null,
        status: 'on_loan', condition_note: null, collection_object_id: null, collection_object_number: null,
        created_at: null, updated_at: null },
    ],
  }],
  subjects: [{ link_id: 's1', subject_authority_id: 'sa1', preferred_term: 'Blind--Civil rights', lcsh_id: 'sh85014899', display_order: 1 }],
  names: [{ link_id: 'n1', constituent_id: 'c1', name: 'Floyd Matson', role: 'author', display_order: 1 }],
  _restricted_fields: [],
};

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/organizations/:orgId/collections/library" element={<LibraryRecordsPage />} />
          <Route path="/organizations/:orgId/collections/library/create" element={<LibraryRecordPage />} />
          <Route path="/organizations/:orgId/collections/library/:recordId" element={<LibraryRecordPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  grant('all');
  col.getLocations.mockResolvedValue({ items: [{ location_id: 'loc1', name: 'Stacks', path: 'Stacks' }] } as never);
  auth.getSubjectAuthorities.mockResolvedValue({ items: [], total: 0, limit: 10, offset: 0 } as never);
  reports.getRecordAuditHistory.mockResolvedValue({ entity_type: 'bib_record', entity_id: 'r1', items: [], total: 0, limit: 20, offset: 0 });
});

describe('LibraryRecordsPage', () => {
  it('lists records in a captioned table with row headers, a labelled search and a type filter', async () => {
    lib.getBibRecords.mockResolvedValue({ items: [RECORD], total: 1, limit: 25, offset: 0 });
    const { container } = renderAt('/organizations/org-1/collections/library');

    const table = await screen.findByRole('table', { name: /library records by title/i });
    for (const name of ['Title', 'Type', 'Responsibility', 'Publication', 'Call number', 'Items']) {
      expect(within(table).getByRole('columnheader', { name })).toBeInTheDocument();
    }
    expect(within(table).getByRole('rowheader', { name: /Walking Alone/ })).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: 'Walking Alone and Marching Together' })).toHaveAttribute(
      'href', '/organizations/org-1/collections/library/r1',
    );
    expect(screen.getByRole('searchbox', { name: 'Search library records' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Record type' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New library record' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1 record.'));
    expect((await checkA11y(container)).violations).toEqual([]);
  });

  it('filters by type, announces the count and pages with named controls', async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ ...RECORD, bib_record_id: `r${i}`, title: `Title ${i}` }));
    lib.getBibRecords.mockResolvedValue({ items: many, total: 40, limit: 25, offset: 0 });
    renderAt('/organizations/org-1/collections/library');

    await screen.findByRole('table', { name: /showing 1 to 25 of 40/i });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('40 records. Showing 1 to 25.'));
    const pages = screen.getByRole('navigation', { name: 'Library record pages' });
    expect(within(pages).getByRole('button', { name: 'Previous page' })).toBeDisabled();

    fireEvent.change(screen.getByRole('combobox', { name: 'Record type' }), { target: { value: 'braille' } });
    await waitFor(() => expect(lib.getBibRecords).toHaveBeenLastCalledWith('org-1', expect.objectContaining({ record_type: 'braille', offset: 0 })));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('40 records match in braille. Showing 1 to 25.'));

    fireEvent.click(within(pages).getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(lib.getBibRecords).toHaveBeenLastCalledWith('org-1', expect.objectContaining({ offset: 25 })));
  });

  it('hides "New library record" without create permission', async () => {
    grant(['collections.view']);
    lib.getBibRecords.mockResolvedValue({ items: [], total: 0, limit: 25, offset: 0 });
    renderAt('/organizations/org-1/collections/library');
    expect(await screen.findByRole('heading', { name: 'No library records yet' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'New library record' })).not.toBeInTheDocument();
  });
});

describe('LibraryRecordPage — create', () => {
  it('groups fields in fieldsets, labels them, and focuses the first invalid field', async () => {
    const { container } = renderAt('/organizations/org-1/collections/library/create');
    expect(await screen.findByRole('heading', { level: 1, name: 'New library record' })).toBeInTheDocument();
    for (const group of ['Title and responsibility', 'Publication', 'Description', 'Identifiers and classification', 'Notes']) {
      expect(screen.getByRole('group', { name: group })).toBeInTheDocument();
    }
    for (const label of ['Subtitle', 'Statement of responsibility', 'Edition', 'Place of publication', 'Publisher', 'Extent', 'Language', 'Series', 'Format notes', 'ISBN', 'ISSN', 'LC control number (LCCN)', 'OCLC number', 'Call number', 'Notes']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    const title = screen.getByRole('textbox', { name: /^Title/ });
    expect(title).toHaveAttribute('aria-required', 'true');
    expect((await checkA11y(container)).violations).toEqual([]);

    fireEvent.change(screen.getByLabelText(/Earliest year/), { target: { value: '1990' } });
    fireEvent.change(screen.getByLabelText(/Latest year/), { target: { value: '1980' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create record' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a title.');
    expect(title).toHaveFocus();
    expect(title).toHaveAttribute('aria-invalid', 'true');
    expect(title.getAttribute('aria-describedby')).toContain('-error');
    expect(screen.getByLabelText(/Latest year/)).toHaveAttribute('aria-invalid', 'true');
    expect(lib.createBibRecord).not.toHaveBeenCalled();
  });

  it('creates a record with trimmed values and numeric years', async () => {
    lib.createBibRecord.mockResolvedValue({ ...RECORD, bib_record_id: 'new1' });
    lib.getBibRecord.mockResolvedValue({ ...RECORD, bib_record_id: 'new1' });
    renderAt('/organizations/org-1/collections/library/create');
    await screen.findByRole('heading', { level: 1, name: 'New library record' });
    fireEvent.change(screen.getByRole('combobox', { name: /Record type/ }), { target: { value: 'audio' } });
    fireEvent.change(screen.getByRole('textbox', { name: /^Title/ }), { target: { value: '  Kernel Book  ' } });
    fireEvent.change(screen.getByLabelText(/Earliest year/), { target: { value: '1991' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create record' }));
    await waitFor(() => expect(lib.createBibRecord).toHaveBeenCalled());
    const body = lib.createBibRecord.mock.calls[0][1];
    expect(body).toMatchObject({ record_type: 'audio', title: 'Kernel Book', date_earliest: 1991, date_latest: null, subtitle: null });
  });
});

describe('LibraryRecordPage — existing record', () => {
  it('shows the record history, including holding and item changes, as readable text', async () => {
    lib.getBibRecord.mockResolvedValue(RECORD);
    reports.getRecordAuditHistory.mockResolvedValue({
      entity_type: 'bib_record', entity_id: 'r1', total: 2, limit: 20, offset: 0,
      items: [
        {
          event_id: 'e2', change_type: 'link_updated', changed_at: '2026-11-13T15:30:00+00:00',
          changed_by: 'u1', changed_by_name: 'Ada Librarian', changed_by_email: null, request_method: 'PATCH',
          changed_fields: ['status'], summary: 'Updated item: T0002',
          child_entity_type: 'bib_item', child_entity_id: 'i2', child_display_key: 'T0002',
          field_diffs: [{ field_name: 'status', old_value: 'available', new_value: 'on_loan' }],
        },
        {
          event_id: 'e1', change_type: 'created', changed_at: '2026-11-12T10:00:00+00:00',
          changed_by: 'u1', changed_by_name: 'Ada Librarian', changed_by_email: null, request_method: 'POST',
          changed_fields: [], summary: 'Created bib record', field_diffs: [],
        },
      ],
    });
    const { container } = renderAt('/organizations/org-1/collections/library/r1');
    expect(await screen.findByRole('heading', { level: 2, name: 'Change history' })).toBeInTheDocument();
    expect(reports.getRecordAuditHistory).toHaveBeenCalledWith('org-1', 'bib_record', 'r1', expect.anything());
    const list = await screen.findByRole('list', { name: 'Change history, newest first' });
    expect(within(list).getByText('Item T0002: Status changed from available to on loan.')).toBeInTheDocument();
    expect(within(list).getByText('Created bib record')).toBeInTheDocument();
    expect((await checkA11y(container)).violations).toEqual([]);
  });

  it('shows names, subjects, holdings and items in accessible tables with row-named controls', async () => {
    lib.getBibRecord.mockResolvedValue(RECORD);
    const { container } = renderAt('/organizations/org-1/collections/library/r1');
    expect(await screen.findByRole('heading', { level: 1, name: /Walking Alone and Marching Together \(Braille\)/ })).toBeInTheDocument();

    const holdings = screen.getByRole('table', { name: '1 holding' });
    expect(within(holdings).getByRole('rowheader', { name: 'Holding 1: Stacks, TB HV1593' })).toBeInTheDocument();
    expect(within(holdings).getByRole('button', { name: 'Edit Holding 1: Stacks, TB HV1593' })).toBeInTheDocument();
    expect(within(holdings).getByRole('button', { name: 'Remove Holding 1: Stacks, TB HV1593' })).toBeInTheDocument();

    const items = screen.getByRole('table', { name: '2 items in Holding 1: Stacks, TB HV1593' });
    expect(within(items).getByRole('rowheader', { name: 'T0001' })).toBeInTheDocument();
    expect(within(items).getByRole('cell', { name: 'On loan' })).toBeInTheDocument();
    expect(within(items).getByRole('button', { name: 'Edit item T0001' })).toBeInTheDocument();
    expect(within(items).getByRole('button', { name: 'Remove item T0002 from Holding 1: Stacks, TB HV1593' })).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Remove Floyd Matson, author' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove subject Blind--Civil rights' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Find a subject heading' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Find a person or organization record' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Role' })).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Add a holding' })).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Add an item to Holding 1: Stacks, TB HV1593' })).toBeInTheDocument();
    expect((await checkA11y(container)).violations).toEqual([]);
  });

  it('adds an item, announces it and focuses the new row', async () => {
    lib.getBibRecord.mockResolvedValue(RECORD);
    const newItem = { ...RECORD.holdings![0].items[0], item_id: 'i3', barcode: 'T0003', enumeration: 'v.3' };
    lib.addBibItem.mockResolvedValue(newItem);
    renderAt('/organizations/org-1/collections/library/r1');
    const form = await screen.findByRole('form', { name: 'Add an item to Holding 1: Stacks, TB HV1593' });

    lib.getBibRecord.mockResolvedValue({
      ...RECORD,
      holdings: [{ ...RECORD.holdings![0], items: [...RECORD.holdings![0].items, newItem] }],
    });
    fireEvent.change(within(form).getByLabelText(/^Barcode/), { target: { value: ' T0003 ' } });
    fireEvent.change(within(form).getByLabelText(/^Volume or part/), { target: { value: 'v.3' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add item' }));

    await waitFor(() => expect(lib.addBibItem).toHaveBeenCalledWith('org-1', 'r1', 'h1', expect.objectContaining({ barcode: 'T0003', enumeration: 'v.3', status: 'available' })));
    const edit = await screen.findByRole('button', { name: 'Edit item T0003' });
    await waitFor(() => expect(edit).toHaveFocus());
    expect(screen.getAllByRole('status').some((s) => s.textContent === 'Added item T0003 to Holding 1: Stacks, TB HV1593.')).toBe(true);
  });

  it('edits an item in a labelled form and returns focus to its Edit button', async () => {
    lib.getBibRecord.mockResolvedValue(RECORD);
    lib.updateBibItem.mockResolvedValue({ ...RECORD.holdings![0].items[0], status: 'missing' });
    renderAt('/organizations/org-1/collections/library/r1');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit item T0001' }));
    const form = screen.getByRole('form', { name: 'Edit item T0001' });
    await waitFor(() => expect(within(form).getByLabelText(/^Barcode/)).toHaveFocus());
    fireEvent.change(within(form).getByRole('combobox', { name: 'Status' }), { target: { value: 'missing' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save item' }));
    await waitFor(() => expect(lib.updateBibItem).toHaveBeenCalledWith('org-1', 'r1', 'h1', 'i1', expect.objectContaining({ status: 'missing' })));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit item T0001' })).toHaveFocus());
  });

  it('removes an item and moves focus to the items heading', async () => {
    lib.getBibRecord.mockResolvedValue(RECORD);
    lib.deleteBibItem.mockResolvedValue({ message: 'ok' });
    renderAt('/organizations/org-1/collections/library/r1');
    fireEvent.click(await screen.findByRole('button', { name: 'Remove item T0002 from Holding 1: Stacks, TB HV1593' }));
    await waitFor(() => expect(lib.deleteBibItem).toHaveBeenCalledWith('org-1', 'r1', 'h1', 'i2'));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Items in Holding 1: Stacks, TB HV1593' })).toHaveFocus());
  });

  it('shows a server error (duplicate barcode) in the item form', async () => {
    lib.getBibRecord.mockResolvedValue(RECORD);
    lib.addBibItem.mockRejectedValue(new Error('Another item in this organization already has that barcode'));
    renderAt('/organizations/org-1/collections/library/r1');
    const form = await screen.findByRole('form', { name: 'Add an item to Holding 1: Stacks, TB HV1593' });
    fireEvent.change(within(form).getByLabelText(/^Barcode/), { target: { value: 'T0001' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add item' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('already has that barcode');
    expect(within(form).getByLabelText(/^Barcode/)).toHaveFocus();
  });

  it('adds a holding and focuses its Edit button', async () => {
    lib.getBibRecord.mockResolvedValue(RECORD);
    const added = { ...RECORD.holdings![0], holding_id: 'h2', call_number: 'TB2', items: [] };
    lib.addBibHolding.mockResolvedValue(added);
    renderAt('/organizations/org-1/collections/library/r1');
    const form = await screen.findByRole('form', { name: 'Add a holding' });
    lib.getBibRecord.mockResolvedValue({ ...RECORD, holdings: [...RECORD.holdings!, added] });
    fireEvent.change(within(form).getByLabelText('Local call number'), { target: { value: 'TB2' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add holding' }));
    await waitFor(() => expect(lib.addBibHolding).toHaveBeenCalledWith('org-1', 'r1', expect.objectContaining({ call_number: 'TB2' })));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Holding 2: Stacks, TB2' })).toHaveFocus());
  });

  it('leaves hidden fields out of the form and the save', async () => {
    lib.getBibRecord.mockResolvedValue({ ...RECORD, notes: undefined, _restricted_fields: ['notes'] });
    lib.updateBibRecord.mockResolvedValue(RECORD);
    renderAt('/organizations/org-1/collections/library/r1');
    await screen.findByRole('heading', { level: 1, name: /Walking Alone/ });
    expect(screen.queryByRole('group', { name: 'Notes' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(lib.updateBibRecord).toHaveBeenCalled());
    expect(lib.updateBibRecord.mock.calls[0][2]).not.toHaveProperty('notes');
  });

  it('is read-only without edit permission', async () => {
    grant(['collections.view']);
    lib.getBibRecord.mockResolvedValue(RECORD);
    const { container } = renderAt('/organizations/org-1/collections/library/r1');
    await screen.findByRole('heading', { level: 1, name: /Walking Alone/ });
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Edit item/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Add a holding' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /^Title/ })).toHaveAttribute('readonly');
    expect((await checkA11y(container)).violations).toEqual([]);
  });
});
