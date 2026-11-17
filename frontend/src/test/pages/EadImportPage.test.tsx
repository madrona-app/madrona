import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import EadImportPage from '../../pages/collections/EadImportPage';
import { checkA11y } from '../a11y';

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock('../../lib/apiClient', async (orig) => ({ ...(await orig<object>()), apiFetch }));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/organizations/org/collections/ead-import']}>
      <Routes><Route path="/organizations/:orgId/collections/ead-import" element={<EadImportPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => apiFetch.mockReset());

describe('EadImportPage', () => {
  it('requires a file, then previews and imports, moving focus to each result', async () => {
    const { container } = renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Import a finding aid (EAD)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose an EAD file first.');
    expect(screen.getByLabelText('EAD file (.xml)')).toHaveFocus();

    apiFetch.mockResolvedValueOnce({
      dry_run: true, total: 2, by_level: { collection: 1, series: 1 }, warnings: [], conflicts: [],
      records: [{ number: 'TP', level: 'collection', title: 'Test Papers', parent_number: null },
                { number: 'TP.1', level: 'series', title: 'Correspondence', parent_number: 'TP' }],
    });
    const file = new File(['<ead/>'], 'guide.xml', { type: 'application/xml' });
    fireEvent.change(screen.getByLabelText('EAD file (.xml)'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
    const heading = await screen.findByRole('heading', { level: 2, name: 'Preview: 2 records' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByRole('table', { name: 'Records to be created' })).toBeInTheDocument();
    expect(screen.getAllByRole('rowheader').map((r) => r.textContent)).toEqual(['TP', 'TP.1']);
    expect((await checkA11y(container)).violations).toEqual([]);

    apiFetch.mockResolvedValueOnce({ dry_run: false, root_object_id: 'r1', created: 2, by_level: {}, warnings: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Import 2 records' }));
    const done = await screen.findByRole('heading', { level: 2, name: 'Imported 2 records' });
    await waitFor(() => expect(done).toHaveFocus());
    expect(screen.getByRole('link', { name: 'Open the collection record' })).toHaveAttribute('href', '/organizations/org/collections/objects/r1');
  });

  it('conflicts disable the import and are listed', async () => {
    apiFetch.mockResolvedValueOnce({ dry_run: true, total: 1, by_level: { collection: 1 }, warnings: [], conflicts: ['TP'],
      records: [{ number: 'TP', level: 'collection', title: 'T', parent_number: null }] });
    renderPage();
    fireEvent.change(screen.getByLabelText('EAD file (.xml)'), { target: { files: [new File(['x'], 'a.xml')] } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
    expect(await screen.findByText(/These object numbers already exist/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import 1 record' })).toBeDisabled();
  });
});
