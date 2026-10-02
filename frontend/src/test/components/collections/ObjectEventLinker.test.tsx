import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ObjectEventLinker } from '../../../components/collections/ObjectEventLinker';

const {
  getObjectEventsMock,
  getEventsMock,
  createEventMock,
  addEventObjectMock,
  removeEventObjectMock,
  useLookupValuesMock,
} = vi.hoisted(() => ({
  getObjectEventsMock: vi.fn(),
  getEventsMock: vi.fn(),
  createEventMock: vi.fn(),
  addEventObjectMock: vi.fn(),
  removeEventObjectMock: vi.fn(),
  useLookupValuesMock: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  getObjectEvents: getObjectEventsMock,
  getEvents: getEventsMock,
  createEvent: createEventMock,
  addEventObject: addEventObjectMock,
  removeEventObject: removeEventObjectMock,
}));

vi.mock('../../../hooks/useLookupValues', () => ({
  useLookupValues: useLookupValuesMock,
}));

const recordLinkerCalls: Array<Record<string, unknown>> = [];
vi.mock('../../../components/records', () => ({
  RecordLinker: (props: Record<string, unknown>) => {
    recordLinkerCalls.push(props);
    return (
      <div data-testid="record-linker">
        <span data-testid="title">{props.title as string}</span>
      </div>
    );
  },
}));

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function renderLinker(props: Partial<Parameters<typeof ObjectEventLinker>[0]> = {}) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={createClient()}>
        <ObjectEventLinker organizationId="org-1" objectId="obj-1" {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('ObjectEventLinker', () => {
  beforeEach(() => {
    recordLinkerCalls.length = 0;
    getObjectEventsMock.mockReset();
    getEventsMock.mockReset();
    createEventMock.mockReset();
    addEventObjectMock.mockReset();
    removeEventObjectMock.mockReset();
    useLookupValuesMock.mockReset();
    useLookupValuesMock.mockReturnValue({
      getLookup: () => [],
    });
  });

  it('renders RecordLinker with Linked Events title', () => {
    getObjectEventsMock.mockResolvedValue({ events: [] });
    renderLinker();
    expect(screen.getByTestId('title')).toHaveTextContent('Linked Events');
  });

  it('extracts event_id as item id', () => {
    getObjectEventsMock.mockResolvedValue({ events: [] });
    renderLinker();
    const getItemId = recordLinkerCalls.at(-1)!.getItemId as (e: { event_id: string }) => string;
    expect(getItemId({ event_id: 'e-1' } as never)).toBe('e-1');
  });

  it('forwards onCountChange', () => {
    const onCountChange = vi.fn();
    getObjectEventsMock.mockResolvedValue({ events: [] });
    renderLinker({ onCountChange });
    expect(recordLinkerCalls.at(-1)?.onCountChange).toBe(onCountChange);
  });

  it('forwards isEditing', () => {
    getObjectEventsMock.mockResolvedValue({ events: [] });
    renderLinker({ isEditing: true });
    expect(recordLinkerCalls.at(-1)?.isEditing).toBe(true);
  });

  it('default isEditing is false', () => {
    getObjectEventsMock.mockResolvedValue({ events: [] });
    renderLinker();
    expect(recordLinkerCalls.at(-1)?.isEditing).toBe(false);
  });

  it('calls useLookupValues with events context', () => {
    getObjectEventsMock.mockResolvedValue({ events: [] });
    renderLinker();
    expect(useLookupValuesMock).toHaveBeenCalledWith({ context: 'events' });
  });
});
