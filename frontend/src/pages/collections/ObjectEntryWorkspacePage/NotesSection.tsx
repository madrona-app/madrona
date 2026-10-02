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
        value={formData.entry_note || ''}
        label="Entry Notes"
        isEditing={isEditing}
        onChange={(v) => updateField('entry_note', v)}
        multiline
        rows={4}
        placeholder="Additional notes about this entry..."
      />
    </WorkspaceSection>
  );
}
