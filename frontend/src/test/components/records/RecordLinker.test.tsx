import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RecordLinker } from '../../../components/records/RecordLinker';

// Mock the slide-over so we don't need to render the full search UI
vi.mock('../../../components/records/RecordLinkerSlideOver', () => ({
  RecordLinkerSlideOver: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="record-linker-slideover" /> : null,
}));

interface Item {
  id: string;
  name: string;
  group?: string;
}

function renderLinker(props: Partial<Parameters<typeof RecordLinker>[0]> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <RecordLinker
        organizationId="org-1"
        title="Linked Items"
        addLabel="Add Item"
        linkedItems={[]}
        getItemId={(it: Item) => it.id}
        renderItem={(it: Item) => <span data-testid={`item-${it.id}`}>{it.name}</span>}
        onLink={vi.fn()}
        onUnlink={vi.fn()}
        search={{ placeholder: 'Search', performSearch: vi.fn().mockResolvedValue([]) } as never}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe('RecordLinker', () => {
  it('shows the title', () => {
    renderLinker();
    expect(screen.getByText('Linked Items')).toBeInTheDocument();
  });

  it('shows empty message when no items', () => {
    renderLinker({ emptyMessage: 'Nothing here yet.' });
    expect(screen.getByText('Nothing here yet.')).toBeInTheDocument();
  });

  it('uses the default empty message', () => {
    renderLinker();
    expect(screen.getByText('No items linked.')).toBeInTheDocument();
  });

  it('hides Add button when not editing', () => {
    renderLinker({ isEditing: false });
    expect(screen.queryByText('Add Item')).not.toBeInTheDocument();
  });

  it('shows Add button when editing', () => {
    renderLinker({ isEditing: true });
    // Both the header button and empty-state button are labeled "Add Item"
    const addButtons = screen.getAllByText('Add Item');
    expect(addButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('opens slide-over when Add button clicked', () => {
    renderLinker({ isEditing: true });
    const addButtons = screen.getAllByText('Add Item');
    fireEvent.click(addButtons[0]);
    expect(screen.getByTestId('record-linker-slideover')).toBeInTheDocument();
  });

  it('renders items with renderItem callback', () => {
    renderLinker({
      linkedItems: [{ id: '1', name: 'Item A' }, { id: '2', name: 'Item B' }] as never,
    });
    expect(screen.getByTestId('item-1')).toBeInTheDocument();
    expect(screen.getByTestId('item-2')).toBeInTheDocument();
  });

  it('renders a link when getItemHref is provided', () => {
    const { container } = renderLinker({
      linkedItems: [{ id: '1', name: 'A' }] as never,
      getItemHref: () => '/x/1',
    });
    expect(container.querySelector('a[href="/x/1"]')).toBeInTheDocument();
  });

  it('renders unlink button when editing', () => {
    renderLinker({
      isEditing: true,
      linkedItems: [{ id: '1', name: 'A' }] as never,
    });
    expect(screen.getByTitle('Unlink')).toBeInTheDocument();
  });

  it('calls onUnlink when unlink clicked', async () => {
    const onUnlink = vi.fn().mockResolvedValue(undefined);
    renderLinker({
      isEditing: true,
      linkedItems: [{ id: '1', name: 'A' }] as never,
      onUnlink,
    });
    fireEvent.click(screen.getByTitle('Unlink'));
    expect(onUnlink).toHaveBeenCalledWith({ id: '1', name: 'A' });
  });

  it('groups items when getItemGroup provided', () => {
    renderLinker({
      linkedItems: [
        { id: '1', name: 'A', group: 'g1' },
        { id: '2', name: 'B', group: 'g2' },
      ] as never,
      getItemGroup: (it: Item) => it.group ?? '',
      groupLabels: { g1: 'Group One', g2: 'Group Two' },
    });
    expect(screen.getByText('Group One')).toBeInTheDocument();
    expect(screen.getByText('Group Two')).toBeInTheDocument();
  });

  it('respects groupOrder when given', () => {
    const { container } = renderLinker({
      linkedItems: [
        { id: '1', name: 'A', group: 'b' },
        { id: '2', name: 'B', group: 'a' },
      ] as never,
      getItemGroup: (it: Item) => it.group ?? '',
      groupLabels: { a: 'Alpha', b: 'Beta' },
      groupOrder: ['a', 'b'],
    });
    const headings = container.querySelectorAll('h5');
    expect(headings[0]).toHaveTextContent('Alpha');
    expect(headings[1]).toHaveTextContent('Beta');
  });

  it('calls onCountChange when items count changes', () => {
    const onCountChange = vi.fn();
    renderLinker({
      linkedItems: [{ id: '1', name: 'A' }, { id: '2', name: 'B' }] as never,
      onCountChange,
    });
    expect(onCountChange).toHaveBeenCalledWith(2);
  });
});
