import type { ReactNode } from 'react';
import { useAccessibleModal, getModalAriaProps } from '../hooks/useAccessibleModal';
import { ModalPortal } from './ModalPortal';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  confirmText?: string;
  cancelText?: string;
  confirmStyle?: 'danger' | 'primary';
}

export default function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  confirmStyle = 'primary',
}: ConfirmDialogProps) {
  const { modalRef, titleId, descriptionId } = useAccessibleModal({
    isOpen,
    onClose,
    titlePrefix: 'confirm-dialog',
  });

  if (!isOpen) return null;

  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  return (
    <ModalPortal>
    { }
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/50"
      data-modal-layer="1000"
      onClick={onClose}
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
            className="m-0 text-lg font-semibold text-ink font-serif"
          >
            {title}
          </h2>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          <div
            id={descriptionId}
            className="m-0 text-sm text-archive leading-relaxed font-serif"
          >
            {message}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-lichen flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-stone rounded-sm bg-parchment text-sm font-serif text-ink cursor-pointer hover:bg-stone/20 transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={handleConfirm}
            className={`px-4 py-2 border-none rounded-sm text-sm font-serif text-parchment cursor-pointer transition-colors ${
              confirmStyle === 'danger'
                ? 'bg-semantic-error hover:bg-semantic-error/90'
                : 'bg-bark hover:bg-bark/90'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
