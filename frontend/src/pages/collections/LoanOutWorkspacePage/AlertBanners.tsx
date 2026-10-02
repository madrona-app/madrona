import { Clock, AlertTriangle } from 'lucide-react';
import type { ExistingLoan } from './types';

interface DaysRemainingAlertProps {
  existingLoan: ExistingLoan;
}

export function DaysRemainingAlert({ existingLoan }: DaysRemainingAlertProps) {
  const status = existingLoan.status || 'requested';

  if (status !== 'on_loan' || !existingLoan.loan_end_date) {
    return null;
  }

  const daysRemaining = Math.floor(
    (new Date(existingLoan.loan_end_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysRemaining < 0 || daysRemaining > 30) {
    return null;
  }

  return (
    <div className="bg-semantic-warning/10 border border-semantic-warning/30 rounded-lg p-4 mb-6">
      <div className="flex items-center gap-3">
        <Clock size={20} className="text-semantic-warning" />
        <div>
          <p className="font-medium text-ink">
            {daysRemaining === 0 ? 'Loan expires today!' : `${daysRemaining} days remaining`}
          </p>
          <p className="text-sm text-accessible-gray">
            Coordinate return with borrower or initiate renewal process.
          </p>
        </div>
      </div>
    </div>
  );
}

interface MissingInsuranceAlertProps {
  existingLoan: ExistingLoan;
}

export function MissingInsuranceAlert({ existingLoan }: MissingInsuranceAlertProps) {
  const status = existingLoan.status || 'requested';

  if (status !== 'on_loan' || existingLoan.certificate_of_insurance_received) {
    return null;
  }

  return (
    <div className="bg-semantic-error/10 border border-semantic-error/30 rounded-lg p-4 mb-6">
      <div className="flex items-center gap-3">
        <AlertTriangle size={20} className="text-semantic-error" />
        <div>
          <p className="font-medium text-ink">Missing Certificate of Insurance</p>
          <p className="text-sm text-archive">
            Request certificate from borrower immediately.
          </p>
        </div>
      </div>
    </div>
  );
}
