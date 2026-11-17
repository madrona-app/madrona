import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { checkA11y, formatViolations } from '../../a11y';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InterpretiveContentTab } from '../../../components/exhibit/InterpretiveContentTab';

const {
  getExhibitionContentBlocksMock,
  deleteExhibitionContentBlockMock,
  reorderExhibitionContentBlocksMock,
} = vi.hoisted(() => ({
  getExhibitionContentBlocksMock: vi.fn(),
  deleteExhibitionContentBlockMock: vi.fn(),
  reorderExhibitionContentBlocksMock: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  getExhibitionContentBlocks: getExhibitionContentBlocksMock,
  deleteExhibitionContentBlock: deleteExhibitionContentBlockMock,
  reorderExhibitionContentBlocks: reorderExhibitionContentBlocksMock,
}));

vi.mock('../../../components/exhibit/ContentBlockEditor', () => ({
  ContentBlockEditor: () => <div data-testid="content-block-editor" />,
}));

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function renderTab(props: Partial<Parameters<typeof InterpretiveContentTab>[0]> = {}) {
  return render(
    <QueryClientProvider client={createClient()}>
      <InterpretiveContentTab organizationId="org-1" exhibitionId="ex-1" {...props} />
    </QueryClientProvider>,
  );
}

describe('InterpretiveContentTab', () => {
  beforeEach(() => {
    getExhibitionContentBlocksMock.mockReset();
    deleteExhibitionContentBlockMock.mockReset();
    reorderExhibitionContentBlocksMock.mockReset();
  });

  it('shows loading state initially', () => {
    getExhibitionContentBlocksMock.mockImplementation(() => new Promise(() => {}));
    renderTab();
    expect(screen.getByText('Loading content...')).toBeInTheDocument();
  });

  it('renders the section header and description', async () => {
    getExhibitionContentBlocksMock.mockResolvedValue({ content_blocks: [] });
    renderTab();
    await waitFor(() => screen.getByText('Interpretive Content'));
    expect(screen.getByText('Interpretive Content')).toBeInTheDocument();
    expect(screen.getByText(/Wall text, narratives/i)).toBeInTheDocument();
  });

  it('renders empty state when no content blocks exist', async () => {
    getExhibitionContentBlocksMock.mockResolvedValue({ content_blocks: [] });
    renderTab();
    await waitFor(() => screen.getByText(/No interpretive content yet/i));
    expect(screen.getByText(/No interpretive content yet/i)).toBeInTheDocument();
  });

  it('shows Add Content button when isEditing', async () => {
    getExhibitionContentBlocksMock.mockResolvedValue({ content_blocks: [] });
    renderTab({ isEditing: true });
    await waitFor(() => screen.getByText('Add Content'));
    expect(screen.getByText('Add Content')).toBeInTheDocument();
  });

  it('hides Add Content button when not editing', async () => {
    getExhibitionContentBlocksMock.mockResolvedValue({ content_blocks: [] });
    renderTab({ isEditing: false });
    await waitFor(() => screen.getByText(/No interpretive content/i));
    expect(screen.queryByText('Add Content')).toBeNull();
  });

  it('renders content blocks when data is present', async () => {
    getExhibitionContentBlocksMock.mockResolvedValue({
      content_blocks: [
        {
          block_id: 'b-1',
          block_type: 'intro_text',
          title: 'Welcome',
          content: '<p>Hello</p>',
          section: 'Intro',
          status: 'draft',
          sort_order: 1,
        },
      ],
    });
    renderTab();
    await waitFor(() => screen.getByText('Welcome'));
    expect(screen.getByText('Welcome')).toBeInTheDocument();
  });

  it('groups content blocks by section', async () => {
    getExhibitionContentBlocksMock.mockResolvedValue({
      content_blocks: [
        {
          block_id: 'b-1',
          block_type: 'intro_text',
          title: 'A',
          content: '<p/>',
          section: 'Section One',
          status: 'draft',
          sort_order: 1,
        },
        {
          block_id: 'b-2',
          block_type: 'quote',
          title: 'B',
          content: '<p/>',
          section: 'Section Two',
          status: 'published',
          sort_order: 2,
        },
      ],
    });
    renderTab();
    await waitFor(() => screen.getByText('Section One'));
    expect(screen.getByText('Section One')).toBeInTheDocument();
    expect(screen.getByText('Section Two')).toBeInTheDocument();
  });

  it('groups blocks without section under "Unsorted"', async () => {
    getExhibitionContentBlocksMock.mockResolvedValue({
      content_blocks: [
        {
          block_id: 'b-1',
          block_type: 'intro_text',
          title: 'No Section',
          content: '<p/>',
          status: 'draft',
          sort_order: 1,
        },
      ],
    });
    renderTab();
    await waitFor(() => screen.getByText('Unsorted'));
    expect(screen.getByText('Unsorted')).toBeInTheDocument();
  });

  describe('accessibility and keyboard reordering', () => {
    const blocks = [
      { block_id: 'b-1', block_type: 'intro_text', title: 'Welcome', content: 'Hello', section: 'Intro', status: 'draft', sort_order: 1, is_public: true },
      { block_id: 'b-2', block_type: 'intro_text', title: 'Second', content: 'More', section: 'Intro', status: 'draft', sort_order: 2, is_public: false },
    ];

    it('has no axe violations in editing mode', async () => {
      getExhibitionContentBlocksMock.mockResolvedValue({ content_blocks: blocks });
      const { container } = renderTab({ isEditing: true });
      await waitFor(() => screen.getByText('Welcome'));
      const results = await checkA11y(container);
      expect(results.violations, formatViolations(results)).toEqual([]);
      expect(screen.getByRole('list', { name: 'Intro content blocks' })).toBeInTheDocument();
    });

    it('offers move up/down buttons as a non-drag alternative', async () => {
      getExhibitionContentBlocksMock.mockResolvedValue({ content_blocks: blocks });
      reorderExhibitionContentBlocksMock.mockResolvedValue({});
      renderTab({ isEditing: true });
      await waitFor(() => screen.getByText('Welcome'));
      expect(screen.getByRole('button', { name: 'Move Welcome up' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Move Second down' })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: 'Move Welcome down' }));
      await waitFor(() =>
        expect(reorderExhibitionContentBlocksMock).toHaveBeenCalledWith('org-1', 'ex-1', ['b-2', 'b-1']),
      );
      expect(screen.getByRole('status')).toHaveTextContent('Welcome moved down, position 2 of 2 in Intro');
    });
  });
});
