/**
 * AdvanceWithExceptionDialog Component
 *
 * Modal for admin users to bypass blocking procedure requirements
 * with an audited reason. Creates an audit log entry for compliance.
 */

import { useState, useCallback } from 'react';
import {
  AlertTriangle,
  X,
  Shield,
  FileWarning,
} from 'lucide-react';
import { useAccessibleModal, getModalAriaProps } from '../../hooks/useAccessibleModal';
import type { RequirementResult } from '../../lib/procedureComplianceUtils';
import { ModalPortal } from '../ModalPortal';

interface AdvanceWithExceptionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason: string, bypassedRequirementIds: string[]) => void;
  currentStatus: string;
  targetStatus: string;
  targetStatusLabel: string;
  blockingRequirements: RequirementResult[];
  isLoading?: boolean;
}

const MIN_REASON_LENGTH = 10;

export function AdvanceWithExceptionDialog({
  isOpen,
  onClose,
  onConfirm,
  currentStatus: _currentStatus,
  targetStatus: _targetStatus,
  targetStatusLabel,
  blockingRequirements,
  isLoading = false,
}: AdvanceWithExceptionDialogProps) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { modalRef, titleId, descriptionId } = useAccessibleModal({ isOpen, onClose, titlePrefix: 'advance-exception-dialog' });

  const handleConfirm = useCallback(() => {
    if (reason.trim().length < MIN_REASON_LENGTH) {
      setError(`Reason must be at least ${MIN_REASON_LENGTH} characters.`);
      return;
    }

    const bypassedIds = blockingRequirements.map(r => r.requirement.id);
    onConfirm(reason.trim(), bypassedIds);
    setReason('');
    setError(null);
  }, [reason, blockingRequirements, onConfirm]);

  const handleClose = useCallback(() => {
    setReason('');
    setError(null);
    onClose();
  }, [onClose]);

  const handleReasonChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setReason(e.target.value);
    if (error && e.target.value.trim().length >= MIN_REASON_LENGTH) {
      setError(null);
    }
  }, [error]);

  if (!isOpen) return null;

  const ariaProps = getModalAriaProps(titleId, descriptionId);

  return (
    <ModalPortal>
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-ink/50 transition-opacity"
        onClick={handleClose}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          ref={modalRef}
          className="relative w-full max-w-lg bg-parchment dark:bg-forest rounded-lg shadow-xl"
          {...ariaProps}
        >
          {/* Header */}
          <div className="flex items-start gap-4 p-6 border-b border-lichen dark:border-lichen">
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-semantic-warning/10 dark:bg-semantic-warning/30 flex items-center justify-center">
              <Shield className="h-5 w-5 text-semantic-warning dark:text-semantic-warning" />
            </div>
            <div className="flex-1 min-w-0">
              <h2
                id={ariaProps['aria-labelledby']}
                className="text-lg font-semibold text-ink dark:text-stone"
              >
                Advance with Exception
              </h2>
              <p className="text-sm text-archive dark:text-archive mt-1">
                Override procedure requirements to advance to <strong>{targetStatusLabel}</strong>
              </p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="text-archive hover:text-archive dark:hover:text-stone"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-4">
            {/* Warning */}
            <div className="flex items-start gap-3 p-4 bg-semantic-warning/10 dark:bg-semantic-warning/20 border border-semantic-warning/30 dark:border-semantic-warning/30 rounded-lg">
              <AlertTriangle className="h-5 w-5 text-semantic-warning dark:text-semantic-warning flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-semantic-warning dark:text-semantic-warning">
                  Bypassing procedure requirements
                </p>
                <p className="text-sm text-semantic-warning dark:text-semantic-warning mt-1">
                  This action will be logged for audit purposes. You should only proceed if there is a valid exceptional circumstance.
                </p>
              </div>
            </div>

            {/* Blocked Requirements */}
            <div>
              <h3 className="text-sm font-medium text-ink dark:text-stone mb-2">
                Requirements being bypassed:
              </h3>
              <ul className="space-y-2">
                {blockingRequirements.map((result) => (
                  <li
                    key={result.requirement.id}
                    className="flex items-start gap-2 text-sm"
                  >
                    <FileWarning className="h-4 w-4 text-semantic-warning flex-shrink-0 mt-0.5" />
                    <div>
                      <span className="font-medium text-ink dark:text-stone">
                        {result.requirement.label}
                      </span>
                      {result.requirement.helpText && (
                        <p className="text-archive dark:text-archive text-xs mt-0.5">
                          {result.requirement.helpText}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {/* Reason Input */}
            <div>
              <label
                htmlFor="exception-reason"
                className="block text-sm font-medium text-ink dark:text-stone mb-1.5"
              >
                Reason for exception <span className="text-semantic-error">*</span>
              </label>
              <textarea
                id="exception-reason"
                value={reason}
                onChange={handleReasonChange}
                placeholder="Explain why these requirements are being bypassed..."
                rows={4}
                className={`w-full px-3 py-2 border rounded-md text-sm focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark dark:bg-forest dark:text-stone ${
                  error
                    ? 'border-semantic-error/30 dark:border-semantic-error/30'
                    : 'border-lichen dark:border-lichen'
                }`}
                required
                minLength={MIN_REASON_LENGTH}
              />
              {error ? (
                <p className="mt-1 text-xs text-semantic-error dark:text-semantic-error">{error}</p>
              ) : (
                <p className="mt-1 text-xs text-archive dark:text-archive">
                  Minimum {MIN_REASON_LENGTH} characters. This will be recorded in the audit log.
                </p>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-lichen dark:border-lichen bg-stone dark:bg-forest/30">
            <button
              type="button"
              onClick={handleClose}
              disabled={isLoading}
              className="px-4 py-2 text-sm font-medium text-ink dark:text-stone bg-parchment dark:bg-forest border border-lichen dark:border-lichen rounded-md hover:bg-stone dark:hover:bg-stone0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isLoading || reason.trim().length < MIN_REASON_LENGTH}
              className="px-4 py-2 text-sm font-medium text-parchment bg-semantic-warning hover:bg-semantic-warning rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Processing...' : 'Advance with Exception'}
            </button>
          </div>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}

export default AdvanceWithExceptionDialog;
