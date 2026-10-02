import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ObjectSelector } from '../../../components/collections/ObjectSelector';

const { getCollectionObjectsMock, getCollectionObjectMock } = vi.hoisted(() => ({
  getCollectionObjectsMock: vi.fn(),
  getCollectionObjectMock: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  getCollectionObjects: getCollectionObjectsMock,
  getCollectionObject: getCollectionObjectMock,
}));

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function renderSelector(props: Partial<Parameters<typeof ObjectSelector>[0]> = {}) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={createClient()}>
        <ObjectSelector
          organizationId="org-1"
          objectId={null}
          onChange={() => {}}
          {...props}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('ObjectSelector', () => {
  beforeEach(() => {
    getCollectionObjectsMock.mockReset();
    getCollectionObjectMock.mockReset();
  });

  it('renders the default label', () => {
    renderSelector();
    expect(screen.getByText('Linked Object')).toBeInTheDocument();
  });

  it('renders a custom label', () => {
    renderSelector({ label: 'Subject Object' });
    expect(screen.getByText('Subject Object')).toBeInTheDocument();
  });

  it('shows "No object linked" in view mode when objectId is null', () => {
    renderSelector();
    expect(screen.getByText('No object linked')).toBeInTheDocument();
  });

  it('renders a "Select an object" button in edit mode when no objectId', () => {
    renderSelector({ isEditing: true });
    expect(screen.getByText('Select an object')).toBeInTheDocument();
  });

  it('renders a "Change object" button when an object is linked in edit mode', async () => {
    getCollectionObjectMock.mockResolvedValue({
      object_number: 'O-1',
      titles: [{ title: 'My Object' }],
    });
    renderSelector({ isEditing: true, objectId: 'obj-1' });
    await waitFor(() => screen.getByText('Change object'));
    expect(screen.getByText('Change object')).toBeInTheDocument();
  });

  it('shows the linked object number and title in view mode', async () => {
    getCollectionObjectMock.mockResolvedValue({
      object_number: 'O-9',
      titles: [{ title: 'Title' }],
    });
    renderSelector({ objectId: 'obj-9' });
    await waitFor(() => screen.getByText('O-9'));
    expect(screen.getByText('O-9')).toBeInTheDocument();
    expect(screen.getByText('Title')).toBeInTheDocument();
  });

  it('opens the search interface when "Select an object" is clicked', () => {
    renderSelector({ isEditing: true });
    fireEvent.click(screen.getByText('Select an object'));
    expect(screen.getByPlaceholderText('Search objects by number or title...')).toBeInTheDocument();
  });

  it('shows "Type at least 2 characters" hint initially', () => {
    renderSelector({ isEditing: true });
    fireEvent.click(screen.getByText('Select an object'));
    expect(screen.getByText(/Type at least 2 characters/)).toBeInTheDocument();
  });

  it('triggers a search after typing 2+ chars', async () => {
    getCollectionObjectsMock.mockResolvedValue({ items: [] });
    renderSelector({ isEditing: true });
    fireEvent.click(screen.getByText('Select an object'));
    fireEvent.change(screen.getByPlaceholderText('Search objects by number or title...'), {
      target: { value: 'mo' },
    });
    await waitFor(() => expect(getCollectionObjectsMock).toHaveBeenCalled());
    expect(getCollectionObjectsMock).toHaveBeenCalledWith('org-1', { search: 'mo', limit: 10 });
  });

  it('shows the search results and selecting calls onChange', async () => {
    getCollectionObjectsMock.mockResolvedValue({
      items: [{ object_id: 'o-77', object_number: 'O-77', title: 'Hit' }],
    });
    const onChange = vi.fn();
    renderSelector({ isEditing: true, onChange });
    fireEvent.click(screen.getByText('Select an object'));
    fireEvent.change(screen.getByPlaceholderText('Search objects by number or title...'), {
      target: { value: 'hi' },
    });
    await waitFor(() => screen.getByText('O-77'));
    fireEvent.click(screen.getByText('O-77'));
    expect(onChange).toHaveBeenCalledWith('o-77');
  });

  it('clear button calls onChange with null', async () => {
    getCollectionObjectMock.mockResolvedValue({ object_number: 'O-1' });
    const onChange = vi.fn();
    renderSelector({ isEditing: true, objectId: 'obj-1', onChange });
    await waitFor(() => screen.getByText('O-1'));
    fireEvent.click(screen.getByTitle('Remove object'));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('shows "No objects found" when search returns empty', async () => {
    getCollectionObjectsMock.mockResolvedValue({ items: [] });
    renderSelector({ isEditing: true });
    fireEvent.click(screen.getByText('Select an object'));
    fireEvent.change(screen.getByPlaceholderText('Search objects by number or title...'), {
      target: { value: 'xx' },
    });
    await waitFor(() => screen.getByText('No objects found.'));
    expect(screen.getByText('No objects found.')).toBeInTheDocument();
  });
});
