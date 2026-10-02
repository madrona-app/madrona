import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { StylePeriodLinker } from '../../../components/collections/StylePeriodLinker';

const {
  getObjectStylePeriodsMock,
  linkObjectStylePeriodMock,
  unlinkObjectStylePeriodMock,
  getStylePeriodAuthoritiesMock,
  createStylePeriodAuthorityMock,
  searchVocabularyMock,
} = vi.hoisted(() => ({
  getObjectStylePeriodsMock: vi.fn(),
  linkObjectStylePeriodMock: vi.fn(),
  unlinkObjectStylePeriodMock: vi.fn(),
  getStylePeriodAuthoritiesMock: vi.fn(),
  createStylePeriodAuthorityMock: vi.fn(),
  searchVocabularyMock: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  getObjectStylePeriods: getObjectStylePeriodsMock,
  linkObjectStylePeriod: linkObjectStylePeriodMock,
  unlinkObjectStylePeriod: unlinkObjectStylePeriodMock,
  getStylePeriodAuthorities: getStylePeriodAuthoritiesMock,
  createStylePeriodAuthority: createStylePeriodAuthorityMock,
  searchVocabulary: searchVocabularyMock,
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

function renderLinker(props: Partial<Parameters<typeof StylePeriodLinker>[0]> = {}) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={createClient()}>
        <StylePeriodLinker organizationId="org-1" objectId="obj-1" {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('StylePeriodLinker', () => {
  beforeEach(() => {
    recordLinkerCalls.length = 0;
    getObjectStylePeriodsMock.mockReset();
    linkObjectStylePeriodMock.mockReset();
    unlinkObjectStylePeriodMock.mockReset();
    getStylePeriodAuthoritiesMock.mockReset();
    createStylePeriodAuthorityMock.mockReset();
    searchVocabularyMock.mockReset();
  });

  it('renders RecordLinker with Styles & Periods title', () => {
    getObjectStylePeriodsMock.mockResolvedValue([]);
    renderLinker();
    expect(screen.getByTestId('title')).toHaveTextContent('Styles & Periods');
  });

  it('renders inside a card by default (not embedded)', () => {
    getObjectStylePeriodsMock.mockResolvedValue([]);
    const { container } = renderLinker();
    expect(container.querySelector('.card')).not.toBeNull();
  });

  it('does not wrap in card when embedded', () => {
    getObjectStylePeriodsMock.mockResolvedValue([]);
    const { container } = renderLinker({ embedded: true });
    expect(container.querySelector('.card')).toBeNull();
  });

  it('extracts link_id as item id', () => {
    getObjectStylePeriodsMock.mockResolvedValue([]);
    renderLinker();
    const getItemId = recordLinkerCalls.at(-1)!.getItemId as (l: { link_id: string }) => string;
    expect(getItemId({ link_id: 'l-1' } as never)).toBe('l-1');
  });

  it('extracts authority_id as linked entity id', () => {
    getObjectStylePeriodsMock.mockResolvedValue([]);
    renderLinker();
    const getLinkedEntityId = recordLinkerCalls.at(-1)!.getLinkedEntityId as (l: { authority_id: string }) => string;
    expect(getLinkedEntityId({ authority_id: 'a-1' } as never)).toBe('a-1');
  });

  it('onLink imports AAT terms first', async () => {
    getObjectStylePeriodsMock.mockResolvedValue([]);
    createStylePeriodAuthorityMock.mockResolvedValue({ authority_id: 'new-1' });
    linkObjectStylePeriodMock.mockResolvedValue({});
    renderLinker();
    const onLink = recordLinkerCalls.at(-1)!.onLink as (
      r: { source: string; aat_id?: string; preferred_term: string; authority_id?: string },
      m: { certainty?: string; assignment_note?: string },
    ) => Promise<void>;
    await onLink(
      { source: 'aat', aat_id: 'aat-99', preferred_term: 'Baroque' },
      { certainty: 'probable' },
    );
    expect(createStylePeriodAuthorityMock).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ preferred_term: 'Baroque', aat_id: 'aat-99' }),
    );
    expect(linkObjectStylePeriodMock).toHaveBeenCalledWith('org-1', 'obj-1', {
      authority_id: 'new-1',
      assignment_certainty: 'probable',
      assignment_note: undefined,
    });
  });

  it('onLink uses local authority directly', async () => {
    getObjectStylePeriodsMock.mockResolvedValue([]);
    linkObjectStylePeriodMock.mockResolvedValue({});
    renderLinker();
    const onLink = recordLinkerCalls.at(-1)!.onLink as (
      r: { source: string; authority_id: string; preferred_term: string },
      m: { certainty?: string },
    ) => Promise<void>;
    await onLink(
      { source: 'local', authority_id: 'a-1', preferred_term: 'Renaissance' },
      { certainty: 'certain' },
    );
    expect(createStylePeriodAuthorityMock).not.toHaveBeenCalled();
    expect(linkObjectStylePeriodMock).toHaveBeenCalledWith('org-1', 'obj-1', {
      authority_id: 'a-1',
      assignment_certainty: 'certain',
      assignment_note: undefined,
    });
  });

  it('onUnlink calls unlinkObjectStylePeriod with link id', async () => {
    getObjectStylePeriodsMock.mockResolvedValue([]);
    unlinkObjectStylePeriodMock.mockResolvedValue({});
    renderLinker();
    const onUnlink = recordLinkerCalls.at(-1)!.onUnlink as (l: { link_id: string }) => Promise<void>;
    await onUnlink({ link_id: 'l-99' });
    expect(unlinkObjectStylePeriodMock).toHaveBeenCalledWith('org-1', 'obj-1', 'l-99');
  });

  it('passes isEditing as the inverse of readOnly', () => {
    getObjectStylePeriodsMock.mockResolvedValue([]);
    renderLinker({ readOnly: false });
    expect(recordLinkerCalls.at(-1)?.isEditing).toBe(true);
  });

  it('passes isEditing=false when readOnly is true', () => {
    getObjectStylePeriodsMock.mockResolvedValue([]);
    renderLinker({ readOnly: true });
    expect(recordLinkerCalls.at(-1)?.isEditing).toBe(false);
  });
});
