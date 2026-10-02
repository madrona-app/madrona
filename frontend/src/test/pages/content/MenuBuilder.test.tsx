import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MenuBuilder } from '../../../pages/content/components/MenuBuilder';
import * as contentApi from '../../../lib/api/content';

vi.mock('../../../lib/api/content', () => ({
  getMenu: vi.fn(),
  saveMenu: vi.fn(),
  getPageTree: vi.fn(),
  listCategories: vi.fn(),
}));

vi.mock('../../../components/content/MediaPickerModal', () => ({
  MediaPickerModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div role="dialog">picker</div> : null,
}));

const mockGetMenu = vi.mocked(contentApi.getMenu);
const mockSaveMenu = vi.mocked(contentApi.saveMenu);
const mockGetTree = vi.mocked(contentApi.getPageTree);
const mockListCats = vi.mocked(contentApi.listCategories);

function renderBuilder(orgId = 'org-1') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/content/settings`]}>
        <Routes>
          <Route
            path="/organizations/:orgId/content/settings"
            element={<MenuBuilder location="header" orgSlug="my-museum" />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MenuBuilder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTree.mockResolvedValue({ data: [] } as never);
    mockListCats.mockResolvedValue({ data: [] } as never);
  });

  it('shows empty state when menu has no items', async () => {
    mockGetMenu.mockResolvedValue({ data: { items: [] } } as never);
    renderBuilder();
    await waitFor(() => {
      expect(screen.getByText(/No header menu items yet/)).toBeInTheDocument();
    });
  });

  it('adds a menu item on Add Item click', async () => {
    mockGetMenu.mockResolvedValue({ data: { items: [] } } as never);
    renderBuilder();
    await waitFor(() => {
      expect(screen.getByText(/No header menu items yet/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Add Item/i }));
    expect(screen.getByPlaceholderText('Menu label')).toBeInTheDocument();
  });

  it('renders existing items from server', async () => {
    mockGetMenu.mockResolvedValue({
      data: {
        items: [
          {
            menu_item_id: 'mi-1',
            label: 'About',
            link_type: 'url',
            url: 'https://example.com',
            highlight: false,
          },
        ],
      },
    } as never);
    renderBuilder();
    await waitFor(() => {
      expect(
        (screen.getByPlaceholderText('Menu label') as HTMLInputElement).value,
      ).toBe('About');
    });
  });

  it('disables Save Menu button when nothing has changed', async () => {
    mockGetMenu.mockResolvedValue({ data: { items: [] } } as never);
    renderBuilder();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Save Menu/i })).toBeDisabled();
    });
  });

  it('calls saveMenu when Save Menu is clicked after editing', async () => {
    mockGetMenu.mockResolvedValue({ data: { items: [] } } as never);
    mockSaveMenu.mockResolvedValue({ data: {} } as never);
    renderBuilder();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add Item/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Add Item/i }));

    const saveBtn = screen.getByRole('button', { name: /Save Menu/i });
    expect(saveBtn).not.toBeDisabled();
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockSaveMenu).toHaveBeenCalled();
    });
  });
});
