import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { checkA11y } from '../../a11y';
import * as members from '../../../lib/api/discoverMembers';
import { PortalMembersSection } from '../../../pages/collections/discover/PortalMembersSection';

vi.mock('../../../lib/api/discoverMembers', () => ({
  listPortalMembers: vi.fn(),
  setMemberCollectionsEnabled: vi.fn(),
  invitePortalMember: vi.fn(),
  approvePortalMember: vi.fn(),
  suspendPortalMember: vi.fn(),
  generatePortalMemberSignInLink: vi.fn(),
}));

const api = vi.mocked(members);

const list = {
  member_collections_enabled: false,
  members: [
    { member_id: 'm1', email: 'ada@example.org', display_name: 'Ada', status: 'active' as const, collection_count: 2, last_sign_in_at: null },
    { member_id: 'm2', email: 'ben@example.org', display_name: null, status: 'invited' as const, collection_count: 0, last_sign_in_at: null },
  ],
};

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <main>
        <h1>Settings</h1>
        <h2>Discover Settings</h2>
        <PortalMembersSection organizationId="org-1" />
      </main>
    </QueryClientProvider>,
  );
}

describe('PortalMembersSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listPortalMembers.mockResolvedValue(list);
  });

  it('renders the switch, the add form and a captioned member table without violations', async () => {
    const { container } = renderSection();
    const table = await screen.findByRole('table', { name: /portal members \(2\)/i });
    expect(within(table).getByRole('rowheader', { name: 'ada@example.org' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /let approved members save personal collections/i })).not.toBeChecked();
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve ben@example.org' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Suspend ada@example.org' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suspend ben@example.org' })).not.toBeInTheDocument();
    expect((await checkA11y(container)).violations).toEqual([]);
  });

  it('switches the feature on and announces it', async () => {
    api.setMemberCollectionsEnabled.mockResolvedValue(true);
    renderSection();
    await userEvent.click(await screen.findByRole('checkbox', { name: /let approved members/i }));
    expect(api.setMemberCollectionsEnabled).toHaveBeenCalledWith('org-1', true);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/saved collections are now on/i));
  });

  it('creates a sign-in link, shows it in a labelled field and focuses it', async () => {
    api.generatePortalMemberSignInLink.mockResolvedValue({
      url: 'https://example.org/c/nfb/member/welcome#token=t',
      expires_at: '2026-11-13T12:15:00Z',
      expires_in_minutes: 15,
      emailed: false,
      feature_enabled: false,
    });
    const { container } = renderSection();
    await userEvent.click(await screen.findByRole('button', { name: 'Create link for ada@example.org' }));
    const field = await screen.findByLabelText(/one-time sign-in link for ada@example.org/i);
    expect(field).toHaveValue('https://example.org/c/nfb/member/welcome#token=t');
    await waitFor(() => expect(field).toHaveFocus());
    expect(api.generatePortalMemberSignInLink).toHaveBeenCalledWith('org-1', 'm1', false);
    expect((await checkA11y(container)).violations).toEqual([]);
  });

  it('validates the email before adding a member', async () => {
    renderSection();
    await userEvent.click(await screen.findByRole('button', { name: 'Add member' }));
    const email = screen.getByLabelText('Email address');
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveFocus();
    expect(api.invitePortalMember).not.toHaveBeenCalled();
  });

  it('confirms before suspending', async () => {
    api.suspendPortalMember.mockResolvedValue({ ...list.members[0], status: 'suspended' });
    renderSection();
    await userEvent.click(await screen.findByRole('button', { name: 'Suspend ada@example.org' }));
    const dialog = screen.getByRole('dialog', { name: 'Suspend ada@example.org?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Suspend member' }));
    await waitFor(() => expect(api.suspendPortalMember).toHaveBeenCalledWith('org-1', 'm1'));
  });
});
