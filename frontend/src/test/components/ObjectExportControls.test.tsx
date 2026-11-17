import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  ObjectJsonLdExportButton,
  ObjectListExportControls,
  RightsExportControls,
} from '../../components/collections/ObjectExportControls';
import { checkA11y } from '../a11y';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

vi.mock('../../lib/api/_utils', () => ({
  apiFetch: apiFetchMock,
}));

function lastBody(callIndex = -1) {
  const calls = apiFetchMock.mock.calls;
  const call = calls[callIndex < 0 ? calls.length + callIndex : callIndex];
  return JSON.parse(call[1].body as string);
}

describe('ObjectListExportControls', () => {
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    apiFetchMock.mockReset();
    // jsdom lacks object URLs; the component needs them for the download.
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = vi.fn(() => 'blob:export-1');
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = vi.fn();
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    clickSpy.mockRestore();
  });

  it('has labelled controls and no axe violations', async () => {
    const { container } = render(
      <main>
        <ObjectListExportControls
          organizationId="org-1"
          resultCount={42}
          activeWorkspace={{ workspace_id: 'ws-1', name: 'Board review', object_count: 5 }}
        />
      </main>,
    );
    expect(screen.getByRole('region', { name: 'Export objects' })).toBeInTheDocument();
    const format = screen.getByLabelText('Format');
    expect(format.tagName).toBe('SELECT');
    expect(screen.getByRole('option', { name: 'CSV' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Excel (.xlsx)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'JSON-LD (linked data)' })).toBeInTheDocument();
    expect(screen.getByLabelText('Objects')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'All objects (42 objects)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Active work set: Board review (5 objects)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
    expect((await checkA11y(container)).violations).toEqual([]);
  });

  it('exports the current search as CSV and offers a named download link', async () => {
    apiFetchMock.mockResolvedValue(new Blob(['Object Number\nEXP.1\n'], { type: 'text/csv' }));
    const { container } = render(
      <ObjectListExportControls
        organizationId="org-1"
        searchQuery="braille"
        filters={{ object_type: ['book'] }}
        resultCount={3}
      />,
    );
    expect(screen.getByText('Objects: Current search results (3 objects)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(1));
    expect(apiFetchMock.mock.calls[0][0]).toBe('/organizations/org-1/collections/export');
    expect(apiFetchMock.mock.calls[0][1].method).toBe('POST');
    expect(lastBody()).toEqual({
      record_type: 'collection_objects',
      format: 'csv',
      search: { query: { q: 'braille' }, filters: { object_type: ['book'] } },
    });

    const link = await screen.findByRole('link', { name: /^Download collection-objects-\d{8}\.csv \(CSV, \d+ bytes\)$/ });
    expect(link).toHaveAttribute('href', 'blob:export-1');
    expect(clickSpy).toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(/CSV export ready: collection-objects-\d{8}\.csv\. The download has started\./);
    expect((await checkA11y(container)).violations).toEqual([]);
  });

  it('exports the active work set as Excel', async () => {
    apiFetchMock.mockResolvedValue(new Blob(['PK'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    render(
      <ObjectListExportControls
        organizationId="org-1"
        resultCount={42}
        activeWorkspace={{ workspace_id: 'ws-1', name: 'Board review', object_count: 5 }}
      />,
    );
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'excel' } });
    fireEvent.change(screen.getByLabelText('Objects'), { target: { value: 'workspace' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    expect(lastBody()).toEqual({ record_type: 'collection_objects', format: 'excel', workspace_id: 'ws-1' });
    expect(await screen.findByRole('link', { name: /\.xlsx \(Excel/ })).toBeInTheDocument();
  });

  it('exports everything with no scope when there is no search', async () => {
    apiFetchMock.mockResolvedValue(new Blob(['x'], { type: 'text/csv' }));
    render(<ObjectListExportControls organizationId="org-1" resultCount={10} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    expect(lastBody()).toEqual({ record_type: 'collection_objects', format: 'csv' });
  });

  it('pages JSON-LD exports and merges the pages into one document', async () => {
    const page = (n: number, start: number) => ({
      '@type': 'Collection',
      hasPart: Array.from({ length: n }, (_, i) => ({ identifier: `O.${start + i}` })),
      numberOfItems: n,
      totalItems: 1500,
    });
    apiFetchMock
      .mockResolvedValueOnce(JSON.stringify(page(1000, 0)))
      .mockResolvedValueOnce(JSON.stringify(page(500, 1000)));
    const blobs: Blob[] = [];
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = vi.fn((b: Blob) => {
      blobs.push(b);
      return 'blob:jsonld';
    });

    render(<ObjectListExportControls organizationId="org-1" searchQuery="tenBroek" resultCount={1500} />);
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'jsonld' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    await screen.findByRole('link', { name: /\.jsonld \(JSON-LD/ });
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
    expect(apiFetchMock.mock.calls[0][0]).toBe('/organizations/org-1/collections/export/jsonld');
    expect(lastBody(0)).toEqual({ search: { query: { q: 'tenBroek' } }, limit: 1000, offset: 0 });
    expect(lastBody(1)).toEqual({ search: { query: { q: 'tenBroek' } }, limit: 1000, offset: 1000 });
    const merged = JSON.parse(await new Promise<string>((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result as string); r.readAsText(blobs[0]); }));
    expect(merged.numberOfItems).toBe(1500);
    expect(merged.hasPart).toHaveLength(1500);
    expect(merged.totalItems).toBeUndefined();
  });

  it('announces failures in an alert', async () => {
    apiFetchMock.mockRejectedValue(new Error('Search service is not available'));
    render(<ObjectListExportControls organizationId="org-1" searchQuery="x" resultCount={1} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Export failed: Search service is not available');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('notes the 10,000-object cap', () => {
    render(<ObjectListExportControls organizationId="org-1" resultCount={25000} />);
    expect(screen.getByRole('button', { name: 'Export' })).toHaveAccessibleDescription(
      'Exports include the first 10,000 objects.',
    );
  });
});

describe('ObjectJsonLdExportButton', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = vi.fn(() => 'blob:one');
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  it('exports one object as JSON-LD from the single-record endpoint', async () => {
    apiFetchMock.mockResolvedValue(JSON.stringify({ '@type': 'CreativeWork', identifier: '2026.1' }));
    const { container } = render(
      <main>
        <ObjectJsonLdExportButton organizationId="org-1" objectId="obj-1" objectNumber="2026.1" />
      </main>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export JSON-LD' }));
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith('/organizations/org-1/collections/objects/obj-1/jsonld'),
    );
    expect(await screen.findByRole('link', { name: /^Download object-2026\.1\.jsonld \(JSON-LD, \d+ bytes\)$/ })).toHaveAttribute('href', 'blob:one');
    expect(screen.getByRole('status')).toHaveTextContent('JSON-LD export ready: object-2026.1.jsonld. The download has started.');
    expect((await checkA11y(container)).violations).toEqual([]);
  });

  it('announces a failure', async () => {
    apiFetchMock.mockRejectedValue(new Error('Object not found'));
    render(<ObjectJsonLdExportButton organizationId="org-1" objectId="obj-1" objectNumber="2026.1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Export JSON-LD' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('JSON-LD export failed: Object not found');
  });
});

describe('RightsExportControls', () => {
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    apiFetchMock.mockReset();
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = vi.fn(() => 'blob:rights-1');
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = vi.fn();
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    clickSpy.mockRestore();
  });

  it('is labelled and has no axe violations', async () => {
    const { container } = render(
      <main>
        <RightsExportControls organizationId="org-1" />
      </main>,
    );
    expect(screen.getByRole('region', { name: 'Export rights records' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Format' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export rights' })).toBeInTheDocument();
    const results = await checkA11y(container);
    expect(results.violations).toEqual([]);
  });

  it('requests the object_rights record type in the chosen format and offers the file', async () => {
    apiFetchMock.mockResolvedValue(new Blob(['a,b'], { type: 'application/octet-stream' }));
    render(<RightsExportControls organizationId="org-1" />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Format' }), { target: { value: 'excel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export rights' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Excel export ready/));
    expect(apiFetchMock.mock.calls[0][0]).toBe('/organizations/org-1/collections/export');
    expect(lastBody()).toEqual({ record_type: 'object_rights', format: 'excel' });
    expect(screen.getByRole('link', { name: /Download object-rights-\d{8}\.xlsx \(Excel/ })).toBeInTheDocument();
  });
});
