import { StickyNote } from 'lucide-react';
import { WorkspaceSection, EditableField } from '../../../components/workspace';
import type { FormData } from './types';

interface NotesSectionProps {
  formData: FormData;
  isExpanded: boolean;
  isEditing: boolean;
  order: number | undefined;
  onToggle: () => void;
  onUpdateField: <K extends keyof FormData>(field: K, value: FormData[K]) => void;
  onFieldBlur: () => void;
}

export function NotesSection({
  formData,
  isExpanded,
  isEditing,
  order,
  onToggle,
  onUpdateField,
  onFieldBlur,
}: NotesSectionProps) {
  return (
    <WorkspaceSection
      id="notes"
      title="Additional Notes"
      icon={<StickyNote size={18} />}
      isExpanded={isExpanded}
      onToggle={onToggle}
      isEditing={isEditing}
      order={order}
    >
      <EditableField
        label="Loan Notes"
        value={formData.loan_note}
        isEditing={isEditing}
        onChange={(v) => onUpdateField('loan_note', v)}
        onSave={onFieldBlur}
        multiline
        rows={4}
        placeholder="Any additional notes..."
      />
    </WorkspaceSection>
  );
}
