import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InsuranceClaimsList } from '../../components/collections/InsuranceClaimsList';
import * as api from '../../lib/api';
import type { InsuranceClaim } from '../../lib/api';
import { checkA11y } from '../a11y';

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, getInsuranceClaims: vi.fn(), getRecordAuditHistory: vi.fn() };
});

const mocked = vi.mocked(api);

const CLAIM: InsuranceClaim = {
  claim_id: 'cl-1',
  organization_id: 'org-1',
  claim_number: 'CLM-2026-001',
  insurer_claim_number: 'INS-77',
  coverage_id: 'cov-1',
  indemnity_id: null,
  date_of_loss: '2026-10-02',
  loss_description: 'Water damage to the Braille map case.',
  loss_type: 'damage',
  loss_type_label: 'Damage',
  claimed_amount: 1200,
  settlement_amount: null,
  amount_currency: 'USD',
  status: 'filed',
  status_label: 'Filed',
  filed_date: '2026-10-05',
  settled_date: null,
};

function renderList(claims: InsuranceClaim[], canViewHistory = true) {
  mocked.getInsuranceClaims.mockResolvedValue({ claims, total: claims.length });
  mocked.getRecordAuditHistory.mockResolvedValue({
    entity_type: 'insurance_claim',
    entity_id: 'cl-1',
    items: [{
      event_id: 'e1',
      change_type: 'updated',
      changed_at: '2026-10-05T12:00:00+00:00',
      changed_by: 'u1',
      changed_by_name: 'Ada Registrar',
      changed_by_email: 'ada@example.org',
      changed_fields: ['status'],
      summary: 'Updated status',
      request_method: 'POST',
      field_diffs: [{ field_name: 'status', old_value: 'draft', new_value: 'filed' }],
    }],
    total: 1,
    limit: 20,
    offset: 0,
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <main>
        <h2>Claims</h2>
        <InsuranceClaimsList organizationId="org-1" policyId="pol-1" canViewHistory={canViewHistory} />
      </main>
    </QueryClientProvider>,
  );
}

describe('InsuranceClaimsList', () => {
  beforeEach(() => {
    mocked.getInsuranceClaims.mockReset();
    mocked.getRecordAuditHistory.mockReset();
  });

  it('lists the policy’s claims with their facts as text', async () => {
    renderList([CLAIM]);
    const list = await screen.findByRole('list', { name: 'Claims (1)' });
    expect(mocked.getInsuranceClaims).toHaveBeenCalledWith('org-1', { policy_id: 'pol-1' });
    const item = within(list).getAllByRole('listitem')[0];
    expect(within(item).getByRole('heading', { level: 3, name: 'Claim CLM-2026-001' })).toBeInTheDocument();
    expect(within(item).getByText('Status:')).toBeInTheDocument();
    expect(within(item).getByText('Filed')).toBeInTheDocument();
    expect(within(item).getByText('INS-77')).toBeInTheDocument();
    expect(within(item).getByText('Water damage to the Braille map case.')).toBeInTheDocument();
  });

  it('shows a claim’s change history behind a named disclosure button', async () => {
    const { container } = renderList([CLAIM]);
    const button = await screen.findByRole('button', { name: 'Show change history for Claim CLM-2026-001' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    const panel = document.getElementById(button.getAttribute('aria-controls')!);
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute('hidden');
    expect(mocked.getRecordAuditHistory).not.toHaveBeenCalled();

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAccessibleName('Hide change history for Claim CLM-2026-001');
    expect(panel).not.toHaveAttribute('hidden');
    expect(await within(panel!).findByRole('heading', { level: 4, name: 'Change history: Claim CLM-2026-001' })).toBeInTheDocument();
    expect(mocked.getRecordAuditHistory).toHaveBeenCalledWith('org-1', 'insurance_claim', 'cl-1', expect.any(Object));
    expect(await within(panel!).findByText('Ada Registrar')).toBeInTheDocument();

    expect((await checkA11y(container)).violations).toEqual([]);
  });

  it('hides the history control without audit-log permission', async () => {
    renderList([CLAIM], false);
    await screen.findByRole('list', { name: 'Claims (1)' });
    expect(screen.queryByRole('button', { name: /change history/ })).toBeNull();
  });

  it('says when there are no claims', async () => {
    const { container } = renderList([]);
    expect(await screen.findByText('No claims have been recorded against this policy.')).toBeInTheDocument();
    expect((await checkA11y(container)).violations).toEqual([]);
  });

  it('names a claim without a reference by its date of loss', async () => {
    renderList([{ ...CLAIM, claim_number: null, insurer_claim_number: null }]);
    expect(await screen.findByRole('heading', { level: 3, name: /^Claim for loss on / })).toBeInTheDocument();
  });
});
