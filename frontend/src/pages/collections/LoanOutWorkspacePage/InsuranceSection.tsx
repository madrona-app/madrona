import { Shield } from 'lucide-react';
import { WorkspaceSection, EditableField, EditableSelect, EditableCheckbox } from '../../../components/workspace';
import type { FormData } from './types';

const CURRENCY_OPTIONS = [
  { value: 'USD', label: 'USD — US Dollar' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'GBP', label: 'GBP — British Pound' },
  { value: 'CAD', label: 'CAD — Canadian Dollar' },
  { value: 'AUD', label: 'AUD — Australian Dollar' },
  { value: 'CHF', label: 'CHF — Swiss Franc' },
  { value: 'JPY', label: 'JPY — Japanese Yen' },
];

const COVERAGE_TYPE_OPTIONS = [
  { value: 'wall_to_wall', label: 'Wall-to-Wall' },
  { value: 'nail_to_nail', label: 'Nail-to-Nail' },
  { value: 'borrower_policy', label: 'Borrower Policy' },
  { value: 'lender_policy', label: 'Lender Policy' },
  { value: 'government_indemnity', label: 'Government Indemnity' },
  { value: 'shared', label: 'Shared Coverage' },
];

interface InsuranceSectionProps {
  formData: FormData;
  isExpanded: boolean;
  isEditing: boolean;
  order: number | undefined;
  onToggle: () => void;
  onUpdateField: <K extends keyof FormData>(field: K, value: FormData[K]) => void;
  onFieldBlur: () => void;
  isRestricted: (field: string) => boolean;
}

export function InsuranceSection({
  formData,
  isExpanded,
  isEditing,
  order,
  onToggle,
  onUpdateField,
  onFieldBlur,
  isRestricted,
}: InsuranceSectionProps) {
  return (
    <WorkspaceSection
      id="insurance"
      title="Insurance"
      icon={<Shield size={18} />}
      isExpanded={isExpanded}
      onToggle={onToggle}
      isEditing={isEditing}
      order={order}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <EditableField
          label="Insurance Value"
          value={formData.insurance_value_total}
          isEditing={isEditing}
          onChange={(v) => onUpdateField('insurance_value_total', v)}
          onSave={onFieldBlur}
          type="number"
          placeholder="0.00"
          restricted={isRestricted('insurance_value_total')}
        />
        <EditableSelect
          label="Currency"
          value={formData.insurance_currency}
          isEditing={isEditing}
          onChange={(v) => onUpdateField('insurance_currency', v)}
          onSave={onFieldBlur}
          options={CURRENCY_OPTIONS}
        />
        <EditableSelect
          label="Coverage Type"
          value={formData.insurance_coverage_type}
          isEditing={isEditing}
          onChange={(v) => onUpdateField('insurance_coverage_type', v)}
          onSave={onFieldBlur}
          options={COVERAGE_TYPE_OPTIONS}
        />
        <EditableField
          label="Insurance Requirements"
          value={formData.insurance_requirements}
          isEditing={isEditing}
          onChange={(v) => onUpdateField('insurance_requirements', v)}
          onSave={onFieldBlur}
          multiline
          rows={2}
          className="md:col-span-2"
        />
        <EditableCheckbox
          label="Certificate of Insurance Received"
          value={formData.certificate_of_insurance_received}
          isEditing={isEditing}
          onChange={(v) => onUpdateField('certificate_of_insurance_received', v)}
          onSave={onFieldBlur}
        />
        <EditableField
          label="Certificate Date"
          value={formData.certificate_of_insurance_date}
          isEditing={isEditing}
          onChange={(v) => onUpdateField('certificate_of_insurance_date', v)}
          onSave={onFieldBlur}
          type="date"
        />
      </div>
    </WorkspaceSection>
  );
}
