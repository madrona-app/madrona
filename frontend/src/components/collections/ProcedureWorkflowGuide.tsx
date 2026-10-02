/**
 * ProcedureWorkflowGuide Component
 *
 * Collapsible panel showing the procedure flow and current position.
 * Provides contextual guidance about related procedures and next steps.
 */

import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  ArrowRight,
  Info,
  BookOpen,
  Check,
} from 'lucide-react';

// Workflow step definition
interface WorkflowStep {
  id: string;
  label: string;
  description: string;
  relatedProcedures?: {
    procedure: string;
    label: string;
    description: string;
  }[];
}

// Object Entry workflow steps
const OBJECT_ENTRY_WORKFLOW: WorkflowStep[] = [
  {
    id: 'pending',
    label: 'Pending',
    description: 'Entry is expected but objects have not yet arrived.',
    relatedProcedures: [
      {
        procedure: 'location_movement',
        label: 'Location & Movement',
        description: 'Arrange transport if needed',
      },
      {
        procedure: 'insurance_indemnity',
        label: 'Insurance & Indemnity',
        description: 'Update insurance coverage',
      },
    ],
  },
  {
    id: 'received',
    label: 'Received',
    description: 'Objects have arrived and entry record is being created.',
    relatedProcedures: [
      {
        procedure: 'condition_checking',
        label: 'Condition Checking',
        description: 'Check and note condition on arrival',
      },
    ],
  },
  {
    id: 'processed',
    label: 'Processed',
    description: 'Entry is complete. Objects ready for next step.',
    relatedProcedures: [
      {
        procedure: 'acquisition',
        label: 'Acquisition',
        description: 'Add objects to your collection',
      },
      {
        procedure: 'loans_in',
        label: 'Loans In',
        description: 'Borrow objects temporarily',
      },
      {
        procedure: 'object_exit',
        label: 'Object Exit',
        description: 'Return objects to depositor',
      },
    ],
  },
];

// Loans In workflow steps
const LOAN_IN_WORKFLOW: WorkflowStep[] = [
  {
    id: 'requested',
    label: 'Requested',
    description: 'Loan request submitted to lender.',
    relatedProcedures: [
      {
        procedure: 'object_entry',
        label: 'Object Entry',
        description: 'Will be created when objects arrive',
      },
    ],
  },
  {
    id: 'approved',
    label: 'Approved',
    description: 'Lender has approved the loan.',
    relatedProcedures: [
      {
        procedure: 'insurance_indemnity',
        label: 'Insurance & Indemnity',
        description: 'Arrange insurance coverage',
      },
      {
        procedure: 'location_movement',
        label: 'Location & Movement',
        description: 'Arrange transport',
      },
    ],
  },
  {
    id: 'received',
    label: 'Received',
    description: 'Objects have arrived at your venue.',
    relatedProcedures: [
      {
        procedure: 'condition_checking',
        label: 'Condition Checking',
        description: 'Check condition on arrival',
      },
    ],
  },
  {
    id: 'on_loan',
    label: 'On Loan',
    description: 'Objects are on display or in use.',
    relatedProcedures: [],
  },
  {
    id: 'returned',
    label: 'Returned',
    description: 'Loan completed, objects returned to lender.',
    relatedProcedures: [
      {
        procedure: 'object_exit',
        label: 'Object Exit',
        description: 'Create exit record for return',
      },
    ],
  },
];

// Object Exit workflow steps
const OBJECT_EXIT_WORKFLOW: WorkflowStep[] = [
  {
    id: 'pending',
    label: 'Preparing',
    description: 'Exit is being prepared.',
    relatedProcedures: [
      {
        procedure: 'condition_checking',
        label: 'Condition Checking',
        description: 'Check condition before exit',
      },
    ],
  },
  {
    id: 'dispatched',
    label: 'Dispatched',
    description: 'Objects have left your premises.',
    relatedProcedures: [
      {
        procedure: 'location_movement',
        label: 'Location & Movement',
        description: 'Record departure',
      },
    ],
  },
  {
    id: 'acknowledged',
    label: 'Acknowledged',
    description: 'Recipient has confirmed receipt.',
    relatedProcedures: [],
  },
];

