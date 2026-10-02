import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WorkPage from '../../pages/work/WorkPage';
import * as useOrganizationHook from '../../contexts/useOrganization';
import * as workContextModule from '../../contexts/WorkContext';

vi.mock('../../contexts/useOrganization', () => ({
  useOrganization: vi.fn(),
}));

vi.mock('../../contexts/WorkContext', () => ({
  useWork: vi.fn(),
}));

// Mock the heavy work components
vi.mock('../../components/work/MyTasks', () => ({
  MyTasks: ({ variant, limit }: { variant?: string; limit?: number }) => (
    <div data-testid="my-tasks">
      MyTasks variant={variant} limit={limit ?? 'none'}
    </div>
  ),
  TaskCountBadge: () => <span data-testid="task-count-badge">3</span>,
}));

vi.mock('../../components/work/RecentItems', () => ({
  RecentItems: ({ limit }: { limit?: number }) => (
    <div data-testid="recent-items">RecentItems limit={limit}</div>
  ),
}));

vi.mock('../../components/work/QuickActions', () => ({
  QuickActions: ({ variant }: { variant?: string }) => (
    <div data-testid="quick-actions">QuickActions variant={variant}</div>
  ),
}));

vi.mock('../../components/work/ActiveObjectIndicator', () => ({
  ActiveObjectIndicator: () => (
    <div data-testid="active-object-indicator">Active object</div>
  ),
}));

vi.mock('../../components/work/ObjectSearchDialog', () => ({
  ObjectSearchDialog: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="object-search-dialog">Search dialog</div> : null,
}));

const mockUseOrganization = vi.mocked(useOrganizationHook.useOrganization);
const mockUseWork = vi.mocked(workContextModule.useWork);

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderPage(
  pathname = '/organizations/org-123/collections/work',
  routePath = '/organizations/:orgId/collections/work'
) {
  const qc = createQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[pathname]}>
        <Routes>
          <Route path={routePath} element={<WorkPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('WorkPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseOrganization.mockReturnValue({
      activeOrganization: {
        organization_id: 'org-123',
        name: 'Test Org',
        slug: 'test-org',
      },
      activeOrganizationId: 'org-123',
    } as ReturnType<typeof useOrganizationHook.useOrganization>);
    mockUseWork.mockReturnValue({
      hasObjectContext: false,
      activeObject: null,
      setActiveObject: vi.fn(),
      clearActiveObject: vi.fn(),
    } as ReturnType<typeof workContextModule.useWork>);
  });

  describe('overview view', () => {
    it('renders Work heading', () => {
      renderPage();
      expect(
        screen.getByRole('heading', { level: 1, name: 'Work' })
      ).toBeInTheDocument();
    });

    it('renders the My Tasks section heading', () => {
      renderPage();
      expect(
        screen.getByRole('heading', { name: 'My Tasks' })
      ).toBeInTheDocument();
    });

    it('renders Recent Items section', () => {
      renderPage();
      expect(
        screen.getByRole('heading', { name: 'Recent Items' })
      ).toBeInTheDocument();
    });

    it('renders Quick Actions section', () => {
      renderPage();
      expect(
        screen.getByRole('heading', { name: 'Quick Actions' })
      ).toBeInTheDocument();
    });

    it('renders Active Object section', () => {
      renderPage();
      expect(
        screen.getByRole('heading', { name: 'Active Object' })
      ).toBeInTheDocument();
    });

    it('shows "No object selected" when no context', () => {
      renderPage();
      expect(screen.getByText('No object selected')).toBeInTheDocument();
    });

    it('opens search dialog when Search objects clicked', () => {
      renderPage();
      const searchButton = screen.getByRole('button', { name: /search objects/i });
      fireEvent.click(searchButton);
      expect(screen.getByTestId('object-search-dialog')).toBeInTheDocument();
    });
  });

  describe('with active object', () => {
    beforeEach(() => {
      mockUseWork.mockReturnValue({
        hasObjectContext: true,
        activeObject: {
          object_id: 'obj-1',
          accession_number: 'ACC-001',
          title: 'Egyptian Vase',
        },
        setActiveObject: vi.fn(),
        clearActiveObject: vi.fn(),
      } as never);
    });

    it('renders the active object banner', () => {
      renderPage();
      expect(screen.getByText('Working with object')).toBeInTheDocument();
    });

    it('shows accession number and title', () => {
      renderPage();
      expect(screen.getByText('ACC-001 — Egyptian Vase')).toBeInTheDocument();
    });

    it('renders View Object link', () => {
      renderPage();
      const link = screen.getByRole('link', { name: /view object/i });
      expect(link).toHaveAttribute(
        'href',
        '/organizations/org-123/collections/objects/obj-1'
      );
    });
  });

  describe('tasks sub-view', () => {
    it('renders My Tasks heading on /tasks route', () => {
      renderPage(
        '/organizations/org-123/collections/work/tasks',
        '/organizations/:orgId/collections/work/tasks'
      );
      // Page-level h1
      expect(
        screen.getByRole('heading', { level: 1, name: 'My Tasks' })
      ).toBeInTheDocument();
    });

    it('shows breadcrumb on sub-view', () => {
      renderPage(
        '/organizations/org-123/collections/work/tasks',
        '/organizations/:orgId/collections/work/tasks'
      );
      expect(screen.getByRole('link', { name: 'Work' })).toBeInTheDocument();
    });

    it('renders the All Tasks section', () => {
      renderPage(
        '/organizations/org-123/collections/work/tasks',
        '/organizations/:orgId/collections/work/tasks'
      );
      expect(
        screen.getByRole('heading', { name: 'All Tasks' })
      ).toBeInTheDocument();
    });
  });

  describe('recent sub-view', () => {
    it('renders Recent Items page heading', () => {
      renderPage(
        '/organizations/org-123/collections/work/recent',
        '/organizations/:orgId/collections/work/recent'
      );
      expect(
        screen.getByRole('heading', { level: 1, name: 'Recent Items' })
      ).toBeInTheDocument();
    });
  });

  describe('actions sub-view', () => {
    it('renders Quick Actions page heading', () => {
      renderPage(
        '/organizations/org-123/collections/work/actions',
        '/organizations/:orgId/collections/work/actions'
      );
      expect(
        screen.getByRole('heading', { level: 1, name: 'Quick Actions' })
      ).toBeInTheDocument();
    });
  });
});
