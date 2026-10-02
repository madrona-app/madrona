/**
 * ProcedureChecklist Component
 *
 * Displays procedure steps as an interactive checklist.
 * Maps procedure minimum requirements to form fields and shows completion status.
 */

import { useState } from 'react';
import {
  CheckCircle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Info,
} from 'lucide-react';
import type { SectionRequirements, SectionCompletion } from '../../lib/procedureValidation';
import { calculateSectionCompletion } from '../../lib/procedureValidation';

// procedure step definitions with guidance text
export interface ProcedureProcedureStep {
  id: string;
  title: string;
  procedureRef: string;
  description: string;
  guidance?: string;
  relatedSections: string[];
}

// Object Entry procedure steps per the collections standard
export const OBJECT_ENTRY_PROCEDURE_STEPS: ProcedureProcedureStep[] = [
  {
    id: 'create-record',
    title: 'Create an entry record',
    procedureRef: 'Object Entry - Creating an entry record',
    description: 'Assign an entry number and record basic information about the objects entering your care.',
    guidance: 'The entry number uniquely identifies this batch of objects. Record the date, depositor, and reason for entry.',
    relatedSections: ['entry', 'depositor'],
  },
  {
    id: 'identify-objects',
    title: 'Identify the objects',
    procedureRef: 'Object Entry - Object identification',
    description: 'Record a brief description of the objects and note how many items are included.',
    guidance: 'Include enough detail to distinguish these objects from others. Note any identifying marks or numbers from the depositor.',
    relatedSections: ['objects'],
  },
  {
    id: 'check-condition',
    title: 'Check and note condition',
    procedureRef: 'Object Entry - Condition checking',
    description: 'Assess and document the condition of objects when they arrive.',
    guidance: 'Note any damage, fragility, or special handling requirements. This protects both you and the depositor.',
    relatedSections: ['objects'],
  },
  {
    id: 'agree-terms',
    title: 'Agree terms and conditions',
    procedureRef: 'Object Entry - Terms acceptance',
    description: 'Get the depositor to accept your terms and conditions for temporary custody.',
    guidance: 'Requires documented acceptance. This can be a signature on a form, email confirmation, or recorded verbal agreement.',
    relatedSections: ['terms-acceptance'],
  },
  {
    id: 'issue-receipt',
    title: 'Issue a receipt',
    procedureRef: 'Object Entry - Receipt generation',
    description: 'Give the depositor a copy of the entry record as their receipt.',
    guidance: 'The receipt should include entry number, date, description, and your terms. Keep a signed copy for your records.',
    relatedSections: ['entry', 'terms-acceptance'],
  },
  {
    id: 'record-location',
    title: 'Record the location',
    procedureRef: 'Object Entry - Location recording',
    description: 'Document where you have placed the objects.',
    guidance: 'Link to a Movement record to track the initial location. This is required for object accountability.',
    relatedSections: [],
  },
  {
    id: 'determine-outcome',
    title: 'Determine outcome',
    procedureRef: 'Object Entry - Outcome determination',
    description: 'Decide what will happen to the objects: acquisition, loan, or return to depositor.',
    guidance: 'Do not keep objects indefinitely without a clear purpose. Begin the appropriate procedure (Acquisition, Loans In, or Object Exit).',
    relatedSections: ['outcome'],
  },
];

