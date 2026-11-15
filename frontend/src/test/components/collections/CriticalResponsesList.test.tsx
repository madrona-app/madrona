import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { CriticalResponsesList } from '../../../components/collections/CriticalResponsesList';
import { AuthContext, type AuthContextValue } from '../../../contexts/AuthContext';
import * as api from '../../../lib/api';
import { checkA11y } from '../../a11y';

vi.mock('../../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/api')>();
  return { ...actual, getObjectCriticalResponses: vi.fn(), getRecordAuditHistory: vi.fn() };
});

const mocked = vi.mocked(api);

function authValue(permissions: string[]): AuthContextValue {
  return {
    user: { permissions },
    isPlatformAdmin: false,
    roleOverride: null,
  } as unknown as AuthContextValue;
}

function renderList(permissions: string[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AuthContext.Provider value={authValue(permissions)}>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </AuthContext.Provider>
  );
  return render(<CriticalResponsesList organizationId="org1" objectId="obj1" />, { wrapper });
}

const RESPONSE = {
  response_id: 'cr1',
  organization_id: 'org1',
  object_id: 'obj1',
  comment_text: 'A striking work that rewards close looking.',
  comment_summary: 'Praised in the Times',
  document_type: 'review' as const,
  author_name: 'J. Critic',
  comment_date_display: '1921',
};

describe('CriticalResponsesList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.getRecordAuditHistory.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 } as never);
  });

  it('lists responses with a History button per response and no a11y violations', async () => {
    mocked.getObjectCriticalResponses.mockResolvedValue({ critical_responses: [RESPONSE] });
    const { container } = renderList(['data.view', 'critical_responses.view']);

    expect(screen.getByRole('heading', { name: 'Critical responses' })).toBeInTheDocument();
    expect(await screen.findByText('Praised in the Times')).toBeInTheDocument();
    expect(screen.getByText('Review, J. Critic, 1921')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'History for Critical response Praised in the Times' });
    expect(await checkA11y(container)).toHaveNoViolations();

    fireEvent.click(button);
    expect(await screen.findByRole('dialog', { name: /History: Critical response Praised in the Times/ })).toBeInTheDocument();
    await waitFor(() =>
      expect(mocked.getRecordAuditHistory).toHaveBeenCalledWith('org1', 'critical_response', 'cr1', expect.anything()),
    );
  });

  it('shows an empty state', async () => {
    mocked.getObjectCriticalResponses.mockResolvedValue({ critical_responses: [] });
    const { container } = renderList(['data.view', 'critical_responses.view']);
    expect(await screen.findByText('No critical responses recorded.')).toBeInTheDocument();
    expect(await checkA11y(container)).toHaveNoViolations();
  });

  it('renders nothing and does not fetch without critical_responses.view', () => {
    const { container } = renderList(['data.view']);
    expect(container).toBeEmptyDOMElement();
    expect(mocked.getObjectCriticalResponses).not.toHaveBeenCalled();
  });
});
