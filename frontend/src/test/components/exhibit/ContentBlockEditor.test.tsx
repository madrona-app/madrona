import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ContentBlockEditor } from '../../../components/exhibit/ContentBlockEditor';
import type { ExhibitionContentBlock } from '../../../lib/api';

const createMock = vi.fn();
const updateMock = vi.fn();

vi.mock('../../../lib/api', () => ({
  createExhibitionContentBlock: (...args: unknown[]) => createMock(...args),
  updateExhibitionContentBlock: (...args: unknown[]) => updateMock(...args),
}));

// Render SlideOver inline so we can assert against the DOM
vi.mock('../../../components/ui/SlideOver', () => ({
  default: ({
    isOpen,
    children,
    footer,
    title,
  }: {
    isOpen: boolean;
    children: React.ReactNode;
    footer?: React.ReactNode;
    title: string;
  }) =>
    isOpen ? (
      <div data-testid="slide-over">
        <h2>{title}</h2>
        <div>{children}</div>
        <div data-testid="footer">{footer}</div>
      </div>
    ) : null,
}));

function renderEditor(
  overrides: Partial<Parameters<typeof ContentBlockEditor>[0]> = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const props = {
    isOpen: true,
    organizationId: 'org-1',
    exhibitionId: 'exh-1',
    block: null,
    onClose: vi.fn(),
    onSuccess: vi.fn(),
    ...overrides,
  };
  return {
    props,
    ...render(
      <QueryClientProvider client={queryClient}>
        <ContentBlockEditor {...props} />
      </QueryClientProvider>,
    ),
  };
}

describe('ContentBlockEditor', () => {
  beforeEach(() => {
    createMock.mockReset();
    updateMock.mockReset();
  });

  it('renders "Add Content Block" in create mode', () => {
    renderEditor();
    expect(screen.getByText('Add Content Block')).toBeInTheDocument();
  });

  it('renders "Edit Content Block" in edit mode with existing values', () => {
    const block: ExhibitionContentBlock = {
      block_id: 'b-1',
      block_type: 'quote',
      display_order: 1,
      title: 'Curator Voice',
      content: 'Original content',
      content_format: 'markdown',
      status: 'review',
      is_public: true,
    };
    renderEditor({ block });
    expect(screen.getByText('Edit Content Block')).toBeInTheDocument();
    // Textarea is seeded with existing content
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Original content');
  });

  it('shows validation error when submitting without content', () => {
    renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Add Block' }));
    expect(screen.getByText('Content is required')).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
  });



  it('calls onClose when Cancel clicked', () => {
    const { props } = renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('markdown format shows a tip line', () => {
    renderEditor();
    expect(screen.getByText(/Supports Markdown/i)).toBeInTheDocument();
  });

  it('hides markdown tip when switching to plain format', () => {
    renderEditor();
    // The content format dropdown is the second <select> (after block type)
    const selects = document.querySelectorAll('select');
    // block type, content format, status — content format is index 1
    fireEvent.change(selects[1], { target: { value: 'plain' } });
    expect(screen.queryByText(/Supports Markdown/i)).not.toBeInTheDocument();
  });
});