interface ProcedureWorkflowGuideProps {
  procedure: 'object_entry' | 'loan_in' | 'object_exit';
  currentStatus: string;
  organizationId: string;
  recordId?: string;
  onRelatedProcedureClick?: (procedure: string) => void;
  defaultExpanded?: boolean;
}

export function ProcedureWorkflowGuide({
  procedure,
  currentStatus,
  organizationId: _organizationId,
  recordId: _recordId,
  onRelatedProcedureClick,
  defaultExpanded = false,
}: ProcedureWorkflowGuideProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  // Get workflow for the procedure
  const workflow = procedure === 'object_entry'
    ? OBJECT_ENTRY_WORKFLOW
    : procedure === 'loan_in'
    ? LOAN_IN_WORKFLOW
    : OBJECT_EXIT_WORKFLOW;

  // Find current step index
  const currentIndex = workflow.findIndex(step => step.id === currentStatus);
  const currentStep = workflow[currentIndex];

  // Procedure labels and descriptions
  const procedureInfo: Record<string, { label: string; description: string }> = {
    object_entry: {
      label: 'Object Entry',
      description: 'Recording objects that enter your organization\'s care',
    },
    loan_in: {
      label: 'Loans In',
      description: 'Borrowing objects from another organization or person',
    },
    object_exit: {
      label: 'Object Exit',
      description: 'Recording objects that leave your organization\'s care',
    },
  };

  const info = procedureInfo[procedure];

  return (
    <div className="rounded-lg border border-lichen bg-parchment overflow-hidden">
      {/* Header - always visible */}
      <button
        type="button"
        className="w-full flex items-center justify-between p-4 text-left hover:bg-stone transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <BookOpen className="h-5 w-5 text-bark" />
          <div>
            <h3 className="text-sm font-medium text-ink">
              Procedure Guide
            </h3>
            <p className="text-xs text-archive">
              {info.label} - {currentStep?.label || 'Unknown status'}
            </p>
          </div>
        </div>
        {isExpanded ? (
          <ChevronDown className="h-5 w-5 text-archive" />
        ) : (
          <ChevronRight className="h-5 w-5 text-archive" />
        )}
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-lichen">
          {/* Procedure description */}
          <div className="px-4 py-3 bg-stone/30">
            <p className="text-sm text-archive">
              {info.description}
            </p>
          </div>

          {/* Workflow visualization */}
          <div className="p-4">
            <h4 className="text-xs font-medium text-archive uppercase tracking-wide mb-3">
              Workflow Progress
            </h4>
            <div className="space-y-2">
              {workflow.map((step, index) => {
                const isComplete = index < currentIndex;
                const isCurrent = index === currentIndex;

                return (
                  <div
                    key={step.id}
                    className={`flex items-start gap-3 p-3 rounded-lg transition-colors ${
                      isCurrent
                        ? 'bg-bark/10 border border-bark/30'
                        : isComplete
                        ? 'bg-semantic-success/10'
                        : 'bg-stone/30'
                    }`}
                  >
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

                      {/* Related procedures for current step */}
                      {isCurrent && step.relatedProcedures && step.relatedProcedures.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-lichen">
                          <p className="text-xs font-medium text-archive mb-2">
                            Related procedures:
                          </p>
                          <div className="space-y-2">
                            {step.relatedProcedures.map(related => (
                              <button
                                key={related.procedure}
                                type="button"
                                className="w-full flex items-center justify-between p-2 rounded bg-parchment border border-lichen hover:border-bark transition-colors text-left"
                                onClick={() => onRelatedProcedureClick?.(related.procedure)}
                              >
                                <div>
                                  <p className="text-sm font-medium text-ink">
                                    {related.label}
                                  </p>
                                  <p className="text-xs text-archive">
                                    {related.description}
                                  </p>
                                </div>
                                <ArrowRight className="h-4 w-4 text-archive" />
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* procedure reference footer */}
          <div className="px-4 py-3 bg-stone/30 border-t border-lichen">
            <div className="flex items-center justify-between">
              <div className="flex items-start gap-2 text-xs text-archive">
                <Info className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <p>Based on recognised collections management practice.</p>
              </div>
              <a
                href="https://collectionstrust.org.uk/procedure/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-bark hover:text-copper-dark flex-shrink-0"
              >
                Learn more
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ProcedureWorkflowGuide;
