import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SecurityChangesPage, SettingsChangesPage } from '../../pages/admin/ConfigurationChangeLogPage';
import * as api from '../../lib/api';
import { checkA11y } from '../a11y';

vi.mock('../../lib/api', () => ({
  getEntityAuditEvents: vi.fn(),
  getEntityAuditEventDetail: vi.fn(),
}));

const mockList = vi.mocked(api.getEntityAuditEvents);
const mockDetail = vi.mocked(api.getEntityAuditEventDetail);
type ListResponse = Awaited<ReturnType<typeof api.getEntityAuditEvents>>;
type DetailResponse = Awaited<ReturnType<typeof api.getEntityAuditEventDetail>>;
const page = (items: ListResponse['items']): ListResponse => ({ items, total: items.length, limit: 50, offset: 0 });

const roleEvent = {
  event_id: 'ev-1',
  organization_id: 'org-1',
  entity_type: 'role',
  entity_id: 'role-1',
  entity_display_key: 'Volunteer cataloguer',
  change_type: 'link_removed' as const,
  changed_at: '2026-11-14T10:00:00Z',
  changed_by: 'u-1',
  changed_by_name: 'Pat Registrar',
  changed_by_email: 'pat@example.org',
  changed_fields: ['permission'],
  summary: 'Removed permission: collections.delete',
};

const ssoEvent = {
  ...roleEvent,
  event_id: 'ev-2',
  entity_type: 'sso_configuration',
  entity_id: 'sso-1',
  entity_display_key: 'oidc',
  change_type: 'updated' as const,
  changed_fields: ['client_secret_encrypted'],
  summary: 'Updated client_secret_encrypted',
};

function renderAt(path: string, element: React.ReactElement, routePath: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={routePath} element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Security changes page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists security changes in a captioned table and asks only for security records', async () => {
    mockList.mockResolvedValue(page([roleEvent, ssoEvent]));
    const { container } = renderAt(
      '/organizations/org-1/admin/security-changes', <SecurityChangesPage />,
      '/organizations/:orgId/admin/security-changes',
    );

    expect(await screen.findByRole('heading', { level: 1, name: 'Security Changes' })).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: /security configuration changes/i });
    expect(within(table).getByRole('rowheader', { name: 'Volunteer cataloguer' })).toBeInTheDocument();
    expect(within(table).getByText('Removed permission: collections.delete')).toBeInTheDocument();
    expect(within(table).getByText('Single sign-on')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Showing 1 to 2 of 2 changes.');
    expect(mockList).toHaveBeenCalledWith('org-1', expect.objectContaining({ category: 'security' }));

    expect(screen.getByLabelText('Record type')).toBeInTheDocument();
    expect(screen.getByLabelText('Change')).toBeInTheDocument();
    expect((await checkA11y(container)).violations).toEqual([]);
  });

  it('reveals the masked before and after of a change', async () => {
    mockList.mockResolvedValue(page([ssoEvent]));
    mockDetail.mockResolvedValue({
      event: { ...ssoEvent, field_diffs: [{ field_name: 'client_secret_encrypted', old_value: '(hidden)', new_value: '(hidden)' }] },
    } as DetailResponse);
    const user = userEvent.setup();
    const { container } = renderAt(
      '/organizations/org-1/admin/security-changes', <SecurityChangesPage />,
      '/organizations/:orgId/admin/security-changes',
    );
    const button = await screen.findByRole('button', { name: /show changes for single sign-on oidc/i });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAccessibleName(/^hide changes for single sign-on oidc/i);
    await waitFor(() => expect(mockDetail).toHaveBeenCalledWith('org-1', 'ev-2'));
    expect((await screen.findAllByText('(hidden)')).length).toBeGreaterThan(0);
    expect((await checkA11y(container)).violations).toEqual([]);
  });

  it('filters by record type', async () => {
    mockList.mockResolvedValue(page([]));
    const user = userEvent.setup();
    renderAt(
      '/organizations/org-1/admin/security-changes', <SecurityChangesPage />,
      '/organizations/:orgId/admin/security-changes',
    );
    await screen.findByText('No changes recorded.');
    await user.selectOptions(screen.getByLabelText('Record type'), 'api_key');
    await waitFor(() => expect(mockList).toHaveBeenLastCalledWith(
      'org-1', expect.objectContaining({ category: 'security', entity_type: 'api_key' }),
    ));
  });
});

describe('Settings changes page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('asks for settings records and passes axe', async () => {
    mockList.mockResolvedValue(page([
      { ...roleEvent, entity_type: 'organization_branding', entity_display_key: 'Example Museum', change_type: 'updated', summary: 'Updated primary_color' },
    ]));
    const { container } = renderAt(
      '/organizations/org-1/admin/settings-changes', <SettingsChangesPage />,
      '/organizations/:orgId/admin/settings-changes',
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings Changes' })).toBeInTheDocument();
    expect(await screen.findByText('Branding and letterhead')).toBeInTheDocument();
    expect(mockList).toHaveBeenCalledWith('org-1', expect.objectContaining({ category: 'settings' }));
    expect((await checkA11y(container)).violations).toEqual([]);
  });
});
