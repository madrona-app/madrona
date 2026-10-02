import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { DraftPayloadForm } from '../../../components/studio/DraftPayloadForm';
import * as api from '../../../lib/api/drafts';

vi.mock('../../../lib/api/drafts');
const getDraftFormSchema = vi.mocked(api.getDraftFormSchema);
const resolveRefs = vi.mocked(api.resolveRefs);

function renderForm(value: Record<string, unknown>, onChange = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/organizations/org-1/x']}>
        <Routes>
          <Route path="/organizations/:orgId/x" element={
            <DraftPayloadForm entityType="acquisition" value={value} onChange={onChange} />
          } />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return onChange;
}

beforeEach(() => {
  vi.clearAllMocks();
  getDraftFormSchema.mockResolvedValue({
    entity_type: 'acquisition',
    entity_label: 'Acquisition',
    fields: [
      { name: 'acquisition_method', label: 'Acquisition method', type: 'enum', required: true, enum_values: ['purchase', 'gift'], section: 'identification', lookup_category: null },
      { name: 'legal_status', label: 'Legal status', type: 'text', required: false, enum_values: null, section: 'legal', lookup_category: null },
    ],
  });
});

describe('DraftPayloadForm', () => {
  it('renders typed, labeled fields from the schema (enum as a select)', async () => {
    renderForm({ acquisition_method: 'purchase' });
    expect(await screen.findByLabelText(/Acquisition method/)).toBeInTheDocument();
    expect((screen.getByLabelText(/Acquisition method/) as HTMLSelectElement).value).toBe('purchase');
    expect(screen.getByLabelText(/Legal status/)).toBeInTheDocument();
  });

  it('clearing a field DROPS the key — never writes an empty/fabricated value', async () => {
    const onChange = renderForm({ acquisition_method: 'purchase', legal_status: 'clear' });
    const legal = await screen.findByLabelText(/Legal status/);
    fireEvent.change(legal, { target: { value: '' } });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const next = onChange.mock.calls.at(-1)![0];
    expect('legal_status' in next).toBe(false); // dropped, not set to ''
    expect(next.acquisition_method).toBe('purchase');
  });

  it('shows a reference field as a resolved name, not a UUID', async () => {
    getDraftFormSchema.mockResolvedValue({
      entity_type: 'acquisition',
      entity_label: 'Acquisition',
      fields: [
        { name: 'source_id', label: 'Source', type: 'reference', required: false, enum_values: null, section: 'source', lookup_category: 'constituent', reference_kind: 'constituent' },
      ],
    });
    resolveRefs.mockResolvedValue({ labels: { 'c-1': 'Estate of A. Donor' } });
    renderForm({ source_id: 'c-1' });
    // The entity's name is shown; the raw id is not.
    expect(await screen.findByText('Estate of A. Donor')).toBeInTheDocument();
    expect(screen.queryByText('c-1')).not.toBeInTheDocument();
  });

  it('falls back (onUnavailable) when the schema can’t load', async () => {
    getDraftFormSchema.mockRejectedValue(new Error('boom'));
    const onUnavailable = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/organizations/org-1/x']}>
          <Routes>
            <Route path="/organizations/:orgId/x" element={
              <DraftPayloadForm entityType="acquisition" value={{}} onChange={vi.fn()} onUnavailable={onUnavailable} />
            } />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(onUnavailable).toHaveBeenCalled());
  });
});
