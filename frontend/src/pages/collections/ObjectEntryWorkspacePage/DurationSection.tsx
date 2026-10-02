/**
 * Duration Section
 *
 * Displays and edits expected duration and return date.
 */

import { Clock } from 'lucide-react';
import {
  WorkspaceSection,
  EditableField,
  EditableSelect,
} from '../../../components/workspace';
import type { DurationSectionProps } from './types';

export function DurationSection({
  formData,
  updateField,
  isExpanded,
  onToggle,
  isEditing,
  getSectionOrder,
  durationOptions,
  isRestricted,
}: DurationSectionProps) {
  return (
    <WorkspaceSection
      id="duration"
      title="Expected Duration"
      icon={<Clock size={20} />}
      isExpanded={isExpanded}
      onToggle={onToggle}
      isEditing={isEditing}
      order={getSectionOrder('duration')}
    >
      <div className="grid grid-cols-2 gap-6">
        <EditableSelect
          value={formData.expected_duration || ''}
          label="Expected Duration"
          isEditing={isEditing}
          onChange={(v) => updateField('expected_duration', v)}
          options={durationOptions}
          placeholder="Select duration..."
        />
        <EditableField
          value={formData.expected_return_date || ''}
          label="Expected Return Date"
          isEditing={isEditing}
          onChange={(v) => updateField('expected_return_date', v)}
          type="date"
        />
      </div>
      <div className="mt-6">
        <EditableField
          value={formData.conditions || ''}
          label="Conditions"
          isEditing={isEditing}
          onChange={(v) => updateField('conditions', v)}
          multiline
          rows={3}
          placeholder="Terms and conditions for the temporary custody..."
          restricted={isRestricted('special_conditions')}
        />
      </div>
    </WorkspaceSection>
  );
}
