import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AcquisitionEntryLinker } from '../../components/collections/AcquisitionEntryLinker';

const { getObjectEntriesMock, updateAcquisitionMock } = vi.hoisted(() => ({
  getObjectEntriesMock: vi.fn(),
  updateAcquisitionMock: vi.fn(),
}));

vi.mock('../../lib/api', () => ({
  getObjectEntries: getObjectEntriesMock,
  updateAcquisition: updateAcquisitionMock,
}));

// Capture props passed to RecordLinkerSingle
const recordLinkerCalls: Array<Record<string, unknown>> = [];
vi.mock('../../components/records', () => ({
  RecordLinkerSingle: (props: Record<string, unknown>) => {
    recordLinkerCalls.push(props);
    const linkedItem = props.linkedItem as { entry_id: string } | null;
    const renderItem = props.renderItem as (i: typeof linkedItem) => React.ReactNode;
    return (
      <div data-testid="record-linker-single">
        <span>singularNoun:{props.singularNoun as string}</span>
        {linkedItem ? <div data-testid="linked-item">{renderItem(linkedItem)}</div> : null}
      </div>
    );
  },
}));

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderLinker(props: Partial<Parameters<typeof AcquisitionEntryLinker>[0]> = {}) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={createClient()}>
        <AcquisitionEntryLinker
          organizationId="org-1"
          acquisitionId="acq-1"
          {...props}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('AcquisitionEntryLinker', () => {
  beforeEach(() => {
    recordLinkerCalls.length = 0;
    getObjectEntriesMock.mockReset();
    updateAcquisitionMock.mockReset();
  });

  it('renders RecordLinkerSingle with the right singular noun', () => {
    renderLinker();
    expect(screen.getByText('singularNoun:Object Entry')).toBeInTheDocument();
  });

  it('renders the linked entry summary', () => {
    renderLinker({
      linkedEntry: {
        entry_id: 'e-1',
        entry_number: 'E-2024-001',
        depositor_name: 'Jane Donor',
        reason: 'gift',
        entry_date: '2024-01-02',
        status: 'processed',
      },
    });
    expect(screen.getByText('E-2024-001')).toBeInTheDocument();
    expect(screen.getByText(/Jane Donor/)).toBeInTheDocument();
    expect(screen.getByText('Processed')).toBeInTheDocument();
  });

  it('does not render a linked summary when linkedEntry is null', () => {
    renderLinker({ linkedEntry: null });
    expect(screen.queryByTestId('linked-item')).toBeNull();
  });

  it('forwards isEditing to RecordLinkerSingle', () => {
    renderLinker({ isEditing: true });
    expect(recordLinkerCalls.at(-1)?.isEditing).toBe(true);
  });

  it('onLink calls updateAcquisition with the chosen entry id', async () => {
    updateAcquisitionMock.mockResolvedValue({});
    renderLinker();
    const onLink = recordLinkerCalls.at(-1)!.onLink as (e: { entry_id: string }) => Promise<void>;
    await onLink({ entry_id: 'e-99' });
    expect(updateAcquisitionMock).toHaveBeenCalledWith('org-1', 'acq-1', { entry_id: 'e-99' });
  });

  it('onUnlink calls updateAcquisition with null entry_id', async () => {
    updateAcquisitionMock.mockResolvedValue({});
    renderLinker({
      linkedEntry: { entry_id: 'e-1', entry_number: 'E1' },
    });
    const onUnlink = recordLinkerCalls.at(-1)!.onUnlink as () => Promise<void>;
    await onUnlink();
    expect(updateAcquisitionMock).toHaveBeenCalledWith('org-1', 'acq-1', { entry_id: null });
  });

  it('throws if onUnlink is called with no linked entry', async () => {
    renderLinker();
    const onUnlink = recordLinkerCalls.at(-1)!.onUnlink as () => Promise<void>;
    await expect(onUnlink()).rejects.toThrow('No entry to unlink');
  });

  it('search.searchFn delegates to getObjectEntries', async () => {
    getObjectEntriesMock.mockResolvedValue({ items: [{ entry_id: 'e-1' }] });
    renderLinker();
    const search = recordLinkerCalls.at(-1)!.search as {
      searchFn: (term: string) => Promise<unknown>;
    };
    const result = await search.searchFn('jane');
    expect(getObjectEntriesMock).toHaveBeenCalledWith('org-1', { q: 'jane', limit: 20 });
    expect(result).toEqual([{ entry_id: 'e-1' }]);
  });

  it('search returns an empty array when API returns no entries field', async () => {
    getObjectEntriesMock.mockResolvedValue({});
    renderLinker();
    const search = recordLinkerCalls.at(-1)!.search as {
      searchFn: (term: string) => Promise<unknown>;
    };
    await waitFor(async () => {
      const result = await search.searchFn('xx');
      expect(result).toEqual([]);
    });
  });
});
