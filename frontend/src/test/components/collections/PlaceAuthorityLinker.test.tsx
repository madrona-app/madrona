import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { PlaceAuthorityLinker } from '../../../components/collections/PlaceAuthorityLinker';

const {
  getObjectPlaceAuthoritiesMock,
  linkObjectPlaceAuthorityMock,
  unlinkObjectPlaceAuthorityMock,
  getPlaceAuthoritiesMock,
  createPlaceAuthorityMock,
  searchVocabularyMock,
} = vi.hoisted(() => ({
  getObjectPlaceAuthoritiesMock: vi.fn(),
  linkObjectPlaceAuthorityMock: vi.fn(),
  unlinkObjectPlaceAuthorityMock: vi.fn(),
  getPlaceAuthoritiesMock: vi.fn(),
  createPlaceAuthorityMock: vi.fn(),
  searchVocabularyMock: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  getObjectPlaceAuthorities: getObjectPlaceAuthoritiesMock,
  linkObjectPlaceAuthority: linkObjectPlaceAuthorityMock,
  unlinkObjectPlaceAuthority: unlinkObjectPlaceAuthorityMock,
  getPlaceAuthorities: getPlaceAuthoritiesMock,
  createPlaceAuthority: createPlaceAuthorityMock,
  searchVocabulary: searchVocabularyMock,
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

function renderLinker(props: Partial<Parameters<typeof PlaceAuthorityLinker>[0]> = {}) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={createClient()}>
        <PlaceAuthorityLinker organizationId="org-1" objectId="obj-1" {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('PlaceAuthorityLinker', () => {
  beforeEach(() => {
    recordLinkerCalls.length = 0;
    getObjectPlaceAuthoritiesMock.mockReset();
    linkObjectPlaceAuthorityMock.mockReset();
    unlinkObjectPlaceAuthorityMock.mockReset();
    createPlaceAuthorityMock.mockReset();
    getPlaceAuthoritiesMock.mockReset();
    searchVocabularyMock.mockReset();
  });

  it('renders RecordLinker with default Places title', () => {
    getObjectPlaceAuthoritiesMock.mockResolvedValue([]);
    renderLinker();
    expect(screen.getByTestId('title')).toHaveTextContent('Places');
  });

  it('uses titleOverride when provided', () => {
    getObjectPlaceAuthoritiesMock.mockResolvedValue([]);
    renderLinker({ title: 'Geography' });
    expect(screen.getByTestId('title')).toHaveTextContent('Geography');
  });

  it('uses addLabelOverride when provided', () => {
    getObjectPlaceAuthoritiesMock.mockResolvedValue([]);
    renderLinker({ addLabel: 'Add Place Mention' });
    expect(screen.getByTestId('add-label')).toHaveTextContent('Add Place Mention');
  });

  it('renders inside card by default', () => {
    getObjectPlaceAuthoritiesMock.mockResolvedValue([]);
    const { container } = renderLinker();
    expect(container.querySelector('.card')).not.toBeNull();
  });

  it('does not wrap in card when embedded', () => {
    getObjectPlaceAuthoritiesMock.mockResolvedValue([]);
    const { container } = renderLinker({ embedded: true });
    expect(container.querySelector('.card')).toBeNull();
  });

  it('extracts link_id as item id', () => {
    getObjectPlaceAuthoritiesMock.mockResolvedValue([]);
    renderLinker();
    const getItemId = recordLinkerCalls.at(-1)!.getItemId as (l: { link_id: string }) => string;
    expect(getItemId({ link_id: 'l-1' } as never)).toBe('l-1');
  });

  it('extracts place_authority_id as linked entity id', () => {
    getObjectPlaceAuthoritiesMock.mockResolvedValue([]);
    renderLinker();
    const getLinkedEntityId = recordLinkerCalls.at(-1)!.getLinkedEntityId as (l: { place_authority_id: string }) => string;
    expect(getLinkedEntityId({ place_authority_id: 'p-1' } as never)).toBe('p-1');
  });

  it('groups linked items by role', () => {
    getObjectPlaceAuthoritiesMock.mockResolvedValue([]);
    renderLinker();
    const getItemGroup = recordLinkerCalls.at(-1)!.getItemGroup as (l: { role: string }) => string;
    expect(getItemGroup({ role: 'creation_place' } as never)).toBe('creation_place');
  });

  it('onLink imports TGN places before linking', async () => {
    getObjectPlaceAuthoritiesMock.mockResolvedValue([]);
    createPlaceAuthorityMock.mockResolvedValue({ place_authority_id: 'p-new' });
    linkObjectPlaceAuthorityMock.mockResolvedValue({});
    renderLinker();
    const onLink = recordLinkerCalls.at(-1)!.onLink as (
      r: {
        source: string;
        tgn_id?: string;
        place_authority_id?: string;
        place_type?: string;
        label: string;
      },
      m: { role?: string; date_display?: string; notes?: string },
    ) => Promise<void>;
    await onLink(
      { source: 'tgn', tgn_id: 'tgn-1', place_type: 'cities', label: 'Paris' },
      { role: 'creation_place' },
    );
    expect(createPlaceAuthorityMock).toHaveBeenCalledWith('org-1', {
      preferred_name: 'Paris',
      place_type: 'city',
      tgn_id: 'tgn-1',
    });
    expect(linkObjectPlaceAuthorityMock).toHaveBeenCalledWith('org-1', 'obj-1', {
      place_authority_id: 'p-new',
      role: 'creation_place',
      date_display: undefined,
      notes: undefined,
    });
  });

  it('onLink uses local place authority directly', async () => {
    getObjectPlaceAuthoritiesMock.mockResolvedValue([]);
    linkObjectPlaceAuthorityMock.mockResolvedValue({});
    renderLinker();
    const onLink = recordLinkerCalls.at(-1)!.onLink as (
      r: { source: string; place_authority_id: string; label: string },
      m: { role?: string },
    ) => Promise<void>;
    await onLink(
      { source: 'local', place_authority_id: 'p-1', label: 'Paris' },
      { role: 'creation_place' },
    );
    expect(createPlaceAuthorityMock).not.toHaveBeenCalled();
    expect(linkObjectPlaceAuthorityMock).toHaveBeenCalledWith('org-1', 'obj-1', {
      place_authority_id: 'p-1',
      role: 'creation_place',
      date_display: undefined,
      notes: undefined,
    });
  });

  it('onUnlink calls unlinkObjectPlaceAuthority', async () => {
    getObjectPlaceAuthoritiesMock.mockResolvedValue([]);
    unlinkObjectPlaceAuthorityMock.mockResolvedValue({});
    renderLinker();
    const onUnlink = recordLinkerCalls.at(-1)!.onUnlink as (l: { link_id: string }) => Promise<void>;
    await onUnlink({ link_id: 'l-7' });
    expect(unlinkObjectPlaceAuthorityMock).toHaveBeenCalledWith('org-1', 'obj-1', 'l-7');
  });
});
