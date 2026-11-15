import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { RecordHistoryButton } from '../../../components/audit/RecordHistoryButton';
import { AuthContext, type AuthContextValue } from '../../../contexts/AuthContext';
import * as api from '../../../lib/api';
import type { RecordAuditEvent } from '../../../lib/api';
import { checkA11y } from '../../a11y';

vi.mock('../../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/api')>();
  return { ...actual, getRecordAuditHistory: vi.fn() };
});

const mocked = vi.mocked(api);

const RENAMED: RecordAuditEvent = {
  event_id: 'e1',
  change_type: 'updated',
  changed_at: '2026-11-14T10:00:00+00:00',
  changed_by: 'u1',
  changed_by_name: 'Ada Registrar',
  changed_by_email: 'ada@example.org',
  changed_fields: ['name'],
  summary: 'Updated name',
  request_method: 'PUT',
  child_entity_type: null,
  child_entity_id: null,
  child_display_key: null,
  field_diffs: [{ field_name: 'name', old_value: 'Small label', new_value: 'Gallery label' }],
};

const VALUE_ADDED: RecordAuditEvent = {
  ...RENAMED,
  event_id: 'e2',
  change_type: 'link_added',
  changed_at: '2026-11-13T10:00:00+00:00',
  summary: 'Added allowed value',
  child_entity_type: 'media_tag_value',
  child_entity_id: 'v1',
  child_display_key: 'Portrait',
  field_diffs: [{ field_name: 'value', old_value: null, new_value: 'Portrait' }],
};

function authValue(permissions: string[], extra: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    user: { permissions },
    isPlatformAdmin: false,
    roleOverride: null,
    ...extra,
  } as unknown as AuthContextValue;
}

function renderWith(ui: ReactNode, auth: AuthContextValue | undefined) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <AuthContext.Provider value={auth}>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </AuthContext.Provider>,
  );
}

const button = (
  <ul>
    <li>
      Gallery label
      <RecordHistoryButton organizationId="org1" entityType="label_template" entityId="t1" recordName="Gallery label" />
    </li>
  </ul>
);

describe('RecordHistoryButton (list and settings rows)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.getRecordAuditHistory.mockResolvedValue({
      entity_type: 'label_template',
      entity_id: 't1',
      items: [RENAMED],
      total: 1,
      limit: 20,
      offset: 0,
    } as never);
  });

  it('names the record it opens and has no violations', async () => {
    const { container } = renderWith(button, authValue(['data.view', 'labels.view']));
    const trigger = screen.getByRole('button', { name: 'History for Label template Gallery label' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(await checkA11y(container)).toHaveNoViolations();
  });

  it('opens the history in a labelled dialog, and Escape returns focus', async () => {
    renderWith(button, authValue(['data.view', 'labels.view']));
    const trigger = screen.getByRole('button', { name: /History for Label template/ });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = await screen.findByRole('dialog', { name: 'History: Label template Gallery label' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(await within(dialog).findByText('Updated 1 field')).toBeInTheDocument();
    expect(mocked.getRecordAuditHistory).toHaveBeenCalledWith('org1', 'label_template', 't1', expect.objectContaining({ include_diffs: true }));
    expect(within(dialog).getByRole('heading', { level: 2 })).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { level: 3, name: 'Changes' })).toBeInTheDocument();
    expect(await checkA11y(dialog)).toHaveNoViolations();

    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes from the close button', async () => {
    renderWith(button, authValue(['data.view', 'labels.view']));
    fireEvent.click(screen.getByRole('button', { name: /History for Label template/ }));
    const close = await screen.findByRole('button', { name: 'Close history for Label template Gallery label' });
    fireEvent.click(close);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows child-row changes as sentences in the dialog', async () => {
    mocked.getRecordAuditHistory.mockResolvedValue({
      entity_type: 'media_tag_definition', entity_id: 'd1', items: [VALUE_ADDED], total: 1, limit: 20, offset: 0,
    } as never);
    renderWith(
      <RecordHistoryButton organizationId="org1" entityType="media_tag_definition" entityId="d1" recordName="Genre" />,
      authValue(['data.view', 'media.view']),
    );
    fireEvent.click(screen.getByRole('button', { name: 'History for Tag definition Genre' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Added allowed value Portrait')).toBeInTheDocument();
  });

  it.each([
    ['without the type permission', ['data.view']],
    ['without data.view', ['labels.view']],
  ])('is hidden %s', (_label, permissions) => {
    renderWith(button, authValue(permissions));
    expect(screen.queryByRole('button', { name: /History/ })).not.toBeInTheDocument();
  });

  it('is hidden outside the auth provider', () => {
    renderWith(button, undefined);
    expect(screen.queryByRole('button', { name: /History/ })).not.toBeInTheDocument();
  });

  it('is shown to platform admins unless simulating a role', () => {
    const { unmount } = renderWith(button, authValue([], { isPlatformAdmin: true }));
    expect(screen.getByRole('button', { name: /History for Label template/ })).toBeInTheDocument();
    unmount();
    renderWith(button, authValue([], { isPlatformAdmin: true, roleOverride: 'viewer' }));
    expect(screen.queryByRole('button', { name: /History/ })).not.toBeInTheDocument();
  });

  it('is hidden when the record has no id yet', () => {
    renderWith(
      <RecordHistoryButton organizationId="org1" entityType="discover_config" entityId="" recordName="Discover settings" />,
      authValue(['data.view', 'discover.publish']),
    );
    expect(screen.queryByRole('button', { name: /History/ })).not.toBeInTheDocument();
  });
});
