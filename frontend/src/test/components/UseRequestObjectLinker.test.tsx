import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UseRequestObjectLinker } from '../../components/collections/UseRequestObjectLinker';

const { getUseRequestObjectsMock, addUseRequestObjectMock, removeUseRequestObjectMock, getCollectionObjectsMock } =
  vi.hoisted(() => ({
    getUseRequestObjectsMock: vi.fn(),
    addUseRequestObjectMock: vi.fn(),
    removeUseRequestObjectMock: vi.fn(),
    getCollectionObjectsMock: vi.fn(),
  }));

vi.mock('../../lib/api', () => ({
  getUseRequestObjects: getUseRequestObjectsMock,
  addUseRequestObject: addUseRequestObjectMock,
  removeUseRequestObject: removeUseRequestObjectMock,
  getCollectionObjects: getCollectionObjectsMock,
}));

// Spy that captures the props RecordLinker receives so we can assert on them.
const recordLinkerCalls: Array<Record<string, unknown>> = [];
vi.mock('../../components/records', () => ({
  RecordLinker: (props: Record<string, unknown>) => {
    recordLinkerCalls.push(props);
    const items = (props.linkedItems as Array<{ object_id: string }>) || [];
    return (
      <div data-testid="record-linker">
        <h3>{props.title as string}</h3>
        {items.length === 0 ? (
          <p>{props.emptyMessage as string}</p>
        ) : (
          <ul>
            {items.map((it) => {
              const renderItem = props.renderItem as (i: typeof it) => React.ReactNode;
              return <li key={it.object_id}>{renderItem(it)}</li>;
            })}
          </ul>
        )}
      </div>
    );
  },
}));

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderLinker(props: Partial<Parameters<typeof UseRequestObjectLinker>[0]> = {}) {
  return render(
    <QueryClientProvider client={createClient()}>
      <UseRequestObjectLinker
        organizationId="org-1"
        requestId="req-1"
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe('UseRequestObjectLinker', () => {
  beforeEach(() => {
    recordLinkerCalls.length = 0;
    getUseRequestObjectsMock.mockReset();
    addUseRequestObjectMock.mockReset();
    removeUseRequestObjectMock.mockReset();
    getCollectionObjectsMock.mockReset();
  });

  it('queries the linked objects with the right org/request', async () => {
    getUseRequestObjectsMock.mockResolvedValue({ objects: [] });
    renderLinker();
    await waitFor(() => expect(getUseRequestObjectsMock).toHaveBeenCalled());
    expect(getUseRequestObjectsMock).toHaveBeenCalledWith('org-1', 'req-1');
  });

  it('renders the title and empty message via RecordLinker', async () => {
    getUseRequestObjectsMock.mockResolvedValue({ objects: [] });
    renderLinker();
    await waitFor(() =>
      expect(screen.getByText('No objects linked to this request.')).toBeInTheDocument(),
    );
    expect(screen.getByText('Requested Objects')).toBeInTheDocument();
  });

  it('passes linked items to RecordLinker and renders each via renderItem', async () => {
    getUseRequestObjectsMock.mockResolvedValue({
      objects: [
        {
          request_object_id: 'ro-1',
          object_id: 'obj-1',
          object: { object_number: 'OBJ.001', title: 'Vase', object_name: null },
        },
      ],
    });
    renderLinker();
    await waitFor(() => expect(screen.getByText('OBJ.001')).toBeInTheDocument());
    expect(screen.getByText('Vase')).toBeInTheDocument();
  });

  it('forwards isEditing to RecordLinker', async () => {
    getUseRequestObjectsMock.mockResolvedValue({ objects: [] });
    renderLinker({ isEditing: true });
    await waitFor(() => expect(recordLinkerCalls.length).toBeGreaterThan(0));
    expect(recordLinkerCalls.at(-1)?.isEditing).toBe(true);
  });

  it('calls addUseRequestObject when onLink is invoked', async () => {
    getUseRequestObjectsMock.mockResolvedValue({ objects: [] });
    addUseRequestObjectMock.mockResolvedValue({});
    renderLinker();
    await waitFor(() => expect(recordLinkerCalls.length).toBeGreaterThan(0));
    const onLink = recordLinkerCalls.at(-1)!.onLink as (o: { object_id: string }) => Promise<void>;
    await onLink({ object_id: 'obj-9' });
    expect(addUseRequestObjectMock).toHaveBeenCalledWith('org-1', 'req-1', { object_id: 'obj-9' });
  });

  it('calls removeUseRequestObject when onUnlink is invoked', async () => {
    getUseRequestObjectsMock.mockResolvedValue({ objects: [] });
    removeUseRequestObjectMock.mockResolvedValue(undefined);
    renderLinker();
    await waitFor(() => expect(recordLinkerCalls.length).toBeGreaterThan(0));
    const onUnlink = recordLinkerCalls.at(-1)!.onUnlink as (
      l: { object_id: string },
    ) => Promise<void>;
    await onUnlink({ object_id: 'obj-7' });
    expect(removeUseRequestObjectMock).toHaveBeenCalledWith('org-1', 'req-1', 'obj-7');
  });

  it('builds object detail href via getItemHref', async () => {
    getUseRequestObjectsMock.mockResolvedValue({ objects: [] });
    renderLinker();
    await waitFor(() => expect(recordLinkerCalls.length).toBeGreaterThan(0));
    const getItemHref = recordLinkerCalls.at(-1)!.getItemHref as (
      l: { object_id: string },
    ) => string;
    expect(getItemHref({ object_id: 'obj-x' })).toBe(
      '/organizations/org-1/collections/objects/obj-x',
    );
  });

  it('search.searchFn delegates to getCollectionObjects', async () => {
    getUseRequestObjectsMock.mockResolvedValue({ objects: [] });
    getCollectionObjectsMock.mockResolvedValue({ items: [{ object_id: 'a' }] });
    renderLinker();
    await waitFor(() => expect(recordLinkerCalls.length).toBeGreaterThan(0));
    const search = recordLinkerCalls.at(-1)!.search as {
      searchFn: (term: string) => Promise<unknown>;
    };
    const result = await search.searchFn('vase');
    expect(getCollectionObjectsMock).toHaveBeenCalledWith('org-1', { search: 'vase', limit: 20 });
    expect(result).toEqual([{ object_id: 'a' }]);
  });
});
