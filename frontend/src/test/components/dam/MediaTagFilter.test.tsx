import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MediaTagFilter, formatTagFiltersForQuery } from '../../../components/dam/MediaTagFilter';

const { listTagDefinitionsMock, getTagValuesMock } = vi.hoisted(() => ({
  listTagDefinitionsMock: vi.fn(),
  getTagValuesMock: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  listTagDefinitions: listTagDefinitionsMock,
  getTagValues: getTagValuesMock,
}));

function createClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderFilter(props: Partial<Parameters<typeof MediaTagFilter>[0]> = {}) {
  return render(
    <QueryClientProvider client={createClient()}>
      <MediaTagFilter
        organizationId="org-1"
        filters={[]}
        onChange={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe('MediaTagFilter', () => {
  beforeEach(() => {
    listTagDefinitionsMock.mockReset();
    getTagValuesMock.mockReset();
  });

  it('renders nothing when there are zero tag definitions', async () => {
    listTagDefinitionsMock.mockResolvedValue({ definitions: [] });
    const { container } = renderFilter();
    // After load completes, the component returns null (no filter UI)
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('shows loading state while definitions load', () => {
    listTagDefinitionsMock.mockImplementation(() => new Promise(() => {}));
    renderFilter();
    expect(screen.getByText('Loading filters...')).toBeInTheDocument();
  });

  it('renders one button per definition', async () => {
    listTagDefinitionsMock.mockResolvedValue({
      definitions: [
        { definition_id: 'd1', tag_key: 'subject', display_name: 'Subject' },
        { definition_id: 'd2', tag_key: 'medium', display_name: 'Medium' },
      ],
    });
    renderFilter();
    await waitFor(() => screen.getByText('Subject'));
    expect(screen.getByText('Subject')).toBeInTheDocument();
    expect(screen.getByText('Medium')).toBeInTheDocument();
  });

  it('shows the count when there are active filters for a definition', async () => {
    listTagDefinitionsMock.mockResolvedValue({
      definitions: [
        { definition_id: 'd1', tag_key: 'subject', display_name: 'Subject' },
      ],
    });
    renderFilter({
      filters: [
        { key: 'subject', value: 'flora', displayName: 'Subject' },
        { key: 'subject', value: 'fauna', displayName: 'Subject' },
      ],
    });
    await waitFor(() => screen.getByText(/Subject: 2/));
    expect(screen.getByText('Subject: 2')).toBeInTheDocument();
  });

  it('renders a Clear all button only when there are active filters', async () => {
    listTagDefinitionsMock.mockResolvedValue({
      definitions: [{ definition_id: 'd1', tag_key: 'subject', display_name: 'Subject' }],
    });
    const { rerender } = renderFilter();
    await waitFor(() => screen.getByText('Subject'));
    expect(screen.queryByText('Clear all')).not.toBeInTheDocument();

    const onChange = vi.fn();
    rerender(
      <QueryClientProvider client={createClient()}>
        <MediaTagFilter
          organizationId="org-1"
          filters={[{ key: 'subject', value: 'flora', displayName: 'Subject' }]}
          onChange={onChange}
        />
      </QueryClientProvider>,
    );
    await waitFor(() => screen.getByText('Clear all'));
    fireEvent.click(screen.getByText('Clear all'));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});

describe('formatTagFiltersForQuery', () => {
  it('returns an empty array for no filters', () => {
    expect(formatTagFiltersForQuery([])).toEqual([]);
  });

  it('combines key and value with a colon', () => {
    expect(
      formatTagFiltersForQuery([
        { key: 'subject', value: 'flora', displayName: 'Subject' },
        { key: 'medium', value: 'oil', displayName: 'Medium' },
      ]),
    ).toEqual(['subject:flora', 'medium:oil']);
  });
});
