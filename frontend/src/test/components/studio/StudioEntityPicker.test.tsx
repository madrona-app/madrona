import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StudioEntityPicker } from '../../../components/studio/StudioEntityPicker';
import * as collectionsApi from '../../../lib/api/collections';
import * as mediaApi from '../../../lib/api/media';

vi.mock('../../../lib/api/collections');
vi.mock('../../../lib/api/media');
const autocompleteCollections = vi.mocked(collectionsApi.autocompleteCollections);
const searchMedia = vi.mocked(mediaApi.searchMedia);

function renderPicker(props: Partial<Parameters<typeof StudioEntityPicker>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <StudioEntityPicker
        orgId="org-1"
        entityKind="object"
        value={undefined}
        onChange={onChange}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onChange };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('StudioEntityPicker', () => {
  it('searches objects after ≥2 chars and emits the picked id', async () => {
    autocompleteCollections.mockResolvedValue({
      suggestions: [{ value: 'Bronze Vase', object_id: 'obj-7', object_number: '2026.7' }],
    });
    const { onChange } = renderPicker({ entityKind: 'object' });

    fireEvent.change(screen.getByPlaceholderText(/search objects/i), { target: { value: 'vase' } });

    const opt = await screen.findByRole('button', { name: /Bronze Vase/i });
    fireEvent.click(opt);
    expect(onChange).toHaveBeenCalledWith('obj-7', 'Bronze Vase');
  });

  it('searches media when entityKind is media', async () => {
    searchMedia.mockResolvedValue({
      hits: [{ media_id: 'm-3', filename: 'portrait.jpg', title: 'Portrait' }],
      total: 1,
    } as never);
    renderPicker({ entityKind: 'media' });

    fireEvent.change(screen.getByPlaceholderText(/search media/i), { target: { value: 'por' } });
    await waitFor(() => expect(searchMedia).toHaveBeenCalledWith('org-1', expect.objectContaining({ q: 'por' })));
    expect(await screen.findByRole('button', { name: /Portrait/i })).toBeInTheDocument();
  });

  it('shows the selection chip after picking, and clearing returns to search', async () => {
    autocompleteCollections.mockResolvedValue({
      suggestions: [{ value: 'Bronze Vase', object_id: 'obj-7', object_number: '2026.7' }],
    });
    function Host() {
      const [value, setValue] = useState<string | undefined>(undefined);
      return (
        <StudioEntityPicker orgId="org-1" entityKind="object" value={value}
          onChange={(id) => setValue(id)} />
      );
    }
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Host />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByPlaceholderText(/search objects/i), { target: { value: 'vase' } });
    fireEvent.click(await screen.findByRole('button', { name: /Bronze Vase/i }));

    // The chip shows the picked label; the search field is gone.
    expect(screen.getByText('Bronze Vase')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/search objects/i)).not.toBeInTheDocument();

    // Clearing returns to the search field.
    fireEvent.click(screen.getByRole('button', { name: /clear selection/i }));
    expect(screen.getByPlaceholderText(/search objects/i)).toBeInTheDocument();
  });
});
