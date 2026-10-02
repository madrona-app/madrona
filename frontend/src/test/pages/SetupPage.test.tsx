import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import SetupPage from '../../pages/bridge/SetupPage';
import * as useOrganizationModule from '../../contexts/useOrganization';

// Mock the organization hook
vi.mock('../../contexts/useOrganization', () => ({
  useOrganization: vi.fn(),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockUseOrganization = vi.mocked(useOrganizationModule.useOrganization);

function renderSetupPage(path = '/organizations/org-123/bridge/setup') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/organizations/:orgId/bridge/setup/*" element={<SetupPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('SetupPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseOrganization.mockReturnValue({
      activeOrganizationId: 'org-123',
      activeOrganization: null,
      setActiveOrganizationId: vi.fn(),
      isLoading: false,
    });
  });

  describe('basic rendering', () => {
    it('renders configuration heading', () => {
      renderSetupPage();
      expect(screen.getByText(/bridge configuration/i)).toBeInTheDocument();
    });

    it('renders description', () => {
      renderSetupPage();
      expect(screen.getByText('Manage your Madrona setup')).toBeInTheDocument();
    });

    it('renders sidebar', () => {
      const { container } = renderSetupPage();
      const sidebar = container.querySelector('.w-56');
      expect(sidebar).toBeInTheDocument();
    });
  });

  describe('navigation sections', () => {
    it('renders Setup section', () => {
      renderSetupPage();
      expect(screen.getByText('Setup')).toBeInTheDocument();
    });

    it('renders Systems section', () => {
      renderSetupPage();
      expect(screen.getByText('Systems')).toBeInTheDocument();
    });

    it('renders Data Models section', () => {
      renderSetupPage();
      expect(screen.getByText('Data Models')).toBeInTheDocument();
    });

    it('renders Operations section', () => {
      renderSetupPage();
      expect(screen.getByText('Operations')).toBeInTheDocument();
    });
  });

  describe('navigation items', () => {
    it('renders Guided Setup link', () => {
      renderSetupPage();
      expect(screen.getByRole('button', { name: /guided setup/i })).toBeInTheDocument();
    });

    it('renders Connectors link', () => {
      renderSetupPage();
      expect(screen.getByRole('button', { name: /connectors/i })).toBeInTheDocument();
    });

    it('renders Pipelines link', () => {
      renderSetupPage();
      expect(screen.getByRole('button', { name: /pipelines/i })).toBeInTheDocument();
    });

    it('renders Canonical Collections link', () => {
      renderSetupPage();
      expect(screen.getByRole('button', { name: /canonical collections/i })).toBeInTheDocument();
    });

    it('renders Canonical Display Fields link', () => {
      renderSetupPage();
      expect(screen.getByRole('button', { name: /canonical display fields/i })).toBeInTheDocument();
    });

    it('renders Pipeline Runs link', () => {
      renderSetupPage();
      expect(screen.getByRole('button', { name: /pipeline runs/i })).toBeInTheDocument();
    });
  });

  describe('navigation clicks', () => {
    it('navigates to connectors when clicked', () => {
      renderSetupPage();
      fireEvent.click(screen.getByRole('button', { name: /connectors/i }));
      expect(mockNavigate).toHaveBeenCalledWith('/organizations/org-123/bridge/setup/connectors');
    });

    it('navigates to pipelines when clicked', () => {
      renderSetupPage();
      fireEvent.click(screen.getByRole('button', { name: /pipelines/i }));
      expect(mockNavigate).toHaveBeenCalledWith('/organizations/org-123/bridge/setup/pipelines');
    });

    it('navigates to datasets when clicked', () => {
      renderSetupPage();
      fireEvent.click(screen.getByRole('button', { name: /canonical collections/i }));
      expect(mockNavigate).toHaveBeenCalledWith('/organizations/org-123/bridge/setup/datasets');
    });

    it('navigates to display fields when clicked', () => {
      renderSetupPage();
      fireEvent.click(screen.getByRole('button', { name: /canonical display fields/i }));
      expect(mockNavigate).toHaveBeenCalledWith('/organizations/org-123/bridge/setup/display-fields');
    });

    it('navigates to runs when clicked', () => {
      renderSetupPage();
      fireEvent.click(screen.getByRole('button', { name: /pipeline runs/i }));
      expect(mockNavigate).toHaveBeenCalledWith('/organizations/org-123/bridge/setup/runs');
    });
  });

  describe('active state', () => {
    it('highlights Guided Setup on exact setup path', () => {
      renderSetupPage('/organizations/org-123/bridge/setup');
      const guidedSetupButton = screen.getByRole('button', { name: /guided setup/i });
      expect(guidedSetupButton).toHaveClass('bg-stone');
    });

    it('highlights Connectors on connectors path', () => {
      renderSetupPage('/organizations/org-123/bridge/setup/connectors');
      const connectorsButton = screen.getByRole('button', { name: /connectors/i });
      expect(connectorsButton).toHaveClass('bg-stone');
    });

    it('does not highlight Guided Setup on sub-paths', () => {
      renderSetupPage('/organizations/org-123/bridge/setup/connectors');
      const guidedSetupButton = screen.getByRole('button', { name: /guided setup/i });
      expect(guidedSetupButton).not.toHaveClass('bg-stone');
    });
  });

  // data-tour attributes removed from rendered buttons; config still carries dataTour
  // but isn't applied to DOM. Restore if the tour feature comes back.

  describe('uses organization from context', () => {
    it('uses activeOrganizationId when orgId param is empty', () => {
      mockUseOrganization.mockReturnValue({
        activeOrganizationId: 'context-org-456',
        activeOrganization: null,
        setActiveOrganizationId: vi.fn(),
        isLoading: false,
      });

      // Render without route params to simulate no orgId
      render(
        <MemoryRouter>
          <SetupPage />
        </MemoryRouter>
      );

      fireEvent.click(screen.getByRole('button', { name: /connectors/i }));
      expect(mockNavigate).toHaveBeenCalledWith('/organizations/context-org-456/bridge/setup/connectors');
    });
  });
});
