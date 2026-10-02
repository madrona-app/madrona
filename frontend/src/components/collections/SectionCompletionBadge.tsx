/**
 * SectionCompletionBadge Component
 *
 * Displays completion status for a form section based on procedure requirements.
 * Shows a checkmark when complete, or field count when partially complete.
 */

import { CheckCircle, AlertCircle } from 'lucide-react';
import type { SectionCompletion } from '../../lib/procedureValidation';

interface SectionCompletionBadgeProps {
  completion: SectionCompletion;
  showDetails?: boolean;
  size?: 'sm' | 'md';
}

export function SectionCompletionBadge({
  completion,
  showDetails = false,
  size = 'sm',
}: SectionCompletionBadgeProps) {
  const { completedCount, totalCount, requiredComplete: _requiredComplete, percentage: _percentage, missingRequired } = completion;

  const isComplete = completedCount === totalCount;
  const hasRequiredMissing = missingRequired.length > 0;

  // Determine badge style and label. When fields are missing, show the actual
  // field names (truncated to the first + count of remaining) instead of the
  // unhelpful "1/2 fields" count. The full list is in the native tooltip.
  let badgeClass: string;
  let textContent: React.ReactNode;
  let tooltip: string | undefined;

  if (isComplete) {
    badgeClass = 'bg-semantic-success/20 text-semantic-success';
    textContent = (
      <>
        <CheckCircle className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
        <span>Complete</span>
      </>
    );
    tooltip = `All ${totalCount} fields complete`;
  } else if (hasRequiredMissing) {
    badgeClass = 'bg-bark/10 text-bark';
    const first = missingRequired[0];
    const remaining = missingRequired.length - 1;
    textContent = (
      <>
        <AlertCircle className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
        <span className="truncate max-w-[16ch]">
          {first}
          {remaining > 0 && ` +${remaining}`}
        </span>
      </>
    );
    tooltip = `Missing required: ${missingRequired.join(', ')}`;
  } else {
    // All required fields complete, but some optional fields missing
    badgeClass = 'bg-semantic-info/20 text-semantic-info';
    textContent = (
      <>
        <CheckCircle className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
        <span>{completedCount}/{totalCount} fields</span>
      </>
    );
    tooltip = `Required complete. ${totalCount - completedCount} optional field${totalCount - completedCount === 1 ? '' : 's'} not filled in.`;
  }

  const sizeClasses = size === 'sm'
    ? 'text-xs px-2 py-0.5 gap-1'
    : 'text-sm px-2.5 py-1 gap-1.5';

  return (
    <div className="flex flex-col items-end gap-1">
      <span
        title={tooltip}
        className={`inline-flex items-center rounded-full font-medium ${badgeClass} ${sizeClasses}`}
      >
        {textContent}
      </span>
      {showDetails && hasRequiredMissing && (
        <span className="text-xs text-archive">
          Missing: {missingRequired.slice(0, 2).join(', ')}
          {missingRequired.length > 2 && ` +${missingRequired.length - 2} more`}
        </span>
      )}
    </div>
  );
}

/**
 * OverallCompletionBar Component
 *
 * Shows overall progress across all sections with a progress bar.
 */
interface OverallCompletionBarProps {
  percentage: number;
  requiredComplete: boolean;
  completedFields: number;
  totalFields: number;
}

export function OverallCompletionBar({
  percentage,
  requiredComplete,
  completedFields,
  totalFields,
}: OverallCompletionBarProps) {
  // Determine bar color based on completion state
  let barColor: string;
  if (percentage === 100) {
    barColor = 'bg-semantic-success/100';
  } else if (requiredComplete) {
    barColor = 'bg-semantic-info/100';
  } else {
    barColor = 'bg-semantic-warning/100';
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-accessible-gray dark:text-archive">
          Record Completion
        </span>
        <span className="font-medium text-ink dark:text-stone">
          {completedFields}/{totalFields} fields ({percentage}%)
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-lichen dark:bg-forest">
        <div
          className={`h-2 rounded-full transition-all duration-300 ${barColor}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      {!requiredComplete && (
        <p className="text-xs text-semantic-warning dark:text-semantic-warning">
          Some required fields are missing
        </p>
      )}
    </div>
  );
}

export default SectionCompletionBadge;
