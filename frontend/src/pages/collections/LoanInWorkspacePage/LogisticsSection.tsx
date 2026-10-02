import { DollarSign, Shield } from 'lucide-react';
import {
  WorkspaceSection,
  EditableField,
  EditableSelect,
  EditableCheckbox,
} from '../../../components/workspace';

import type { FormData } from './types';
import type { LookupOption } from '../../../hooks/useLookupValues';

interface LogisticsSectionProps {
  formData: FormData;
  isEditing: boolean;
  expandedSections: Record<string, boolean>;
  updateField: <K extends keyof FormData>(field: K, value: FormData[K]) => void;
  toggleSection: (sectionId: string) => void;
  getSectionOrder: (sectionId: string) => number | undefined;
  currencyOptions: LookupOption[];
  isRestricted: (field: string) => boolean;
}

export function LogisticsSection({
  formData,
  isEditing,
  expandedSections,
  updateField,
  toggleSection,
  getSectionOrder,
  currencyOptions,
  isRestricted,
}: LogisticsSectionProps) {
  return (
    <>
      {/* Insurance */}
      <WorkspaceSection
        id="insurance"
        title="Insurance & Indemnity"
        icon={<DollarSign size={20} />}
        isExpanded={expandedSections.insurance}
        onToggle={() => toggleSection('insurance')}
        isEditing={isEditing}
        order={getSectionOrder('insurance')}
      >
        <div className="grid grid-cols-2 gap-6">
          <EditableField
            value={formData.insurance_value}
            label="Insurance Value"
            isEditing={isEditing}
            onChange={(v) => updateField('insurance_value', v)}
            type="number"
            placeholder="0.00"
            restricted={isRestricted('insurance_value')}
          />
          <EditableSelect
            value={formData.insurance_currency}
            label="Currency"
            isEditing={isEditing}
            onChange={(v) => updateField('insurance_currency', v)}
            options={currencyOptions}
          />
          <EditableField
            value={formData.insurance_policy}
            label="Policy Number"
            isEditing={isEditing}
            onChange={(v) => updateField('insurance_policy', v)}
            placeholder="Policy number"
          />
          <EditableField
            value={formData.insurance_provider}
            label="Insurance Provider"
            isEditing={isEditing}
            onChange={(v) => updateField('insurance_provider', v)}
            placeholder="Insurance company"
          />
        </div>
        <div className="mt-6 pt-6 border-t border-lichen">
          <h4 className="text-sm font-medium text-ink mb-4">Government Indemnity</h4>
          <div className="flex items-start gap-6">
            <EditableCheckbox
              value={formData.indemnity}
              label="Government indemnity applies"
              isEditing={isEditing}
              onChange={(v) => updateField('indemnity', v)}
            />
          </div>
          {(formData.indemnity || !isEditing) && formData.indemnity && (
              <div className="mt-4">
                <EditableField
                  value={formData.indemnity_reference}
                  label="Indemnity Reference"
                  isEditing={isEditing}
                  onChange={(v) => updateField('indemnity_reference', v)}
                  placeholder="GIS reference number"
                  restricted={isRestricted('indemnity_reference')}
                />
              </div>
          )}
        </div>
      </WorkspaceSection>

      {/* Facility Report */}
      <WorkspaceSection
        id="facility"
        title="Facility Report"
        icon={<Shield size={20} />}
        isExpanded={expandedSections.facility}
        onToggle={() => toggleSection('facility')}
        isEditing={isEditing}
        order={getSectionOrder('facility')}
      >
        <div className="space-y-4">
          <div className="flex items-center gap-6">
            <EditableCheckbox
              value={formData.facility_report_sent}
              label="Facility report sent to lender"
              isEditing={isEditing}
              onChange={(v) => updateField('facility_report_sent', v)}
            />
            <EditableCheckbox
              value={formData.facility_report_approved}
              label="Approved by lender"
              isEditing={isEditing}
              onChange={(v) => updateField('facility_report_approved', v)}
            />
          </div>
          <div className="grid grid-cols-2 gap-6">
            {(formData.facility_report_sent || !isEditing) && (
              <EditableField
                value={formData.facility_report_date}
                label="Date Sent"
                isEditing={isEditing}
                onChange={(v) => updateField('facility_report_date', v)}
                type="date"
              />
            )}
            {(formData.facility_report_approved || !isEditing) && formData.facility_report_approved && (
              <EditableField
                value={formData.facility_report_approved_date}
                label="Date Approved"
                isEditing={isEditing}
                onChange={(v) => updateField('facility_report_approved_date', v)}
                type="date"
              />
            )}
          </div>
          <EditableField
            value={formData.facility_report_note}
            label="Facility Report Notes"
            isEditing={isEditing}
            onChange={(v) => updateField('facility_report_note', v)}
            multiline
            rows={2}
            placeholder="Notes about the facility report..."
            restricted={isRestricted('facility_report_note')}
          />
        </div>
      </WorkspaceSection>

    </>
  );
}
