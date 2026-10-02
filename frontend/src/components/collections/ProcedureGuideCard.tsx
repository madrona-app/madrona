/**
 * ProcedureGuideCard Component
 *
 * Collapsible card showing procedure workflow and related procedures.
 * Replaces ProcedureWorkflowGuide with organization-neutral language.
 */

import { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Check,
  ExternalLink,
} from 'lucide-react';

type EntryStatus = 'pending' | 'received' | 'processing' | 'processed' | 'returned' | 'acquired';

interface WorkflowStep {
  id: string;
  label: string;
  description: string;
}

const WORKFLOW_STEPS: WorkflowStep[] = [
  {
    id: 'pending',
    label: 'Pending',
    description: 'Entry is expected but objects have not yet arrived.',
  },
  {
    id: 'received',
    label: 'Received',
    description: 'Objects have arrived and entry record is being created.',
  },
  {
    id: 'processed',
    label: 'Processed',
    description: 'Entry is complete. Objects ready for next step.',
  },
];

interface RelatedProcedure {
  id: string;
  label: string;
  description: string;
}

const RELATED_PROCEDURES: RelatedProcedure[] = [
  {
    id: 'acquisition',
    label: 'Acquisition',
    description: 'Add objects to your collection',
  },
  {
    id: 'loans_in',
    label: 'Loans In',
    description: 'Borrow objects temporarily',
  },
  {
    id: 'object_exit',
    label: 'Object Exit',
    description: 'Return objects to depositor',
  },
];

interface ProcedureGuideCardProps {
  currentStatus: EntryStatus;
  onRelatedProcedureClick?: (procedureId: string) => void;
  onLearnMore?: () => void;
  defaultExpanded?: boolean;
}

export function ProcedureGuideCard({
  currentStatus,
  onRelatedProcedureClick,
  onLearnMore,
  defaultExpanded = false,
}: ProcedureGuideCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  // Find current step
  const currentStepIndex = WORKFLOW_STEPS.findIndex(s => s.id === currentStatus);
  const currentStep = WORKFLOW_STEPS[currentStepIndex] || WORKFLOW_STEPS[0];

  // Format status label
  const statusLabel = currentStep.label;

  return (
    <div className="rounded-lg border border-lichen bg-parchment overflow-hidden">
      {/* Header */}
      <button
        type="button"
        className="w-full flex items-center justify-between p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-bark/30 focus-visible:ring-offset-2"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        aria-controls="procedure-guide-panel"
      >
        <div>
          <h3 className="text-sm font-semibold text-ink">
            Procedure Guide
          </h3>
          <p className="text-sm text-archive mt-0.5">
            Object Entry — {statusLabel}
          </p>
        </div>
        {isExpanded ? (
          <ChevronUp className="h-5 w-5 text-archive flex-shrink-0" />
        ) : (
          <ChevronDown className="h-5 w-5 text-archive flex-shrink-0" />
        )}
      </button>

      {/* Expanded Panel */}
      {isExpanded && (
        <div id="procedure-guide-panel" className="border-t border-lichen">
          {/* Description */}
          <div className="px-4 py-3 bg-stone/30">
            <p className="text-sm text-archive">
              Recording objects that enter your organization's care
            </p>
          </div>

          {/* Workflow Progress */}
          <div className="p-4">
            <h4 className="text-xs font-semibold text-archive uppercase tracking-wide mb-3">
              Workflow Progress
            </h4>
            <div className="space-y-3">
              {WORKFLOW_STEPS.map((step, index) => {
                const isComplete = index < currentStepIndex;
                const isCurrent = step.id === currentStatus;

                return (
                  <div key={step.id} className="flex items-start gap-3">
                    {/* Step indicator */}
                    <div className="flex-shrink-0 mt-0.5">
                      {isComplete ? (
                        <div className="h-5 w-5 rounded-full bg-semantic-success flex items-center justify-center">
                          <Check className="h-3 w-3 text-parchment" />
                        </div>
                      ) : isCurrent ? (
                        <div className="h-5 w-5 rounded-full bg-bark flex items-center justify-center">
                          <div className="h-2 w-2 rounded-full bg-parchment" />
                        </div>
                      ) : (
                        <div className="h-5 w-5 rounded-full border-2 border-lichen" />
                      )}
                    </div>

                    {/* Step content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className={`text-sm font-medium ${
                          isCurrent
                            ? 'text-bark'
                            : isComplete
                            ? 'text-semantic-success'
                            : 'text-archive'
                        }`}>
                          {step.label}
                        </p>
                        {isCurrent && (
                          <span className="text-xs bg-bark text-parchment px-1.5 py-0.5 rounded">
                            Current
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-archive mt-0.5">
                        {step.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Related Procedures */}
          {currentStatus === 'processed' && (
            <div className="px-4 pb-4">
              <h4 className="text-xs font-semibold text-archive uppercase tracking-wide mb-3">
                Related procedures
              </h4>
              <div className="space-y-2">
                {RELATED_PROCEDURES.map((proc) => (
                  <button
                    key={proc.id}
                    type="button"
                    className="w-full flex items-center justify-between p-3 rounded-lg border border-lichen hover:border-bark bg-parchment transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                    onClick={() => onRelatedProcedureClick?.(proc.id)}
                  >
                    <div>
                      <p className="text-sm font-medium text-ink">
                        {proc.label}
                      </p>
                      <p className="text-xs text-archive">
                        {proc.description}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="px-4 py-3 bg-stone/30 border-t border-lichen">
            <p className="text-xs text-archive mb-2">
              Based on an established collections management standard.
            </p>
            {onLearnMore ? (
              <button
                type="button"
                onClick={onLearnMore}
                className="flex items-center gap-1 text-xs text-bark hover:text-copper-dark font-medium"
              >
                Learn more
                <ExternalLink className="h-3 w-3" />
              </button>
            ) : (
              <a
                href="https://collectionstrust.org.uk/procedure/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-bark hover:text-copper-dark font-medium"
              >
                Learn more
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default ProcedureGuideCard;
