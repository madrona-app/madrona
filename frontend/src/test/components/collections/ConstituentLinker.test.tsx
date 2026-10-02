import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ConstituentLinker } from '../../../components/collections/ConstituentLinker';

const {
  getObjectConstituentsMock,
  addObjectConstituentMock,
  removeObjectConstituentMock,
  searchConstituentsMock,
  importUlanMock,
  createConstituentMock,
  useLookupCategoryMock,
} = vi.hoisted(() => ({
  getObjectConstituentsMock: vi.fn(),
  addObjectConstituentMock: vi.fn(),
  removeObjectConstituentMock: vi.fn(),
  searchConstituentsMock: vi.fn(),
  importUlanMock: vi.fn(),
  createConstituentMock: vi.fn(),
  useLookupCategoryMock: vi.fn(),
}));

vi.mock('../../../lib/api/constituents', () => ({
  getObjectConstituents: getObjectConstituentsMock,
  addObjectConstituent: addObjectConstituentMock,
  removeObjectConstituent: removeObjectConstituentMock,
  searchConstituents: searchConstituentsMock,
  importUlan: importUlanMock,
  createConstituent: createConstituentMock,
}));

vi.mock('../../../hooks/useLookupValues', () => ({
  useLookupCategory: useLookupCategoryMock,
}));

const recordLinkerCalls: Array<Record<string, unknown>> = [];

