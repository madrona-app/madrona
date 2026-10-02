/**
 * LoanOutDispatchDialog
 *
 * Shown when advancing a loan out to "in_transit". Surfaces cross-procedure
 * checklist items (outbound condition reports, object exit) alongside the
 * standard procedure dispatch action.
 */

import { CheckCircle, AlertTriangle, ClipboardCheck, LogOut, Loader2, X } from 'lucide-react';
import { useAccessibleModal, getModalAriaProps } from '../../../hooks/useAccessibleModal';
import { ModalPortal } from '../../../components/ModalPortal';
import type { LoanObject } from './types';

interface LoanOutDispatchDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  loanObjects: LoanObject[];
  orgId: string;
  loanId: string;
  isLoading?: boolean;
}

export function LoanOutDispatchDialog({
  isOpen,
  onClose,
  onConfirm,
  loanObjects,
  orgId: _orgId,
  loanId: _loanId,
  isLoading,
}: LoanOutDispatchDialogProps) {
  const { modalRef } = useAccessibleModal({ isOpen, onClose, titlePrefix: 'loan-out-dispatch-dialog' });

  if (!isOpen) return null;

  const totalObjects = loanObjects.length;
  const withConditionReport = loanObjects.filter(o => o.condition_report_out_id).length;
  const allReportsComplete = totalObjects > 0 && withConditionReport === totalObjects;

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40">
        <div
          ref={modalRef}
          className="bg-parchment rounded-xl shadow-xl max-w-lg w-full"
          {...getModalAriaProps('Dispatch Loan')}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-lichen">
            <h2 className="text-lg font-serif font-medium text-forest">Dispatch Loan</h2>
            <button onClick={onClose} className="p-1 text-archive hover:text-ink rounded">
              <X size={18} />
            </button>
          </div>

          {/* Body */}
          <div className="px-6 py-5 space-y-4">
            <p className="text-sm text-archive">
              Mark this loan as in transit. Review the checklist below before dispatching.
            </p>

            {/* Condition Reports */}
            <div className="border border-lichen rounded-lg p-4">
              <div className="flex items-start gap-3">
                {allReportsComplete ? (
                  <CheckCircle size={18} className="text-semantic-success mt-0.5 flex-shrink-0" />
                ) : (
                  <AlertTriangle size={18} className="text-semantic-warning mt-0.5 flex-shrink-0" />
                )}
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <ClipboardCheck size={14} className="text-archive" />
                    <span className="text-sm font-medium text-ink">Outbound Condition Reports</span>
                  </div>
                  <p className="text-sm text-archive mt-1">
                    {totalObjects === 0
                      ? 'No objects on this loan'
                      : `${withConditionReport} of ${totalObjects} object${totalObjects !== 1 ? 's' : ''} ${withConditionReport === 1 && totalObjects === 1 ? 'has' : 'have'} a condition report`
                    }
                  </p>
                  {!allReportsComplete && totalObjects > 0 && (
                    <p className="text-xs text-semantic-warning mt-1">
                      Condition reports can be linked from the Objects section.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Info: what dispatch will do */}
            <div className="border border-lichen rounded-lg p-4 bg-stone/20">
              <div className="flex items-start gap-3">
                <LogOut size={18} className="text-archive mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <span className="text-sm font-medium text-ink">Dispatching will automatically:</span>
                  <ul className="text-sm text-archive mt-1 list-disc list-inside space-y-0.5">
                    <li>Create an object exit record</li>
                    <li>Record a movement for each object</li>
                    <li>Update object locations to "On Loan"</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-lichen">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-archive hover:text-ink"
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              className="btn btn-primary text-sm flex items-center gap-2"
              disabled={isLoading}
            >
              {isLoading ? (
                <><Loader2 size={16} className="animate-spin" /> Dispatching...</>
              ) : (
                'Dispatch Loan'
              )}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