// Loans In procedure steps per the collections standard
export const LOAN_IN_PROCEDURE_STEPS: ProcedureProcedureStep[] = [
  {
    id: 'identify-lender',
    title: 'Identify the lender',
    procedureRef: 'Loans In - Lender identification',
    description: 'Record who is lending the objects and their contact details.',
    guidance: 'Include the organization name (if applicable) and the authorized contact person.',
    relatedSections: ['lender'],
  },
  {
    id: 'get-authorization',
    title: 'Get lender authorization',
    procedureRef: 'Loans In - Lender authorization',
    description: 'Obtain formal approval from the lender for the loan.',
    guidance: 'Record the name and title of the person authorizing the loan, and the date they gave approval.',
    relatedSections: ['lender-authorization'],
  },
  {
    id: 'agree-purpose',
    title: 'Agree loan purpose and conditions',
    procedureRef: 'Loans In - Loan purpose and conditions',
    description: 'Document why you need the objects and any conditions set by the lender.',
    guidance: 'Be specific about the exhibition, research project, or other purpose. Note any restrictions on display, photography, or handling.',
    relatedSections: ['details'],
  },
  {
    id: 'agree-dates',
    title: 'Agree loan dates',
    procedureRef: 'Loans In - Loan dates',
    description: 'Set the start and end dates for the loan period.',
    guidance: 'Allow time for transport, installation, and de-installation. Note any dates when the lender needs the objects back.',
    relatedSections: ['dates'],
  },
  {
    id: 'arrange-insurance',
    title: 'Arrange insurance or indemnity',
    procedureRef: 'Loans In - Insurance and indemnity',
    description: 'Ensure objects are covered for their full value during the loan.',
    guidance: 'Clarify whether you or the lender will provide insurance. Record policy numbers and values.',
    relatedSections: ['insurance'],
  },
  {
    id: 'send-facility-report',
    title: 'Send facility report',
    procedureRef: 'Loans In - Facilities report',
    description: 'Provide the lender with information about your venue and conditions.',
    guidance: 'Include environmental controls, security measures, and display conditions. Get lender approval before proceeding.',
    relatedSections: ['facility'],
  },
  {
    id: 'arrange-transport',
    title: 'Arrange transport',
    procedureRef: 'Loans In - Transport arrangements',
    description: 'Plan how the objects will travel to and from your venue.',
    guidance: 'Consider courier requirements, packing specifications, and shipping method. Document all arrangements.',
    relatedSections: ['shipping'],
  },
  {
    id: 'sign-agreement',
    title: 'Sign loan agreement',
    procedureRef: 'Loans In - Loan agreement',
    description: 'Execute a formal agreement covering all aspects of the loan.',
    guidance: 'Both parties should sign. File the agreement securely and note where it can be found.',
    relatedSections: ['agreement', 'document-location'],
  },
  {
    id: 'assign-contact',
    title: 'Assign internal contact',
    procedureRef: 'Loans In - Loan contact',
    description: 'Designate someone responsible for managing this loan.',
    guidance: 'This person will be the primary contact for correspondence and will track deadlines.',
    relatedSections: ['loan-contact'],
  },
];

// Object Exit procedure steps per the collections standard
export const OBJECT_EXIT_PROCEDURE_STEPS: ProcedureProcedureStep[] = [
  {
    id: 'create-exit-record',
    title: 'Create an exit record',
    procedureRef: 'Object Exit - Creating an exit record',
    description: 'Assign an exit number and record basic information about the departure.',
    guidance: 'The exit number tracks this specific departure. Note the date and reason for the exit.',
    relatedSections: ['exit'],
  },
  {
    id: 'identify-recipient',
    title: 'Identify the recipient',
    procedureRef: 'Object Exit - Exit destination',
    description: 'Record who will receive the objects and where they are going.',
    guidance: 'Include the name, organization, and destination address.',
    relatedSections: ['recipient'],
  },
  {
    id: 'get-authorization',
    title: 'Get authorization',
    procedureRef: 'Object Exit - Exit authorizer',
    description: 'Obtain formal approval for the objects to leave.',
    guidance: 'Record who authorized the exit and when. This provides an audit trail.',
    relatedSections: ['authorization'],
  },
  {
    id: 'check-exit-condition',
    title: 'Check condition at exit',
    procedureRef: 'Object Exit - Condition at exit',
    description: 'Document the condition of objects before they leave.',
    guidance: 'Compare with condition on entry. Note any changes. Link to a condition report if appropriate.',
    relatedSections: ['condition'],
  },
  {
    id: 'get-receipt',
    title: 'Get receipt from recipient',
    procedureRef: 'Object Exit - Recipient signature',
    description: 'Have the recipient acknowledge receipt of the objects.',
    guidance: 'This completes the transfer of custody. Keep the signed receipt in your records.',
    relatedSections: ['receipt'],
  },
];

interface ProcedureChecklistProps {
  procedure: 'object_entry' | 'loan_in' | 'object_exit';
  sections: SectionRequirements[];
  record: Record<string, unknown>;
  onStepClick?: (step: ProcedureProcedureStep) => void;
  onSectionClick?: (sectionId: string) => void;
  showIncompleteOnly?: boolean;
}

