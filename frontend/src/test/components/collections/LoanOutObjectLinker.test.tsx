import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { LoanOutObjectLinker } from '../../../components/collections/LoanOutObjectLinker';

const { addLoanOutObjectMock, getCollectionObjectsMock, apiFetchMock } = vi.hoisted(() => ({
  addLoanOutObjectMock: vi.fn(),
  getCollectionObjectsMock: vi.fn(),
  apiFetchMock: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  addLoanOutObject: addLoanOutObjectMock,
  getCollectionObjects: getCollectionObjectsMock,
}));

vi.mock('../../../lib/apiClient', () => ({
  apiFetch: apiFetchMock,
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

function renderLinker(props: Partial<Parameters<typeof LoanOutObjectLinker>[0]> = {}) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={createClient()}>
        <LoanOutObjectLinker organizationId="org-1" loanId="loan-1" {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('LoanOutObjectLinker', () => {
  beforeEach(() => {
    recordLinkerCalls.length = 0;
    addLoanOutObjectMock.mockReset();
    getCollectionObjectsMock.mockReset();
    apiFetchMock.mockReset();
  });

  it('renders RecordLinker with Loan Objects title', () => {
    apiFetchMock.mockResolvedValue({ objects: [] });
    renderLinker();
    expect(screen.getByTestId('title')).toHaveTextContent('Loan Objects');
  });

  it('extracts loan_object_id as item id', () => {
    apiFetchMock.mockResolvedValue({ objects: [] });
    renderLinker();
    const getItemId = recordLinkerCalls.at(-1)!.getItemId as (o: { loan_object_id: string }) => string;
    expect(getItemId({ loan_object_id: 'lo-1' } as never)).toBe('lo-1');
  });

  it('extracts object_id as linked entity id', () => {
    apiFetchMock.mockResolvedValue({ objects: [] });
    renderLinker();
    const getLinkedEntityId = recordLinkerCalls.at(-1)!.getLinkedEntityId as (o: { object_id: string }) => string;
    expect(getLinkedEntityId({ object_id: 'obj-9' } as never)).toBe('obj-9');
  });

  it('builds object detail href', () => {
    apiFetchMock.mockResolvedValue({ objects: [] });
    renderLinker();
    const getItemHref = recordLinkerCalls.at(-1)!.getItemHref as (o: { object_id: string }) => string;
    expect(getItemHref({ object_id: 'obj-9' } as never)).toBe(
      '/organizations/org-1/collections/objects/obj-9',
    );
  });

  it('onLink calls addLoanOutObject with the chosen object id', async () => {
    apiFetchMock.mockResolvedValue({ objects: [] });
    addLoanOutObjectMock.mockResolvedValue({});
    renderLinker();
    const onLink = recordLinkerCalls.at(-1)!.onLink as (o: { object_id: string }) => Promise<void>;
    await onLink({ object_id: 'obj-1' });
    expect(addLoanOutObjectMock).toHaveBeenCalledWith('org-1', 'loan-1', { object_id: 'obj-1' });
  });

  it('onUnlink calls apiFetch DELETE on the loan object endpoint', async () => {
    apiFetchMock.mockResolvedValue({ objects: [] });
    renderLinker();
    apiFetchMock.mockResolvedValue({});
    const onUnlink = recordLinkerCalls.at(-1)!.onUnlink as (o: {
      loan_object_id: string;
    }) => Promise<void>;
    await onUnlink({ loan_object_id: 'lo-2' });
    expect(apiFetchMock).toHaveBeenLastCalledWith(
      '/organizations/org-1/collections/loans-out/loan-1/objects/lo-2',
      { method: 'DELETE' },
    );
  });

  it('search.searchFn delegates to getCollectionObjects', async () => {
    apiFetchMock.mockResolvedValue({ objects: [] });
    getCollectionObjectsMock.mockResolvedValue({ items: [{ object_id: 'a' }] });
    renderLinker();
    const search = recordLinkerCalls.at(-1)!.search as { searchFn: (t: string) => Promise<unknown> };
    const r = await search.searchFn('hello');
    expect(getCollectionObjectsMock).toHaveBeenCalledWith('org-1', { search: 'hello', limit: 20 });
    expect(r).toEqual([{ object_id: 'a' }]);
  });

  it('forwards onCountChange', () => {
    const onCountChange = vi.fn();
    apiFetchMock.mockResolvedValue({ objects: [] });
    renderLinker({ onCountChange });
    expect(recordLinkerCalls.at(-1)?.onCountChange).toBe(onCountChange);
  });

  it('declares cache invalidation keys for loan-out and loan-out-objects', () => {
    apiFetchMock.mockResolvedValue({ objects: [] });
    renderLinker();
    const keys = recordLinkerCalls.at(-1)!.invalidateKeys as string[][];
    expect(keys).toContainEqual(['loan-out-objects', 'org-1', 'loan-1']);
    expect(keys).toContainEqual(['loan-out', 'org-1', 'loan-1']);
  });
});
