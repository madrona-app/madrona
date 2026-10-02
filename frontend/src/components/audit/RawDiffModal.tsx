import { useState } from 'react';
import { X, Copy, Check } from 'lucide-react';
import { useAccessibleModal, getModalAriaProps } from '../../hooks/useAccessibleModal';
import type { FieldDiffData } from './FieldDiffRow';
import { formatFieldName } from './formatFieldName';
import { ModalPortal } from '../ModalPortal';

interface RawDiffModalProps {
  isOpen: boolean;
  onClose: () => void;
  diffs: FieldDiffData[];
  title?: string;
}

export function RawDiffModal({ isOpen, onClose, diffs, title = 'Raw Diff' }: RawDiffModalProps) {
  const { modalRef, titleId } = useAccessibleModal({
    isOpen,
    onClose,
    titlePrefix: 'raw-diff-modal',
  });
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopy = async () => {
    const json = JSON.stringify(
      diffs.map((d) => ({
        field: d.field_name,
        before: d.old_value,
        after: d.new_value,
      })),
      null,
      2,
    );
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: do nothing if clipboard API unavailable
    }
  };

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
        {...getModalAriaProps(titleId)}
        className="bg-parchment rounded-lg max-w-[700px] w-[90%] max-h-[80vh] flex flex-col shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-lichen flex items-center justify-between shrink-0">
          <h2 id={titleId} className="text-base font-semibold text-ink font-serif">
            {title}
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-lichen rounded hover:bg-stone/30 text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-1"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy JSON'}
            </button>
            <button
              onClick={onClose}
              className="p-1 text-archive hover:text-ink rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-1"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body — scrollable */}
        <div className="overflow-y-auto px-5 py-4 space-y-4">
          {diffs.map((diff) => (
            <div key={diff.field_name}>
              <div className="text-sm font-medium text-ink mb-2">
                {formatFieldName(diff.field_name)}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-archive mb-1">Before</div>
                  <pre className="bg-stone/30 text-ink p-2.5 rounded text-xs overflow-auto max-h-48 whitespace-pre-wrap break-words">
                    {JSON.stringify(diff.old_value, null, 2)}
                  </pre>
                </div>
                <div>
                  <div className="text-xs text-archive mb-1">After</div>
                  <pre className="bg-stone/30 text-ink p-2.5 rounded text-xs overflow-auto max-h-48 whitespace-pre-wrap break-words">
                    {JSON.stringify(diff.new_value, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
