/**
 * Accessibility checks for the authenticated app shell: skip link, landmarks,
 * main navigation (aria-current), the notification bell, the application
 * switcher and the user/org menu. Automated checks only (axe + role queries).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { checkA11y, formatViolations } from '../a11y';

const { authState, notificationsApi } = vi.hoisted(() => ({
  authState: {
    isAuthenticated: true,
    isLoading: false,
    activeOrganizationId: 'org-1',
    user: { user_id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', agent_enabled: false },
    memberships: [
      { organization_id: 'org-1', name: 'Museum One', slug: 'museum-one', role: 'admin', role_label: 'Admin' },
      { organization_id: 'org-2', name: 'Museum Two', slug: 'museum-two', role: 'member', role_label: 'Member' },
    ],
    applications: [],
  },
  notificationsApi: {
    getNotifications: vi.fn(),
    getUnreadNotificationCount: vi.fn(),
    markNotificationAsRead: vi.fn(),
    markAllNotificationsAsRead: vi.fn(),
  },
}));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    ...authState,
    hasAppAccess: () => true,
    setActiveOrganization: vi.fn(),
    logout: vi.fn(),
  }),
}));
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: () => true }),
}));
vi.mock('../../contexts/WebSocketContext', () => ({
  useWebSocket: () => ({ isConnected: true }),
}));
vi.mock('../../hooks/usePageContextAutoDetect', () => ({ usePageContextAutoDetect: () => {} }));
vi.mock('../../hooks/useCommandPaletteShortcut', () => ({ useCommandPaletteShortcut: () => {} }));
vi.mock('../../hooks/useGuideActionable', () => ({
  useGuideActionable: () => ({ actionable: false, reason: null }),
}));
vi.mock('../../hooks/useOnboardingSeen', () => ({
  useOnboardingSeen: () => ({ seen: true, markSeen: vi.fn() }),
}));
vi.mock('../../hooks/useRecentPageTracker', () => ({ useRecentPageTracker: () => {} }));
vi.mock('../../hooks/useNotifications', () => ({ useNotifications: () => {} }));
vi.mock('../../contexts/WorkContext', () => ({
  useWork: () => ({ recentItems: [] }),
  filterRecentItemsByApp: () => [],
}));
vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}));
vi.mock('../../components/RoleOverrideBanner', () => ({ RoleOverrideBanner: () => null }));
vi.mock('../../components/ActiveContextIndicator', () => ({
  ActiveContextIndicator: () => null,
  MobileContextIndicator: () => null,
}));
vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../lib/api');
  return { ...actual, ...notificationsApi };
});

import { AppShell } from '../../components/AppShell';

function renderShell(path = '/organizations/org-1/collections/objects') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Page = ({ children }: { children: ReactNode }) => <AppShell>{children}</AppShell>;
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/organizations/:orgId/*"
            element={
              <Page>
                <h1>Objects</h1>
              </Page>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('App shell accessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    try {
      localStorage.clear();
    } catch {
      // ignore
    }
    notificationsApi.getUnreadNotificationCount.mockResolvedValue({ unread_count: 2 });
    notificationsApi.getNotifications.mockResolvedValue({
      items: [
        {
          notification_id: 'n1',
          notification_type: 'comment',
          title: 'New comment on Vase',
          message: 'Looks good',
          is_read: false,
          created_at: new Date().toISOString(),
          entity_type: null,
          entity_id: null,
        },
      ],
      has_more: false,
    });
  });

  it('has no axe violations in the default shell', async () => {
    const { container } = renderShell();
    await screen.findByRole('button', { name: /Notifications \(2 unread\)/ });
    const results = await checkA11y(container);
    expect(results.violations, formatViolations(results)).toEqual([]);
  });

  it('puts the skip link first and targets a focusable main landmark', () => {
    const { container } = renderShell();
    const firstFocusable = container.querySelector<HTMLElement>('a[href], button, input, select, textarea');
    expect(firstFocusable).toHaveTextContent('Skip to main content');
    expect(firstFocusable).toHaveAttribute('href', '#main-content');
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'main-content');
    expect(main).toHaveAttribute('tabindex', '-1');
  });

  it('exposes a labelled product navigation landmark with aria-current on the current page', () => {
    renderShell('/organizations/org-1/collections/objects');
    const nav = screen.getByRole('navigation', { name: 'Collections navigation' });
    // The collapsed section that holds the current page says so...
    const section = within(nav).getByRole('button', { name: 'Toggle Collection, contains current page' });
    expect(section).toHaveAttribute('aria-expanded', 'false');
    // ...and once expanded, the current page link carries aria-current.
    fireEvent.click(section);
    expect(section).toHaveAttribute('aria-expanded', 'true');
    expect(within(nav).getByRole('link', { name: 'Cataloging' })).toHaveAttribute('aria-current', 'page');
    expect(section).toHaveAttribute('aria-controls');
    expect(screen.getByRole('complementary', { name: 'Sidebar' })).toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });

  it('notification bell is a disclosure; Escape closes it and returns focus', async () => {
    const { container } = renderShell();
    const bell = await screen.findByRole('button', { name: /Notifications \(2 unread\)/ });
    expect(bell).toHaveAttribute('aria-expanded', 'false');
    expect(bell).not.toHaveAttribute('aria-haspopup');
    fireEvent.click(bell);
    expect(bell).toHaveAttribute('aria-expanded', 'true');
    const panel = screen.getByRole('region', { name: 'Notifications' });
    expect(bell).toHaveAttribute('aria-controls', panel.id);
    expect(await within(panel).findByRole('button', { name: 'Mark New comment on Vase as read' })).toBeInTheDocument();
    const results = await checkA11y(container);
    expect(results.violations, formatViolations(results)).toEqual([]);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(bell).toHaveAttribute('aria-expanded', 'false');
    expect(bell).toHaveFocus();
  });

  it('application switcher is a listbox with arrow-key navigation', async () => {
    renderShell();
    const trigger = screen.getByRole('button', { name: /^Switch application/ });
    fireEvent.click(trigger);
    const listbox = screen.getByRole('listbox', { name: 'Select application' });
    expect(trigger).toHaveAttribute('aria-controls', listbox.id);
    const options = within(listbox).getAllByRole('option').filter((o) => o.getAttribute('aria-disabled') !== 'true');
    await waitFor(() => expect(options.find((o) => o.getAttribute('aria-selected') === 'true')).toHaveFocus());
    const start = options.indexOf(document.activeElement as HTMLElement);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(options[(start + 1) % options.length]).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(options[options.length - 1]).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('user menu marks the current organization and theme state', async () => {
    const { container } = renderShell();
    const trigger = screen.getByRole('button', { name: /^User menu: Ada Lovelace, Museum One/ });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const orgGroup = screen.getByRole('group', { name: 'Switch Organization' });
    expect(within(orgGroup).getByRole('button', { name: /Museum One/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'true');
    const results = await checkA11y(container);
    expect(results.violations, formatViolations(results)).toEqual([]);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger).toHaveFocus();
  });
});
