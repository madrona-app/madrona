import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ArchivalHierarchyPanel } from '../../../components/collections/ArchivalHierarchyPanel';
import { checkA11y } from '../../a11y';

const api = vi.hoisted(() => ({ getHierarchy: vi.fn(), moveRecord: vi.fn(), createChildRecord: vi.fn(), downloadEad: vi.fn() }));
vi.mock('../../../lib/api/hierarchy', async (orig) => ({ ...(await orig<object>()), ...api }));

const n = (id: string, level: string, label: string, number: string, title: string, parent: string | null, count = 0) => ({
  object_id: id, object_number: number, title, catalog_level: level, level_label: label, date: null,
  parent_object_id: parent, sibling_order: 1, child_count: count,
});
const coll = n('c', 'collection', 'Collection', 'NFB.1', 'tenBroek papers', null, 1);
const series = n('s', 'series', 'Series', 'NFB.1.1', 'Correspondence', 'c', 1);
const box = n('b', 'box', 'Box', 'B1', 'Box 1', 's', 2);
const f1 = n('f1', 'folder', 'Folder', 'F1', 'Letters 1950', 'b', 0);
const f2 = n('f2', 'folder', 'Folder', 'F2', 'Letters 1951', 'b', 0);
const levels = [{ value: 'series', label: 'Series' }, { value: 'box', label: 'Box' }, { value: 'folder', label: 'Folder' }, { value: 'item', label: 'Item' }];

function respond(id: string) {
  const map: Record<string, object> = {
    c: { ancestors: [], node: coll, children: [series], children_total: 1 },
    s: { ancestors: [coll], node: series, children: [box], children_total: 1 },
    b: { ancestors: [coll, series], node: box, children: [f1, f2], children_total: 2 },
  };
  return Promise.resolve({ limit: 50, offset: 0, levels, ...(map[id] as object) });
}

function renderPanel(id = 'b') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><ArchivalHierarchyPanel orgId="org" objectId={id} canEdit /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getHierarchy.mockImplementation((_o: string, id: string) => respond(id));
});

describe('ArchivalHierarchyPanel', () => {
  it('breadcrumb, contents table and move buttons are named; no axe violations', async () => {
    const { container } = renderPanel();
    const nav = await screen.findByRole('navigation', { name: 'Archival hierarchy' });
    expect(within(nav).getByRole('link', { name: 'Collection NFB.1 tenBroek papers' })).toBeInTheDocument();
    expect(within(nav).getByText('Box B1 Box 1')).toHaveAttribute('aria-current', 'page');
    const table = screen.getByRole('table', { name: /Contents of Box B1 Box 1: 2 records/ });
    expect(within(table).getAllByRole('rowheader').map((r) => r.textContent)).toEqual(['Letters 1950', 'Letters 1951']);
    expect(screen.getByRole('button', { name: 'Move Folder F1 Letters 1950 up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Folder F2 Letters 1951 down' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Download finding aid (EAD3) for tenBroek papers' })).toBeInTheDocument();
    expect((await checkA11y(container)).violations).toEqual([]);
  });

  it('moving announces the new position', async () => {
    api.moveRecord.mockResolvedValue({ object_id: 'f1', position: 2, of: 2 });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Move Folder F1 Letters 1950 down' }));
    await waitFor(() => expect(screen.getAllByRole('status')[0]).toHaveTextContent('Folder F1 Letters 1950 moved down, now 2 of 2'));
  });

  it('add-child form: labelled, validates, defaults to the next level', async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Add a record inside Box B1 Box 1' }));
    const level = screen.getByLabelText('Level');
    expect(level).toHaveFocus();
    expect(level).toHaveValue('folder');
    fireEvent.click(screen.getByRole('button', { name: 'Add record' }));
    expect(screen.getByLabelText('Number')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Number')).toHaveFocus();
    expect(api.createChildRecord).not.toHaveBeenCalled();
  });

  it('tree view follows the WAI-ARIA tree pattern with keyboard navigation', async () => {
    const { container } = renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Show tree view' }));
    const tree = await screen.findByRole('tree', { name: 'Hierarchy of Collection NFB.1 tenBroek papers' });
    const current = await within(tree).findByRole('treeitem', { name: 'Box B1 Box 1, current record' });
    expect(current).toHaveAttribute('aria-level', '3');
    expect(current).toHaveAttribute('aria-selected', 'true');
    expect(current).toHaveAttribute('tabindex', '0');
    const root = within(tree).getByRole('treeitem', { name: 'Collection NFB.1 tenBroek papers' });
    expect(root).toHaveAttribute('aria-expanded', 'true');
    current.focus();
    fireEvent.keyDown(current, { key: 'ArrowUp' });
    await waitFor(() => expect(within(tree).getByRole('treeitem', { name: 'Series NFB.1.1 Correspondence' })).toHaveFocus());
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    await waitFor(() => expect(within(tree).getByRole('treeitem', { name: 'Series NFB.1.1 Correspondence' })).toHaveAttribute('aria-expanded', 'false'));
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    await waitFor(() => expect(root).toHaveFocus());
    expect((await checkA11y(container)).violations).toEqual([]);
  });
});
