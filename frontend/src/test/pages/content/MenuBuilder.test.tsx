import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MenuBuilder } from '../../../pages/content/components/MenuBuilder';
import * as contentApi from '../../../lib/api/content';
import * as api from '../../../lib/api';
import { checkA11y, formatViolations } from '../../a11y';

vi.mock('../../../lib/api/content', () => ({
  getMenu: vi.fn(),
  saveMenu: vi.fn(),
  getPageTree: vi.fn(),
  listCategories: vi.fn(),
}));

vi.mock('../../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/api')>();
  return { ...actual, getRecordAuditHistory: vi.fn() };
});

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

  describe('accessibility', () => {
    const twoItems = {
      data: {
        items: [
          { menu_item_id: 'mi-1', label: 'About', link_type: 'url', url: '/about', highlight: false },
          { menu_item_id: 'mi-2', label: 'Visit', link_type: 'url', url: '/visit', highlight: true },
        ],
      },
    } as never;

    it('has no axe violations with items rendered', async () => {
      mockGetMenu.mockResolvedValue(twoItems);
      const { container } = renderBuilder();
      await waitFor(() => screen.getByDisplayValue('Visit'));
      const results = await checkA11y(container);
      expect(results.violations, formatViolations(results)).toEqual([]);
    });

    it('reorders top-level items with move buttons (no drag needed)', async () => {
      mockGetMenu.mockResolvedValue(twoItems);
      renderBuilder();
      await waitFor(() => screen.getByDisplayValue('Visit'));
      expect(screen.getByRole('button', { name: 'Move About up' })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: 'Move About down' }));
      const labels = screen.getAllByRole('textbox', { name: 'Menu label' }).map(
        (el) => (el as HTMLInputElement).value,
      );
      expect(labels).toEqual(['Visit', 'About']);
      expect(screen.getByRole('button', { name: /Save Menu/i })).toBeEnabled();
    });
  });
});

describe('MenuBuilder change history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTree.mockResolvedValue({ data: [] } as never);
    mockListCats.mockResolvedValue({ data: [] } as never);
  });

  it('shows the saved menu history, including menu item changes', async () => {
    mockGetMenu.mockResolvedValue({ data: { menu_id: 'menu-1', location: 'header', name: 'Main', items: [] } } as never);
    vi.mocked(api.getRecordAuditHistory).mockResolvedValue({
      entity_type: 'menu', entity_id: 'menu-1', total: 1, limit: 20, offset: 0,
      items: [{
        event_id: 'e1', change_type: 'link_updated', changed_at: '2026-11-14T10:00:00+00:00',
        changed_by: 'u1', changed_by_name: 'Pat Registrar', changed_by_email: 'pat@example.org',
        changed_fields: ['url'], summary: 'Updated menu item: Hours', request_method: 'PUT',
        child_entity_type: 'menu_item', child_entity_id: 'mi-1', child_display_key: 'Hours',
        field_diffs: [{ field_name: 'url', old_value: '/visit/hours', new_value: '/visit/opening-hours' }],
      }],
    } as Awaited<ReturnType<typeof api.getRecordAuditHistory>>);
    const { container } = renderBuilder();
    expect(await screen.findByText(/Changed menu item Hours/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'Header menu change history' })).toBeInTheDocument();
    expect(api.getRecordAuditHistory).toHaveBeenCalledWith('org-1', 'menu', 'menu-1', expect.anything());
    const results = await checkA11y(container);
    expect(results.violations, formatViolations(results)).toEqual([]);
  });

  it('shows no history panel before the menu is first saved', async () => {
    mockGetMenu.mockResolvedValue({ data: { items: [] } } as never);
    renderBuilder();
    await screen.findByText(/No header menu items yet/);
    expect(screen.queryByRole('heading', { name: /menu change history/i })).not.toBeInTheDocument();
  });
});