export function ProcedureChecklist({
  procedure,
  sections,
  record,
  onStepClick: _onStepClick,
  onSectionClick,
  showIncompleteOnly = false,
}: ProcedureChecklistProps) {
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());

  // Get procedure steps based on procedure type
  const procedureSteps = procedure === 'object_entry'
    ? OBJECT_ENTRY_PROCEDURE_STEPS
    : procedure === 'loan_in'
    ? LOAN_IN_PROCEDURE_STEPS
    : OBJECT_EXIT_PROCEDURE_STEPS;

  // Calculate section completions
  const sectionCompletions = sections.reduce((acc, section) => {
    acc[section.id] = calculateSectionCompletion(section, record);
    return acc;
  }, {} as Record<string, SectionCompletion>);

  // Check if a step is complete (all related sections have required fields complete)
  const isStepComplete = (step: ProcedureProcedureStep): boolean => {
    if (step.relatedSections.length === 0) return false;
    return step.relatedSections.every(sectionId => {
      const completion = sectionCompletions[sectionId];
      return completion ? completion.requiredComplete : false;
    });
  };

  // Filter steps if showing incomplete only
  const displaySteps = showIncompleteOnly
    ? procedureSteps.filter(step => !isStepComplete(step))
    : procedureSteps;

  const toggleStep = (stepId: string) => {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      if (next.has(stepId)) {
        next.delete(stepId);
      } else {
        next.add(stepId);
      }
      return next;
    });
  };

  const procedureLabels: Record<string, string> = {
    object_entry: 'Object Entry',
    loan_in: 'Loans In (Borrowing Objects)',
    object_exit: 'Object Exit',
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-ink dark:text-stone">
          {procedureLabels[procedure]} Procedure
        </h3>
        <a
          href="https://collectionstrust.org.uk/procedure/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-semantic-info dark:text-semantic-info hover:underline"
        >
          View standard
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {displaySteps.length === 0 && showIncompleteOnly && (
        <div className="text-center py-6 text-sm text-archive dark:text-archive">
          <CheckCircle className="h-8 w-8 mx-auto mb-2 text-semantic-success" />
          All procedure steps are complete!
        </div>
      )}

      {displaySteps.map((step, index) => {
        const isComplete = isStepComplete(step);
        const isExpanded = expandedSteps.has(step.id);

        return (
          <div
            key={step.id}
            className={`border rounded-lg transition-colors ${
              isComplete
                ? 'border-semantic-success/30 dark:border-semantic-success/30 bg-semantic-success/10 dark:bg-semantic-success/10'
                : 'border-lichen dark:border-lichen'
            }`}
          >
            <button
              type="button"
              className="w-full flex items-start gap-3 p-3 text-left"
              onClick={() => toggleStep(step.id)}
            >
              <div className="flex-shrink-0 mt-0.5">
                {isComplete ? (
                  <CheckCircle className="h-5 w-5 text-semantic-success" />
                ) : (
                  <div className="h-5 w-5 rounded-full border-2 border-lichen dark:border-lichen flex items-center justify-center">
                    <span className="text-xs text-archive dark:text-archive">{index + 1}</span>
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${
                  isComplete ? 'text-semantic-success dark:text-semantic-success' : 'text-ink dark:text-stone'
                }`}>
                  {step.title}
                </p>
                <p className="text-xs text-archive dark:text-archive mt-0.5">
                  {step.description}
                </p>
              </div>
              {isExpanded ? (
                <ChevronDown className="h-5 w-5 text-archive flex-shrink-0" />
              ) : (
                <ChevronRight className="h-5 w-5 text-archive flex-shrink-0" />
              )}
            </button>

            {isExpanded && (
              <div className="px-3 pb-3 pt-0 ml-8 border-t border-lichen dark:border-lichen mt-2">
                {step.guidance && (
                  <div className="flex items-start gap-2 mb-3 p-2 bg-semantic-info/10 dark:bg-semantic-info/20 rounded text-xs">
                    <Info className="h-4 w-4 text-semantic-info flex-shrink-0 mt-0.5" />
                    <p className="text-semantic-info dark:text-semantic-info">{step.guidance}</p>
                  </div>
                )}

                {step.relatedSections.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-accessible-gray dark:text-archive mb-2">
                      Related sections:
                    </p>
                    {step.relatedSections.map(sectionId => {
                      const section = sections.find(s => s.id === sectionId);
                      const completion = sectionCompletions[sectionId];
                      if (!section) return null;

                      return (
                        <button
                          key={sectionId}
                          type="button"
                          className="w-full flex items-center justify-between p-2 rounded hover:bg-stone dark:hover:bg-forest text-left transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSectionClick?.(sectionId);
                          }}
                        >
                          <span className="text-sm text-ink dark:text-stone">
                            {section.title}
                          </span>
                          {completion && (
                            <span className={`text-xs ${
                              completion.requiredComplete
                                ? 'text-semantic-success dark:text-semantic-success'
                                : 'text-semantic-warning dark:text-semantic-warning'
                            }`}>
                              {completion.completedCount}/{completion.totalCount}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                <p className="text-xs text-archive dark:text-archive mt-3 italic">
                  Ref: {step.procedureRef}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default ProcedureChecklist;
