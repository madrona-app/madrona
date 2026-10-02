import { X } from 'lucide-react';
import { formatDateShort } from '../../lib/formatters';
import type { ExhibitionLabel } from '../../lib/api';
import { ModalPortal } from '../ModalPortal';

interface LabelPreviewProps {
  isOpen: boolean;
  label: ExhibitionLabel;
  onClose: () => void;
}

export function LabelPreview({ isOpen, label, onClose }: LabelPreviewProps) {
  if (!isOpen) return null;

  return (
    <ModalPortal>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50">
      <div className="bg-parchment rounded-lg max-w-xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-lichen">
          <div>
            <h3 className="text-lg font-medium text-ink">Label Preview</h3>
            <p className="text-sm text-archive capitalize">{label.label_type} label</p>
          </div>
          <button onClick={onClose} className="p-1 text-archive hover:text-ink">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {/* Label content preview */}
          <div className="border border-lichen rounded-lg p-6 bg-parchment shadow-sm">
            <div className="whitespace-pre-wrap text-sm text-ink leading-relaxed">
              {label.custom_text || label.generated_text}
            </div>
          </div>

          {/* Metadata */}
          <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-archive">Status:</span>{' '}
              <span className="text-ink capitalize">{label.status}</span>
            </div>
            <div>
              <span className="text-archive">Print Count:</span>{' '}
              <span className="text-ink">{label.print_count}</span>
            </div>
            {label.approved_at && (
              <div>
                <span className="text-archive">Approved:</span>{' '}
                <span className="text-ink">
                  {formatDateShort(label.approved_at)}
                </span>
              </div>
            )}
            {label.last_printed_at && (
              <div>
                <span className="text-archive">Last Printed:</span>{' '}
                <span className="text-ink">
                  {formatDateShort(label.last_printed_at)}
                </span>
              </div>
            )}
          </div>

          {/* Custom text indicator */}
          {label.custom_text && (
            <div className="mt-4 p-3 bg-bark/5 border border-bark/20 rounded-lg">
              <p className="text-xs text-archive">
                This label has custom text that overrides the generated content.
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-lichen">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-lichen rounded-lg hover:bg-stone/50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}

export default LabelPreview;
