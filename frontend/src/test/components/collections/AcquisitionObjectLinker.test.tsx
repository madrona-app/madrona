import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AcquisitionObjectLinker, ObjectAcquisitionSelector } from '../../../components/collections/AcquisitionObjectLinker';

const {
  getAcquisitionObjectsMock,
  linkAcquisitionObjectMock,
  unlinkAcquisitionObjectMock,
  getAcquisitionsMock,
  setObjectAcquisitionMock,
  getCollectionObjectsMock,
} = vi.hoisted(() => ({
  getAcquisitionObjectsMock: vi.fn(),
  linkAcquisitionObjectMock: vi.fn(),
  unlinkAcquisitionObjectMock: vi.fn(),
  getAcquisitionsMock: vi.fn(),
  setObjectAcquisitionMock: vi.fn(),
  getCollectionObjectsMock: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  getAcquisitionObjects: getAcquisitionObjectsMock,
  linkAcquisitionObject: linkAcquisitionObjectMock,
  unlinkAcquisitionObject: unlinkAcquisitionObjectMock,
  getAcquisitions: getAcquisitionsMock,
  setObjectAcquisition: setObjectAcquisitionMock,
  getCollectionObjects: getCollectionObjectsMock,
}));

const recordLinkerCalls: Array<Record<string, unknown>> = [];
const recordLinkerSingleCalls: Array<Record<string, unknown>> = [];

vi.mock('../../../components/records', () => ({
  RecordLinker: (props: Record<string, unknown>) => {
    recordLinkerCalls.push(props);
    const linkedItems = (props.linkedItems as unknown[]) || [];
    const renderItem = props.renderItem as (i: unknown) => React.ReactNode;
    return (
      <div data-testid="record-linker">
        <span data-testid="title">{props.title as string}</span>
        <span data-testid="add-label">{props.addLabel as string}</span>
        <span data-testid="empty-message">{props.emptyMessage as string}</span>
        <span data-testid="is-editing">{String(props.isEditing)}</span>
        <span data-testid="count">{linkedItems.length}</span>
        <div>
          {linkedItems.map((item, i) => (
            <div key={i} data-testid={`item-${i}`}>
              {renderItem(item)}
            </div>
          ))}
        </div>
      </div>
    );
  },
  RecordLinkerSingle: (props: Record<string, unknown>) => {
    recordLinkerSingleCalls.push(props);
    const linkedItem = props.linkedItem;
    const renderItem = props.renderItem as (i: unknown) => React.ReactNode;
    return (
      <div data-testid="record-linker-single">
        <span data-testid="singular">{props.singularNoun as string}</span>
        {linkedItem ? <div data-testid="linked-item">{renderItem(linkedItem)}</div> : null}
      </div>
    );
  },
}));

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function renderObjectLinker(props: Partial<Parameters<typeof AcquisitionObjectLinker>[0]> = {}) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={createClient()}>
        <AcquisitionObjectLinker
          organizationId="org-1"
          acquisitionId="acq-1"
          {...props}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function renderAcquisitionSelector(props: Partial<Parameters<typeof ObjectAcquisitionSelector>[0]> = {}) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={createClient()}>
        <ObjectAcquisitionSelector
          organizationId="org-1"
          objectId="obj-1"
          {...props}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('AcquisitionObjectLinker', () => {
  beforeEach(() => {
    recordLinkerCalls.length = 0;
    recordLinkerSingleCalls.length = 0;
    getAcquisitionObjectsMock.mockReset();
    linkAcquisitionObjectMock.mockReset();
    unlinkAcquisitionObjectMock.mockReset();
    setObjectAcquisitionMock.mockReset();
    getCollectionObjectsMock.mockReset();
  });

  it('renders RecordLinker with the right title and add label', () => {
    getAcquisitionObjectsMock.mockResolvedValue({ objects: [] });
    renderObjectLinker();
    expect(screen.getByTestId('title')).toHaveTextContent('Linked Objects');
    expect(screen.getByTestId('add-label')).toHaveTextContent('Add Object');
  });

  it('passes empty message describing acquisition objects', () => {
    getAcquisitionObjectsMock.mockResolvedValue({ objects: [] });
    renderObjectLinker();
    expect(screen.getByTestId('empty-message')).toHaveTextContent('No objects linked to this acquisition.');
  });

  it('forwards isEditing to RecordLinker', () => {
    getAcquisitionObjectsMock.mockResolvedValue({ objects: [] });
    renderObjectLinker({ isEditing: true });
    expect(screen.getByTestId('is-editing')).toHaveTextContent('true');
  });

  it('extracts the right item id (acquisition_object_id)', () => {
    getAcquisitionObjectsMock.mockResolvedValue({ objects: [] });
    renderObjectLinker();
    const getItemId = recordLinkerCalls.at(-1)!.getItemId as (link: { acquisition_object_id: string }) => string;
    expect(getItemId({ acquisition_object_id: 'lnk-1' } as never)).toBe('lnk-1');
  });

  it('extracts the linked entity id (object_id)', () => {
    getAcquisitionObjectsMock.mockResolvedValue({ objects: [] });
    renderObjectLinker();
    const getLinkedEntityId = recordLinkerCalls.at(-1)!.getLinkedEntityId as (link: { object_id: string }) => string;
    expect(getLinkedEntityId({ object_id: 'obj-1' } as never)).toBe('obj-1');
  });

  it('builds an object detail href', () => {
    getAcquisitionObjectsMock.mockResolvedValue({ objects: [] });
    renderObjectLinker();
    const getItemHref = recordLinkerCalls.at(-1)!.getItemHref as (link: { object_id: string }) => string;
    expect(getItemHref({ object_id: 'obj-99' } as never)).toBe(
      '/organizations/org-1/collections/objects/obj-99',
    );
  });

  it('onLink calls linkAcquisitionObject with the chosen object id', async () => {
    getAcquisitionObjectsMock.mockResolvedValue({ objects: [] });
    linkAcquisitionObjectMock.mockResolvedValue({});
    renderObjectLinker();
    const onLink = recordLinkerCalls.at(-1)!.onLink as (o: { object_id: string }) => Promise<void>;
    await onLink({ object_id: 'obj-7' });
    expect(linkAcquisitionObjectMock).toHaveBeenCalledWith('org-1', 'acq-1', 'obj-7');
  });

  it('onUnlink calls unlinkAcquisitionObject with object_id from the link', async () => {
    getAcquisitionObjectsMock.mockResolvedValue({ objects: [] });
    unlinkAcquisitionObjectMock.mockResolvedValue({});
    renderObjectLinker();
    const onUnlink = recordLinkerCalls.at(-1)!.onUnlink as (l: { object_id: string }) => Promise<void>;
    await onUnlink({ object_id: 'obj-2' });
    expect(unlinkAcquisitionObjectMock).toHaveBeenCalledWith('org-1', 'acq-1', 'obj-2');
  });

  it('search.searchFn delegates to getCollectionObjects', async () => {
    getAcquisitionObjectsMock.mockResolvedValue({ objects: [] });
    getCollectionObjectsMock.mockResolvedValue({ items: [{ object_id: 'a' }] });
    renderObjectLinker();
    const search = recordLinkerCalls.at(-1)!.search as { searchFn: (t: string) => Promise<unknown> };
    const result = await search.searchFn('hello');
    expect(getCollectionObjectsMock).toHaveBeenCalledWith('org-1', { search: 'hello', limit: 20 });
    expect(result).toEqual([{ object_id: 'a' }]);
  });
});

