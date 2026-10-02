import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { LoanExitLinker } from '../../../components/collections/LoanExitLinker';

const { getObjectExitsMock, updateObjectExitMock } = vi.hoisted(() => ({
  getObjectExitsMock: vi.fn(),
  updateObjectExitMock: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  getObjectExits: getObjectExitsMock,
  updateObjectExit: updateObjectExitMock,
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

function renderLinker(props: Partial<Parameters<typeof LoanExitLinker>[0]> = {}) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={createClient()}>
        <LoanExitLinker organizationId="org-1" loanId="loan-1" {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('LoanExitLinker', () => {
  beforeEach(() => {
    recordLinkerCalls.length = 0;
    getObjectExitsMock.mockReset();
    updateObjectExitMock.mockReset();
  });

  it('renders RecordLinker with Linked Exits title', () => {
    getObjectExitsMock.mockResolvedValue({ items: [] });
    renderLinker();
    expect(screen.getByTestId('title')).toHaveTextContent('Linked Exits');
  });

  it('extracts exit_id as item id', () => {
    getObjectExitsMock.mockResolvedValue({ items: [] });
    renderLinker();
    const getItemId = recordLinkerCalls.at(-1)!.getItemId as (e: { exit_id: string }) => string;
    expect(getItemId({ exit_id: 'ex-1' } as never)).toBe('ex-1');
  });

  it('builds exit detail href', () => {
    getObjectExitsMock.mockResolvedValue({ items: [] });
    renderLinker();
    const getItemHref = recordLinkerCalls.at(-1)!.getItemHref as (e: { exit_id: string }) => string;
    expect(getItemHref({ exit_id: 'ex-7' } as never)).toBe(
      '/organizations/org-1/collections/exits/ex-7',
    );
  });

  it('onLink updates the exit to reference the loan', async () => {
    getObjectExitsMock.mockResolvedValue({ items: [] });
    updateObjectExitMock.mockResolvedValue({});
    renderLinker();
    const onLink = recordLinkerCalls.at(-1)!.onLink as (e: { exit_id: string }) => Promise<void>;
    await onLink({ exit_id: 'ex-99' });
    expect(updateObjectExitMock).toHaveBeenCalledWith('org-1', 'ex-99', {
      reference_type: 'loan_in',
      reference_id: 'loan-1',
    });
  });

  it('onUnlink clears the reference on the exit', async () => {
    getObjectExitsMock.mockResolvedValue({ items: [] });
    updateObjectExitMock.mockResolvedValue({});
    renderLinker();
    const onUnlink = recordLinkerCalls.at(-1)!.onUnlink as (e: { exit_id: string }) => Promise<void>;
    await onUnlink({ exit_id: 'ex-99' });
    expect(updateObjectExitMock).toHaveBeenCalledWith('org-1', 'ex-99', {
      reference_type: null,
      reference_id: null,
    });
  });

  it('search.searchFn delegates to getObjectExits with exit_reason filter', async () => {
    getObjectExitsMock.mockResolvedValue({ items: [{ exit_id: 'a' }] });
    renderLinker();
    const search = recordLinkerCalls.at(-1)!.search as { searchFn: (t: string) => Promise<unknown> };
    await search.searchFn('foo');
    expect(getObjectExitsMock).toHaveBeenCalledWith('org-1', {
      q: 'foo',
      limit: 20,
      exit_reason: 'loan_return',
    });
  });

  it('search.filterLinked excludes exits already linked or referenced', () => {
    getObjectExitsMock.mockResolvedValue({ items: [] });
    renderLinker();
    const search = recordLinkerCalls.at(-1)!.search as {
      filterLinked: (items: Array<{ exit_id: string; reference_id?: string | null }>, ids: Set<string>) => unknown[];
    };
    const items = [
      { exit_id: 'a' },
      { exit_id: 'b', reference_id: 'other-loan' },
      { exit_id: 'c', reference_id: 'loan-1' },
      { exit_id: 'd' },
    ];
    const filtered = search.filterLinked(items, new Set(['d']));
    expect(filtered).toEqual([
      { exit_id: 'a' },
      { exit_id: 'c', reference_id: 'loan-1' },
    ]);
  });

  it('forwards onCountChange', () => {
    const onCountChange = vi.fn();
    getObjectExitsMock.mockResolvedValue({ items: [] });
    renderLinker({ onCountChange });
    expect(recordLinkerCalls.at(-1)?.onCountChange).toBe(onCountChange);
  });
});
