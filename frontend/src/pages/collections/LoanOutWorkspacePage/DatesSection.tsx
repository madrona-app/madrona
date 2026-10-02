import { Calendar } from 'lucide-react';
import { WorkspaceSection, EditableField } from '../../../components/workspace';
import { formatDateShort } from '@/lib/formatters';
import type { FormData, ExistingLoan } from './types';

interface DatesSectionProps {
  formData: FormData;
  existingLoan: ExistingLoan | undefined;
  isCreateMode: boolean;
  isExpanded: boolean;
  isEditing: boolean;
  order: number | undefined;
  onToggle: () => void;
  onUpdateField: <K extends keyof FormData>(field: K, value: FormData[K]) => void;
  onFieldBlur: () => void;
}

export function DatesSection({
  formData,
  existingLoan,
  isCreateMode,
  isExpanded,
  isEditing,
  order,
  onToggle,
  onUpdateField,
  onFieldBlur,
}: DatesSectionProps) {
  return (
    <WorkspaceSection
      id="dates"
      title="Dates"
      icon={<Calendar size={18} />}
      isExpanded={isExpanded}
      onToggle={onToggle}
      isEditing={isEditing}
      order={order}
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <EditableField
          label="Request Date"
          value={formData.request_date}
          isEditing={isEditing}
          onChange={(v) => onUpdateField('request_date', v)}
          onSave={onFieldBlur}
          type="date"
        />
        <EditableField
          label="Loan Start Date"
          value={formData.loan_start_date}
          isEditing={isEditing}
          onChange={(v) => onUpdateField('loan_start_date', v)}
          onSave={onFieldBlur}
          type="date"
        />
        <EditableField
          label="Loan End Date"
          value={formData.loan_end_date}
          isEditing={isEditing}
          onChange={(v) => onUpdateField('loan_end_date', v)}
          onSave={onFieldBlur}
          type="date"
        />
      </div>
      {!isCreateMode && existingLoan && (
        <div className="mt-6 pt-6 border-t border-lichen">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {existingLoan.actual_dispatch_date && (
              <div>
                <dt className="text-sm font-medium text-archive mb-1">Actual Dispatch Date</dt>
                <dd className="text-ink">{formatDateShort(existingLoan.actual_dispatch_date)}</dd>
              </div>
            )}
            {existingLoan.actual_return_date && (
              <div>
                <dt className="text-sm font-medium text-archive mb-1">Actual Return Date</dt>
                <dd className="text-ink">{formatDateShort(existingLoan.actual_return_date)}</dd>
              </div>
            )}
            <div>
              <dt className="text-sm font-medium text-archive mb-1">Renewals</dt>
              <dd className="text-ink">
                {existingLoan.renewal_count ?? 0} of {existingLoan.max_renewals ?? 0}
              </dd>
            </div>
          </div>
        </div>
      )}
    </WorkspaceSection>
  );
}
