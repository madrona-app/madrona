import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ShipmentLinker } from '../../../components/collections/ShipmentLinker';

const { apiFetchMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
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

function renderLinker(props: Partial<Parameters<typeof ShipmentLinker>[0]> = {}) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={createClient()}>
        <ShipmentLinker
          organizationId="org-1"
          procedureType="loan_in"
          procedureId="loan-1"
          {...props}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('ShipmentLinker', () => {
  beforeEach(() => {
    recordLinkerCalls.length = 0;
    apiFetchMock.mockReset();
  });

  it('renders RecordLinker with the Shipments title', () => {
    apiFetchMock.mockResolvedValue({ items: [], total: 0 });
    renderLinker();
    expect(screen.getByTestId('title')).toHaveTextContent('Shipments');
  });

  it('extracts shipment_id as item id', () => {
    apiFetchMock.mockResolvedValue({ items: [], total: 0 });
    renderLinker();
    const getItemId = recordLinkerCalls.at(-1)!.getItemId as (s: { shipment_id: string }) => string;
    expect(getItemId({ shipment_id: 'sh-1' } as never)).toBe('sh-1');
  });

  it('builds shipment href', () => {
    apiFetchMock.mockResolvedValue({ items: [], total: 0 });
    renderLinker();
    const getItemHref = recordLinkerCalls.at(-1)!.getItemHref as (s: { shipment_id: string }) => string;
    expect(getItemHref({ shipment_id: 'sh-7' } as never)).toBe(
      '/organizations/org-1/collections/shipments/sh-7',
    );
  });

  it('onLink POSTs a reference for the shipment', async () => {
    apiFetchMock.mockResolvedValue({ items: [], total: 0 });
    renderLinker();
    apiFetchMock.mockResolvedValue({});
    const onLink = recordLinkerCalls.at(-1)!.onLink as (s: { shipment_id: string }) => Promise<void>;
    await onLink({ shipment_id: 'sh-9' });
    expect(apiFetchMock).toHaveBeenLastCalledWith(
      '/organizations/org-1/collections/shipments/sh-9/references',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ procedure_type: 'loan_in', procedure_id: 'loan-1' }),
      }),
    );
  });

  it('onUnlink DELETEs the procedure-specific reference if present', async () => {
    apiFetchMock.mockResolvedValue({ items: [], total: 0 });
    renderLinker();
    apiFetchMock.mockResolvedValue({});
    const onUnlink = recordLinkerCalls.at(-1)!.onUnlink as (s: {
      shipment_id: string;
      references: Array<{ reference_id: string; procedure_type: string; procedure_id: string }>;
    }) => Promise<void>;
    await onUnlink({
      shipment_id: 'sh-1',
      references: [
        { reference_id: 'r-1', procedure_type: 'loan_in', procedure_id: 'loan-1' },
        { reference_id: 'r-2', procedure_type: 'loan_in', procedure_id: 'other' },
      ],
    });
    expect(apiFetchMock).toHaveBeenLastCalledWith(
      '/organizations/org-1/collections/shipments/sh-1/references/r-1',
      { method: 'DELETE' },
    );
  });

  it('onUnlink does nothing when no matching reference is found', async () => {
    apiFetchMock.mockResolvedValue({ items: [], total: 0 });
    renderLinker();
    apiFetchMock.mockClear();
    const onUnlink = recordLinkerCalls.at(-1)!.onUnlink as (s: {
      shipment_id: string;
      references: Array<{ reference_id: string; procedure_type: string; procedure_id: string }>;
    }) => Promise<void>;
    await onUnlink({
      shipment_id: 'sh-1',
      references: [{ reference_id: 'r-1', procedure_type: 'loan_out', procedure_id: 'other' }],
    });
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('search.searchFn calls the shipments search endpoint', async () => {
    apiFetchMock.mockResolvedValue({ items: [], total: 0 });
    renderLinker();
    apiFetchMock.mockResolvedValue({ items: [{ shipment_id: 'a' }], total: 1 });
    const search = recordLinkerCalls.at(-1)!.search as { searchFn: (t: string) => Promise<unknown> };
    const r = await search.searchFn('SH-001');
    expect(apiFetchMock).toHaveBeenLastCalledWith(
      '/organizations/org-1/collections/shipments?q=SH-001&limit=20',
    );
    expect(r).toEqual([{ shipment_id: 'a' }]);
  });

  it('forwards onCountChange', () => {
    const onCountChange = vi.fn();
    apiFetchMock.mockResolvedValue({ items: [], total: 0 });
    renderLinker({ onCountChange });
    expect(recordLinkerCalls.at(-1)?.onCountChange).toBe(onCountChange);
  });

  it('declares cache invalidation key for procedure-shipments', () => {
    apiFetchMock.mockResolvedValue({ items: [], total: 0 });
    renderLinker();
    const keys = recordLinkerCalls.at(-1)!.invalidateKeys as string[][];
    expect(keys).toContainEqual(['procedure-shipments', 'org-1', 'loan_in', 'loan-1']);
  });
});
