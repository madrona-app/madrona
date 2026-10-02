import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { MediaLibraryLinker, OBJECT_USAGE_TYPES } from '../../../components/collections/MediaLibraryLinker';

const { searchMediaMock } = vi.hoisted(() => ({
  searchMediaMock: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  searchMedia: searchMediaMock,
}));

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function renderLinker(props: Partial<Parameters<typeof MediaLibraryLinker>[0]> = {}) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={createClient()}>
        <MediaLibraryLinker
          organizationId="org-1"
          linkedMedia={[]}
          isEditing={true}
          onLink={vi.fn()}
          onUnlink={vi.fn()}
          onUpdateLink={vi.fn()}
          {...props}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('MediaLibraryLinker', () => {
  beforeEach(() => {
    searchMediaMock.mockReset();
  });

  it('exports OBJECT_USAGE_TYPES with expected categories', () => {
    expect(OBJECT_USAGE_TYPES.find((u) => u.value === 'main')?.label).toBe('Main Image');
    expect(OBJECT_USAGE_TYPES.find((u) => u.value === 'detail')?.label).toBe('Detail');
  });

  it('renders the title with linked count', () => {
    renderLinker();
    expect(screen.getByText('Linked Media (0)')).toBeInTheDocument();
  });

  it('uses a custom title when provided', () => {
    renderLinker({ title: 'Documentation Photos' });
    expect(screen.getByText('Documentation Photos (0)')).toBeInTheDocument();
  });

  it('renders the empty state', () => {
    renderLinker();
    expect(screen.getByText(/No media linked/)).toBeInTheDocument();
  });

  it('shows the Link Media button when isEditing and hasMediaApp', () => {
    renderLinker({ isEditing: true, hasMediaApp: true });
    expect(screen.getByText('Link Media')).toBeInTheDocument();
  });

  it('hides the Link Media button when hasMediaApp=false', () => {
    renderLinker({ isEditing: true, hasMediaApp: false });
    expect(screen.queryByText('Link Media')).toBeNull();
  });

  it('renders linked media when provided', async () => {
    renderLinker({
      linkedMedia: [
        {
          link_id: 'l-1',
          media_id: 'm-1',
          is_primary: true,
          media: {
            media_id: 'm-1',
            filename: 'photo.jpg',
            title: 'Cool Photo',
            media_type: 'image',
            thumbnail_url: '/thumb.jpg',
          } as never,
        },
      ],
    });
    await waitFor(() => {
      const matches = screen.queryAllByText(/Cool Photo|photo\.jpg/);
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  it('respects readOnly via isEditing=false (no Link Media button)', () => {
    renderLinker({ isEditing: false });
    expect(screen.queryByText('Link Media')).toBeNull();
  });

  it('shows count of linked media in the title', () => {
    renderLinker({
      linkedMedia: [
        { link_id: 'l-1', media_id: 'm-1', media: { media_id: 'm-1', filename: 'a.jpg' } as never },
        { link_id: 'l-2', media_id: 'm-2', media: { media_id: 'm-2', filename: 'b.jpg' } as never },
      ],
    });
    expect(screen.getByText('Linked Media (2)')).toBeInTheDocument();
  });
});
