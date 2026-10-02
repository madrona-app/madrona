import { useState, useEffect, useCallback } from 'react';
import Checkbox from '../Checkbox';
import {
  Plus,
  FileText,
  Shield,
  CheckCircle2,
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  User,
  Loader2,
  ChevronRight,
  Edit3,
  Trash2,
  Link2,
  AlertTriangle,
} from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import { formatDateShort } from '../../lib/formatters';
import { SlideOver } from '../ui/SlideOver';
import ConfirmDialog from '../ConfirmDialog';
import { logger } from '../../lib/logger';
import { MadronaLoader } from '../ui/MadronaLoader';

// === Types ===
type LoanType = 'loan_in' | 'loan_out';
type LoanStatus =
  | 'requested'
  | 'pending_approval'
  | 'approved'
  | 'agreement_sent'
  | 'agreement_signed'
  | 'in_transit'
  | 'on_loan'
  | 'return_scheduled'
  | 'returned'
  | 'closed'
  | 'declined'
  | 'cancelled';

interface LoanObject {
  loan_object_id: string;
  object_id: string;
  object_number: string | null;
  object_title: string | null;
}

interface Loan {
  link_id: string;
  exhibition_id: string;
  loan_id: string;
  loan_type: LoanType;
  loan_type_label: string;
  loan_number: string | null;
  party_name: string | null;
  party_contact: string | null;
  status: LoanStatus;
  status_label: string;
  status_notes: string | null;
  agreement_document_id: string | null;
  agreement_signed: boolean;
  agreement_signed_date: string | null;
  insurance_confirmed: boolean;
  insurance_policy: string | null;
  insurance_value: string | null;
  request_date: string | null;
  loan_start_date: string | null;
  loan_end_date: string | null;
  actual_return_date: string | null;
  object_count: string | null;
  notes: string | null;
  objects?: LoanObject[];
  is_active: boolean;
  needs_attention: boolean;
  created_at: string;
}

interface LoanSummary {
  total: number;
  loans_in: number;
  loans_out: number;
  active: number;
  needs_attention: number;
  agreements_pending: number;
  insurance_pending: number;
}

interface Props {
  organizationId: string;
  exhibitionId: string;
  isEditing: boolean;
}

// === Constants ===
const STATUS_CONFIG: Record<LoanStatus, { bg: string; text: string }> = {
  requested: { bg: 'bg-stone', text: 'text-ink' },
  pending_approval: { bg: 'bg-semantic-warning/10', text: 'text-semantic-warning' },
  approved: { bg: 'bg-semantic-info/10', text: 'text-semantic-info' },
  agreement_sent: { bg: 'bg-bark/10', text: 'text-bark' },
  agreement_signed: { bg: 'bg-bark/10', text: 'text-bark' },
  in_transit: { bg: 'bg-semantic-info/10', text: 'text-semantic-info' },
  on_loan: { bg: 'bg-semantic-success/10', text: 'text-semantic-success' },
  return_scheduled: { bg: 'bg-semantic-warning/10', text: 'text-semantic-warning' },
  returned: { bg: 'bg-stone', text: 'text-archive' },
  closed: { bg: 'bg-stone', text: 'text-archive' },
  declined: { bg: 'bg-semantic-error/10', text: 'text-semantic-error' },
  cancelled: { bg: 'bg-stone', text: 'text-archive' },
};

const STATUS_OPTIONS: Array<{ value: LoanStatus; label: string }> = [
  { value: 'requested', label: 'Requested' },
  { value: 'pending_approval', label: 'Pending Approval' },
  { value: 'approved', label: 'Approved' },
  { value: 'agreement_sent', label: 'Agreement Sent' },
  { value: 'agreement_signed', label: 'Agreement Signed' },
  { value: 'in_transit', label: 'In Transit' },
  { value: 'on_loan', label: 'On Loan' },
  { value: 'return_scheduled', label: 'Return Scheduled' },
  { value: 'returned', label: 'Returned' },
  { value: 'closed', label: 'Closed' },
  { value: 'declined', label: 'Declined' },
  { value: 'cancelled', label: 'Cancelled' },
];


