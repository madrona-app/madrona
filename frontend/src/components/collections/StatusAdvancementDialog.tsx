/**
 * StatusAdvancementDialog Component
 *
 * Modal dialog that validates procedure requirements before allowing
 * status transitions. Shows validation errors and warnings.
 */

import {
  CheckCircle,
  AlertTriangle,
  XCircle,
  X,
} from 'lucide-react';
import { useAccessibleModal, getModalAriaProps } from '../../hooks/useAccessibleModal';
import type { ValidationResult } from '../../lib/procedureValidation';
import { ModalPortal } from '../ModalPortal';

interface StatusAdvancementDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  currentStatus: string;
  targetStatus: string;
  targetStatusLabel: string;
  validation: ValidationResult;
  isLoading?: boolean;
  /** Optional callback for admin exception bypass */
  onAdvanceWithException?: () => void;
}

export function StatusAdvancementDialog({
  isOpen,
  onClose,
  onConfirm,
  currentStatus: _currentStatus,
  targetStatus: _targetStatus,
  targetStatusLabel,
  validation,
  isLoading = false,
  onAdvanceWithException,
}: StatusAdvancementDialogProps) {
  const { modalRef, titleId, descriptionId } = useAccessibleModal({
    isOpen,
    onClose,
    titlePrefix: 'status-advancement-dialog',
  });

  if (!isOpen) return null;

  const { valid, errors, warnings } = validation;

  return (
    <ModalPortal>
    { }
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/50"
      onClick={onClose}
    >
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        ref={modalRef}
        {...getModalAriaProps(titleId, descriptionId)}
        className="bg-parchment dark:bg-forest rounded-lg max-w-md w-[90%] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-lichen dark:border-lichen flex items-start justify-between">
          <h2
            id={titleId}
            className="m-0 text-lg font-semibold text-ink dark:text-stone font-serif"
          >
            {valid ? 'Confirm Status Change' : 'Cannot Change Status'}
          </h2>
          <button
            type="button"
            className="rounded-md text-archive hover:text-archive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5" id={descriptionId}>
          {valid ? (
            <div className="flex items-start gap-3">
              <CheckCircle className="h-6 w-6 text-semantic-success flex-shrink-0" />
              <div>
                <p className="text-sm text-ink dark:text-stone">
                  All requirements are met. You can advance this record to{' '}
                  <span className="font-medium">{targetStatusLabel}</span>.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3">
              <XCircle className="h-6 w-6 text-semantic-error flex-shrink-0" />
              <div>
                <p className="text-sm text-ink dark:text-stone">
                  The following requirements must be completed before advancing to{' '}
                  <span className="font-medium">{targetStatusLabel}</span>:
                </p>
              </div>
            </div>
          )}

          {errors.length > 0 && (
            <ul className="mt-3 ml-9 space-y-1">
              {errors.map((error, index) => (
                <li
                  key={index}
                  className="text-sm text-semantic-error dark:text-semantic-error flex items-center gap-2"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-semantic-error/100 flex-shrink-0" />
                  {error}
                </li>
              ))}
            </ul>
          )}

          {warnings.length > 0 && (
            <div className="mt-4 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-semantic-warning flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-semantic-warning dark:text-semantic-warning">
                  Recommendations:
                </p>
                <ul className="mt-1 space-y-1">
                  {warnings.map((warning, index) => (
                    <li
                      key={index}
                      className="text-sm text-semantic-warning dark:text-semantic-warning"
                    >
                      {warning}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-lichen dark:border-lichen flex justify-end gap-3">
          <button
            type="button"
            className="px-4 py-2 border border-stone dark:border-lichen rounded-sm bg-parchment dark:bg-forest text-sm font-serif text-ink dark:text-stone cursor-pointer hover:bg-stone/20 dark:hover:bg-forest transition-colors"
            onClick={onClose}
          >
            {valid ? 'Cancel' : 'Close'}
          </button>
          {!valid && onAdvanceWithException && (
            <button
              type="button"
              className="px-4 py-2 border border-semantic-warning/30 dark:border-semantic-warning/30 rounded-sm bg-semantic-warning/10 dark:bg-semantic-warning/30 text-sm font-serif text-semantic-warning dark:text-semantic-warning cursor-pointer hover:bg-semantic-warning/10 dark:hover:bg-semantic-warning/50 transition-colors"
              onClick={onAdvanceWithException}
            >
              Advance with Exception
            </button>
          )}
          {valid && (
            <button
              type="button"
              className="px-4 py-2 border-none rounded-sm bg-bark text-sm font-serif text-parchment cursor-pointer hover:bg-bark/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={onConfirm}
              disabled={isLoading}
            >
              {isLoading ? 'Updating...' : `Change to ${targetStatusLabel}`}
            </button>
          )}
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}

/**
 * StatusRequirementsTooltip Component
 *
 * Shows a tooltip with requirements for a status transition.
 */
interface StatusRequirementsTooltipProps {
  targetStatus: string;
  targetStatusLabel: string;
  validation: ValidationResult;
  children: React.ReactNode;
}

export function StatusRequirementsTooltip({
  targetStatus: _targetStatus,
  targetStatusLabel,
  validation,
  children,
}: StatusRequirementsTooltipProps) {
  const { valid, errors } = validation;

  if (valid) {
    return <>{children}</>;
  }

  return (
    <div className="group relative inline-block">
      {children}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10">
        <div className="bg-ink dark:bg-forest text-parchment text-xs rounded-lg py-2 px-3 shadow-lg max-w-xs">
          <p className="font-medium mb-1">
            Required for {targetStatusLabel}:
          </p>
          <ul className="space-y-0.5">
            {errors.slice(0, 5).map((error, index) => (
              <li key={index} className="text-stone">• {error}</li>
            ))}
            {errors.length > 5 && (
              <li className="text-archive">+{errors.length - 5} more...</li>
            )}
          </ul>
          <div className="absolute left-1/2 -translate-x-1/2 top-full">
            <div className="border-8 border-transparent border-t-ink dark:border-t-forest" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default StatusAdvancementDialog;
