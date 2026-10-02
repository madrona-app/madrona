import { ClipboardCheck } from 'lucide-react';
import { WorkspaceSection, EditableField, EditableCheckbox } from '../../../components/workspace';
import type { FormData } from './types';

interface FacilitySectionProps {
  formData: FormData;
  isExpanded: boolean;
  isEditing: boolean;
  order: number | undefined;
  onToggle: () => void;
  onUpdateField: <K extends keyof FormData>(field: K, value: FormData[K]) => void;
  onFieldBlur: () => void;
}

export function FacilitySection({
  formData,
  isExpanded,
  isEditing,
  order,
  onToggle,
  onUpdateField,
  onFieldBlur,
}: FacilitySectionProps) {
  return (
    <WorkspaceSection
      id="facility"
      title="Facility Report"
      icon={<ClipboardCheck size={18} />}
      isExpanded={isExpanded}
      onToggle={onToggle}
      isEditing={isEditing}
      order={order}
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <EditableCheckbox
          label="Facility Report Received"
          value={formData.facility_report_received}
          isEditing={isEditing}
          onChange={(v) => onUpdateField('facility_report_received', v)}
          onSave={onFieldBlur}
        />
        <EditableField
          label="Report Date"
          value={formData.facility_report_date}
          isEditing={isEditing}
          onChange={(v) => onUpdateField('facility_report_date', v)}
          onSave={onFieldBlur}
          type="date"
        />
        <EditableCheckbox
          label="Report Approved"
          value={formData.facility_report_approved}
          isEditing={isEditing}
          onChange={(v) => onUpdateField('facility_report_approved', v)}
          onSave={onFieldBlur}
        />
        <EditableCheckbox
          label="Security conditions confirmed"
          value={formData.security_conditions_confirmed}
          isEditing={isEditing}
          onChange={(v) => onUpdateField('security_conditions_confirmed', v)}
          onSave={onFieldBlur}
        />
      </div>
    </WorkspaceSection>
  );
}