// === Component ===
export function ExhibitionLoansTab({ organizationId, exhibitionId, isEditing }: Props) {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [summary, setSummary] = useState<LoanSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'loan_in' | 'loan_out' | 'attention'>('all');

  const [selectedLoan, setSelectedLoan] = useState<Loan | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingLoan, setEditingLoan] = useState<Partial<Loan> | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<Loan | null>(null);

  // Load loans
  const loadLoans = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (filter === 'loan_in' || filter === 'loan_out') {
        params.set('loan_type', filter);
      }
      if (filter === 'attention') {
        // We'll filter client-side for needs_attention
      }

      const data = await apiFetch<{ loans: Loan[]; summary: LoanSummary }>(
        `/organizations/${organizationId}/exhibit/exhibitions/${exhibitionId}/loans?${params}`
      );

      let filteredLoans = data.loans || [];
      if (filter === 'attention') {
        filteredLoans = filteredLoans.filter((l) => l.needs_attention);
      }

      setLoans(filteredLoans);
      setSummary(data.summary);
    } catch (err) {
      logger.error('Failed to load loans:', err);
      setError(err instanceof Error ? err.message : 'Failed to load loans');
    } finally {
      setLoading(false);
    }
  }, [organizationId, exhibitionId, filter]);

  useEffect(() => {
    loadLoans();
  }, [loadLoans]);

  // Load single loan details
  const loadLoanDetails = async (linkId: string) => {
    try {
      const data = await apiFetch<Loan>(
        `/organizations/${organizationId}/exhibit/exhibitions/${exhibitionId}/loans/${linkId}`
      );
      setSelectedLoan(data);
    } catch (err) {
      logger.error('Failed to load loan details:', err);
    }
  };

  // Open loan drawer
  const openLoanDrawer = async (loan: Loan) => {
    setSelectedLoan(loan);
    setIsDrawerOpen(true);
    await loadLoanDetails(loan.link_id);
  };

  // Save loan
  const saveLoan = async () => {
    if (!editingLoan) return;

    try {
      setSaving(true);
      setError(null);

      const isNew = !editingLoan.link_id;
      const url = isNew
        ? `/organizations/${organizationId}/exhibit/exhibitions/${exhibitionId}/loans`
        : `/organizations/${organizationId}/exhibit/exhibitions/${exhibitionId}/loans/${editingLoan.link_id}`;

      await apiFetch(url, {
        method: isNew ? 'POST' : 'PATCH',
        body: JSON.stringify({
          loan_id: editingLoan.loan_id || crypto.randomUUID(),
          loan_type: editingLoan.loan_type,
          loan_number: editingLoan.loan_number,
          party_name: editingLoan.party_name,
          party_contact: editingLoan.party_contact,
          status: editingLoan.status,
          status_notes: editingLoan.status_notes,
          agreement_signed: editingLoan.agreement_signed,
          agreement_signed_date: editingLoan.agreement_signed_date,
          insurance_confirmed: editingLoan.insurance_confirmed,
          insurance_policy: editingLoan.insurance_policy,
          insurance_value: editingLoan.insurance_value,
          request_date: editingLoan.request_date,
          loan_start_date: editingLoan.loan_start_date,
          loan_end_date: editingLoan.loan_end_date,
          object_count: editingLoan.object_count,
          notes: editingLoan.notes,
        }),
      });

      setIsFormOpen(false);
      setEditingLoan(null);
      await loadLoans();
    } catch (err) {
      logger.error('Failed to save loan:', err);
      setError(err instanceof Error ? err.message : 'Failed to save loan');
    } finally {
      setSaving(false);
    }
  };

  // Delete loan
  const deleteLoan = async (loan: Loan) => {
    try {
      await apiFetch(
        `/organizations/${organizationId}/exhibit/exhibitions/${exhibitionId}/loans/${loan.link_id}`,
        { method: 'DELETE' }
      );
      setDeleteConfirm(null);
      setIsDrawerOpen(false);
      await loadLoans();
    } catch (err) {
      logger.error('Failed to delete loan:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete loan');
    }
  };

  // Quick actions
  const markAgreementSigned = async (loan: Loan) => {
    try {
      await apiFetch(
        `/organizations/${organizationId}/exhibit/exhibitions/${exhibitionId}/loans/${loan.link_id}/agreement`,
        {
          method: 'POST',
          body: JSON.stringify({ signed: true }),
        }
      );
      await loadLoans();
      if (selectedLoan?.link_id === loan.link_id) {
        await loadLoanDetails(loan.link_id);
      }
    } catch (err) {
      logger.error('Failed to update agreement:', err);
    }
  };

  const confirmInsurance = async (loan: Loan) => {
    try {
      await apiFetch(
        `/organizations/${organizationId}/exhibit/exhibitions/${exhibitionId}/loans/${loan.link_id}/insurance`,
        {
          method: 'POST',
          body: JSON.stringify({ confirmed: true }),
        }
      );
      await loadLoans();
      if (selectedLoan?.link_id === loan.link_id) {
        await loadLoanDetails(loan.link_id);
      }
    } catch (err) {
      logger.error('Failed to confirm insurance:', err);
    }
  };

  const updateStatus = async (loan: Loan, newStatus: LoanStatus) => {
    try {
      await apiFetch(
        `/organizations/${organizationId}/exhibit/exhibitions/${exhibitionId}/loans/${loan.link_id}/status`,
        {
          method: 'POST',
          body: JSON.stringify({ status: newStatus }),
        }
      );
      await loadLoans();
      if (selectedLoan?.link_id === loan.link_id) {
        await loadLoanDetails(loan.link_id);
      }
    } catch (err) {
      logger.error('Failed to update status:', err);
    }
  };

  // Start new loan
  const startNewLoan = (loanType: LoanType = 'loan_in') => {
    setEditingLoan({
      loan_type: loanType,
      status: 'requested',
      agreement_signed: false,
      insurance_confirmed: false,
    });
    setIsFormOpen(true);
  };

  // Edit existing loan
  const startEditLoan = (loan: Loan) => {
    setEditingLoan({ ...loan });
    setIsFormOpen(true);
    setIsDrawerOpen(false);
  };

  if (loading && loans.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <MadronaLoader variant="dots" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium text-ink">Agreements & Loans</h2>
          <p className="text-sm text-ink/60 mt-1">Track loan agreements for this exhibition</p>
        </div>
        {isEditing && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => startNewLoan('loan_out')}
              className="flex items-center gap-2 px-3 py-2 border border-lichen rounded-lg text-ink hover:bg-stone/50 transition-colors"
            >
              <ArrowUpRight className="w-4 h-4 text-semantic-info" />
              Loan Out
            </button>
            <button
              onClick={() => startNewLoan('loan_in')}
              className="flex items-center gap-2 px-4 py-2 bg-bark text-parchment rounded-lg hover:bg-copper-dark hover:text-parchment transition-colors"
            >
              <Plus className="w-4 h-4" />
              Loan In
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-semantic-error text-sm">
          {error}
        </div>
      )}

      {/* Summary Cards */}
      {summary && summary.total > 0 && (
        <div className="grid grid-cols-5 gap-4">
          <button
            onClick={() => setFilter('all')}
            className={`text-left rounded-lg p-4 transition-colors ${
              filter === 'all' ? 'bg-bark/10 ring-2 ring-bark' : 'bg-parchment/50 hover:bg-parchment'
            }`}
          >
            <div className="text-sm text-ink/60 mb-1">Total</div>
            <div className="text-2xl font-semibold text-ink">{summary.total}</div>
          </button>
          <button
            onClick={() => setFilter('loan_in')}
            className={`text-left rounded-lg p-4 transition-colors ${
              filter === 'loan_in' ? 'bg-semantic-success/10 ring-2 ring-semantic-success' : 'bg-parchment/50 hover:bg-parchment'
            }`}
          >
            <div className="text-sm text-ink/60 mb-1 flex items-center gap-1">
              <ArrowDownLeft className="w-3.5 h-3.5 text-semantic-success" />
              Loans In
            </div>
            <div className="text-2xl font-semibold text-semantic-success">{summary.loans_in}</div>
          </button>
          <button
            onClick={() => setFilter('loan_out')}
            className={`text-left rounded-lg p-4 transition-colors ${
              filter === 'loan_out' ? 'bg-semantic-info/10 ring-2 ring-semantic-info' : 'bg-parchment/50 hover:bg-parchment'
            }`}
          >
            <div className="text-sm text-ink/60 mb-1 flex items-center gap-1">
              <ArrowUpRight className="w-3.5 h-3.5 text-semantic-info" />
              Loans Out
            </div>
            <div className="text-2xl font-semibold text-semantic-info">{summary.loans_out}</div>
          </button>
          <button
            onClick={() => setFilter('attention')}
            className={`text-left rounded-lg p-4 transition-colors ${
              filter === 'attention' ? 'bg-semantic-warning/10 ring-2 ring-semantic-warning' : 'bg-parchment/50 hover:bg-parchment'
            }`}
          >
            <div className="text-sm text-ink/60 mb-1 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5 text-semantic-warning" />
              Needs Attention
            </div>
            <div className="text-2xl font-semibold text-semantic-warning">{summary.needs_attention}</div>
          </button>
          <div className="bg-parchment/50 rounded-lg p-4">
            <div className="text-sm text-ink/60 mb-1">Active</div>
            <div className="text-2xl font-semibold text-ink">{summary.active}</div>
          </div>
        </div>
      )}

      {/* Status Indicators */}
      {summary && (summary.agreements_pending > 0 || summary.insurance_pending > 0) && (
        <div className="flex items-center gap-4 p-4 bg-semantic-warning/10 border border-semantic-warning/30 rounded-lg">
          {summary.agreements_pending > 0 && (
            <div className="flex items-center gap-2 text-sm text-semantic-warning">
              <FileText className="w-4 h-4" />
              <span>{summary.agreements_pending} agreement(s) pending signature</span>
            </div>
          )}
          {summary.insurance_pending > 0 && (
            <div className="flex items-center gap-2 text-sm text-semantic-warning">
              <Shield className="w-4 h-4" />
              <span>{summary.insurance_pending} loan(s) awaiting insurance confirmation</span>
            </div>
          )}
        </div>
      )}

      {/* Loans Table */}
      {loans.length === 0 ? (
        <div className="text-center py-12 bg-stone/20 rounded-lg">
          <FileText className="w-12 h-12 mx-auto mb-3 text-ink/30" />
          <p className="text-ink/50 mb-4">No loans linked to this exhibition</p>
          {isEditing && (
            <button
              onClick={() => startNewLoan()}
              className="text-bark hover:text-copper-dark transition-colors"
            >
              Link your first loan agreement
            </button>
          )}
        </div>
      ) : (
        <div className="bg-parchment border border-lichen rounded-lg overflow-hidden">
          {/* Table Header */}
          <div className="grid grid-cols-[1fr_180px_100px_100px_120px_48px] gap-4 px-4 py-3 bg-stone/30 border-b border-lichen text-sm font-medium text-ink/70">
            <div>Lender / Borrower</div>
            <div>Status</div>
            <div className="text-center">Agreement</div>
            <div className="text-center">Insurance</div>
            <div>Dates</div>
            <div></div>
          </div>

          {/* Table Body */}
          <div className="divide-y divide-lichen">
            {loans.map((loan) => {
              const TypeIcon = loan.loan_type === 'loan_in' ? ArrowDownLeft : ArrowUpRight;
              const typeColor = loan.loan_type === 'loan_in' ? 'text-semantic-success' : 'text-semantic-info';
              const statusConfig = STATUS_CONFIG[loan.status];

              return (
                <div
                  key={loan.link_id}
                  className={`grid grid-cols-[1fr_180px_100px_100px_120px_48px] gap-4 px-4 py-3 items-center hover:bg-stone cursor-pointer ${
                    loan.needs_attention ? 'bg-semantic-warning/10' : ''
                  }`}
                  onClick={() => openLoanDrawer(loan)}
                >
                  {/* Party */}
                  <div className="flex items-center gap-3">
                    <TypeIcon className={`w-4 h-4 ${typeColor} flex-shrink-0`} />
                    <div className="min-w-0">
                      <div className="font-medium text-ink truncate">
                        {loan.party_name || 'Unknown party'}
                      </div>
                      {loan.loan_number && (
                        <div className="text-xs text-ink/50">{loan.loan_number}</div>
                      )}
                    </div>
                  </div>

                  {/* Status */}
                  <div>
                    <span className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-full ${statusConfig.bg} ${statusConfig.text}`}>
                      {loan.status_label}
                    </span>
                  </div>

                  {/* Agreement */}
                  <div className="text-center">
                    {loan.agreement_signed ? (
                      <CheckCircle2 className="w-5 h-5 text-semantic-success mx-auto" />
                    ) : loan.is_active ? (
                      <AlertCircle className="w-5 h-5 text-semantic-warning mx-auto" />
                    ) : (
                      <span className="text-ink/30">—</span>
                    )}
                  </div>

                  {/* Insurance */}
                  <div className="text-center">
                    {loan.insurance_confirmed ? (
                      <CheckCircle2 className="w-5 h-5 text-semantic-success mx-auto" />
                    ) : loan.is_active ? (
                      <AlertCircle className="w-5 h-5 text-semantic-warning mx-auto" />
                    ) : (
                      <span className="text-ink/30">—</span>
                    )}
                  </div>

                  {/* Dates */}
                  <div className="text-sm text-ink/60">
                    {loan.loan_start_date && loan.loan_end_date ? (
                      <div>
                        <div>{formatDateShort(loan.loan_start_date)}</div>
                        <div className="text-xs">to {formatDateShort(loan.loan_end_date)}</div>
                      </div>
                    ) : (
                      '—'
                    )}
                  </div>

                  {/* Arrow */}
                  <div className="flex justify-end">
                    <ChevronRight className="w-4 h-4 text-ink/40" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Loan Detail Drawer */}
      <SlideOver
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        title={selectedLoan?.party_name || 'Loan Details'}
      >
        {selectedLoan && (
          <div className="space-y-6">
            {/* Type & Status */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {selectedLoan.loan_type === 'loan_in' ? (
                  <span className="flex items-center gap-1 text-sm font-medium text-semantic-success">
                    <ArrowDownLeft className="w-4 h-4" />
                    Loan In
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-sm font-medium text-semantic-info">
                    <ArrowUpRight className="w-4 h-4" />
                    Loan Out
                  </span>
                )}
                {selectedLoan.loan_number && (
                  <span className="text-sm text-ink/50">• {selectedLoan.loan_number}</span>
                )}
              </div>
              {isEditing ? (
                <select
                  value={selectedLoan.status}
                  onChange={(e) => updateStatus(selectedLoan, e.target.value as LoanStatus)}
                  className={`text-sm font-medium px-3 py-1 rounded-full border-0 ${STATUS_CONFIG[selectedLoan.status]?.bg} ${STATUS_CONFIG[selectedLoan.status]?.text}`}
                >
                  {STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              ) : (
                <span className={`inline-flex items-center px-3 py-1 text-sm font-medium rounded-full ${STATUS_CONFIG[selectedLoan.status]?.bg} ${STATUS_CONFIG[selectedLoan.status]?.text}`}>
                  {selectedLoan.status_label}
                </span>
              )}
            </div>

            {/* Needs Attention Warning */}
            {selectedLoan.needs_attention && (
              <div className="flex items-center gap-2 p-3 bg-semantic-warning/10 border border-semantic-warning/30 rounded-lg text-semantic-warning text-sm">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>This loan requires attention</span>
              </div>
            )}

            {/* Party Info */}
            <div className="bg-stone/30 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <User className="w-4 h-4 text-ink/50" />
                <span className="text-sm font-medium text-ink">
                  {selectedLoan.loan_type === 'loan_in' ? 'Lender' : 'Borrower'}
                </span>
              </div>
              <div className="text-ink font-medium">{selectedLoan.party_name || '—'}</div>
              {selectedLoan.party_contact && (
                <div className="text-sm text-ink/60 mt-1">{selectedLoan.party_contact}</div>
              )}
            </div>

            {/* Agreement Status */}
            <div className={`p-4 rounded-lg ${selectedLoan.agreement_signed ? 'bg-semantic-success/10' : 'bg-semantic-warning/10'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className={`w-4 h-4 ${selectedLoan.agreement_signed ? 'text-semantic-success' : 'text-semantic-warning'}`} />
                  <span className={`text-sm font-medium ${selectedLoan.agreement_signed ? 'text-semantic-success' : 'text-semantic-warning'}`}>
                    Agreement
                  </span>
                </div>
                {selectedLoan.agreement_signed ? (
                  <div className="flex items-center gap-1 text-semantic-success">
                    <CheckCircle2 className="w-4 h-4" />
                    <span className="text-sm">Signed {selectedLoan.agreement_signed_date && formatDateShort(selectedLoan.agreement_signed_date)}</span>
                  </div>
                ) : isEditing ? (
                  <button
                    onClick={() => markAgreementSigned(selectedLoan)}
                    className="text-sm text-semantic-warning hover:text-semantic-warning font-medium"
                  >
                    Mark as Signed
                  </button>
                ) : (
                  <span className="text-sm text-semantic-warning">Pending</span>
                )}
              </div>
            </div>

            {/* Insurance Status */}
            <div className={`p-4 rounded-lg ${selectedLoan.insurance_confirmed ? 'bg-semantic-success/10' : 'bg-semantic-warning/10'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Shield className={`w-4 h-4 ${selectedLoan.insurance_confirmed ? 'text-semantic-success' : 'text-semantic-warning'}`} />
                  <span className={`text-sm font-medium ${selectedLoan.insurance_confirmed ? 'text-semantic-success' : 'text-semantic-warning'}`}>
                    Insurance
                  </span>
                </div>
                {selectedLoan.insurance_confirmed ? (
                  <div className="flex items-center gap-1 text-semantic-success">
                    <CheckCircle2 className="w-4 h-4" />
                    <span className="text-sm">Confirmed</span>
                  </div>
                ) : isEditing ? (
                  <button
                    onClick={() => confirmInsurance(selectedLoan)}
                    className="text-sm text-semantic-warning hover:text-semantic-warning font-medium"
                  >
                    Confirm Insurance
                  </button>
                ) : (
                  <span className="text-sm text-semantic-warning">Pending</span>
                )}
              </div>
              {selectedLoan.insurance_confirmed && (selectedLoan.insurance_policy || selectedLoan.insurance_value) && (
                <div className="mt-2 pt-2 border-t border-semantic-success/30 text-sm text-semantic-success">
                  {selectedLoan.insurance_policy && <div>Policy: {selectedLoan.insurance_policy}</div>}
                  {selectedLoan.insurance_value && <div>Value: {selectedLoan.insurance_value}</div>}
                </div>
              )}
            </div>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs font-medium text-ink/50 uppercase tracking-wide">Loan Start</div>
                <div className="text-sm text-ink mt-1">{formatDateShort(selectedLoan.loan_start_date)}</div>
              </div>
              <div>
                <div className="text-xs font-medium text-ink/50 uppercase tracking-wide">Loan End</div>
                <div className="text-sm text-ink mt-1">{formatDateShort(selectedLoan.loan_end_date)}</div>
              </div>
              {selectedLoan.request_date && (
                <div>
                  <div className="text-xs font-medium text-ink/50 uppercase tracking-wide">Requested</div>
                  <div className="text-sm text-ink mt-1">{formatDateShort(selectedLoan.request_date)}</div>
                </div>
              )}
              {selectedLoan.actual_return_date && (
                <div>
                  <div className="text-xs font-medium text-ink/50 uppercase tracking-wide">Returned</div>
                  <div className="text-sm text-ink mt-1">{formatDateShort(selectedLoan.actual_return_date)}</div>
                </div>
              )}
            </div>

            {/* Objects */}
            {selectedLoan.object_count && (
              <div>
                <div className="text-xs font-medium text-ink/50 uppercase tracking-wide mb-2">Objects</div>
                <div className="text-sm text-ink">{selectedLoan.object_count}</div>
              </div>
            )}

            {selectedLoan.objects && selectedLoan.objects.length > 0 && (
              <div className="space-y-2">
                {selectedLoan.objects.map((obj) => (
                  <div key={obj.loan_object_id} className="flex items-center justify-between p-2 bg-stone/30 rounded">
                    <div>
                      <div className="text-sm font-medium text-ink">{obj.object_number || obj.object_id.slice(0, 8)}</div>
                      {obj.object_title && (
                        <div className="text-xs text-ink/60">{obj.object_title}</div>
                      )}
                    </div>
                    <Link2 className="w-3.5 h-3.5 text-ink/40" />
                  </div>
                ))}
              </div>
            )}

            {/* Notes */}
            {selectedLoan.notes && (
              <div>
                <div className="text-xs font-medium text-ink/50 uppercase tracking-wide mb-2">Notes</div>
                <div className="text-sm text-ink bg-stone/30 rounded-lg p-3">{selectedLoan.notes}</div>
              </div>
            )}

            {/* Actions */}
            {isEditing && (
              <div className="flex items-center gap-2 pt-4 border-t border-lichen">
                <button
                  onClick={() => startEditLoan(selectedLoan)}
                  className="flex items-center gap-2 px-4 py-2 border border-lichen rounded-lg text-ink hover:bg-stone/50 transition-colors"
                >
                  <Edit3 className="w-4 h-4" />
                  Edit
                </button>
                <button
                  onClick={() => setDeleteConfirm(selectedLoan)}
                  className="flex items-center gap-2 px-4 py-2 border border-semantic-error/30 rounded-lg text-semantic-error hover:bg-semantic-error/10 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  Remove
                </button>
              </div>
            )}
          </div>
        )}
      </SlideOver>

      {/* Create/Edit Form Drawer */}
      <SlideOver
        isOpen={isFormOpen}
        onClose={() => {
          setIsFormOpen(false);
          setEditingLoan(null);
        }}
        title={editingLoan?.link_id ? 'Edit Loan' : 'Link Loan'}
      >
        {editingLoan && (
          <div className="space-y-4">
            {/* Loan Type */}
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Loan Type</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditingLoan({ ...editingLoan, loan_type: 'loan_in' })}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg border transition-colors ${
                    editingLoan.loan_type === 'loan_in'
                      ? 'bg-semantic-success/10 border-semantic-success text-semantic-success'
                      : 'border-lichen text-ink/60 hover:border-ink/30'
                  }`}
                >
                  <ArrowDownLeft className="w-4 h-4" />
                  Loan In
                </button>
                <button
                  type="button"
                  onClick={() => setEditingLoan({ ...editingLoan, loan_type: 'loan_out' })}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg border transition-colors ${
                    editingLoan.loan_type === 'loan_out'
                      ? 'bg-semantic-info/10 border-semantic-info text-semantic-info'
                      : 'border-lichen text-ink/60 hover:border-ink/30'
                  }`}
                >
                  <ArrowUpRight className="w-4 h-4" />
                  Loan Out
                </button>
              </div>
            </div>

            {/* Party Info */}
            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                {editingLoan.loan_type === 'loan_in' ? 'Lender Name' : 'Borrower Name'}
              </label>
              <input
                type="text"
                value={editingLoan.party_name || ''}
                onChange={(e) => setEditingLoan({ ...editingLoan, party_name: e.target.value })}
                placeholder="Institution or individual name"
                className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-ink mb-1">Contact</label>
              <input
                type="text"
                value={editingLoan.party_contact || ''}
                onChange={(e) => setEditingLoan({ ...editingLoan, party_contact: e.target.value })}
                placeholder="Contact person or email"
                className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-ink mb-1">Loan Number</label>
              <input
                type="text"
                value={editingLoan.loan_number || ''}
                onChange={(e) => setEditingLoan({ ...editingLoan, loan_number: e.target.value })}
                placeholder="e.g., LI-2026-001"
                className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              />
            </div>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Loan Start</label>
                <input
                  type="date"
                  value={editingLoan.loan_start_date || ''}
                  onChange={(e) => setEditingLoan({ ...editingLoan, loan_start_date: e.target.value })}
                  className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Loan End</label>
                <input
                  type="date"
                  value={editingLoan.loan_end_date || ''}
                  onChange={(e) => setEditingLoan({ ...editingLoan, loan_end_date: e.target.value })}
                  className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                />
              </div>
            </div>

            {/* Agreement */}
            <div className="flex items-center gap-3 p-3 bg-stone/30 rounded-lg">
              <Checkbox
                id="agreement_signed"
                checked={editingLoan.agreement_signed || false}
                onChange={(e) => setEditingLoan({ ...editingLoan, agreement_signed: e.target.checked })}
              />
              <label htmlFor="agreement_signed" className="text-sm text-ink">
                Agreement signed
              </label>
            </div>

            {/* Insurance */}
            <div className="flex items-center gap-3 p-3 bg-stone/30 rounded-lg">
              <Checkbox
                id="insurance_confirmed"
                checked={editingLoan.insurance_confirmed || false}
                onChange={(e) => setEditingLoan({ ...editingLoan, insurance_confirmed: e.target.checked })}
              />
              <label htmlFor="insurance_confirmed" className="text-sm text-ink">
                Insurance confirmed
              </label>
            </div>

            {editingLoan.insurance_confirmed && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">Policy Number</label>
                  <input
                    type="text"
                    value={editingLoan.insurance_policy || ''}
                    onChange={(e) => setEditingLoan({ ...editingLoan, insurance_policy: e.target.value })}
                    className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">Coverage Value</label>
                  <input
                    type="text"
                    value={editingLoan.insurance_value || ''}
                    onChange={(e) => setEditingLoan({ ...editingLoan, insurance_value: e.target.value })}
                    placeholder="e.g., $500,000"
                    className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  />
                </div>
              </div>
            )}

            {/* Object Count */}
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Objects</label>
              <input
                type="text"
                value={editingLoan.object_count || ''}
                onChange={(e) => setEditingLoan({ ...editingLoan, object_count: e.target.value })}
                placeholder="e.g., 3 paintings"
                className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              />
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Notes</label>
              <textarea
                value={editingLoan.notes || ''}
                onChange={(e) => setEditingLoan({ ...editingLoan, notes: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              />
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-4 border-t border-lichen">
              <button
                onClick={() => {
                  setIsFormOpen(false);
                  setEditingLoan(null);
                }}
                className="px-4 py-2 text-ink/60 hover:text-ink transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveLoan}
                disabled={saving || !editingLoan.party_name}
                className="flex items-center gap-2 px-4 py-2 bg-bark text-parchment rounded-lg hover:bg-copper-dark hover:text-parchment transition-colors disabled:opacity-50"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingLoan.link_id ? 'Save Changes' : 'Link Loan'}
              </button>
            </div>
          </div>
        )}
      </SlideOver>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => deleteConfirm && deleteLoan(deleteConfirm)}
        title="Remove Loan"
        message={`Are you sure you want to remove the loan from "${deleteConfirm?.party_name || 'this party'}" from this exhibition?`}
        confirmText="Remove"
        confirmStyle="danger"
      />
    </div>
  );
}
