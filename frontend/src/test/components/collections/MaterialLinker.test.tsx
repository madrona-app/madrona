import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { MaterialLinker } from '../../../components/collections/MaterialLinker';

const {
  getObjectMaterialsMock,
  linkObjectMaterialMock,
  unlinkObjectMaterialMock,
  searchVocabularyMock,
  cacheVocabularyTermMock,
} = vi.hoisted(() => ({
  getObjectMaterialsMock: vi.fn(),
  linkObjectMaterialMock: vi.fn(),
  unlinkObjectMaterialMock: vi.fn(),
  searchVocabularyMock: vi.fn(),
  cacheVocabularyTermMock: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  getObjectMaterials: getObjectMaterialsMock,
  linkObjectMaterial: linkObjectMaterialMock,
  unlinkObjectMaterial: unlinkObjectMaterialMock,
  searchVocabulary: searchVocabularyMock,
  cacheVocabularyTerm: cacheVocabularyTermMock,
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

function renderLinker(props: Partial<Parameters<typeof MaterialLinker>[0]> = {}) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={createClient()}>
        <MaterialLinker organizationId="org-1" objectId="obj-1" {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('MaterialLinker', () => {
  beforeEach(() => {
    recordLinkerCalls.length = 0;
    getObjectMaterialsMock.mockReset();
    linkObjectMaterialMock.mockReset();
    unlinkObjectMaterialMock.mockReset();
    searchVocabularyMock.mockReset();
    cacheVocabularyTermMock.mockReset();
  });

  it('renders RecordLinker with Materials title', () => {
    getObjectMaterialsMock.mockResolvedValue([]);
    renderLinker();
    expect(screen.getByTestId('title')).toHaveTextContent('Materials');
  });

  it('extracts link_id as item id', () => {
    getObjectMaterialsMock.mockResolvedValue([]);
    renderLinker();
    const getItemId = recordLinkerCalls.at(-1)!.getItemId as (l: { link_id: string }) => string;
    expect(getItemId({ link_id: 'l-1' } as never)).toBe('l-1');
  });

  it('extracts vocabulary_term_id as linked entity id', () => {
    getObjectMaterialsMock.mockResolvedValue([]);
    renderLinker();
    const getLinkedEntityId = recordLinkerCalls.at(-1)!.getLinkedEntityId as (l: { vocabulary_term_id: string }) => string;
    expect(getLinkedEntityId({ vocabulary_term_id: 't-1' } as never)).toBe('t-1');
  });

  it('onLink links existing local terms directly', async () => {
    getObjectMaterialsMock.mockResolvedValue([]);
    linkObjectMaterialMock.mockResolvedValue({});
    renderLinker();
    const onLink = recordLinkerCalls.at(-1)!.onLink as (
      t: { term_id?: string; external_id?: string; preferred_term: string; vocabulary?: string },
      m: { part?: string },
    ) => Promise<void>;
    await onLink({ term_id: 't-1', preferred_term: 'Wood' }, { part: 'support' });
    expect(cacheVocabularyTermMock).not.toHaveBeenCalled();
    expect(linkObjectMaterialMock).toHaveBeenCalledWith('org-1', 'obj-1', {
      vocabulary_term_id: 't-1',
      part: 'support',
    });
  });

  it('onLink caches Getty AAT terms before linking', async () => {
    getObjectMaterialsMock.mockResolvedValue([]);
    cacheVocabularyTermMock.mockResolvedValue({ term_id: 'cached-1' });
    linkObjectMaterialMock.mockResolvedValue({});
    renderLinker();
    const onLink = recordLinkerCalls.at(-1)!.onLink as (
      t: {
        term_id?: string;
        external_id: string;
        external_uri?: string;
        preferred_term: string;
        vocabulary: string;
      },
      m: { part?: string },
    ) => Promise<void>;
    await onLink(
      {
        external_id: 'aat-555',
        preferred_term: 'Oil paint',
        vocabulary: 'aat',
      },
      { part: '' },
    );
    expect(cacheVocabularyTermMock).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ external_id: 'aat-555', vocabulary: 'aat' }),
    );
    expect(linkObjectMaterialMock).toHaveBeenCalledWith('org-1', 'obj-1', {
      vocabulary_term_id: 'cached-1',
      part: undefined,
    });
  });

  it('onLink throws when neither term_id nor external_id provided', async () => {
    getObjectMaterialsMock.mockResolvedValue([]);
    renderLinker();
    const onLink = recordLinkerCalls.at(-1)!.onLink as (
      t: { preferred_term: string; vocabulary: string },
      m: Record<string, string>,
    ) => Promise<void>;
    await expect(onLink({ preferred_term: 'X', vocabulary: 'aat' }, {})).rejects.toThrow(
      'Unable to cache vocabulary term',
    );
  });

  it('onUnlink calls unlinkObjectMaterial with link id', async () => {
    getObjectMaterialsMock.mockResolvedValue([]);
    unlinkObjectMaterialMock.mockResolvedValue({});
    renderLinker();
    const onUnlink = recordLinkerCalls.at(-1)!.onUnlink as (l: { link_id: string }) => Promise<void>;
    await onUnlink({ link_id: 'l-99' });
    expect(unlinkObjectMaterialMock).toHaveBeenCalledWith('org-1', 'obj-1', 'l-99');
  });

  it('search.searchFn delegates to searchVocabulary with materials facet', async () => {
    getObjectMaterialsMock.mockResolvedValue([]);
    searchVocabularyMock.mockResolvedValue({ terms: [{ preferred_term: 'Wood' }] });
    renderLinker();
    const search = recordLinkerCalls.at(-1)!.search as { searchFn: (t: string) => Promise<unknown> };
    const r = await search.searchFn('wood');
    expect(searchVocabularyMock).toHaveBeenCalledWith('org-1', {
      vocabulary_type: 'aat',
      query: 'wood',
      limit: 20,
      facet: 'materials',
    });
    expect(r).toEqual([{ preferred_term: 'Wood' }]);
  });

  it('declares the part metadata field', () => {
    getObjectMaterialsMock.mockResolvedValue([]);
    renderLinker();
    const fields = recordLinkerCalls.at(-1)!.metadataFields as Array<{ key: string }>;
    expect(fields.map((f) => f.key)).toContain('part');
  });

  it('declares remoteCache for AAT terms', () => {
    getObjectMaterialsMock.mockResolvedValue([]);
    renderLinker();
    const remoteCache = recordLinkerCalls.at(-1)!.remoteCache as {
      remoteLabel: string;
      isRemote: (t: { term_id?: string; external_id?: string }) => boolean;
    };
    expect(remoteCache.remoteLabel).toBe('AAT');
    expect(remoteCache.isRemote({ external_id: 'x' })).toBe(true);
    expect(remoteCache.isRemote({ term_id: 'a', external_id: 'x' })).toBe(false);
  });
});
