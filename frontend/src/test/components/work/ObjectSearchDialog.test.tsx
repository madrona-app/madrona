import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ObjectSearchDialog } from '../../../components/work/ObjectSearchDialog';

const { searchCollectionsMock, useOrganizationMock, useWorkMock, setActiveObjectMock } = vi.hoisted(() => ({
  searchCollectionsMock: vi.fn(),
  useOrganizationMock: vi.fn(),
  useWorkMock: vi.fn(),
  setActiveObjectMock: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  searchCollections: searchCollectionsMock,
}));

vi.mock('../../../contexts/useOrganization', () => ({
  useOrganization: useOrganizationMock,
}));

vi.mock('../../../contexts/WorkContext', () => ({
  useWork: useWorkMock,
}));

vi.mock('../../../hooks/useAccessibleModal', () => ({
  useAccessibleModal: ({ titlePrefix }: { titlePrefix: string }) => ({
    modalRef: { current: null },
    titleId: `${titlePrefix}-title`,
    descriptionId: `${titlePrefix}-desc`,
  }),
  getModalAriaProps: (id: string) => ({ role: 'dialog', 'aria-labelledby': id }),
}));

vi.mock('../../../components/ModalPortal', () => ({
  ModalPortal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function renderDialog(props: Partial<Parameters<typeof ObjectSearchDialog>[0]> = {}) {
  return render(
    <QueryClientProvider client={createClient()}>
      <ObjectSearchDialog isOpen={true} onClose={() => {}} {...props} />
    </QueryClientProvider>,
  );
}

describe('ObjectSearchDialog', () => {
  beforeEach(() => {
    searchCollectionsMock.mockReset();
    useOrganizationMock.mockReset();
    useWorkMock.mockReset();
    setActiveObjectMock.mockReset();
    useOrganizationMock.mockReturnValue({ activeOrganization: { organization_id: 'org-1' } });
    useWorkMock.mockReturnValue({ setActiveObject: setActiveObjectMock, recentItems: [] });
  });

  it('renders nothing when isOpen=false', () => {
    const { container } = renderDialog({ isOpen: false });
    expect(container.firstChild).toBeNull();
  });

  it('renders the default title when open', () => {
    renderDialog();
    expect(screen.getByText('Select Object')).toBeInTheDocument();
  });

  it('renders a custom title', () => {
    renderDialog({ title: 'Pick One' });
    expect(screen.getByText('Pick One')).toBeInTheDocument();
  });

  it('shows the empty state when no recent items and no search', () => {
    renderDialog();
    expect(screen.getByText('Start typing to search for objects')).toBeInTheDocument();
  });

  it('renders recent objects when present', () => {
    useWorkMock.mockReturnValue({
      setActiveObject: setActiveObjectMock,
      recentItems: [
        { id: 'o-1', type: 'object', label: 'O-1', sublabel: 'Old Painting' },
      ],
    });
    renderDialog();
    expect(screen.getByText('Recent Objects')).toBeInTheDocument();
    expect(screen.getByText('O-1')).toBeInTheDocument();
  });

  it('triggers a search after typing 2+ chars (debounced)', async () => {
    searchCollectionsMock.mockResolvedValue({ hits: [] });
    renderDialog();
    fireEvent.change(screen.getByPlaceholderText('Search by accession number or title...'), {
      target: { value: 'mo' },
    });
    await waitFor(() => expect(searchCollectionsMock).toHaveBeenCalled(), { timeout: 1000 });
  });

  it('shows "No objects found" when results are empty', async () => {
    searchCollectionsMock.mockResolvedValue({ hits: [] });
    renderDialog();
    fireEvent.change(screen.getByPlaceholderText('Search by accession number or title...'), {
      target: { value: 'xx' },
    });
    await waitFor(() => screen.getByText(/No objects found for "xx"/), { timeout: 2000 });
    expect(screen.getByText(/No objects found for "xx"/)).toBeInTheDocument();
  });

  it('renders search results when API returns hits', async () => {
    searchCollectionsMock.mockResolvedValue({
      hits: [{ object_id: 'o-1', object_number: 'O-1', title: 'Hit Object' }],
    });
    renderDialog();
    fireEvent.change(screen.getByPlaceholderText('Search by accession number or title...'), {
      target: { value: 'hi' },
    });
    await waitFor(() => screen.getByText('Hit Object'), { timeout: 2000 });
    expect(screen.getByText('Hit Object')).toBeInTheDocument();
  });

  it('clicking a result calls setActiveObject and onSelect and onClose', async () => {
    searchCollectionsMock.mockResolvedValue({
      hits: [{ object_id: 'o-1', object_number: 'O-1', title: 'Hit' }],
    });
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderDialog({ onSelect, onClose });
    fireEvent.change(screen.getByPlaceholderText('Search by accession number or title...'), {
      target: { value: 'hi' },
    });
    await waitFor(() => screen.getByText('Hit'), { timeout: 2000 });
    fireEvent.click(screen.getByText('Hit'));
    expect(setActiveObjectMock).toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ object_id: 'o-1' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('Cancel button calls onClose', () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('does not search when only 1 character is typed', async () => {
    searchCollectionsMock.mockResolvedValue({ hits: [] });
    renderDialog();
    fireEvent.change(screen.getByPlaceholderText('Search by accession number or title...'), {
      target: { value: 'a' },
    });
    // Wait briefly to confirm no call
    await new Promise((r) => setTimeout(r, 400));
    expect(searchCollectionsMock).not.toHaveBeenCalled();
  });
});