describe('ObjectAcquisitionSelector', () => {
  beforeEach(() => {
    recordLinkerSingleCalls.length = 0;
    setObjectAcquisitionMock.mockReset();
    getAcquisitionsMock.mockReset();
  });

  it('renders RecordLinkerSingle with Acquisition singularNoun', () => {
    renderAcquisitionSelector();
    expect(screen.getByTestId('singular')).toHaveTextContent('Acquisition');
  });

  it('renders the linked acquisition summary when provided', () => {
    renderAcquisitionSelector({
      currentAcquisition: {
        acquisition_id: 'a-1',
        acquisition_number: 'A-2024-1',
        acquisition_method: 'gift',
        status: 'pending',
        source_name: 'Donor X',
      },
    });
    expect(screen.getByText('A-2024-1')).toBeInTheDocument();
  });

  it('does not render a summary when currentAcquisition is null', () => {
    renderAcquisitionSelector({ currentAcquisition: null });
    expect(screen.queryByTestId('linked-item')).toBeNull();
  });

  it('onLink calls setObjectAcquisition and onAcquisitionChange', async () => {
    setObjectAcquisitionMock.mockResolvedValue({ acquisition: { acquisition_id: 'a-9' } });
    const onAcquisitionChange = vi.fn();
    renderAcquisitionSelector({ onAcquisitionChange });
    const onLink = recordLinkerSingleCalls.at(-1)!.onLink as (a: { acquisition_id: string }) => Promise<void>;
    await onLink({ acquisition_id: 'a-9' });
    expect(setObjectAcquisitionMock).toHaveBeenCalledWith('org-1', 'obj-1', 'a-9');
    expect(onAcquisitionChange).toHaveBeenCalledWith({ acquisition_id: 'a-9' });
  });

  it('onUnlink calls setObjectAcquisition with null', async () => {
    setObjectAcquisitionMock.mockResolvedValue({ acquisition: null });
    const onAcquisitionChange = vi.fn();
    renderAcquisitionSelector({ onAcquisitionChange });
    const onUnlink = recordLinkerSingleCalls.at(-1)!.onUnlink as () => Promise<void>;
    await onUnlink();
    expect(setObjectAcquisitionMock).toHaveBeenCalledWith('org-1', 'obj-1', null);
    expect(onAcquisitionChange).toHaveBeenCalledWith(null);
  });

  it('search.searchFn delegates to getAcquisitions', async () => {
    getAcquisitionsMock.mockResolvedValue({ items: [{ acquisition_id: 'a' }] });
    renderAcquisitionSelector();
    const search = recordLinkerSingleCalls.at(-1)!.search as { searchFn: (t: string) => Promise<unknown> };
    const result = await search.searchFn('foo');
    expect(getAcquisitionsMock).toHaveBeenCalledWith('org-1', { q: 'foo', limit: 20 });
    expect(result).toEqual([{ acquisition_id: 'a' }]);
  });
});
