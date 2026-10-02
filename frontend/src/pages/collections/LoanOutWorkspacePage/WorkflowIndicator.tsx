import { CheckCircle } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { WORKFLOW_STEPS } from './constants';

interface WorkflowIndicatorProps {
  status: string;
}

export function WorkflowIndicator({ status }: WorkflowIndicatorProps) {
  if (status === 'cancelled' || status === 'declined') {
    return null;
  }

  const getStepIndex = (s: string) => {
    const index = WORKFLOW_STEPS.findIndex(step => step.key === s);
    return index >= 0 ? index : 0;
  };

  const currentIndex = getStepIndex(status);

  // Helper text for each status
  const statusHints: Record<string, string> = {
    requested: 'Awaiting approval',
    approved: 'Ready to send agreement',
    agreement_sent: 'Awaiting signed agreement',
    agreement_signed: 'Ready to dispatch',
    in_transit: 'Objects in transit to borrower',
    on_loan: 'Objects currently on loan',
    return_scheduled: 'Return date confirmed',
    returned: 'Objects returned, ready to close',
    closed: 'Loan completed',
  };

  return (
    <div className="mb-6 p-4 bg-stone/30 rounded-lg">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-ink">Loan Workflow</span>
        <span className="text-xs text-archive">
          {statusHints[status] || ''}
        </span>
      </div>
      <div className="flex items-center gap-0.5 overflow-x-auto">
        {WORKFLOW_STEPS.map((step, index) => {
          const isComplete = index < currentIndex;
          const isCurrent = index === currentIndex;

          return (
            <div key={step.key} className="flex items-center flex-1 min-w-0">
              <div className={cn(
                'flex items-center justify-center flex-shrink-0 rounded-full text-xs font-medium transition-colors',
                'w-6 h-6 sm:w-7 sm:h-7',
                isComplete
                  ? 'bg-forest text-parchment'
                  : isCurrent
                  ? 'bg-copper text-parchment'
                  : 'bg-stone text-archive'
              )}>
                {isComplete ? <CheckCircle size={14} /> : index + 1}
              </div>
              <span className={cn(
                'ml-1 text-[10px] sm:text-xs font-medium hidden md:inline truncate',
                isComplete || isCurrent ? 'text-ink' : 'text-archive'
              )}>
                {step.label}
              </span>
              {index < WORKFLOW_STEPS.length - 1 && (
                <div className={cn(
                  'flex-1 h-0.5 mx-1',
                  isComplete ? 'bg-forest' : 'bg-stone'
                )} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
