import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FlowEmptyState } from '../../components/FlowEmptyState';

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('FlowEmptyState', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  describe('rendering', () => {
    it('renders empty state message', () => {
      render(
        <MemoryRouter>
          <FlowEmptyState organizationId="org-123" />
        </MemoryRouter>
      );

      expect(screen.getByText('No pipelines configured')).toBeInTheDocument();
    });

    it('renders description text', () => {
      render(
        <MemoryRouter>
          <FlowEmptyState organizationId="org-123" />
        </MemoryRouter>
      );

      expect(
        screen.getByText(/Set up your first data pipeline/)
      ).toBeInTheDocument();
    });

    it('renders configuration button', () => {
      render(
        <MemoryRouter>
          <FlowEmptyState organizationId="org-123" />
        </MemoryRouter>
      );

      expect(screen.getByText('Go to Configuration')).toBeInTheDocument();
    });

    it('renders workflow icon', () => {
      const { container } = render(
        <MemoryRouter>
          <FlowEmptyState organizationId="org-123" />
        </MemoryRouter>
      );

      // Check for SVG icon (Workflow from lucide-react)
      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });
  });

  describe('navigation', () => {
    it('navigates to setup page when button clicked', () => {
      render(
        <MemoryRouter>
          <FlowEmptyState organizationId="org-123" />
        </MemoryRouter>
      );

      fireEvent.click(screen.getByText('Go to Configuration'));

      expect(mockNavigate).toHaveBeenCalledWith('/organizations/org-123/bridge/setup');
    });

    it('uses correct organization ID in navigation', () => {
      render(
        <MemoryRouter>
          <FlowEmptyState organizationId="different-org" />
        </MemoryRouter>
      );

      fireEvent.click(screen.getByText('Go to Configuration'));

      expect(mockNavigate).toHaveBeenCalledWith('/organizations/different-org/bridge/setup');
    });
  });

  describe('styling', () => {
    it('has centered layout', () => {
      const { container } = render(
        <MemoryRouter>
          <FlowEmptyState organizationId="org-123" />
        </MemoryRouter>
      );

      const outerDiv = container.firstChild;
      expect(outerDiv).toHaveStyle({ display: 'flex' });
      expect(outerDiv).toHaveStyle({ alignItems: 'center' });
      expect(outerDiv).toHaveStyle({ justifyContent: 'center' });
    });
  });
});
