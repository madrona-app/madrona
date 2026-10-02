import { Calendar } from 'lucide-react';
import {
  WorkspaceSection,
  EditableField,
} from '../../../components/workspace';
import { SectionCompletionBadge } from '../../../components/collections/SectionCompletionBadge';
import { formatDateShort } from '@/lib/formatters';
import type { SectionCompletion } from '../../../lib/procedureValidation';
import type { FormData } from './types';
import type { LoanIn } from '../../../lib/schemas';

interface DatesSectionProps {
  formData: FormData;
  isEditing: boolean;
  isCreateMode: boolean;
  loan: LoanIn | undefined;
  expandedSections: Record<string, boolean>;
  sectionCompletions: Record<string, SectionCompletion>;
  updateField: <K extends keyof FormData>(field: K, value: FormData[K]) => void;
  toggleSection: (sectionId: string) => void;
  getSectionOrder: (sectionId: string) => number | undefined;
}

export function DatesSection({
  formData,
  isEditing,
  isCreateMode,
  loan,
  expandedSections,
  sectionCompletions,
  updateField,
  toggleSection,
  getSectionOrder,
}: DatesSectionProps) {
  return (
    <WorkspaceSection
      id="dates"
      title="Key Dates"
      icon={<Calendar size={20} />}
      isExpanded={expandedSections.dates}
      onToggle={() => toggleSection('dates')}
      isEditing={isEditing}
      order={getSectionOrder('dates')}
      badge={!isCreateMode && sectionCompletions.dates && (
        <SectionCompletionBadge completion={sectionCompletions.dates} />
      )}
    >
      <div className="grid grid-cols-2 gap-6">
        <EditableField
          value={formData.request_date}
          label="Request Date"
          isEditing={isEditing}
          onChange={(v) => updateField('request_date', v)}
          type="date"
        />
        <EditableField
          value={formData.approval_date}
          label="Approval Date"
          isEditing={isEditing}
          onChange={(v) => updateField('approval_date', v)}
          type="date"
        />
        <EditableField
          value={formData.loan_start_date}
          label="Loan Start Date"
          isEditing={isEditing}
          onChange={(v) => updateField('loan_start_date', v)}
          type="date"
        />
        <EditableField
          value={formData.loan_end_date}
          label="Loan End Date"
          isEditing={isEditing}
          onChange={(v) => updateField('loan_end_date', v)}
          type="date"
        />
      </div>
      {!isCreateMode && loan && (
        <div className="mt-6 pt-6 border-t border-lichen">
          <div className="grid grid-cols-2 gap-6">
            {loan.actual_receipt_date && (
              <div>
                <dt className="text-sm font-medium text-archive mb-1">Actual Receipt Date</dt>
                <dd className="text-ink">{formatDateShort(loan.actual_receipt_date)}</dd>
              </div>
            )}
            {loan.actual_return_date && (
              <div>
                <dt className="text-sm font-medium text-archive mb-1">Actual Return Date</dt>
                <dd className="text-ink">{formatDateShort(loan.actual_return_date)}</dd>
              </div>
            )}
          </div>
        </div>
      )}
    </WorkspaceSection>
  );
}
