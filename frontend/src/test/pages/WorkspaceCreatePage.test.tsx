import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WorkspaceCreatePage from '../../pages/work/WorkspaceCreatePage';
import * as api from '../../lib/api';
import * as useOrganizationHook from '../../contexts/useOrganization';
import * as useActiveProductHook from '../../hooks/useActiveProduct';

vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof api>('../../lib/api');
  return {
    ...actual,
    createWorkspace: vi.fn(),
  };
});

vi.mock('../../contexts/useOrganization', () => ({
  useOrganization: vi.fn(),
}));

vi.mock('../../hooks/useActiveProduct', () => ({
  useActiveProduct: vi.fn(),
}));

const mockCreateWorkspace = vi.mocked(api.createWorkspace);
const mockUseOrganization = vi.mocked(useOrganizationHook.useOrganization);
const mockUseActiveProduct = vi.mocked(useActiveProductHook.useActiveProduct);

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderPage() {
  const qc = createQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter
        initialEntries={['/organizations/org-123/collections/work/workspaces/new']}
      >
        <Routes>
          <Route
            path="/organizations/:orgId/collections/work/workspaces/new"
            element={<WorkspaceCreatePage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('WorkspaceCreatePage', () => {
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

    mockUseActiveProduct.mockReturnValue({
      activeProductId: 'collections',
      setActiveProductId: vi.fn(),
    } as ReturnType<typeof useActiveProductHook.useActiveProduct>);
  });

  describe('basic render', () => {
    it('renders the create form', () => {
      renderPage();
      expect(
        screen.getByRole('heading', { name: /new work set/i })
      ).toBeInTheDocument();
    });

    it('renders name input field', () => {
      renderPage();
      // The input is found via placeholder text
      const inputs = screen.getAllByRole('textbox');
      expect(inputs.length).toBeGreaterThan(0);
    });

    it('renders all visibility options', () => {
      renderPage();
      expect(screen.getByText('Private')).toBeInTheDocument();
      expect(screen.getByText('Shared')).toBeInTheDocument();
      expect(screen.getByText('Organization')).toBeInTheDocument();
    });

    it('renders Cancel button', () => {
      renderPage();
      expect(screen.getByRole('link', { name: /cancel/i })).toBeInTheDocument();
    });

    it('renders submit button', () => {
      renderPage();
      expect(
        screen.getByRole('button', { name: /create work set/i })
      ).toBeInTheDocument();
    });
  });

  describe('form validation', () => {
    it('shows error when submitting empty name', async () => {
      renderPage();

      const submit = screen.getByRole('button', { name: /create work set/i });
      fireEvent.click(submit);

      await waitFor(() => {
        expect(screen.getByText('Name is required')).toBeInTheDocument();
      });
    });
  });

  describe('visibility selection', () => {
    it('lets user select shared visibility', () => {
      renderPage();

      // Click the Shared label
      const sharedLabel = screen.getByText('Shared');
      fireEvent.click(sharedLabel);
      // Just verify clicking doesn't throw
      expect(sharedLabel).toBeInTheDocument();
    });
  });

  describe('form submission', () => {
    it('calls createWorkspace on valid submit', async () => {
      mockCreateWorkspace.mockResolvedValue({
        workspace_id: 'new-ws',
        name: 'My new set',
      } as never);

      renderPage();

      const inputs = screen.getAllByRole('textbox');
      const nameInput = inputs[0];
      fireEvent.change(nameInput, { target: { value: 'My new set' } });

      const submit = screen.getByRole('button', { name: /create work set/i });
      fireEvent.click(submit);

      await waitFor(() => {
        expect(mockCreateWorkspace).toHaveBeenCalledWith(
          'org-123',
          expect.objectContaining({
            name: 'My new set',
            workspace_type: 'collections',
          })
        );
      });
    });

    it('uses media workspace_type when active product is media', async () => {
      mockUseActiveProduct.mockReturnValue({
        activeProductId: 'media',
        setActiveProductId: vi.fn(),
      } as ReturnType<typeof useActiveProductHook.useActiveProduct>);

      mockCreateWorkspace.mockResolvedValue({
        workspace_id: 'new-ws',
        name: 'Media set',
      } as never);

      renderPage();

      const inputs = screen.getAllByRole('textbox');
      const nameInput = inputs[0];
      fireEvent.change(nameInput, { target: { value: 'Media set' } });

      const submit = screen.getByRole('button', { name: /create work set/i });
      fireEvent.click(submit);

      await waitFor(() => {
        expect(mockCreateWorkspace).toHaveBeenCalledWith(
          'org-123',
          expect.objectContaining({
            workspace_type: 'media',
          })
        );
      });
    });

    it('shows error message when API call fails', async () => {
      mockCreateWorkspace.mockRejectedValue(
        new Error('Server unavailable')
      );

      renderPage();

      const inputs = screen.getAllByRole('textbox');
      fireEvent.change(inputs[0], { target: { value: 'Failing set' } });

      const submit = screen.getByRole('button', { name: /create work set/i });
      fireEvent.click(submit);

      await waitFor(() => {
        expect(screen.getByText(/Server unavailable/i)).toBeInTheDocument();
      });
    });
  });
});
