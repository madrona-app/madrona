import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { checkA11y } from '../../a11y';
import * as api from '../../../lib/api/searchSettings';
import { DeaccessionedSearchSetting } from '../../../pages/collections/settings/DeaccessionedSearchSetting';

vi.mock('../../../lib/api/searchSettings', () => ({
  getHideDeaccessioned: vi.fn(),
  setHideDeaccessioned: vi.fn(),
  hideDeaccessionedQueryKey: (id: string) => ['search-settings', 'hide-deaccessioned', id],
}));

const permissions = { manage: true };
vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (key: string) => key === 'org.manage_settings' && permissions.manage }),
}));

const mocked = vi.mocked(api);

function renderSetting() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <main>
        <h1>Collections Settings</h1>
        <DeaccessionedSearchSetting organizationId="org-1" />
      </main>
    </QueryClientProvider>,
  );
}

describe('DeaccessionedSearchSetting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permissions.manage = true;
    mocked.getHideDeaccessioned.mockResolvedValue(true);
  });

  it('shows a labelled switch, on by default, with no axe violations', async () => {
    const { container } = renderSetting();
    const toggle = await screen.findByRole('switch', { name: 'Hide deaccessioned records from search' });
    expect(toggle).toBeChecked();
    expect(toggle).toHaveAccessibleDescription(/public portal never shows them/);
    expect(screen.getByRole('heading', { name: 'Deaccessioned Records', level: 2 })).toBeInTheDocument();
    expect((await checkA11y(container)).violations).toEqual([]);
  });

  it('turns the setting off, keeps focus and announces it', async () => {
    mocked.setHideDeaccessioned.mockResolvedValue(false);
    renderSetting();
    const toggle = await screen.findByRole('switch', { name: /hide deaccessioned/i });
    await userEvent.click(toggle);
    expect(mocked.setHideDeaccessioned).toHaveBeenCalledWith('org-1', false);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/now appear in search/));
    expect(toggle).not.toBeChecked();
    expect(toggle).toHaveFocus();
  });

  it('reports a failure', async () => {
    mocked.setHideDeaccessioned.mockRejectedValue(new Error('Forbidden'));
    renderSetting();
    await userEvent.click(await screen.findByRole('switch', { name: /hide deaccessioned/i }));
    await waitFor(() => expect(screen.getAllByRole('alert').some((el) => /could not be changed: Forbidden/.test(el.textContent ?? ''))).toBe(true));
  });

  it('is read-only without permission', async () => {
    permissions.manage = false;
    const { container } = renderSetting();
    const toggle = await screen.findByRole('switch', { name: /hide deaccessioned/i });
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAccessibleDescription(/requires permission to manage organization settings/);
    expect((await checkA11y(container)).violations).toEqual([]);
  });
});