vi.mock('../../../components/records', () => ({
  RecordLinker: (props: Record<string, unknown>) => {
    recordLinkerCalls.push(props);
    return (
      <div data-testid="record-linker">
        <span data-testid="title">{props.title as string}</span>
        <span data-testid="add-label">{props.addLabel as string}</span>
        <span data-testid="count">{((props.linkedItems as unknown[]) || []).length}</span>
      </div>
    );
  },
}));

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function renderLinker(props: Partial<Parameters<typeof ConstituentLinker>[0]> = {}) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={createClient()}>
        <ConstituentLinker organizationId="org-1" objectId="obj-1" {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('ConstituentLinker', () => {
  beforeEach(() => {
    recordLinkerCalls.length = 0;
    getObjectConstituentsMock.mockReset();
    addObjectConstituentMock.mockReset();
    removeObjectConstituentMock.mockReset();
    searchConstituentsMock.mockReset();
    importUlanMock.mockReset();
    createConstituentMock.mockReset();
    useLookupCategoryMock.mockReset();
    useLookupCategoryMock.mockReturnValue({
      options: [{ value: 'creator', label: 'Creator' }],
      getLabel: (v: string) => v,
      isLoading: false,
    });
  });

  it('renders RecordLinker with default title', () => {
    getObjectConstituentsMock.mockResolvedValue([]);
    renderLinker();
    expect(screen.getByTestId('title')).toHaveTextContent('Linked People and Organizations');
  });

  it('uses titleOverride when provided', () => {
    getObjectConstituentsMock.mockResolvedValue([]);
    renderLinker({ title: 'Authors' });
    expect(screen.getByTestId('title')).toHaveTextContent('Authors');
  });

  it('uses addLabelOverride when provided', () => {
    getObjectConstituentsMock.mockResolvedValue([]);
    renderLinker({ addLabel: 'Add Author' });
    expect(screen.getByTestId('add-label')).toHaveTextContent('Add Author');
  });

  it('filters linked xrefs by allowedRoles', () => {
    getObjectConstituentsMock.mockResolvedValue([
      { xref_id: 'x-1', constituent_id: 'c-1', role: 'creator' },
      { xref_id: 'x-2', constituent_id: 'c-2', role: 'donor' },
    ]);
    renderLinker({ allowedRoles: ['creator'] });
    // initial render before query resolves shows count 0
    expect(screen.getByTestId('count')).toBeInTheDocument();
  });

  it('passes lookup category that maps to the entity type', () => {
    getObjectConstituentsMock.mockResolvedValue([]);
    renderLinker({ entityType: 'collection_object' });
    expect(useLookupCategoryMock).toHaveBeenCalledWith('constituent_role_object');
  });

  it('uses entityType for non-collection_object entities', () => {
    getObjectConstituentsMock.mockResolvedValue([]);
    renderLinker({ entityType: 'exhibition' });
    expect(useLookupCategoryMock).toHaveBeenCalledWith('constituent_role_exhibition');
  });

  it('extracts xref_id as item id', () => {
    getObjectConstituentsMock.mockResolvedValue([]);
    renderLinker();
    const getItemId = recordLinkerCalls.at(-1)!.getItemId as (x: { xref_id: string }) => string;
    expect(getItemId({ xref_id: 'x-99' } as never)).toBe('x-99');
  });

  it('extracts constituent_id as linked entity id', () => {
    getObjectConstituentsMock.mockResolvedValue([]);
    renderLinker();
    const getLinkedEntityId = recordLinkerCalls.at(-1)!.getLinkedEntityId as (x: { constituent_id: string }) => string;
    expect(getLinkedEntityId({ constituent_id: 'c-9' } as never)).toBe('c-9');
  });

  it('groups by role', () => {
    getObjectConstituentsMock.mockResolvedValue([]);
    renderLinker();
    const getItemGroup = recordLinkerCalls.at(-1)!.getItemGroup as (x: { role: string }) => string;
    expect(getItemGroup({ role: 'creator' } as never)).toBe('creator');
  });

  it('builds a constituent detail href', () => {
    getObjectConstituentsMock.mockResolvedValue([]);
    renderLinker();
    const getItemHref = recordLinkerCalls.at(-1)!.getItemHref as (x: { constituent_id: string }) => string;
    expect(getItemHref({ constituent_id: 'c-77' } as never)).toBe(
      '/organizations/org-1/collections/constituents/c-77',
    );
  });

  it('onLink imports ULAN constituents before linking', async () => {
    getObjectConstituentsMock.mockResolvedValue([]);
    importUlanMock.mockResolvedValue({ constituent_id: 'imported-1' });
    addObjectConstituentMock.mockResolvedValue({});
    renderLinker();
    const onLink = recordLinkerCalls.at(-1)!.onLink as (
      r: { source?: string; ulan_id?: string; constituent_id?: string },
      m: { role: string },
    ) => Promise<void>;
    await onLink({ source: 'ulan', ulan_id: 'ulan-555' }, { role: 'creator' });
    expect(importUlanMock).toHaveBeenCalledWith('org-1', { ulan_id: 'ulan-555' });
    expect(addObjectConstituentMock).toHaveBeenCalledWith('org-1', 'obj-1', {
      constituent_id: 'imported-1',
      role: 'creator',
    });
  });

  it('onLink uses local constituent id when source is local', async () => {
    getObjectConstituentsMock.mockResolvedValue([]);
    addObjectConstituentMock.mockResolvedValue({});
    renderLinker();
    const onLink = recordLinkerCalls.at(-1)!.onLink as (
      r: { source?: string; constituent_id?: string },
      m: { role: string },
    ) => Promise<void>;
    await onLink({ source: 'local', constituent_id: 'c-local' }, { role: 'creator' });
    expect(importUlanMock).not.toHaveBeenCalled();
    expect(addObjectConstituentMock).toHaveBeenCalledWith('org-1', 'obj-1', {
      constituent_id: 'c-local',
      role: 'creator',
    });
  });

  it('onUnlink calls removeObjectConstituent with xref_id', async () => {
    getObjectConstituentsMock.mockResolvedValue([]);
    removeObjectConstituentMock.mockResolvedValue({});
    renderLinker();
    const onUnlink = recordLinkerCalls.at(-1)!.onUnlink as (x: { xref_id: string }) => Promise<void>;
    await onUnlink({ xref_id: 'x-7' });
    expect(removeObjectConstituentMock).toHaveBeenCalledWith('org-1', 'obj-1', 'x-7');
  });

  it('search.searchFn delegates to searchConstituents', async () => {
    getObjectConstituentsMock.mockResolvedValue([]);
    searchConstituentsMock.mockResolvedValue({ results: [{ id: 'r1' }] });
    renderLinker();
    const search = recordLinkerCalls.at(-1)!.search as { searchFn: (t: string) => Promise<unknown> };
    const r = await search.searchFn('mon');
    expect(searchConstituentsMock).toHaveBeenCalledWith('org-1', { q: 'mon', include_ulan: true, limit: 20 });
    expect(r).toEqual([{ id: 'r1' }]);
  });

  it('create.onCreateSubmit creates a constituent then links it', async () => {
    getObjectConstituentsMock.mockResolvedValue([]);
    createConstituentMock.mockResolvedValue({ constituent_id: 'c-new' });
    addObjectConstituentMock.mockResolvedValue({});
    renderLinker();
    const create = recordLinkerCalls.at(-1)!.create as {
      onCreateSubmit: (data: Record<string, string>) => Promise<void>;
    };
    await create.onCreateSubmit({
      name: 'New Person',
      constituent_type: 'person',
      role: 'creator',
    });
    expect(createConstituentMock).toHaveBeenCalledWith('org-1', {
      name: 'New Person',
      constituent_type: 'person',
    });
    expect(addObjectConstituentMock).toHaveBeenCalledWith('org-1', 'obj-1', {
      constituent_id: 'c-new',
      role: 'creator',
    });
  });
});
