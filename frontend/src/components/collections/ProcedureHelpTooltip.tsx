/**
 * ProcedureHelpTooltip Component
 *
 * Provides contextual help tooltips with procedure guidance for form fields.
 */

import { useState, useRef, useEffect } from 'react';
import { Info, Sparkles } from 'lucide-react';
import { useAgentChatContext } from '../../contexts/AgentChatContext';

interface ProcedureHelpTooltipProps {
  fieldId: string;
  /** Human-readable field label — used when building the Ask Guide prompt. */
  fieldLabel?: string;
  procedureRef?: string;
  guidance: string;
  learnMoreUrl?: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

export function ProcedureHelpTooltip({
  fieldId,
  fieldLabel,
  procedureRef,
  guidance,
  learnMoreUrl,
  position = 'top',
}: ProcedureHelpTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { openChatWithMessage } = useAgentChatContext();

  // Prompt Guide with enough context to look up the field definition
  // (lookup_madrona_field) and any procedure reference (lookup_reference).
  // PageContext gives it the current entity type, so we don't need to name it.
  const humanName = fieldLabel || fieldId.replace(/_/g, ' ');
  const askPrompt =
    `Explain the "${humanName}" field on this record: what it's for, what goes in it, ` +
    `and any procedure context I should know. If the value depends on other fields, call those out.`;

  const handleAskGuide = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsVisible(false);
    openChatWithMessage(askPrompt);
  };

