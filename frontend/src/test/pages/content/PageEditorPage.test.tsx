import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PageEditorPage from '../../../pages/content/PageEditorPage';
import * as contentApi from '../../../lib/api/content';
import * as useAuthHook from '../../../hooks/useAuth';

vi.mock('../../../lib/api/content', () => ({
  getPage: vi.fn(),
  createPage: vi.fn(),
  updatePage: vi.fn(),
  saveBlocks: vi.fn(),
  publishPage: vi.fn(),
  unpublishPage: vi.fn(),
  deletePage: vi.fn(),
  listPages: vi.fn(),
  listCategories: vi.fn(),
  getPreviewToken: vi.fn(),
}));

vi.mock('../../../hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../../pages/content/components/BlockEditor', () => ({
  default: () => <div data-testid="block-editor" />,
}));

vi.mock('../../../components/content/MediaPickerModal', () => ({
  MediaPickerModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div role="dialog">picker</div> : null,
}));

const mockCreatePage = vi.mocked(contentApi.createPage);
const mockGetPage = vi.mocked(contentApi.getPage);
const mockUpdatePage = vi.mocked(contentApi.updatePage);
const mockSaveBlocks = vi.mocked(contentApi.saveBlocks);
const mockPublishPage = vi.mocked(contentApi.publishPage);
const mockListPages = vi.mocked(contentApi.listPages);
const mockListCategories = vi.mocked(contentApi.listCategories);
const mockUseAuth = vi.mocked(useAuthHook.useAuth);

function setupAuth() {
  mockUseAuth.mockReturnValue({
    memberships: [{ organization_id: 'org-1', slug: 'my-org', name: 'Test Org' }],
    user: null,
    applications: [],
    isLoading: false,
  } as unknown as ReturnType<typeof useAuthHook.useAuth>);
}

function renderEditor(initialEntry: string, routePath: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path={routePath} element={<PageEditorPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PageEditorPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth();
    mockListPages.mockResolvedValue({ items: [], total: 0 } as never);
    mockListCategories.mockResolvedValue({ data: [] } as never);
  });

  describe('create mode', () => {
    it('renders New Page heading and disabled Save button', () => {
      renderEditor(
        '/organizations/org-1/content/pages/create',
        '/organizations/:orgId/content/pages/create',
      );
      expect(screen.getByRole('heading', { name: /New Page/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Save Draft/i })).toBeDisabled();
    });

    it('auto-generates slug from title', () => {
      renderEditor(
        '/organizations/org-1/content/pages/create',
        '/organizations/:orgId/content/pages/create',
      );

      fireEvent.change(screen.getByLabelText('Title'), {
        target: { value: 'My First Page' },
      });

      expect((screen.getByLabelText('Slug') as HTMLInputElement).value).toBe(
        'my-first-page',
      );
    });

    it('enables Save Draft once title is set, and calls createPage', async () => {
      mockCreatePage.mockResolvedValue({
        items: { page_id: 'p-new', slug: 'foo', title: 'foo' },
      } as never);

      renderEditor(
        '/organizations/org-1/content/pages/create',
        '/organizations/:orgId/content/pages/create',
      );

      fireEvent.change(screen.getByLabelText('Title'), {
        target: { value: 'About' },
      });

      const save = screen.getByRole('button', { name: /Save Draft/i });
      expect(save).not.toBeDisabled();
      fireEvent.click(save);

      await waitFor(() => {
        expect(mockCreatePage).toHaveBeenCalledWith(
          'org-1',
          expect.objectContaining({
            title: 'About',
            slug: 'about',
            page_type: 'page',
            template: 'default',
          }),
        );
      });
    });

    it('detects post type from URL path and shows Post heading', () => {
      renderEditor(
        '/organizations/org-1/content/posts/create',
        '/organizations/:orgId/content/posts/create',
      );
      expect(screen.getByRole('heading', { name: /New Post/i })).toBeInTheDocument();
    });
  });

  describe('edit mode', () => {
    beforeEach(() => {
      mockGetPage.mockResolvedValue({
        data: {
          page_id: 'p-1',
          title: 'Visit Us',
          slug: 'visit-us',
          page_type: 'page',
          template: 'default',
          status: 'draft',
          excerpt: 'Plan your visit',
          meta_title: '',
          meta_description: '',
          parent_page_id: null,
          featured_image_media_id: null,
          og_image_media_id: null,
          publish_at: null,
          categories: [],
          blocks: [],
        },
      } as never);
    });

    it('shows loading state, then populates form', async () => {
      renderEditor(
        '/organizations/org-1/content/pages/p-1',
        '/organizations/:orgId/content/pages/:pageId',
      );

      await waitFor(() => {
        expect(
          (screen.getByLabelText('Title') as HTMLInputElement).value,
        ).toBe('Visit Us');
      });
      expect((screen.getByLabelText('Slug') as HTMLInputElement).value).toBe('visit-us');
      expect(screen.getByText('draft')).toBeInTheDocument();
    });

    it('calls update + saveBlocks in parallel on Save Draft', async () => {
      mockUpdatePage.mockResolvedValue({ data: {} } as never);
      mockSaveBlocks.mockResolvedValue({ data: [] } as never);

      renderEditor(
        '/organizations/org-1/content/pages/p-1',
        '/organizations/:orgId/content/pages/:pageId',
      );

      await waitFor(() => {
        expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe(
          'Visit Us',
        );
      });

      fireEvent.change(screen.getByLabelText('Title'), {
        target: { value: 'Visit Us Today' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Save Draft/i }));

      await waitFor(() => {
        expect(mockUpdatePage).toHaveBeenCalled();
      });
      expect(mockSaveBlocks).toHaveBeenCalled();
    });

    it('publishes after save when Publish is clicked', async () => {
      mockUpdatePage.mockResolvedValue({ data: {} } as never);
      mockSaveBlocks.mockResolvedValue({ data: [] } as never);
      mockPublishPage.mockResolvedValue({ data: {} } as never);

      renderEditor(
        '/organizations/org-1/content/pages/p-1',
        '/organizations/:orgId/content/pages/:pageId',
      );

      await waitFor(() => {
        expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe(
          'Visit Us',
        );
      });

      fireEvent.click(screen.getByRole('button', { name: /^Publish$/ }));

      await waitFor(() => {
        expect(mockPublishPage).toHaveBeenCalledWith('org-1', 'p-1');
      });
    });
  });
});
