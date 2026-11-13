import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ExhibitSettingsPage from '../../pages/exhibit/ExhibitSettingsPage';
import * as api from '../../lib/api';
import * as usePermissionsHook from '../../hooks/usePermissions';
import { checkA11y, formatViolations } from '../a11y';

vi.mock('../../lib/api', () => ({
  getFrameStyles: vi.fn(),
  createFrameStyle: vi.fn(),
  updateFrameStyle: vi.fn(),
  deleteFrameStyle: vi.fn(),
  getMountConfigs: vi.fn(),
  createMountConfig: vi.fn(),
  updateMountConfig: vi.fn(),
  deleteMountConfig: vi.fn(),
}));

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}));

const mockGetFrameStyles = vi.mocked(api.getFrameStyles);
const mockGetMountConfigs = vi.mocked(api.getMountConfigs);
const mockUsePermissions = vi.mocked(usePermissionsHook.usePermissions);

function createClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderPage(orgId = 'org-1') {
  return render(
    <QueryClientProvider client={createClient()}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/collections/exhibitions/settings`]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/exhibitions/settings"
            element={<ExhibitSettingsPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ExhibitSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePermissions.mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(true),
      hasAnyPermission: vi.fn().mockReturnValue(true),
      hasAllPermissions: vi.fn().mockReturnValue(true),
    });
    mockGetFrameStyles.mockResolvedValue({ frame_styles: [] } as never);
    mockGetMountConfigs.mockResolvedValue({ mount_configs: [] } as never);
  });

  it('renders the page heading', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /exhibit settings/i })).toBeInTheDocument();
  });

  it('renders the Frames and Mounts tabs', () => {
    renderPage();
    expect(screen.getByRole('tab', { name: /frame styles/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /mount configurations/i })).toBeInTheDocument();
  });

  it('shows empty state for frame styles', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/no frame styles$/i)).toBeInTheDocument();
    });
  });

  it('switches to mount configurations tab', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/no frame styles$/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('tab', { name: /mount configurations/i }));

    await waitFor(() => {
      expect(screen.getByText(/no mount configurations$/i)).toBeInTheDocument();
    });
  });

  it('renders frame style cards when present', async () => {
    mockGetFrameStyles.mockResolvedValueOnce({
      frame_styles: [
        {
          frame_style_id: 'f-1',
          name: 'Gallery Black',
          description: 'Standard black frame',
          profile_type: 'flat',
          default_width_cm: 5,
          default_depth_cm: 2,
          color: '#000',
          material: 'Wood',
          is_system: false,
        },
      ],
    } as never);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Gallery Black')).toBeInTheDocument();
    });
    expect(screen.getByText(/Flat/)).toBeInTheDocument();
  });

  it('renders mount config cards when present', async () => {
    mockGetMountConfigs.mockResolvedValueOnce({
      mount_configs: [
        {
          mount_config_id: 'm-1',
          name: 'Standard Plinth',
          mount_type: 'plinth',
          config: { height_cm: 100 },
          is_system: false,
        },
      ],
    } as never);

    renderPage();

    fireEvent.click(screen.getByRole('tab', { name: /mount configurations/i }));

    await waitFor(() => {
      expect(screen.getByText('Standard Plinth')).toBeInTheDocument();
    });
    // The label "Plinth/Pedestal" appears under the card name
    expect(screen.getByText(/Plinth\/Pedestal/i)).toBeInTheDocument();
  });

  it('shows New Frame Style button when user has permission', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /new frame style/i })).toBeInTheDocument();
    });
  });

  it('hides New Frame Style button when user lacks permission', async () => {
    mockUsePermissions.mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(false),
      hasAnyPermission: vi.fn().mockReturnValue(false),
      hasAllPermissions: vi.fn().mockReturnValue(false),
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/no frame styles$/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /new frame style/i })).not.toBeInTheDocument();
  });

  it('opens the frame style editor when New Frame Style is clicked', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /new frame style/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /new frame style/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /create frame style/i })).toBeInTheDocument();
    });
  });

  it('renders Back to exhibitions link', () => {
    renderPage('org-42');
    const link = screen.getByRole('link', { name: /back to exhibitions/i });
    expect(link).toHaveAttribute('href', '/organizations/org-42/collections/exhibitions');
  });

  describe('accessibility', () => {
    const frame = {
      frame_style_id: 'f-1',
      name: 'Gallery Black',
      description: 'Standard black frame',
      profile_type: 'flat',
      default_width_cm: 5,
      default_depth_cm: 2,
      color: '#000',
      material: 'Wood',
      is_system: false,
    };

    it('has no axe violations with a frame card and its action menu open', async () => {
      mockGetFrameStyles.mockResolvedValue({ frame_styles: [frame] } as never);
      const { container } = renderPage();
      await waitFor(() => screen.getByText('Gallery Black'));
      let results = await checkA11y(container);
      expect(results.violations, formatViolations(results)).toEqual([]);

      const trigger = screen.getByRole('button', { name: 'Actions for Gallery Black' });
      expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
      fireEvent.click(trigger);
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      const menu = screen.getByRole('menu');
      expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Edit', 'Delete']);
      results = await checkA11y(container);
      expect(results.violations, formatViolations(results)).toEqual([]);

      // Arrow keys move between items, Escape closes and returns focus
      expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
      fireEvent.keyDown(menu, { key: 'ArrowDown' });
      expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus();
      fireEvent.keyDown(menu, { key: 'Escape' });
      expect(screen.queryByRole('menu')).toBeNull();
      expect(trigger).toHaveFocus();
    });

    it('settings tabs follow the tab pattern with arrow-key navigation', async () => {
      renderPage();
      const frames = screen.getByRole('tab', { name: /frame styles/i });
      const mounts = screen.getByRole('tab', { name: /mount configurations/i });
      expect(frames).toHaveAttribute('aria-selected', 'true');
      expect(mounts).toHaveAttribute('tabindex', '-1');
      expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', frames.id);
      frames.focus();
      fireEvent.keyDown(frames, { key: 'ArrowRight' });
      expect(mounts).toHaveAttribute('aria-selected', 'true');
      expect(mounts).toHaveFocus();
    });
  });
});
