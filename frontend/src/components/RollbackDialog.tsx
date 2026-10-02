import { useState } from 'react';
import { useAccessibleModal, getModalAriaProps } from '../hooks/useAccessibleModal';
import { RotateCcw } from 'lucide-react';
import { ModalPortal } from './ModalPortal';

interface RollbackDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  /** Entity type label (e.g., "Acquisition", "Loan") */
  entityLabel: string;
  /** Status the record will be reverted to */
  targetStatusLabel: string;
  /** Whether the mutation is in flight */
  isLoading?: boolean;
}

/**
 * Modal dialog for reverting an entity's status.
 * Requires a reason before allowing the rollback.
 */
export default function RollbackDialog({
  isOpen,
  onClose,
  onConfirm,
  entityLabel,
  targetStatusLabel,
  isLoading = false,
}: RollbackDialogProps) {
  const [reason, setReason] = useState('');
  const { modalRef, titleId, descriptionId } = useAccessibleModal({
    isOpen,
    onClose,
    titlePrefix: 'rollback-dialog',
  });

  if (!isOpen) return null;

  const trimmedReason = reason.trim();
  const isValid = trimmedReason.length >= 10;

  const handleConfirm = () => {
    if (!isValid || isLoading) return;
    onConfirm(trimmedReason);
    setReason('');
  };

  const handleClose = () => {
    setReason('');
    onClose();
  };

  return (
    <ModalPortal>
    { }
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/50"
      data-modal-layer="1000"
      onClick={handleClose}
    >
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        ref={modalRef}
        {...getModalAriaProps(titleId, descriptionId)}
        className="bg-parchment rounded-lg max-w-[500px] w-[90%] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-lichen">
          <h2
            id={titleId}
            className="m-0 text-lg font-semibold text-ink font-serif flex items-center gap-2"
          >
            <RotateCcw size={18} className="text-semantic-warning" />
            Revert {entityLabel} Status
          </h2>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          <p
            id={descriptionId}
            className="m-0 text-sm text-archive leading-relaxed font-serif"
          >
            This will revert the status to <strong className="text-ink">{targetStatusLabel}</strong>.
            Any dates and approvals set after that status will be cleared.
          </p>

          <div>
            <label
              htmlFor="rollback-reason"
              className="block text-sm font-medium text-ink mb-1.5"
            >
              Reason for reverting <span className="text-semantic-error">*</span>
            </label>
            <textarea
              id="rollback-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why this record needs to be reverted..."
              rows={3}
              className="w-full px-3 py-2 text-sm border border-lichen rounded-lg bg-parchment text-ink placeholder:text-archive/50 focus-visible:ring-2 ring-bark/30 ring-offset-2 resize-none"
              autoFocus
            />
            {reason.length > 0 && !isValid && (
              <p className="mt-1 text-xs text-semantic-warning">
                Please provide at least 10 characters
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-lichen flex justify-end gap-3">
          <button
            onClick={handleClose}
            disabled={isLoading}
            className="px-4 py-2 border border-stone rounded-lg bg-parchment text-sm font-serif text-ink cursor-pointer hover:bg-stone/20 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!isValid || isLoading}
            className="px-4 py-2 border-none rounded-lg text-sm font-serif text-parchment cursor-pointer transition-colors bg-semantic-warning hover:bg-semantic-warning/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Reverting...' : 'Revert Status'}
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
