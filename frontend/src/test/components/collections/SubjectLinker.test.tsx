import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { SubjectLinker } from '../../../components/collections/SubjectLinker';

const {
  getObjectSubjectsMock,
  linkObjectSubjectMock,
  unlinkObjectSubjectMock,
  getSubjectAuthoritiesMock,
  createSubjectAuthorityMock,
  searchSubjectsExternalMock,
} = vi.hoisted(() => ({
  getObjectSubjectsMock: vi.fn(),
  linkObjectSubjectMock: vi.fn(),
  unlinkObjectSubjectMock: vi.fn(),
  getSubjectAuthoritiesMock: vi.fn(),
  createSubjectAuthorityMock: vi.fn(),
  searchSubjectsExternalMock: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  getObjectSubjects: getObjectSubjectsMock,
  linkObjectSubject: linkObjectSubjectMock,
  unlinkObjectSubject: unlinkObjectSubjectMock,
  getSubjectAuthorities: getSubjectAuthoritiesMock,
  createSubjectAuthority: createSubjectAuthorityMock,
  searchSubjectsExternal: searchSubjectsExternalMock,
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

function renderLinker(props: Partial<Parameters<typeof SubjectLinker>[0]> = {}) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={createClient()}>
        <SubjectLinker organizationId="org-1" objectId="obj-1" {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('SubjectLinker', () => {
  beforeEach(() => {
    recordLinkerCalls.length = 0;
    getObjectSubjectsMock.mockReset();
    linkObjectSubjectMock.mockReset();
    unlinkObjectSubjectMock.mockReset();
    getSubjectAuthoritiesMock.mockReset();
    createSubjectAuthorityMock.mockReset();
    searchSubjectsExternalMock.mockReset();
  });

  it('renders RecordLinker with Subjects title', () => {
    getObjectSubjectsMock.mockResolvedValue([]);
    renderLinker();
    expect(screen.getByTestId('title')).toHaveTextContent('Subjects');
  });

  it('extracts link_id as item id', () => {
    getObjectSubjectsMock.mockResolvedValue([]);
    renderLinker();
    const getItemId = recordLinkerCalls.at(-1)!.getItemId as (l: { link_id: string }) => string;
    expect(getItemId({ link_id: 'l-1' } as never)).toBe('l-1');
  });

  it('extracts subject_authority_id as linked entity id', () => {
    getObjectSubjectsMock.mockResolvedValue([]);
    renderLinker();
    const getLinkedEntityId = recordLinkerCalls.at(-1)!.getLinkedEntityId as (l: { subject_authority_id: string }) => string;
    expect(getLinkedEntityId({ subject_authority_id: 's-1' } as never)).toBe('s-1');
  });

  it('builds subject href', () => {
    getObjectSubjectsMock.mockResolvedValue([]);
    renderLinker();
    const getItemHref = recordLinkerCalls.at(-1)!.getItemHref as (l: { subject_authority_id: string }) => string;
    expect(getItemHref({ subject_authority_id: 's-9' } as never)).toBe(
      '/organizations/org-1/collections/subject-authorities/s-9',
    );
  });

  it('passes isEditing=true when not readOnly', () => {
    getObjectSubjectsMock.mockResolvedValue([]);
    renderLinker({ readOnly: false });
    expect(recordLinkerCalls.at(-1)?.isEditing).toBe(true);
  });

  it('passes isEditing=false when readOnly', () => {
    getObjectSubjectsMock.mockResolvedValue([]);
    renderLinker({ readOnly: true });
    expect(recordLinkerCalls.at(-1)?.isEditing).toBe(false);
  });

  it('renders inside a card by default', () => {
    getObjectSubjectsMock.mockResolvedValue([]);
    const { container } = renderLinker();
    expect(container.querySelector('.card')).not.toBeNull();
  });

  it('does not wrap in card when embedded', () => {
    getObjectSubjectsMock.mockResolvedValue([]);
    const { container } = renderLinker({ embedded: true });
    expect(container.querySelector('.card')).toBeNull();
  });

  it('onUnlink calls unlinkObjectSubject', async () => {
    getObjectSubjectsMock.mockResolvedValue([]);
    unlinkObjectSubjectMock.mockResolvedValue({});
    renderLinker();
    const onUnlink = recordLinkerCalls.at(-1)!.onUnlink as (l: { link_id: string }) => Promise<void>;
    await onUnlink({ link_id: 'l-9' });
    expect(unlinkObjectSubjectMock).toHaveBeenCalledWith('org-1', 'obj-1', 'l-9');
  });

  it('declares cache invalidation keys', () => {
    getObjectSubjectsMock.mockResolvedValue([]);
    renderLinker();
    const keys = recordLinkerCalls.at(-1)!.invalidateKeys as string[][];
    expect(keys).toContainEqual(['object-subjects', 'org-1', 'obj-1']);
  });
});
