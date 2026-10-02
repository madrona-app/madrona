import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ProductSwitcher } from '../../../components/navigation/ProductSwitcher';
import type { ComponentType } from 'react';

const { useAuthMock, useActiveProductMock, usePermissionsMock, navigateMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useActiveProductMock: vi.fn(),
  usePermissionsMock: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock('../../../hooks/useAuth', () => ({
  useAuth: useAuthMock,
}));

vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: usePermissionsMock,
}));

vi.mock('../../../hooks/useActiveProduct', () => ({
  useActiveProduct: useActiveProductMock,
  getProductLandingPath: (id: string, orgId: string) =>
    `/organizations/${orgId}/${id}`,
}));

vi.mock('../../../lib/navigationConfig', () => {
  const Icon = () => null;
  return {
    products: [
      { id: 'collections', label: 'Collections', icon: Icon, appKey: 'collections' },
      { id: 'bridge', label: 'Bridge', icon: Icon, appKey: 'bridge' },
      { id: 'guide', label: 'Guide', icon: Icon, appKey: 'guide' },
    ],
  };
});

const FakeIcon: ComponentType<{ size?: number; className?: string }> = () => null;

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom',
  );
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

function setup({
  activeProductId = 'collections',
  appAccess = ['collections', 'bridge', 'guide'],
  canManageGuide = true,
}: { activeProductId?: string; appAccess?: string[]; canManageGuide?: boolean } = {}) {
  const activeProduct = {
    id: activeProductId,
    label:
      activeProductId === 'collections'
        ? 'Collections'
        : activeProductId === 'bridge'
        ? 'Bridge'
        : 'Guide',
    icon: FakeIcon,
  };
  useActiveProductMock.mockReturnValue({
    activeProduct,
    activeProductId,
  });
  useAuthMock.mockReturnValue({
    activeOrganizationId: 'org-1',
    hasAppAccess: (app: string) => appAccess.includes(app),
  });
  usePermissionsMock.mockReturnValue({
    hasPermission: (p?: string) => (p === 'org.manage_settings' ? canManageGuide : true),
  });
}

function renderSwitcher() {
  return render(
    <MemoryRouter initialEntries={['/organizations/org-1/collections']}>
      <Routes>
        <Route
          path="/organizations/:orgId/*"
          element={<ProductSwitcher />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProductSwitcher', () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    useActiveProductMock.mockReset();
    usePermissionsMock.mockReset();
    usePermissionsMock.mockReturnValue({ hasPermission: () => true });
    navigateMock.mockReset();
  });

  it('renders the active product label', () => {
    setup({ activeProductId: 'collections' });
    renderSwitcher();
    expect(screen.getByText('Collections')).toBeInTheDocument();
  });

  it('falls back to "Madrona" when no active product is set', () => {
    useActiveProductMock.mockReturnValue({ activeProduct: null, activeProductId: null });
    useAuthMock.mockReturnValue({
      activeOrganizationId: 'org-1',
      hasAppAccess: () => true,
    });
    renderSwitcher();
    expect(screen.getByText('Madrona')).toBeInTheDocument();
  });

  it('opens the dropdown listbox when clicked', () => {
    setup();
    renderSwitcher();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Click to switch applications/ }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('shows all products in the dropdown sorted alphabetically', () => {
    setup();
    renderSwitcher();
    fireEvent.click(screen.getByRole('button', { name: /Click to switch applications/ }));
    const labels = screen
      .getAllByRole('option')
      .map((el) => el.textContent?.trim());
    // Note: "Collections" appears as the trigger label too — check the first three options
    expect(labels.slice(0, 3)).toEqual(['Bridge', 'Collections', 'Guide']);
  });

  it('marks the active product with aria-selected', () => {
    setup({ activeProductId: 'guide' });
    renderSwitcher();
    fireEvent.click(screen.getByRole('button', { name: /Click to switch applications/ }));
    const guide = screen
      .getAllByRole('option')
      .find((el) => el.textContent?.trim() === 'Guide');
    expect(guide).toHaveAttribute('aria-selected', 'true');
  });

  it('renders unlicensed products as disabled with an Upgrade label', () => {
    setup({ appAccess: ['collections'] });
    renderSwitcher();
    fireEvent.click(screen.getByRole('button', { name: /Click to switch applications/ }));
    const bridgeOption = screen
      .getAllByRole('option')
      .find((el) => el.textContent?.includes('Bridge'));
    expect(bridgeOption).toHaveAttribute('aria-disabled', 'true');
    expect(bridgeOption?.textContent).toContain('Upgrade');
  });

  it('navigates to the chosen product landing page on click', () => {
    setup({ activeProductId: 'collections' });
    renderSwitcher();
    fireEvent.click(screen.getByRole('button', { name: /Click to switch applications/ }));
    const guideOption = screen
      .getAllByRole('option')
      .find((el) => el.textContent?.trim() === 'Guide');
    fireEvent.click(guideOption!);
    expect(navigateMock).toHaveBeenCalledWith(
      '/organizations/org-1/guide',
      expect.objectContaining({ viewTransition: true }),
    );
  });

  it('does not navigate when the active product is re-selected', () => {
    setup({ activeProductId: 'collections' });
    renderSwitcher();
    fireEvent.click(screen.getByRole('button', { name: /Click to switch applications/ }));
    const collectionsOption = screen
      .getAllByRole('option')
      .find((el) => el.getAttribute('aria-selected') === 'true');
    fireEvent.click(collectionsOption!);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('closes when Escape is pressed', () => {
    setup();
    renderSwitcher();
    fireEvent.click(screen.getByRole('button', { name: /Click to switch applications/ }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('closes when clicking outside the dropdown', () => {
    setup();
    renderSwitcher();
    fireEvent.click(screen.getByRole('button', { name: /Click to switch applications/ }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('hides Guide from a non-admin who has another app (Guide is admin config)', () => {
    setup({ canManageGuide: false, appAccess: ['collections', 'bridge', 'guide'] });
    renderSwitcher();
    fireEvent.click(screen.getByRole('button', { name: /Click to switch applications/ }));
    const labels = screen.getAllByRole('option').map((el) => el.textContent?.trim());
    expect(labels).not.toContain('Guide');
    expect(labels).toContain('Collections');
  });

  it('keeps Guide for a non-admin whose only app is Guide (standalone org — never strand)', () => {
    setup({ activeProductId: 'guide', canManageGuide: false, appAccess: ['guide'] });
    renderSwitcher();
    fireEvent.click(screen.getByRole('button', { name: /Click to switch applications/ }));
    const labels = screen.getAllByRole('option').map((el) => el.textContent?.trim());
    expect(labels).toContain('Guide');
  });

  it('shows Guide to admins (org.manage_settings)', () => {
    setup({ canManageGuide: true });
    renderSwitcher();
    fireEvent.click(screen.getByRole('button', { name: /Click to switch applications/ }));
    const labels = screen.getAllByRole('option').map((el) => el.textContent?.trim());
    expect(labels).toContain('Guide');
  });
});
