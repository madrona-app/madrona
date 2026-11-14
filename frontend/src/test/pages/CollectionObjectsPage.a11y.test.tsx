import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CollectionObjectsPage from '../../pages/collections/CollectionObjectsPage';
import * as api from '../../lib/api';
import { checkA11y } from '../a11y';

vi.mock('../../lib/api', () => ({
  searchCollections: vi.fn(),
  getActiveContext: vi.fn(),
  getLocations: vi.fn().mockResolvedValue({ items: [] }),
}));

const searchSettings = { hide: true };
vi.mock('../../lib/api/searchSettings', () => ({
  getHideDeaccessioned: vi.fn(() => Promise.resolve(searchSettings.hide)),
  hideDeaccessionedQueryKey: (id: string) => ['search-settings', 'hide-deaccessioned', id],
}));

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: () => true }),
}));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ hasAppAccess: () => true }),
}));

vi.mock('../../hooks/useGeo', () => ({
  useGeo: () => ({
    searchObjectsInPolygon: { mutateAsync: vi.fn() },
    useCollectionOrigins: () => ({ data: undefined, isLoading: false }),
  }),
}));

vi.mock('../../components/workspaces', () => ({
  AddToWorkspaceDialog: () => null,
  BulkActionDialog: () => null,
  SaveSearchAsWorkSetDialog: () => null,
}));

vi.mock('../../components/maps/MapSearch', () => ({ default: () => null }));
vi.mock('../../components/maps/CollectionOriginMap', () => ({ default: () => null }));

const hits = [
  {
    object_id: 'obj-1',
    object_number: '2024.1.1',
    title: 'Bronze vase',
    object_type: 'sculpture',
    object_status: 'active',
    primary_image_url: 'https://example.com/vase.jpg',
    creators: [{ name: 'A. Maker' }],
    current_location: { location_id: 'loc-1', name: 'Gallery 3' },
    has_rights: true,
    is_discoverable: true,
    active_procedures_count: 2,
  },
  {
    object_id: 'obj-2',
    object_number: '2024.1.2',
    title: 'Linen sampler',
    object_type: 'textile',
    object_status: 'active',
    primary_image_url: null,
    creators: [],
    current_location: null,
  },
];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/organizations/org-1/collections/objects']}>
        <Routes>
          <Route path="/organizations/:orgId/collections/objects" element={<CollectionObjectsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CollectionObjectsPage accessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchSettings.hide = true;
    vi.mocked(api.searchCollections).mockResolvedValue({
      hits,
      total: 2,
      facets: [
        {
          field: 'object_type',
          buckets: [
            { key: 'sculpture', doc_count: 1 },
            { key: 'textile', doc_count: 1 },
          ],
        },
      ],
    } as never);
    vi.mocked(api.getActiveContext).mockResolvedValue({ context: null } as never);
  });

  it('grid view has no axe violations and each card has a named link', async () => {
    const { container } = renderPage();
    await screen.findByRole('link', { name: 'Bronze vase' });
    expect(screen.getByRole('link', { name: 'Linen sampler' })).toHaveAttribute(
      'href',
      '/organizations/org-1/collections/objects/obj-2',
    );
    expect(screen.getByRole('button', { name: 'Move 2024.1.1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add 2024.1.1 to workspace' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Search collection objects' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Text' })).toHaveAttribute('aria-pressed', 'true');

    const results = await checkA11y(container);
    expect(results.violations).toEqual([]);
  });

  it('list view has no axe violations and rows have a link and named actions', async () => {
    const { container } = renderPage();
    await screen.findByRole('link', { name: 'Bronze vase' });
    fireEvent.click(screen.getByRole('button', { name: 'List view' }));

    const table = screen.getByRole('table', { name: 'Collection objects' });
    expect(within(table).getByRole('columnheader', { name: 'Actions' })).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: 'Bronze vase' })).toBeInTheDocument();
    expect(within(table).getByRole('button', { name: 'Edit 2024.1.1' })).toBeInTheDocument();
    expect(within(table).getByText('No rights')).toBeInTheDocument();

    const results = await checkA11y(container);
    expect(results.violations).toEqual([]);
  });

  it('filter panel is a disclosure, inert while collapsed, with labelled controls', async () => {
    const { container } = renderPage();
    await screen.findByRole('link', { name: 'Bronze vase' });

    const toggle = screen.getByRole('button', { name: 'Filters' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const panel = container.querySelector('#objects-filter-panel')!;
    expect(panel).toHaveAttribute('inert');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(panel).not.toHaveAttribute('inert');

    expect(screen.getByRole('combobox', { name: 'Display Status' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Creator' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Date Range' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Date from' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Location' })).toBeInTheDocument();

    const facet = screen.getByRole('button', { name: 'Object Type All Object Type' });
    fireEvent.click(facet);
    expect(facet).toHaveAttribute('aria-expanded', 'true');
    const group = screen.getByRole('group', { name: 'Object Type' });
    const sculpture = within(group).getByRole('checkbox', { name: /sculpture/ });
    fireEvent.keyDown(sculpture, { key: 'Escape' });
    expect(facet).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(facet).toHaveFocus());

    fireEvent.click(facet);
    const results = await checkA11y(container);
    expect(results.violations).toEqual([]);
  });

  it('has a labelled checkbox that includes deaccessioned records in the search', async () => {
    const { container } = renderPage();
    await screen.findByRole('link', { name: 'Bronze vase' });
    const include = screen.getByRole('checkbox', { name: 'Include deaccessioned records' });
    expect(include).not.toBeChecked();
    expect(include).toHaveAccessibleDescription(/left out of search results unless this is checked/);
    expect(vi.mocked(api.searchCollections).mock.calls.at(-1)?.[1]).not.toHaveProperty('include_deaccessioned');

    fireEvent.click(include);
    expect(include).toBeChecked();
    await waitFor(() =>
      expect(vi.mocked(api.searchCollections).mock.calls.at(-1)?.[1]).toMatchObject({ include_deaccessioned: true }),
    );
    expect((await checkA11y(container)).violations).toEqual([]);
  });

  it('explains when the organization already shows deaccessioned records', async () => {
    searchSettings.hide = false;
    renderPage();
    await screen.findByRole('link', { name: 'Bronze vase' });
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'Include deaccessioned records' })).toBeDisabled(),
    );
    const include = screen.getByRole('checkbox', { name: 'Include deaccessioned records' });
    expect(include).toBeChecked();
    expect(include).toHaveAccessibleDescription(/always included/);
  });
});
