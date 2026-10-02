import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ExhibitionObjectLinker } from '../../../components/collections/ExhibitionObjectLinker';

const {
  getExhibitionObjectsMock,
  addExhibitionObjectMock,
  updateExhibitionObjectMock,
  removeExhibitionObjectMock,
  getCollectionObjectsMock,
  getConditionReportsMock,
} = vi.hoisted(() => ({
  getExhibitionObjectsMock: vi.fn(),
  addExhibitionObjectMock: vi.fn(),
  updateExhibitionObjectMock: vi.fn(),
  removeExhibitionObjectMock: vi.fn(),
  getCollectionObjectsMock: vi.fn(),
  getConditionReportsMock: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  getExhibitionObjects: getExhibitionObjectsMock,
  addExhibitionObject: addExhibitionObjectMock,
  updateExhibitionObject: updateExhibitionObjectMock,
  removeExhibitionObject: removeExhibitionObjectMock,
  getCollectionObjects: getCollectionObjectsMock,
  getConditionReports: getConditionReportsMock,
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

function renderLinker(props: Partial<Parameters<typeof ExhibitionObjectLinker>[0]> = {}) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={createClient()}>
        <ExhibitionObjectLinker organizationId="org-1" exhibitionId="ex-1" {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('ExhibitionObjectLinker', () => {
  beforeEach(() => {
    recordLinkerCalls.length = 0;
    getExhibitionObjectsMock.mockReset();
    addExhibitionObjectMock.mockReset();
    removeExhibitionObjectMock.mockReset();
    getCollectionObjectsMock.mockReset();
  });

  it('renders RecordLinker with the right title', () => {
    getExhibitionObjectsMock.mockResolvedValue({ exhibition_objects: [] });
    renderLinker();
    expect(screen.getByTestId('title')).toHaveTextContent('Exhibition Objects');
  });

  it('uses Add Object as the add label', () => {
    getExhibitionObjectsMock.mockResolvedValue({ exhibition_objects: [] });
    renderLinker();
    expect(screen.getByTestId('add-label')).toHaveTextContent('Add Object');
  });

  it('uses bulkSelect mode', () => {
    getExhibitionObjectsMock.mockResolvedValue({ exhibition_objects: [] });
    renderLinker();
    expect(recordLinkerCalls.at(-1)?.bulkSelect).toBe(true);
  });

  it('extracts exhibition_object_id as item id', () => {
    getExhibitionObjectsMock.mockResolvedValue({ exhibition_objects: [] });
    renderLinker();
    const getItemId = recordLinkerCalls.at(-1)!.getItemId as (o: { exhibition_object_id: string }) => string;
    expect(getItemId({ exhibition_object_id: 'eo-1' } as never)).toBe('eo-1');
  });

  it('prefers object_id for entity dedup', () => {
    getExhibitionObjectsMock.mockResolvedValue({ exhibition_objects: [] });
    renderLinker();
    const getLinkedEntityId = recordLinkerCalls.at(-1)!.getLinkedEntityId as (o: {
      object_id?: string;
      entity_key?: string;
      exhibition_object_id: string;
    }) => string;
    expect(getLinkedEntityId({ object_id: 'o-1', exhibition_object_id: 'eo-1' } as never)).toBe('o-1');
    expect(getLinkedEntityId({ entity_key: 'k-1', exhibition_object_id: 'eo-1' } as never)).toBe('k-1');
    expect(getLinkedEntityId({ exhibition_object_id: 'eo-1' } as never)).toBe('eo-1');
  });

  it('builds an object detail href when object_id present', () => {
    getExhibitionObjectsMock.mockResolvedValue({ exhibition_objects: [] });
    renderLinker();
    const getItemHref = recordLinkerCalls.at(-1)!.getItemHref as (o: { object_id?: string }) => string | null;
    expect(getItemHref({ object_id: 'obj-99' } as never)).toBe(
      '/organizations/org-1/collections/objects/obj-99',
    );
    expect(getItemHref({} as never)).toBeNull();
  });

  it('onLink calls addExhibitionObject with metadata.section', async () => {
    getExhibitionObjectsMock.mockResolvedValue({ exhibition_objects: [] });
    addExhibitionObjectMock.mockResolvedValue({});
    renderLinker();
    const onLink = recordLinkerCalls.at(-1)!.onLink as (
      o: { object_id: string },
      m: { section?: string },
    ) => Promise<void>;
    await onLink({ object_id: 'obj-1' }, { section: 'Gallery A' });
    expect(addExhibitionObjectMock).toHaveBeenCalledWith('org-1', 'ex-1', {
      object_id: 'obj-1',
      section: 'Gallery A',
    });
  });

  it('onLink omits section when blank', async () => {
    getExhibitionObjectsMock.mockResolvedValue({ exhibition_objects: [] });
    addExhibitionObjectMock.mockResolvedValue({});
    renderLinker();
    const onLink = recordLinkerCalls.at(-1)!.onLink as (
      o: { object_id: string },
      m: { section?: string },
    ) => Promise<void>;
    await onLink({ object_id: 'obj-2' }, { section: '' });
    expect(addExhibitionObjectMock).toHaveBeenCalledWith('org-1', 'ex-1', {
      object_id: 'obj-2',
      section: undefined,
    });
  });

  it('onUnlink calls removeExhibitionObject', async () => {
    getExhibitionObjectsMock.mockResolvedValue({ exhibition_objects: [] });
    removeExhibitionObjectMock.mockResolvedValue({});
    renderLinker();
    const onUnlink = recordLinkerCalls.at(-1)!.onUnlink as (o: { exhibition_object_id: string }) => Promise<void>;
    await onUnlink({ exhibition_object_id: 'eo-2' });
    expect(removeExhibitionObjectMock).toHaveBeenCalledWith('org-1', 'ex-1', 'eo-2');
  });

  it('search.searchFn delegates to getCollectionObjects', async () => {
    getExhibitionObjectsMock.mockResolvedValue({ exhibition_objects: [] });
    getCollectionObjectsMock.mockResolvedValue({ items: [{ object_id: 'a' }] });
    renderLinker();
    const search = recordLinkerCalls.at(-1)!.search as { searchFn: (t: string) => Promise<unknown> };
    const r = await search.searchFn('hello');
    expect(getCollectionObjectsMock).toHaveBeenCalledWith('org-1', { search: 'hello', limit: 30 });
    expect(r).toEqual([{ object_id: 'a' }]);
  });

  it('declares editLink with renderEditSlideOver', () => {
    getExhibitionObjectsMock.mockResolvedValue({ exhibition_objects: [] });
    renderLinker();
    const editLink = recordLinkerCalls.at(-1)!.editLink as { renderEditSlideOver: unknown };
    expect(typeof editLink.renderEditSlideOver).toBe('function');
  });

  it('declares the section metadata field', () => {
    getExhibitionObjectsMock.mockResolvedValue({ exhibition_objects: [] });
    renderLinker();
    const fields = recordLinkerCalls.at(-1)!.metadataFields as Array<{ key: string }>;
    expect(fields.map((f) => f.key)).toContain('section');
  });
});