  // Close on escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isVisible) {
        setIsVisible(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isVisible]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        isVisible &&
        tooltipRef.current &&
        !tooltipRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setIsVisible(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isVisible]);

  const positionClasses: Record<string, string> = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  const arrowClasses: Record<string, string> = {
    top: 'top-full left-1/2 -translate-x-1/2 border-t-ink dark:border-t-forest border-l-transparent border-r-transparent border-b-transparent',
    bottom: 'bottom-full left-1/2 -translate-x-1/2 border-b-ink dark:border-b-forest border-l-transparent border-r-transparent border-t-transparent',
    left: 'left-full top-1/2 -translate-y-1/2 border-l-ink dark:border-l-forest border-t-transparent border-b-transparent border-r-transparent',
    right: 'right-full top-1/2 -translate-y-1/2 border-r-ink dark:border-r-forest border-t-transparent border-b-transparent border-l-transparent',
  };

  return (
    <div className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        className="inline-flex items-center justify-center p-0.5 text-archive hover:text-bark transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-1 rounded-full"
        onClick={() => setIsVisible(!isVisible)}
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
        aria-label={`Help for ${fieldId}`}
        aria-describedby={isVisible ? `tooltip-${fieldId}` : undefined}
      >
        <Info className="h-4 w-4" />
      </button>

      {isVisible && (
        <div
          ref={tooltipRef}
          id={`tooltip-${fieldId}`}
          role="tooltip"
          className={`absolute z-50 ${positionClasses[position]}`}
          // Mouse-leave on the trigger would otherwise close the tooltip
          // before the user can reach the Ask Guide link. Keep it open
          // while the pointer is inside the tooltip content.
          onMouseEnter={() => setIsVisible(true)}
          onMouseLeave={() => setIsVisible(false)}
        >
          <div className="bg-ink dark:bg-forest text-parchment text-xs rounded-lg py-2 px-3 shadow-lg max-w-xs">
            {procedureRef && (
              <p className="text-archive text-[10px] uppercase tracking-wide mb-1">
                Reference: {procedureRef}
              </p>
            )}
            <p className="leading-relaxed">{guidance}</p>
            <div className="mt-2 flex items-center gap-3 flex-wrap">
              {learnMoreUrl && (
                <a
                  href={learnMoreUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-semantic-info hover:text-semantic-info underline"
                >
                  Learn more →
                </a>
              )}
              {/* Bespoke link here instead of AskGuideButton so the colors
                  read against the dark tooltip background (text-parchment
                  + copper hover vs. AskGuideButton's default bark/copper
                  which fails contrast on ink). */}
              <button
                type="button"
                onClick={handleAskGuide}
                className="inline-flex items-center gap-1 text-parchment hover:text-copper-dark underline decoration-1 underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-parchment/40 focus-visible:ring-offset-1 focus-visible:ring-offset-ink rounded"
                aria-label={`Ask Guide about the ${humanName} field`}
              >
                <Sparkles size={12} aria-hidden="true" />
                <span>Ask Guide</span>
              </button>
            </div>
            <div className={`absolute border-[6px] ${arrowClasses[position]}`} />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * ProcedureFieldLabel Component
 *
 * A label component with integrated procedure help tooltip.
 */
interface ProcedureFieldLabelProps {
  htmlFor: string;
  label: string;
  required?: boolean;
  procedureRef?: string;
  guidance?: string;
}

export function ProcedureFieldLabel({
  htmlFor,
  label,
  required = false,
  procedureRef,
  guidance,
}: ProcedureFieldLabelProps) {
  return (
    <label htmlFor={htmlFor} className="flex items-center gap-1.5 text-sm font-medium text-bark mb-1.5">
      {label}
      {required && <span className="text-semantic-error">*</span>}
      {guidance && (
        <ProcedureHelpTooltip
          fieldId={htmlFor}
          fieldLabel={label}
          procedureRef={procedureRef}
          guidance={guidance}
        />
      )}
    </label>
  );
}

// Pre-defined procedure guidance for common fields
export const PROCEDURE_FIELD_GUIDANCE: Record<string, { procedureRef: string; guidance: string }> = {
  // Object Entry fields
  entry_number: {
    procedureRef: 'Object Entry',
    guidance: 'A unique identifier for this entry. Assign a number following your organization\'s numbering scheme.',
  },
  entry_date: {
    procedureRef: 'Object Entry',
    guidance: 'The date the objects arrived or are expected to arrive at your organization.',
  },
  depositor_name: {
    procedureRef: 'Object Entry',
    guidance: 'The person or organization bringing objects to you. May be different from the owner.',
  },
  current_owner: {
    procedureRef: 'Object Entry',
    guidance: 'The legal owner of the objects. Important for determining who can authorize actions.',
  },
  terms_accepted: {
    procedureRef: 'Object Entry',
    guidance: 'Requires that depositors accept your terms and conditions before objects enter your care. Document their acceptance.',
  },
  objects_description: {
    procedureRef: 'Object Entry',
    guidance: 'A brief description of the objects. Include enough detail to identify them and distinguish them from other items.',
  },

  // Loans In fields
  lender_id: {
    procedureRef: 'Loans In',
    guidance: 'The organization or person lending objects to you. Record their contact details.',
  },
  loan_purpose: {
    procedureRef: 'Loans In',
    guidance: 'Why you need to borrow these objects. Be specific about exhibitions, research projects, or other uses.',
  },
  loan_start_date: {
    procedureRef: 'Loans In',
    guidance: 'When the loan period begins. Allow time for transport and installation.',
  },
  loan_end_date: {
    procedureRef: 'Loans In',
    guidance: 'When objects must be returned. Note any flexibility in the end date.',
  },
  lender_authorizer_name: {
    procedureRef: 'Loans In',
    guidance: 'The person who formally authorized the loan on behalf of the lender. Required for audit purposes.',
  },
  insurance_value: {
    procedureRef: 'Loans In',
    guidance: 'The agreed value for insurance purposes. Clarify whether you or the lender provides coverage.',
  },
  facility_report_sent: {
    procedureRef: 'Loans In',
    guidance: 'Lenders often require a facilities report describing your venue conditions. Record when sent and approved.',
  },
  loan_agreement_reference: {
    procedureRef: 'Loans In',
    guidance: 'Reference number for the signed loan agreement. Both parties should retain signed copies.',
  },
  document_location: {
    procedureRef: 'Loans In',
    guidance: 'Where the physical loan file is stored. Important for finding documents in future.',
  },
  loan_contact_name: {
    procedureRef: 'Loans In',
    guidance: 'The person at your organization responsible for this loan. Primary contact for correspondence.',
  },

  // Object Exit fields
  exit_number: {
    procedureRef: 'Object Exit',
    guidance: 'A unique identifier for this exit. Links to the original entry and any loan records.',
  },
  exit_date: {
    procedureRef: 'Object Exit',
    guidance: 'The date objects leave your premises.',
  },
  exit_reason: {
    procedureRef: 'Object Exit',
    guidance: 'Why objects are leaving: return to owner, loan return, sale, transfer, etc.',
  },
  recipient_name: {
    procedureRef: 'Object Exit',
    guidance: 'Who is receiving the objects. Must be authorized to take them.',
  },
  authorization_id: {
    procedureRef: 'Object Exit',
    guidance: 'Who authorized objects to leave. Provides accountability and audit trail.',
  },
  receipt_acknowledged: {
    procedureRef: 'Object Exit',
    guidance: 'Confirmation that the recipient received the objects. Completes the transfer of custody.',
  },
};

export default ProcedureHelpTooltip;
