import { ModalPortal } from '../../ModalPortal';

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
  if (!isOpen) return null;

  return (
    <ModalPortal>
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="fixed inset-0 bg-ink/30" onClick={onClose} />
        <div className="relative bg-parchment rounded-lg shadow-xl w-full max-w-sm p-6">
          <h3 className="text-lg font-semibold text-ink mb-4">Set Due Date</h3>
          <p className="text-sm text-archive mb-4">
            Set due date for {selectedCount} selected item(s)
          </p>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => onDueDateChange(e.target.value)}
            className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
          />
          <div className="flex justify-end gap-2 mt-6">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-archive hover:text-ink"
            >
              Cancel
            </button>
            <button
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
