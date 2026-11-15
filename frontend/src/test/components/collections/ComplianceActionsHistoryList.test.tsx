import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ComplianceActionsHistoryList } from '../../../components/collections/ComplianceActionsHistoryList';
import { toComplianceActions } from '../../../components/collections/complianceActions';
import { AuthContext, type AuthContextValue } from '../../../contexts/AuthContext';
import * as api from '../../../lib/api';
import { checkA11y } from '../../a11y';

vi.mock('../../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/api')>();
  return { ...actual, getRecordAuditHistory: vi.fn() };
});

const mocked = vi.mocked(api);

function renderList(actions: unknown, permissions = ['data.view']) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const auth = { user: { permissions }, isPlatformAdmin: false, roleOverride: null } as unknown as AuthContextValue;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AuthContext.Provider value={auth}>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </AuthContext.Provider>
  );
  return render(
    <ComplianceActionsHistoryList organizationId="org1" actions={actions} title="Remedial action history" />,
    { wrapper },
  );
}

const ACTIONS = [
  { action_id: 'a1', title: 'Relabel shelf B', status: 'in_progress' },
  { action_id: 'a2', title: '', status: null },
];

describe('ComplianceActionsHistoryList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.getRecordAuditHistory.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 } as never);
  });

  it('lists each action with a History button and no a11y violations', async () => {
    const { container } = renderList(ACTIONS);
    expect(screen.getByRole('heading', { name: 'Remedial action history' })).toBeInTheDocument();
    expect(screen.getByText('Relabel shelf B')).toBeInTheDocument();
    expect(screen.getByText('in progress')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'History for Action Relabel shelf B' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'History for Action Action 2' })).toBeInTheDocument();
    expect(await checkA11y(container)).toHaveNoViolations();

    fireEvent.click(screen.getByRole('button', { name: 'History for Action Relabel shelf B' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await waitFor(() =>
      expect(mocked.getRecordAuditHistory).toHaveBeenCalledWith('org1', 'compliance_action', 'a1', expect.anything()),
    );
  });

  it('renders nothing for an empty list, plain strings or without data.view', () => {
    expect(renderList([]).container).toBeEmptyDOMElement();
    expect(renderList('Relabel everything').container).toBeEmptyDOMElement();
    expect(renderList(ACTIONS, []).container).toBeEmptyDOMElement();
  });

  it('keeps only structured actions', () => {
    expect(toComplianceActions(['text', null, { title: 'no id' }, { action_id: 'x', title: 'ok' }])).toEqual([
      { action_id: 'x', title: 'ok' },
    ]);
  });
});
