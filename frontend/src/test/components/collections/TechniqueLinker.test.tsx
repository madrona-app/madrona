import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { TechniqueLinker } from '../../../components/collections/TechniqueLinker';

const {
  getObjectTechniquesMock,
  linkObjectTechniqueMock,
  unlinkObjectTechniqueMock,
  searchVocabularyMock,
  cacheVocabularyTermMock,
} = vi.hoisted(() => ({
  getObjectTechniquesMock: vi.fn(),
  linkObjectTechniqueMock: vi.fn(),
  unlinkObjectTechniqueMock: vi.fn(),
  searchVocabularyMock: vi.fn(),
  cacheVocabularyTermMock: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  getObjectTechniques: getObjectTechniquesMock,
  linkObjectTechnique: linkObjectTechniqueMock,
  unlinkObjectTechnique: unlinkObjectTechniqueMock,
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

function renderLinker(props: Partial<Parameters<typeof TechniqueLinker>[0]> = {}) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={createClient()}>
        <TechniqueLinker organizationId="org-1" objectId="obj-1" {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('TechniqueLinker', () => {
  beforeEach(() => {
    recordLinkerCalls.length = 0;
    getObjectTechniquesMock.mockReset();
    linkObjectTechniqueMock.mockReset();
    unlinkObjectTechniqueMock.mockReset();
    searchVocabularyMock.mockReset();
    cacheVocabularyTermMock.mockReset();
  });

  it('renders RecordLinker with Techniques title', () => {
    getObjectTechniquesMock.mockResolvedValue([]);
    renderLinker();
    expect(screen.getByTestId('title')).toHaveTextContent('Techniques');
  });

  it('onLink links existing local terms directly', async () => {
    getObjectTechniquesMock.mockResolvedValue([]);
    linkObjectTechniqueMock.mockResolvedValue({});
    renderLinker();
    const onLink = recordLinkerCalls.at(-1)!.onLink as (
      t: { term_id?: string; preferred_term: string; vocabulary?: string },
      m: { part?: string },
    ) => Promise<void>;
    await onLink({ term_id: 't-1', preferred_term: 'Etching' }, { part: 'overall' });
    expect(cacheVocabularyTermMock).not.toHaveBeenCalled();
    expect(linkObjectTechniqueMock).toHaveBeenCalledWith('org-1', 'obj-1', {
      vocabulary_term_id: 't-1',
      part: 'overall',
    });
  });

  it('onLink caches Getty AAT terms before linking', async () => {
    getObjectTechniquesMock.mockResolvedValue([]);
    cacheVocabularyTermMock.mockResolvedValue({ term_id: 'cached-1' });
    linkObjectTechniqueMock.mockResolvedValue({});
    renderLinker();
    const onLink = recordLinkerCalls.at(-1)!.onLink as (
      t: { external_id: string; preferred_term: string; vocabulary: string },
      m: Record<string, string>,
    ) => Promise<void>;
    await onLink(
      { external_id: 'aat-1', preferred_term: 'Etching', vocabulary: 'aat' },
      {},
    );
    expect(cacheVocabularyTermMock).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({
        external_id: 'aat-1',
        applicable_fields: ['techniques'],
      }),
    );
    expect(linkObjectTechniqueMock).toHaveBeenCalledWith('org-1', 'obj-1', {
      vocabulary_term_id: 'cached-1',
      part: undefined,
    });
  });

  it('onLink throws when no term identifier is available', async () => {
    getObjectTechniquesMock.mockResolvedValue([]);
    renderLinker();
    const onLink = recordLinkerCalls.at(-1)!.onLink as (
      t: { preferred_term: string; vocabulary: string },
      m: Record<string, string>,
    ) => Promise<void>;
    await expect(onLink({ preferred_term: 'X', vocabulary: 'aat' }, {})).rejects.toThrow();
  });

  it('onUnlink calls unlinkObjectTechnique', async () => {
    getObjectTechniquesMock.mockResolvedValue([]);
    unlinkObjectTechniqueMock.mockResolvedValue({});
    renderLinker();
    const onUnlink = recordLinkerCalls.at(-1)!.onUnlink as (l: { link_id: string }) => Promise<void>;
    await onUnlink({ link_id: 'l-99' });
    expect(unlinkObjectTechniqueMock).toHaveBeenCalledWith('org-1', 'obj-1', 'l-99');
  });

  it('search.searchFn calls searchVocabulary with techniques facet', async () => {
    getObjectTechniquesMock.mockResolvedValue([]);
    searchVocabularyMock.mockResolvedValue({ terms: [{ preferred_term: 'X' }] });
    renderLinker();
    const search = recordLinkerCalls.at(-1)!.search as { searchFn: (t: string) => Promise<unknown> };
    const r = await search.searchFn('etch');
    expect(searchVocabularyMock).toHaveBeenCalledWith('org-1', {
      vocabulary_type: 'aat',
      query: 'etch',
      limit: 20,
      facet: 'techniques',
    });
    expect(r).toEqual([{ preferred_term: 'X' }]);
  });

  it('declares the part metadata field', () => {
    getObjectTechniquesMock.mockResolvedValue([]);
    renderLinker();
    const fields = recordLinkerCalls.at(-1)!.metadataFields as Array<{ key: string }>;
    expect(fields.map((f) => f.key)).toContain('part');
  });

  it('declares remoteCache for AAT terms', () => {
    getObjectTechniquesMock.mockResolvedValue([]);
    renderLinker();
    const remoteCache = recordLinkerCalls.at(-1)!.remoteCache as {
      remoteLabel: string;
      isRemote: (t: { term_id?: string; external_id?: string }) => boolean;
    };
    expect(remoteCache.remoteLabel).toBe('AAT');
    expect(remoteCache.isRemote({ external_id: 'a' })).toBe(true);
    expect(remoteCache.isRemote({ term_id: 't', external_id: 'a' })).toBe(false);
  });
});
