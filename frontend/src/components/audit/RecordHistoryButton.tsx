/**
 * Change history for records managed on list and settings pages (templates,
 * lookup values, definitions, rules, folders ...): a "History" button on the
 * row opens the record's history in an accessible dialog. Records with a
 * workspace page mount RecordAuditHistory there instead.
 *
 * The button renders nothing unless the user holds the permissions the
 * history API checks for the type (see recordHistoryRegistry).
 */
import { useState } from 'react';
import { History, X } from 'lucide-react';
import { useAccessibleModal, getModalAriaProps } from '../../hooks/useAccessibleModal';
import { ModalPortal } from '../ModalPortal';
import { RecordAuditHistory } from '../workspace/RecordAuditHistory';
import { recordTypeLabel, useCanViewRecordHistory } from './useCanViewRecordHistory';

interface RecordHistoryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  organizationId: string;
  entityType: string;
  entityId: string;
  recordName: string;
}

export function RecordHistoryDialog({
  isOpen,
  onClose,
  organizationId,
  entityType,
  entityId,
  recordName,
}: RecordHistoryDialogProps) {
  const { modalRef, titleId } = useAccessibleModal({
    isOpen,
    onClose,
    titlePrefix: `record-history-${entityType}-${entityId}`,
  });

  if (!isOpen) return null;
  const typeLabel = recordTypeLabel(entityType);

  return (
    <ModalPortal>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- backdrop click-to-dismiss; Escape closes via useAccessibleModal */}
      <div
        className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/50 p-4"
        onClick={(e) => {
          // React events bubble out of the portal to the row that holds the
          // button; a clickable row must not also act on the dismiss.
          e.stopPropagation();
          onClose();
        }}
      >
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- stops backdrop dismiss */}
        <div
          ref={modalRef}
          {...getModalAriaProps(titleId)}
          className="bg-parchment rounded-lg w-full max-w-[720px] max-h-[85vh] flex flex-col shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-5 py-4 border-b border-lichen flex items-start justify-between gap-3 shrink-0">
            <h2 id={titleId} className="text-base font-semibold text-ink font-serif break-words">
              History: {typeLabel} {recordName}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={`Close history for ${typeLabel} ${recordName}`}
              className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-archive hover:text-ink rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4">
            <RecordAuditHistory
              organizationId={organizationId}
              entityType={entityType}
              entityId={entityId}
              title="Changes"
              headingLevel={3}
            />
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

interface RecordHistoryButtonProps {
  organizationId: string;
  entityType: string;
  entityId: string;
  /** The record's name as shown on the row; used in the accessible name. */
  recordName: string;
  className?: string;
  /** Show the word "History" next to the icon (default). Icon-only keeps the 44px target. */
  showLabel?: boolean;
}

const BUTTON_CLASS =
  'inline-flex items-center justify-center gap-1 min-h-[44px] min-w-[44px] px-2 text-sm text-bark hover:text-copper-dark hover:bg-bark/10 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2';

export function RecordHistoryButton({
  organizationId,
  entityType,
  entityId,
  recordName,
  className = '',
  showLabel = true,
}: RecordHistoryButtonProps) {
  const [open, setOpen] = useState(false);
  const canView = useCanViewRecordHistory(entityType);
  if (!canView || !organizationId || !entityId) return null;
  const typeLabel = recordTypeLabel(entityType);

  return (
    <>
      <button
        type="button"
        className={`${BUTTON_CLASS} ${className}`}
        aria-haspopup="dialog"
        aria-label={`History for ${typeLabel} ${recordName}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <History size={16} aria-hidden="true" />
        {showLabel && <span>History</span>}
      </button>
      <RecordHistoryDialog
        isOpen={open}
        onClose={() => setOpen(false)}
        organizationId={organizationId}
        entityType={entityType}
        entityId={entityId}
        recordName={recordName}
      />
    </>
  );
}
