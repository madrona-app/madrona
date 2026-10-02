import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ObjectRelationshipsManager } from '../../../components/collections/ObjectRelationshipsManager';

const {
  getObjectRelationshipsMock,
  createObjectRelationshipMock,
  updateObjectRelationshipMock,
  deleteObjectRelationshipMock,
  getCollectionObjectsMock,
  searchWikidataArtworksMock,
} = vi.hoisted(() => ({
  getObjectRelationshipsMock: vi.fn(),
  createObjectRelationshipMock: vi.fn(),
  updateObjectRelationshipMock: vi.fn(),
  deleteObjectRelationshipMock: vi.fn(),
  getCollectionObjectsMock: vi.fn(),
  searchWikidataArtworksMock: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  getObjectRelationships: getObjectRelationshipsMock,
  createObjectRelationship: createObjectRelationshipMock,
  updateObjectRelationship: updateObjectRelationshipMock,
  deleteObjectRelationship: deleteObjectRelationshipMock,
  getCollectionObjects: getCollectionObjectsMock,
  searchWikidataArtworks: searchWikidataArtworksMock,
}));

vi.mock('../../../components/ModalPortal', () => ({
  ModalPortal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function renderManager(props: Partial<Parameters<typeof ObjectRelationshipsManager>[0]> = {}) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={createClient()}>
        <ObjectRelationshipsManager organizationId="org-1" objectId="obj-1" {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('ObjectRelationshipsManager', () => {
  beforeEach(() => {
    getObjectRelationshipsMock.mockReset();
    createObjectRelationshipMock.mockReset();
    deleteObjectRelationshipMock.mockReset();
    getCollectionObjectsMock.mockReset();
    searchWikidataArtworksMock.mockReset();
  });

  it('renders a loading state when fetching', () => {
    getObjectRelationshipsMock.mockImplementation(() => new Promise(() => {}));
    renderManager();
    expect(screen.getByText('Related Works')).toBeInTheDocument();
  });

  it('renders an empty state when there are no relationships', async () => {
    getObjectRelationshipsMock.mockResolvedValue({ outgoing: [], incoming: [] });
    renderManager();
    await waitFor(() => screen.getByText(/No related works documented yet/));
    expect(screen.getByText(/No related works documented yet/)).toBeInTheDocument();
  });

  it('shows "Add first relationship" link when not readOnly and empty', async () => {
    getObjectRelationshipsMock.mockResolvedValue({ outgoing: [], incoming: [] });
    renderManager({ readOnly: false });
    await waitFor(() => screen.getByText('Add first relationship'));
    expect(screen.getByText('Add first relationship')).toBeInTheDocument();
  });

  it('hides Add Relationship in readOnly mode (header button not present)', async () => {
    getObjectRelationshipsMock.mockResolvedValue({ outgoing: [], incoming: [] });
    renderManager({ readOnly: true });
    await waitFor(() => screen.getByText(/No related works/));
    expect(screen.queryByText('Add Relationship')).toBeNull();
  });

  it('renders outgoing relationships with their type label', async () => {
    getObjectRelationshipsMock.mockResolvedValue({
      outgoing: [
        {
          relationship_id: 'r-1',
          relationship_type: 'study_for',
          related_object_id: 'obj-2',
          related_object_summary: { title: 'Other Object', object_number: 'O-2' },
        },
      ],
      incoming: [],
    });
    renderManager();
    await waitFor(() => screen.getByText('Related To'));
    expect(screen.getByText('Study For')).toBeInTheDocument();
    expect(screen.getByText('Other Object')).toBeInTheDocument();
  });

  it('renders incoming relationships with their type label', async () => {
    getObjectRelationshipsMock.mockResolvedValue({
      outgoing: [],
      incoming: [
        {
          relationship_id: 'r-2',
          relationship_type: 'derived_from',
          source_object_id: 'obj-3',
          related_object_summary: { title: 'Source Object' },
        },
      ],
    });
    renderManager();
    await waitFor(() => screen.getByText('Related From'));
    expect(screen.getByText('Derived From')).toBeInTheDocument();
  });

  it('opens the add slideover from the header button', async () => {
    getObjectRelationshipsMock.mockResolvedValue({ outgoing: [], incoming: [] });
    renderManager({ readOnly: false });
    await waitFor(() => screen.getByText('Add Relationship'));
    fireEvent.click(screen.getByText('Add Relationship'));
    // Slideover title and button cause the count to grow
    expect((await screen.findAllByText('Add Relationship')).length).toBeGreaterThan(1);
  });

  it('shows external work link with wikidata href', async () => {
    getObjectRelationshipsMock.mockResolvedValue({
      outgoing: [
        {
          relationship_id: 'r-1',
          relationship_type: 'related_to',
          external_work_title: 'Mona Lisa',
          external_work_identifier: 'Q12418',
        },
      ],
      incoming: [],
    });
    renderManager();
    await waitFor(() => screen.getByText('Mona Lisa'));
    const link = screen.getByText('Mona Lisa').closest('a') as HTMLAnchorElement;
    expect(link.href).toContain('Q12418');
  });

  it('embedded mode renders without the card wrapper', async () => {
    getObjectRelationshipsMock.mockResolvedValue({ outgoing: [], incoming: [] });
    const { container } = renderManager({ embedded: true });
    await waitFor(() => screen.getByText(/No related works/));
    expect(container.querySelector('.card')).toBeNull();
  });

  it('not embedded — wraps in card', async () => {
    getObjectRelationshipsMock.mockResolvedValue({ outgoing: [], incoming: [] });
    const { container } = renderManager({ embedded: false });
    await waitFor(() => screen.getByText(/No related works/));
    expect(container.querySelector('.card')).not.toBeNull();
  });

  it('error state shows fallback', async () => {
    getObjectRelationshipsMock.mockRejectedValue(new Error('boom'));
    renderManager();
    await waitFor(() => screen.getByText('Failed to load relationships'));
    expect(screen.getByText('Failed to load relationships')).toBeInTheDocument();
  });

  it('reports count change to parent', async () => {
    getObjectRelationshipsMock.mockResolvedValue({
      outgoing: [{ relationship_id: 'r-1', relationship_type: 'related_to', external_work_title: 'X' }],
      incoming: [{ relationship_id: 'r-2', relationship_type: 'related_to', external_work_title: 'Y' }],
    });
    const onCountChange = vi.fn();
    renderManager({ onCountChange });
    await waitFor(() => expect(onCountChange).toHaveBeenCalledWith(2));
  });
});
