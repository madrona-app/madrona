/**
 * ProcedureComplianceCard Component
 *
 * Displays Object Entry compliance status with collapsed/expanded states.
 * Shows completion percentage, blocking requirements, and navigable group checklist.
 */

import { useState, useCallback } from 'react';
import {
  ChevronDown,
  ChevronRight,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  Info,
  ArrowRight,
  ExternalLink,
} from 'lucide-react';
import type { GroupResult, RequirementGroup } from '../../lib/procedureComplianceUtils';
import { computeProcedureCompliance, getNextStatus } from '../../lib/procedureComplianceUtils';

interface ProcedureComplianceCardProps {
  entry: Record<string, unknown>;
  currentStatus: string;
  requirementGroups: RequirementGroup[];
  statusOrder: string[];
  title?: string;
  onSectionNavigate: (sectionId: string, fieldPath?: string) => void;
  onFixNext?: () => void;
  defaultExpanded?: boolean;
}

export function ProcedureComplianceCard({
  entry,
  currentStatus,
  requirementGroups,
  statusOrder,
  title = 'Procedure Compliance',
  onSectionNavigate,
  onFixNext,
  defaultExpanded = false,
}: ProcedureComplianceCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  // Compute compliance for the next logical status transition
  const nextStatus = getNextStatus(currentStatus, statusOrder);
  const compliance = computeProcedureCompliance(requirementGroups, entry, currentStatus, statusOrder, nextStatus ?? undefined);

  const {
    requiredTotal,
    requiredComplete,
    percentComplete,
    blockingMissing,
    groups,
    nextBlockingField,
  } = compliance;

  const blockingCount = blockingMissing.length;

  // Determine card status color
  const getStatusColor = () => {
    if (percentComplete === 100) return 'border-semantic-success/30 dark:border-semantic-success/30';
    if (blockingCount > 0) return 'border-semantic-warning/30 dark:border-semantic-warning/30';
    return 'border-semantic-info/30 dark:border-semantic-info/30';
  };

  const handleFixNext = useCallback(() => {
    if (nextBlockingField) {
      onSectionNavigate(nextBlockingField.sectionId, nextBlockingField.fieldPath);
    }
    onFixNext?.();
  }, [nextBlockingField, onSectionNavigate, onFixNext]);

  const handleGroupClick = useCallback((group: GroupResult) => {
    const firstMissingField = group.results.find(r => !r.satisfied)?.missingFields[0];
    onSectionNavigate(group.group.sectionId, firstMissingField);
  }, [onSectionNavigate]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent, callback: () => void) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      callback();
    }
  }, []);

  return (
    <div className={`rounded-lg border-2 bg-parchment dark:bg-forest overflow-hidden transition-colors ${getStatusColor()}`}>
      {/* Collapsed Header */}
      <button
        type="button"
        className="w-full flex items-center justify-between p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-bark/30 focus-visible:ring-offset-2"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        aria-controls="compliance-panel"
      >
        <div className="flex items-center gap-3 flex-1">
          {/* Status Icon */}
          {percentComplete === 100 ? (
            <CheckCircle className="h-6 w-6 text-semantic-success flex-shrink-0" />
          ) : blockingCount > 0 ? (
            <AlertCircle className="h-6 w-6 text-semantic-warning flex-shrink-0" />
          ) : (
            <Info className="h-6 w-6 text-bark flex-shrink-0" />
          )}

          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-ink dark:text-parchment">
              {title}
            </h3>
            <p className="text-sm text-accessible-gray dark:text-archive">
              {percentComplete === 100 ? (
                'All required fields complete'
              ) : (
                <>
                  Missing required fields – {requiredComplete}/{requiredTotal} fields ({percentComplete}%)
                </>
              )}
            </p>
            {blockingCount > 0 && (
              <p className="text-xs text-semantic-warning dark:text-semantic-warning mt-0.5 font-medium">
                Blocking for next step: {blockingCount} requirement{blockingCount !== 1 ? 's' : ''}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          {!isExpanded && (
            <span className="text-sm text-bark font-medium hidden sm:inline">
              Review requirements
            </span>
          )}
          {isExpanded ? (
            <ChevronDown className="h-5 w-5 text-archive" />
          ) : (
            <ChevronRight className="h-5 w-5 text-archive" />
          )}
        </div>
      </button>

      {/* Expanded Panel */}
      {isExpanded && (
        <div id="compliance-panel" className="border-t border-lichen dark:border-lichen">
          {/* Fix Next Button */}
          {blockingCount > 0 && nextBlockingField && (
            <div className="px-4 py-3 bg-semantic-warning/10 dark:bg-semantic-warning/20 border-b border-semantic-warning/30 dark:border-semantic-warning/30">
              <button
                type="button"
                onClick={handleFixNext}
                className="flex items-center gap-2 text-sm font-medium text-semantic-warning dark:text-semantic-warning hover:text-semantic-warning dark:hover:text-semantic-warning transition-colors"
              >
                <ArrowRight className="h-4 w-4" />
                Fix next blocking requirement
              </button>
            </div>
          )}

          {/* Progress Bar */}
          <div className="px-4 py-3 bg-stone dark:bg-forest/30">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-ink dark:text-stone">
                Completion
              </span>
              <span className="text-sm font-semibold text-ink dark:text-parchment">
                {percentComplete}%
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-lichen dark:bg-archive overflow-hidden">
              <div
                className={`h-2 rounded-full transition-all duration-500 ${
                  percentComplete === 100
                    ? 'bg-semantic-success/100'
                    : blockingCount > 0
                    ? 'bg-semantic-warning/100'
                    : 'bg-semantic-info/100'
                }`}
                style={{ width: `${percentComplete}%` }}
              />
            </div>
          </div>

          {/* Group Checklist */}
          <div className="divide-y divide-lichen dark:divide-lichen">
            {groups.map((groupResult) => (
              <GroupRow
                key={groupResult.group.id}
                groupResult={groupResult}
                onClick={() => handleGroupClick(groupResult)}
                onKeyDown={(e) => handleKeyDown(e, () => handleGroupClick(groupResult))}
              />
            ))}
          </div>

          {/* Footer */}
          <div className="px-4 py-3 bg-stone dark:bg-forest/30 border-t border-lichen dark:border-lichen">
            <div className="flex items-start justify-between gap-4">
              <p className="text-xs text-archive dark:text-archive">
                Field requirements based on the collections standard. Required fields must be completed before advancing to certain statuses.
              </p>
              <a
                href="https://collectionstrust.org.uk/procedure/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-bark hover:text-copper-dark whitespace-nowrap flex-shrink-0"
              >
                View standard
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * GroupRow Component
 *
 * Individual row in the group checklist, showing completion status and missing items.
 */
interface GroupRowProps {
  groupResult: GroupResult;
  onClick: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

function GroupRow({ groupResult, onClick, onKeyDown }: GroupRowProps) {
  const { group, completedCount, totalCount, missingLabels, blockingMissing } = groupResult;
  const isComplete = completedCount === totalCount && totalCount > 0;
  const hasBlocking = blockingMissing.length > 0;

  // Determine icon and colors
  let StatusIcon = CheckCircle;
  let iconColor = 'text-semantic-success';
  let bgColor = '';

  if (!isComplete) {
    if (hasBlocking) {
      StatusIcon = AlertCircle;
      iconColor = 'text-semantic-warning';
      bgColor = 'bg-semantic-warning/10 dark:bg-semantic-warning/10';
    } else if (missingLabels.length > 0) {
      StatusIcon = AlertTriangle;
      iconColor = 'text-bark';
    }
  }

  // Get the most important missing item to display
  const primaryMissing = hasBlocking
    ? blockingMissing[0].requirement.label
    : missingLabels[0];

  return (
    <button
      type="button"
      className={`w-full flex items-center justify-between px-4 py-3 text-left hover:bg-stone dark:hover:bg-bark/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-bark/30 focus-visible:ring-offset-2 transition-colors ${bgColor}`}
      onClick={onClick}
      onKeyDown={onKeyDown}
      aria-label={`${group.label}: ${completedCount} of ${totalCount} complete. ${primaryMissing ? `Missing: ${primaryMissing}` : ''}`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <StatusIcon className={`h-5 w-5 flex-shrink-0 ${iconColor}`} />
        <div className="min-w-0">
          <span className="text-sm font-medium text-ink dark:text-parchment">
            {group.label}
          </span>
          {!isComplete && primaryMissing && (
            <p className={`text-xs mt-0.5 truncate ${hasBlocking ? 'text-semantic-warning dark:text-semantic-warning' : 'text-archive dark:text-archive'}`}>
              {hasBlocking ? 'Blocking: ' : 'Missing: '}
              {primaryMissing}
              {missingLabels.length > 1 && ` (+${missingLabels.length - 1} more)`}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <span className={`text-sm font-medium ${isComplete ? 'text-semantic-success dark:text-semantic-success' : 'text-archive dark:text-archive'}`}>
          {completedCount}/{totalCount}
        </span>
        <ChevronRight className="h-4 w-4 text-archive" />
      </div>
    </button>
  );
}

export default ProcedureComplianceCard;
