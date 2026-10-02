import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConstituentSelectorSlideOver } from '../../../components/collections/ConstituentSelectorSlideOver';

const { getConstituentsMock, createConstituentMock } = vi.hoisted(() => ({
  getConstituentsMock: vi.fn(),
  createConstituentMock: vi.fn(),
}));

vi.mock('../../../lib/api/constituents', () => ({
  getConstituents: getConstituentsMock,
  createConstituent: createConstituentMock,
}));

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function renderSelector(props: Partial<Parameters<typeof ConstituentSelectorSlideOver>[0]> = {}) {
  return render(
    <QueryClientProvider client={createClient()}>
      <ConstituentSelectorSlideOver
        isOpen={true}
        organizationId="org-1"
        onClose={() => {}}
        onSelect={() => {}}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe('ConstituentSelectorSlideOver', () => {
  beforeEach(() => {
    getConstituentsMock.mockReset();
    createConstituentMock.mockReset();
  });

  it('does not render when isOpen is false', () => {
    const { container } = renderSelector({ isOpen: false });
    expect(container.querySelector('input[type="text"]')).toBeNull();
  });

  it('renders the search input when open', () => {
    renderSelector();
    expect(screen.getByPlaceholderText('Search by name...')).toBeInTheDocument();
  });

  it('shows the default title and subtitle', () => {
    renderSelector();
    expect(screen.getByText('Select Person or Organization')).toBeInTheDocument();
    expect(screen.getByText('Search for a person or organization')).toBeInTheDocument();
  });

  it('uses custom title when provided', () => {
    renderSelector({ title: 'Pick a Lender' });
    expect(screen.getByText('Pick a Lender')).toBeInTheDocument();
  });

  it('shows hint to type at least 2 characters', () => {
    renderSelector();
    expect(screen.getByText(/Type at least 2 characters/)).toBeInTheDocument();
  });

  it('triggers a search after typing 2+ chars', async () => {
    getConstituentsMock.mockResolvedValue({ items: [] });
    renderSelector();
    fireEvent.change(screen.getByPlaceholderText('Search by name...'), {
      target: { value: 'mo' },
    });
    await waitFor(() => expect(getConstituentsMock).toHaveBeenCalled());
    expect(getConstituentsMock).toHaveBeenCalledWith('org-1', { q: 'mo', limit: 20 });
  });

  it('shows results when search returns constituents', async () => {
    getConstituentsMock.mockResolvedValue({
      items: [
        { constituent_id: 'c-1', name: 'Monet', constituent_type: 'person' },
      ],
    });
    renderSelector();
    fireEvent.change(screen.getByPlaceholderText('Search by name...'), {
      target: { value: 'mo' },
    });
    await waitFor(() => screen.getByText('Monet'));
    expect(screen.getByText('Monet')).toBeInTheDocument();
  });

  it('shows no-results state with create option', async () => {
    getConstituentsMock.mockResolvedValue({ items: [] });
    renderSelector();
    fireEvent.change(screen.getByPlaceholderText('Search by name...'), {
      target: { value: 'xyz' },
    });
    await waitFor(() => screen.getByText(/No people or organizations found for "xyz"/));
    expect(screen.getByRole('button', { name: /Create New Person or Organization/ })).toBeInTheDocument();
  });

  it('switches to create mode and pre-fills name from search', async () => {
    getConstituentsMock.mockResolvedValue({ items: [] });
    renderSelector();
    fireEvent.change(screen.getByPlaceholderText('Search by name...'), {
      target: { value: 'NewPerson' },
    });
    await waitFor(() => screen.getByRole('button', { name: /Create New Person or Organization/ }));
    fireEvent.click(screen.getByRole('button', { name: /Create New Person or Organization/ }));
    await waitFor(() => screen.getByText('Create a new person or organization'));
    const nameInput = screen.getByPlaceholderText(/Enter person name/) as HTMLInputElement;
    expect(nameInput.value).toBe('NewPerson');
  });

  it('selecting a constituent enables the Select button', async () => {
    getConstituentsMock.mockResolvedValue({
      items: [{ constituent_id: 'c-1', name: 'Monet', constituent_type: 'person' }],
    });
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderSelector({ onSelect, onClose });
    fireEvent.change(screen.getByPlaceholderText('Search by name...'), {
      target: { value: 'mo' },
    });
    await waitFor(() => screen.getByText('Monet'));
    fireEvent.click(screen.getByText('Monet'));
    fireEvent.click(screen.getByRole('button', { name: /^Select$/ }));
    expect(onSelect).toHaveBeenCalledWith('c-1');
    expect(onClose).toHaveBeenCalled();
  });

  it('Cancel button calls onClose', () => {
    const onClose = vi.fn();
    renderSelector({ onClose });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('filters out excluded ids', async () => {
    getConstituentsMock.mockResolvedValue({
      items: [
        { constituent_id: 'c-1', name: 'Keep Me', constituent_type: 'person' },
        { constituent_id: 'c-2', name: 'Skip Me', constituent_type: 'person' },
      ],
    });
    renderSelector({ excludeIds: new Set(['c-2']) });
    fireEvent.change(screen.getByPlaceholderText('Search by name...'), {
      target: { value: 'me' },
    });
    await waitFor(() => screen.getByText('Keep Me'));
    expect(screen.queryByText('Skip Me')).toBeNull();
  });

  it('filters by constituent type when provided', async () => {
    getConstituentsMock.mockResolvedValue({
      items: [
        { constituent_id: 'c-1', name: 'Person A', constituent_type: 'person' },
        { constituent_id: 'c-2', name: 'Org B', constituent_type: 'organization' },
      ],
    });
    renderSelector({ constituentTypes: ['organization'] });
    fireEvent.change(screen.getByPlaceholderText('Search by name...'), {
      target: { value: 'aa' },
    });
    await waitFor(() => screen.getByText('Org B'));
    expect(screen.queryByText('Person A')).toBeNull();
  });
});
