import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InheritedFieldsPanel } from '../../../components/dam/InheritedFieldsPanel';

const { getMediaInheritedFieldsMock } = vi.hoisted(() => ({
  getMediaInheritedFieldsMock: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  getMediaInheritedFields: getMediaInheritedFieldsMock,
}));

function createClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderPanel(props: Partial<Parameters<typeof InheritedFieldsPanel>[0]> = {}) {
  return render(
    <QueryClientProvider client={createClient()}>
      <InheritedFieldsPanel organizationId="org-1" mediaId="m-1" {...props} />
    </QueryClientProvider>,
  );
}

describe('InheritedFieldsPanel', () => {
  beforeEach(() => {
    getMediaInheritedFieldsMock.mockReset();
  });

  it('renders nothing when there are no inherited fields', async () => {
    getMediaInheritedFieldsMock.mockResolvedValue({ inherited_fields: [] });
    const { container } = renderPanel();
    // After load completes, the component returns null
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('renders an error state on query failure', async () => {
    getMediaInheritedFieldsMock.mockRejectedValue(new Error('500'));
    renderPanel();
    await waitFor(() =>
      expect(screen.getByText('Failed to load inherited fields')).toBeInTheDocument(),
    );
  });

  it('renders a single linked object expanded by default', async () => {
    getMediaInheritedFieldsMock.mockResolvedValue({
      inherited_fields: [
        {
          object_id: 'obj-1',
          object_number: '2024.001',
          fields: [
            { source_field: 'title', display_label: 'Title', value: 'Vase' },
            { source_field: 'mat', display_label: 'Material', value: ['glass', 'wood'] },
          ],
        },
      ],
    });
    renderPanel();
    await waitFor(() => screen.getByText('2024.001'));
    expect(screen.getByText('Linked Collection Object')).toBeInTheDocument();
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Vase')).toBeInTheDocument();
    // Array values formatted with ", "
    expect(screen.getByText('glass, wood')).toBeInTheDocument();
  });

  it('renders a collapsible header for each object when there are multiple', async () => {
    getMediaInheritedFieldsMock.mockResolvedValue({
      inherited_fields: [
        { object_id: 'a', object_number: 'A.1', fields: [{ source_field: 't', display_label: 'T', value: 'va' }] },
        { object_id: 'b', object_number: 'B.2', fields: [{ source_field: 't', display_label: 'T', value: 'vb' }] },
      ],
    });
    renderPanel();
    await waitFor(() => screen.getByText('A.1'));
    expect(screen.getByText('Linked Collection Objects')).toBeInTheDocument();
    expect(screen.getByText('B.2')).toBeInTheDocument();
    // Multiple objects start collapsed; values should not be shown until expansion
    expect(screen.queryByText('va')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('A.1'));
    expect(screen.getByText('va')).toBeInTheDocument();
  });

  it('renders the count badge', async () => {
    getMediaInheritedFieldsMock.mockResolvedValue({
      inherited_fields: [
        { object_id: 'a', object_number: 'A', fields: [] },
        { object_id: 'b', object_number: 'B', fields: [] },
        { object_id: 'c', object_number: 'C', fields: [] },
      ],
    });
    renderPanel();
    await waitFor(() => screen.getByText('A'));
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});
