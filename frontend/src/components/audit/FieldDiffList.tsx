import { useState } from 'react';
import { Code2 } from 'lucide-react';
import { FieldDiffRow, type FieldDiffData } from './FieldDiffRow';
import { RawDiffModal } from './RawDiffModal';

interface FieldDiffListProps {
  diffs: FieldDiffData[];
  showRawButton?: boolean;
}

export function FieldDiffList({ diffs, showRawButton = false }: FieldDiffListProps) {
  const [rawModalOpen, setRawModalOpen] = useState(false);
  const [rawModalDiff, setRawModalDiff] = useState<FieldDiffData | null>(null);
  /** Track which field's inline detail accordion is open (by field_name) */
  const [openDetail, setOpenDetail] = useState<string | null>(null);

  if (diffs.length === 0) return null;

  const handleViewRaw = (diff: FieldDiffData) => {
    setRawModalDiff(diff);
    setRawModalOpen(true);
  };

  const handleOpenAllRaw = () => {
    setRawModalDiff(null);
    setRawModalOpen(true);
  };

  const toggleDetail = (fieldName: string) => {
    setOpenDetail((prev) => (prev === fieldName ? null : fieldName));
  };

  return (
    <>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-medium text-archive uppercase tracking-wide">
          Changed Fields
        </div>
        {showRawButton && (
          <button
            onClick={handleOpenAllRaw}
            className="inline-flex items-center gap-1 text-xs text-bark hover:text-copper-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-1 rounded"
          >
            <Code2 size={12} />
            View raw diff
          </button>
        )}
      </div>
      <div>
        {diffs.map((diff) => (
          <FieldDiffRow
            key={diff.field_name}
            diff={diff}
            detailOpen={openDetail === diff.field_name}
            onToggleDetail={() => toggleDetail(diff.field_name)}
            onViewRaw={handleViewRaw}
          />
        ))}
      </div>
      <RawDiffModal
        isOpen={rawModalOpen}
        onClose={() => setRawModalOpen(false)}
        diffs={rawModalDiff ? [rawModalDiff] : diffs}
        title={rawModalDiff ? `Raw: ${rawModalDiff.field_name}` : 'Raw Diff'}
      />
    </>
  );
}
