import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { IncidentObjectLinker } from '../../../components/collections/IncidentObjectLinker';

const {
  getIncidentReportMock,
  addIncidentObjectMock,
  removeIncidentObjectMock,
  getCollectionObjectsMock,
} = vi.hoisted(() => ({
  getIncidentReportMock: vi.fn(),
  addIncidentObjectMock: vi.fn(),
  removeIncidentObjectMock: vi.fn(),
  getCollectionObjectsMock: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  getIncidentReport: getIncidentReportMock,
  addIncidentObject: addIncidentObjectMock,
  removeIncidentObject: removeIncidentObjectMock,
  getCollectionObjects: getCollectionObjectsMock,
}));

const recordLinkerCalls: Array<Record<string, unknown>> = [];
vi.mock('../../../components/records', () => ({
  RecordLinker: (props: Record<string, unknown>) => {
    recordLinkerCalls.push(props);
    return (
      <div data-testid="record-linker">
        <span data-testid="title">{props.title as string}</span>
        <span data-testid="add-label">{props.addLabel as string}</span>
      </div>
    );
  },
}));

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function renderLinker(props: Partial<Parameters<typeof IncidentObjectLinker>[0]> = {}) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={createClient()}>
        <IncidentObjectLinker organizationId="org-1" reportId="r-1" {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('IncidentObjectLinker', () => {
  beforeEach(() => {
    recordLinkerCalls.length = 0;
    getIncidentReportMock.mockReset();
    addIncidentObjectMock.mockReset();
    removeIncidentObjectMock.mockReset();
    getCollectionObjectsMock.mockReset();
  });

  it('renders the Affected Objects title', () => {
    getIncidentReportMock.mockResolvedValue({ affected_objects: [] });
    renderLinker();
    expect(screen.getByTestId('title')).toHaveTextContent('Affected Objects');
  });

  it('renders Add Object label', () => {
    getIncidentReportMock.mockResolvedValue({ affected_objects: [] });
    renderLinker();
    expect(screen.getByTestId('add-label')).toHaveTextContent('Add Object');
  });

  it('extracts incident_object_id as item id', () => {
    getIncidentReportMock.mockResolvedValue({ affected_objects: [] });
    renderLinker();
    const getItemId = recordLinkerCalls.at(-1)!.getItemId as (l: { incident_object_id: string }) => string;
    expect(getItemId({ incident_object_id: 'io-1' } as never)).toBe('io-1');
  });

  it('extracts object_id as linked entity id', () => {
    getIncidentReportMock.mockResolvedValue({ affected_objects: [] });
    renderLinker();
    const getLinkedEntityId = recordLinkerCalls.at(-1)!.getLinkedEntityId as (l: { object_id: string }) => string;
    expect(getLinkedEntityId({ object_id: 'obj-9' } as never)).toBe('obj-9');
  });

  it('builds an object detail href', () => {
    getIncidentReportMock.mockResolvedValue({ affected_objects: [] });
    renderLinker();
    const getItemHref = recordLinkerCalls.at(-1)!.getItemHref as (l: { object_id: string }) => string;
    expect(getItemHref({ object_id: 'obj-9' } as never)).toBe(
      '/organizations/org-1/collections/objects/obj-9',
    );
  });

  it('onLink calls addIncidentObject with damage metadata', async () => {
    getIncidentReportMock.mockResolvedValue({ affected_objects: [] });
    addIncidentObjectMock.mockResolvedValue({});
    renderLinker();
    const onLink = recordLinkerCalls.at(-1)!.onLink as (
      o: { object_id: string },
      m: { damage_extent?: string; damage_description?: string },
    ) => Promise<void>;
    await onLink(
      { object_id: 'obj-3' },
      { damage_extent: 'severe', damage_description: 'Cracked' },
    );
    expect(addIncidentObjectMock).toHaveBeenCalledWith('org-1', 'r-1', {
      object_id: 'obj-3',
      damage_extent: 'severe',
      damage_description: 'Cracked',
    });
  });

  it('onLink converts blank damage_description to null', async () => {
    getIncidentReportMock.mockResolvedValue({ affected_objects: [] });
    addIncidentObjectMock.mockResolvedValue({});
    renderLinker();
    const onLink = recordLinkerCalls.at(-1)!.onLink as (
      o: { object_id: string },
      m: { damage_extent?: string; damage_description?: string },
    ) => Promise<void>;
    await onLink({ object_id: 'obj-5' }, { damage_extent: 'minor', damage_description: '' });
    expect(addIncidentObjectMock).toHaveBeenCalledWith('org-1', 'r-1', {
      object_id: 'obj-5',
      damage_extent: 'minor',
      damage_description: null,
    });
  });

  it('onUnlink calls removeIncidentObject with object_id', async () => {
    getIncidentReportMock.mockResolvedValue({ affected_objects: [] });
    removeIncidentObjectMock.mockResolvedValue({});
    renderLinker();
    const onUnlink = recordLinkerCalls.at(-1)!.onUnlink as (l: { object_id: string }) => Promise<void>;
    await onUnlink({ object_id: 'obj-2' });
    expect(removeIncidentObjectMock).toHaveBeenCalledWith('org-1', 'r-1', 'obj-2');
  });

  it('search.searchFn delegates to getCollectionObjects', async () => {
    getIncidentReportMock.mockResolvedValue({ affected_objects: [] });
    getCollectionObjectsMock.mockResolvedValue({ items: [{ object_id: 'a' }] });
    renderLinker();
    const search = recordLinkerCalls.at(-1)!.search as { searchFn: (t: string) => Promise<unknown> };
    const r = await search.searchFn('q');
    expect(getCollectionObjectsMock).toHaveBeenCalledWith('org-1', { search: 'q', limit: 20 });
    expect(r).toEqual([{ object_id: 'a' }]);
  });

  it('declares the damage_extent and damage_description metadata fields', () => {
    getIncidentReportMock.mockResolvedValue({ affected_objects: [] });
    renderLinker();
    const fields = recordLinkerCalls.at(-1)!.metadataFields as Array<{ key: string }>;
    const keys = fields.map((f) => f.key);
    expect(keys).toContain('damage_extent');
    expect(keys).toContain('damage_description');
  });
});
