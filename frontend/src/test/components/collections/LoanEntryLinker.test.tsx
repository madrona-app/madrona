import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { LoanEntryLinker } from '../../../components/collections/LoanEntryLinker';

const {
  getLoanInObjectEntriesMock,
  addLoanInObjectEntryMock,
  removeLoanInObjectEntryMock,
  getObjectEntriesMock,
} = vi.hoisted(() => ({
  getLoanInObjectEntriesMock: vi.fn(),
  addLoanInObjectEntryMock: vi.fn(),
  removeLoanInObjectEntryMock: vi.fn(),
  getObjectEntriesMock: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  getLoanInObjectEntries: getLoanInObjectEntriesMock,
  addLoanInObjectEntry: addLoanInObjectEntryMock,
  removeLoanInObjectEntry: removeLoanInObjectEntryMock,
  getObjectEntries: getObjectEntriesMock,
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

function renderLinker(props: Partial<Parameters<typeof LoanEntryLinker>[0]> = {}) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={createClient()}>
        <LoanEntryLinker organizationId="org-1" loanId="loan-1" {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('LoanEntryLinker', () => {
  beforeEach(() => {
    recordLinkerCalls.length = 0;
    getLoanInObjectEntriesMock.mockReset();
    addLoanInObjectEntryMock.mockReset();
    removeLoanInObjectEntryMock.mockReset();
    getObjectEntriesMock.mockReset();
  });

  it('renders RecordLinker with Linked Entries title', () => {
    getLoanInObjectEntriesMock.mockResolvedValue({ entries: [] });
    renderLinker();
    expect(screen.getByTestId('title')).toHaveTextContent('Linked Entries');
  });

  it('extracts loan_in_entry_id as item id', () => {
    getLoanInObjectEntriesMock.mockResolvedValue({ entries: [] });
    renderLinker();
    const getItemId = recordLinkerCalls.at(-1)!.getItemId as (l: { loan_in_entry_id: string }) => string;
    expect(getItemId({ loan_in_entry_id: 'lie-1' } as never)).toBe('lie-1');
  });

  it('extracts entry_id as linked entity id', () => {
    getLoanInObjectEntriesMock.mockResolvedValue({ entries: [] });
    renderLinker();
    const getLinkedEntityId = recordLinkerCalls.at(-1)!.getLinkedEntityId as (l: { entry_id: string }) => string;
    expect(getLinkedEntityId({ entry_id: 'e-1' } as never)).toBe('e-1');
  });

  it('builds entry detail href', () => {
    getLoanInObjectEntriesMock.mockResolvedValue({ entries: [] });
    renderLinker();
    const getItemHref = recordLinkerCalls.at(-1)!.getItemHref as (l: { entry_id: string }) => string;
    expect(getItemHref({ entry_id: 'e-1' } as never)).toBe(
      '/organizations/org-1/collections/entries/e-1',
    );
  });

  it('onLink calls addLoanInObjectEntry with entry id', async () => {
    getLoanInObjectEntriesMock.mockResolvedValue({ entries: [] });
    addLoanInObjectEntryMock.mockResolvedValue({});
    renderLinker();
    const onLink = recordLinkerCalls.at(-1)!.onLink as (e: { entry_id: string }) => Promise<void>;
    await onLink({ entry_id: 'e-9' });
    expect(addLoanInObjectEntryMock).toHaveBeenCalledWith('org-1', 'loan-1', { entry_id: 'e-9' });
  });

  it('onUnlink calls removeLoanInObjectEntry with loan_in_entry_id', async () => {
    getLoanInObjectEntriesMock.mockResolvedValue({ entries: [] });
    removeLoanInObjectEntryMock.mockResolvedValue({});
    renderLinker();
    const onUnlink = recordLinkerCalls.at(-1)!.onUnlink as (l: { loan_in_entry_id: string }) => Promise<void>;
    await onUnlink({ loan_in_entry_id: 'lie-99' });
    expect(removeLoanInObjectEntryMock).toHaveBeenCalledWith('org-1', 'loan-1', 'lie-99');
  });

  it('search.searchFn delegates to getObjectEntries', async () => {
    getLoanInObjectEntriesMock.mockResolvedValue({ entries: [] });
    getObjectEntriesMock.mockResolvedValue({ items: [{ entry_id: 'a' }] });
    renderLinker();
    const search = recordLinkerCalls.at(-1)!.search as { searchFn: (t: string) => Promise<unknown> };
    const r = await search.searchFn('foo');
    expect(getObjectEntriesMock).toHaveBeenCalledWith('org-1', { q: 'foo', limit: 20 });
    expect(r).toEqual([{ entry_id: 'a' }]);
  });

  it('returns [] when getObjectEntries gives no entries', async () => {
    getLoanInObjectEntriesMock.mockResolvedValue({ entries: [] });
    getObjectEntriesMock.mockResolvedValue({});
    renderLinker();
    const search = recordLinkerCalls.at(-1)!.search as { searchFn: (t: string) => Promise<unknown> };
    const r = await search.searchFn('foo');
    expect(r).toEqual([]);
  });

  it('forwards onCountChange', () => {
    const onCountChange = vi.fn();
    getLoanInObjectEntriesMock.mockResolvedValue({ entries: [] });
    renderLinker({ onCountChange });
    expect(recordLinkerCalls.at(-1)?.onCountChange).toBe(onCountChange);
  });
});
