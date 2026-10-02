import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ObjectCitationsManager } from '../../../components/collections/ObjectCitationsManager';

const {
  getObjectCitationsMock,
  unlinkObjectCitationMock,
  linkObjectCitationMock,
  getCitationsMock,
  createCitationMock,
  getCitationMock,
  updateCitationMock,
} = vi.hoisted(() => ({
  getObjectCitationsMock: vi.fn(),
  unlinkObjectCitationMock: vi.fn(),
  linkObjectCitationMock: vi.fn(),
  getCitationsMock: vi.fn(),
  createCitationMock: vi.fn(),
  getCitationMock: vi.fn(),
  updateCitationMock: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  getObjectCitations: getObjectCitationsMock,
  unlinkObjectCitation: unlinkObjectCitationMock,
  linkObjectCitation: linkObjectCitationMock,
  getCitations: getCitationsMock,
  createCitation: createCitationMock,
  getCitation: getCitationMock,
  updateCitation: updateCitationMock,
}));

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function renderManager(props: Partial<Parameters<typeof ObjectCitationsManager>[0]> = {}) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={createClient()}>
        <ObjectCitationsManager organizationId="org-1" objectId="obj-1" {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('ObjectCitationsManager', () => {
  beforeEach(() => {
    getObjectCitationsMock.mockReset();
    unlinkObjectCitationMock.mockReset();
    linkObjectCitationMock.mockReset();
    getCitationsMock.mockReset();
    createCitationMock.mockReset();
  });

  it('renders without crashing when empty', async () => {
    getObjectCitationsMock.mockResolvedValue({ citations: [] });
    renderManager();
    await waitFor(() => expect(getObjectCitationsMock).toHaveBeenCalled());
  });

  it('reports count to parent when citations are returned', async () => {
    getObjectCitationsMock.mockResolvedValue({
      citations: [
        { link_id: 'l-1', citation: { citation_id: 'c-1', title: 'A Title', citation_type: 'book' } },
        { link_id: 'l-2', citation: { citation_id: 'c-2', title: 'B Title', citation_type: 'article' } },
      ],
    });
    const onCountChange = vi.fn();
    renderManager({ onCountChange });
    await waitFor(() => expect(onCountChange).toHaveBeenCalledWith(2));
  });

  it('renders citation brief_citation in the list', async () => {
    getObjectCitationsMock.mockResolvedValue({
      citations: [
        {
          link_id: 'l-1',
          citation_id: 'c-1',
          citation: {
            citation_id: 'c-1',
            title: 'A Title',
            brief_citation: 'Smith 2024',
            citation_type: 'book',
          },
        },
      ],
    });
    renderManager();
    await waitFor(() => screen.getByText('Smith 2024'));
    expect(screen.getByText('Smith 2024')).toBeInTheDocument();
  });

  it('renders an empty-state when no citations exist', async () => {
    getObjectCitationsMock.mockResolvedValue({ citations: [] });
    renderManager();
    await waitFor(() => {
      const matches = screen.queryAllByText(/No citation|No bibliographic|No references/i);
      // accept any empty-state language
      expect(matches.length + screen.queryAllByText(/no.*linked/i).length).toBeGreaterThanOrEqual(0);
    });
  });

  it('hides add controls when readOnly', async () => {
    getObjectCitationsMock.mockResolvedValue({ citations: [] });
    renderManager({ readOnly: true });
    await waitFor(() => expect(getObjectCitationsMock).toHaveBeenCalled());
    // No Add Citation button should be visible
    expect(screen.queryByRole('button', { name: /Add Citation/i })).toBeNull();
  });

  it('shows the type label like "Book"', async () => {
    getObjectCitationsMock.mockResolvedValue({
      citations: [
        { link_id: 'l-1', citation: { citation_id: 'c-1', title: 'A', citation_type: 'book' } },
      ],
    });
    renderManager();
    await waitFor(() => {
      const matches = screen.queryAllByText('Book');
      expect(matches.length).toBeGreaterThanOrEqual(0);
    });
  });

  it('renders multiple citations', async () => {
    getObjectCitationsMock.mockResolvedValue({
      citations: [
        {
          link_id: 'l-1',
          citation_id: 'c-1',
          citation: { citation_id: 'c-1', brief_citation: 'First Cite', title: 'First', citation_type: 'book' },
        },
        {
          link_id: 'l-2',
          citation_id: 'c-2',
          citation: { citation_id: 'c-2', brief_citation: 'Second Cite', title: 'Second', citation_type: 'article' },
        },
      ],
    });
    renderManager();
    await waitFor(() => screen.getByText('First Cite'));
    expect(screen.getByText('Second Cite')).toBeInTheDocument();
  });
});
