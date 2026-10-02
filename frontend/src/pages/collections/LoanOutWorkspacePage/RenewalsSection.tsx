import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Calendar } from 'lucide-react';
import { WorkspaceSection, SectionEmptyState } from '../../../components/workspace';
import { apiFetch } from '../../../lib/apiClient';
import { formatDateShort } from '@/lib/formatters';
import type { ExistingLoan } from './types';

interface Renewal {
  renewal_id: string;
  renewal_number: number;
  previous_end_date: string | null;
  new_end_date: string | null;
  approved_date: string | null;
  approved_by: string | null;
  reason: string | null;
  note: string | null;
  created_at: string | null;
}

interface RenewalsResponse {
  renewals: Renewal[];
  total: number;
}

interface RenewalsSectionProps {
  organizationId: string;
  loanId: string;
  existingLoan: ExistingLoan;
  isExpanded: boolean;
  isEditing: boolean;
  order: number | undefined;
  onToggle: () => void;
}

export function RenewalsSection({
  organizationId,
  loanId,
  existingLoan,
  isExpanded,
  isEditing,
  order,
  onToggle,
}: RenewalsSectionProps) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [newEndDate, setNewEndDate] = useState('');
  const [reason, setReason] = useState('');

  const renewalCount = existingLoan.renewal_count ?? 0;
  const maxRenewals = existingLoan.max_renewals ?? 0;
  const canRenew = maxRenewals === 0 || renewalCount < maxRenewals;

  const { data, isLoading } = useQuery<RenewalsResponse>({
    queryKey: ['loan-out-renewals', organizationId, loanId],
    queryFn: async () => {
      return apiFetch<RenewalsResponse>(
        `/organizations/${organizationId}/collections/loans-out/${loanId}/renewals`
      );
    },
    enabled: !!organizationId && !!loanId,
  });

  const renewals = data?.renewals ?? [];

  const createRenewalMutation = useMutation({
    mutationFn: async (payload: { new_end_date: string; reason?: string }) => {
      return apiFetch(
        `/organizations/${organizationId}/collections/loans-out/${loanId}/renewals`,
        { method: 'POST', body: JSON.stringify(payload) }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['loan-out-renewals', organizationId, loanId],
      });
      queryClient.invalidateQueries({
        queryKey: ['loan-out', organizationId, loanId],
      });
      setShowForm(false);
      setNewEndDate('');
      setReason('');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEndDate) return;
    createRenewalMutation.mutate({
      new_end_date: newEndDate,
      reason: reason || undefined,
    });
  };

  return (
    <WorkspaceSection
      id="renewals"
      title="Renewals & Extensions"
      icon={<RefreshCw size={18} />}
      isExpanded={isExpanded}
      onToggle={onToggle}
      isEditing={isEditing}
      order={order}
    >
      {isLoading ? (
        <div className="py-8 text-center text-archive text-sm">Loading renewals...</div>
      ) : (
        <div className="space-y-4">
          {/* Summary */}
          <div className="flex items-center gap-2 text-sm">
            <RefreshCw size={14} className="text-archive" />
            <span className="text-ink">
              Renewals: {renewalCount} of {maxRenewals || '\u221E'}
            </span>
            {renewalCount > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-semantic-success/10 text-semantic-success">
                {renewalCount} completed
              </span>
            )}
          </div>

          {/* Renewal History */}
          {renewals.length > 0 ? (
            <div className="space-y-2">
              {renewals.map((renewal) => (
                <div
                  key={renewal.renewal_id}
                  className="flex items-start gap-3 border border-lichen rounded-lg p-4"
                >
                  <div className="mt-0.5">
                    <Calendar size={16} className="text-archive" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-ink">
                        Renewal {renewal.renewal_number}
                      </span>
                      {renewal.created_at && (
                        <span className="text-xs text-archive">
                          {formatDateShort(renewal.created_at)}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-sm text-accessible-gray">
                      {renewal.previous_end_date && (
                        <span>{formatDateShort(renewal.previous_end_date)}</span>
                      )}
                      {renewal.previous_end_date && renewal.new_end_date && (
                        <span className="mx-1.5 text-archive">&rarr;</span>
                      )}
                      {renewal.new_end_date && (
                        <span className="font-medium text-ink">
                          {formatDateShort(renewal.new_end_date)}
                        </span>
                      )}
                    </div>
                    {renewal.reason && (
                      <div className="mt-1 text-sm text-archive">{renewal.reason}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <SectionEmptyState message="No renewals have been recorded." isEditing={isEditing} />
          )}

          {/* Inline Renewal Form */}
          {isEditing && canRenew && !showForm && (
            <button
              type="button"
              className="text-sm text-bark hover:text-copper-dark focus-visible:ring-2 ring-bark/30 ring-offset-2 rounded"
              onClick={() => setShowForm(true)}
            >
              + Request Renewal
            </button>
          )}

          {isEditing && showForm && (
            <form onSubmit={handleSubmit} className="border border-lichen rounded-lg p-4 space-y-3 bg-parchment">
              <div>
                <label htmlFor="renewal-new-end-date" className="block text-sm font-medium text-ink mb-1">
                  New End Date <span className="text-semantic-error">*</span>
                </label>
                <input
                  id="renewal-new-end-date"
                  type="date"
                  value={newEndDate}
                  onChange={(e) => setNewEndDate(e.target.value)}
                  required
                  className="w-full rounded-md border border-lichen px-3 py-2 text-sm text-ink bg-parchment focus-visible:ring-2 ring-bark/30 ring-offset-2"
                />
              </div>
              <div>
                <label htmlFor="renewal-reason" className="block text-sm font-medium text-ink mb-1">
                  Reason
                </label>
                <textarea
                  id="renewal-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  placeholder="Optional reason for renewal"
                  className="w-full rounded-md border border-lichen px-3 py-2 text-sm text-ink bg-parchment focus-visible:ring-2 ring-bark/30 ring-offset-2"
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  className="btn-primary text-sm px-4 py-2 rounded-md"
                  disabled={!newEndDate || createRenewalMutation.isPending}
                >
                  {createRenewalMutation.isPending ? 'Saving...' : 'Save Renewal'}
                </button>
                <button
                  type="button"
                  className="btn-tertiary text-sm px-4 py-2 rounded-md"
                  onClick={() => {
                    setShowForm(false);
                    setNewEndDate('');
                    setReason('');
                  }}
                >
                  Cancel
                </button>
              </div>
              {createRenewalMutation.isError && (
                <p className="text-sm text-semantic-error">
                  Failed to create renewal. Please try again.
                </p>
              )}
            </form>
          )}
        </div>
      )}
    </WorkspaceSection>
  );
}
