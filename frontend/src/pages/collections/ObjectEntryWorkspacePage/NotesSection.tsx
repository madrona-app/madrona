/**
 * Notes Section
 *
 * Displays and edits entry notes.
 */

import { FileText } from 'lucide-react';
import {
  WorkspaceSection,
  EditableField,
} from '../../../components/workspace';
import type { NotesSectionProps } from './types';

export function NotesSection({
  formData,
  updateField,
  isExpanded,
  onToggle,
  isEditing,
  getSectionOrder,
}: NotesSectionProps) {
  return (
    <WorkspaceSection
      id="notes"
      title="Notes"
      icon={<FileText size={20} />}
      isExpanded={isExpanded}
      onToggle={onToggle}
      isEditing={isEditing}
      order={getSectionOrder('notes')}
    >
      <EditableField
        name="entry_note"
        value={formData.entry_note || ''}
        label="Entry Notes"
        isEditing={isEditing}
        onChange={(v) => updateField('entry_note', v)}
        multiline
        rows={4}
        placeholder="Additional notes about this entry..."
      />
      <EditableField
        name="depositor_requirements"
        label="Depositor Requirements"
        value={formData.depositor_requirements || ''}
        isEditing={isEditing}
        onChange={(v) => updateField('depositor_requirements', v)}
        multiline
        rows={2}
      />
      <EditableField
        name="special_conditions"
        label="Special Conditions"
        value={formData.special_conditions || ''}
        isEditing={isEditing}
        onChange={(v) => updateField('special_conditions', v)}
        multiline
        rows={2}
      />
      <EditableField
        name="packing_note"
        label="Packing Note"
        value={formData.packing_note || ''}
        isEditing={isEditing}
        onChange={(v) => updateField('packing_note', v)}
        multiline
        rows={2}
      />
    </WorkspaceSection>
  );
}
