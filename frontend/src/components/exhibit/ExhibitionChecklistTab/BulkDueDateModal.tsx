import { useId } from 'react';
import { ModalPortal } from '../../ModalPortal';
import { useAccessibleModal, getModalAriaProps } from '../../../hooks/useAccessibleModal';

interface BulkDueDateModalProps {
  isOpen: boolean;
  selectedCount: number;
  dueDate: string;
  onDueDateChange: (date: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

export function BulkDueDateModal({
  isOpen,
  selectedCount,
  dueDate,
  onDueDateChange,
  onConfirm,
  onClose,
}: BulkDueDateModalProps) {
  const dateId = useId();
  const { modalRef, titleId, descriptionId } = useAccessibleModal({
    isOpen,
    onClose,
    titlePrefix: 'bulk-due-date',
  });
  if (!isOpen) return null;

  return (
    <ModalPortal>
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        {/* Backdrop: mouse dismiss; Escape closes via useAccessibleModal */}
        <div className="fixed inset-0 bg-ink/30" aria-hidden="true" onClick={onClose} />
        <div
          ref={modalRef}
          {...getModalAriaProps(titleId, descriptionId)}
          className="relative bg-parchment rounded-lg shadow-xl w-full max-w-sm p-6"
        >
          <h2 id={titleId} className="text-lg font-semibold text-ink mb-4">Set Due Date</h2>
          <p id={descriptionId} className="text-sm text-archive mb-4">
            Set due date for {selectedCount} selected item(s)
          </p>
          <label htmlFor={dateId} className="sr-only">Due date</label>
          <input
            id={dateId}
            type="date"
            value={dueDate}
            onChange={(e) => onDueDateChange(e.target.value)}
            className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
          />
          <div className="flex justify-end gap-2 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-archive hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={!dueDate}
              className="px-4 py-2 bg-bark text-parchment text-sm rounded-lg hover:bg-copper-dark hover:text-parchment disabled:opacity-50"
            >
              Set Date
            </button>
          </div>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
