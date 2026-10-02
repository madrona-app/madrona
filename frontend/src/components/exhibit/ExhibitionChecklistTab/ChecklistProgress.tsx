import type { ChecklistItem } from './types';
import { PHASE_ORDER } from './constants';
import { MadronaProgressBar } from '../../ui/MadronaLoader';

interface ChecklistProgressHeaderProps {
  checklistName: string;
  items: ChecklistItem[];
  allExpanded: boolean;
  onToggleAll: () => void;
}

export function ChecklistProgressHeader({
  checklistName,
  items,
  allExpanded,
  onToggleAll,
}: ChecklistProgressHeaderProps) {
  const totalItems = items.length;
  const doneItems = items.filter(
    (i) => i.status === 'done' || i.status === 'not_applicable'
  ).length;
  const overallProgress = totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0;

  return (
    <div className="flex items-center justify-between">
      <div>
        <h2 className="text-lg font-semibold text-ink">{checklistName}</h2>
        <MadronaProgressBar
          value={overallProgress}
          label={`${doneItems} of ${totalItems} complete`}
          className="w-48 mt-2"
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onToggleAll}
          className="px-3 py-1.5 text-sm text-archive hover:text-ink border border-lichen rounded-lg"
        >
          {allExpanded ? 'Collapse All' : 'Expand All'}
        </button>
      </div>
    </div>
  );
}

export function calculatePhaseProgress(items: ChecklistItem[], phase: string): { done: number; total: number; percent: number } {
  const phaseItems = items.filter((i) => i.phase === phase);
  const done = phaseItems.filter((i) => i.status === 'done' || i.status === 'not_applicable').length;
  const total = phaseItems.length;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return { done, total, percent };
}

export function groupItemsByPhase(items: ChecklistItem[]): Record<string, ChecklistItem[]> {
  return PHASE_ORDER.reduce((acc, phase) => {
    acc[phase] = items.filter((item) => item.phase === phase);
    return acc;
  }, {} as Record<string, ChecklistItem[]>);
}
