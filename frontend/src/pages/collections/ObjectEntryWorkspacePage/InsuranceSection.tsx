/**
 * Insurance Section
 *
 * Displays and edits insurance value and notes.
 */

import { ShieldCheck } from 'lucide-react';
import {
  WorkspaceSection,
  EditableField,
  EditableSelect,
} from '../../../components/workspace';
import type { InsuranceSectionProps } from './types';

export function InsuranceSection({
  formData,
  updateField,
  isExpanded,
  onToggle,
  isEditing,
  getSectionOrder,
  currencyOptions,
  isRestricted,
}: InsuranceSectionProps) {
  return (
    <WorkspaceSection
      id="insurance"
      title="Insurance"
      icon={<ShieldCheck size={20} />}
      isExpanded={isExpanded}
      onToggle={onToggle}
      isEditing={isEditing}
      order={getSectionOrder('insurance')}
    >
      <div className="grid grid-cols-2 gap-6">
        <EditableField
          value={formData.insurance_value || ''}
          label="Insurance Value"
          isEditing={isEditing}
          onChange={(v) => updateField('insurance_value', v)}
          type="number"
          placeholder="0.00"
          restricted={isRestricted('insurance_value')}
        />
        <EditableSelect
          value={formData.insurance_currency || 'USD'}
          label="Currency"
          isEditing={isEditing}
          onChange={(v) => updateField('insurance_currency', v)}
          options={currencyOptions}
        />
      </div>
      <div className="mt-6">
        <EditableField
          value={formData.insurance_note || ''}
          label="Insurance Note"
          isEditing={isEditing}
          onChange={(v) => updateField('insurance_note', v)}
          multiline
          rows={2}
          placeholder="Insurance arrangements or special instructions..."
        />
      </div>
    </WorkspaceSection>
  );
}
