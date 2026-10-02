/**
 * Entry Information Section
 *
 * Displays and edits entry date, reason, and receipt reference.
 */

import { Calendar } from 'lucide-react';
import {
  WorkspaceSection,
  EditableField,
  EditableSelect,
} from '../../../components/workspace';
import { SectionCompletionBadge } from '../../../components/collections/SectionCompletionBadge';
import type { EntrySectionProps } from './types';

const ENTRY_METHOD_OPTIONS = [
  { value: '', label: '— Select method —' },
  { value: 'hand_delivery', label: 'Hand delivery' },
  { value: 'post', label: 'Post / mail' },
  { value: 'courier', label: 'Courier' },
  { value: 'collected', label: 'Collected by staff' },
  { value: 'other', label: 'Other' },
];

export function EntryInfoSection({
  formData,
  updateField,
  isExpanded,
  onToggle,
  isEditing,
  isCreateMode,
  getSectionOrder,
  sectionCompletion,
  entryReasonOptions,
  orgId: _orgId,
}: EntrySectionProps) {
  return (
    <WorkspaceSection
      id="entry"
      title="Entry Information"
      icon={<Calendar size={20} />}
      isExpanded={isExpanded}
      onToggle={onToggle}
      isEditing={isEditing}
      order={getSectionOrder('entry')}
      badge={!isCreateMode && sectionCompletion ? <SectionCompletionBadge completion={sectionCompletion} /> : undefined}
    >
      <div className="grid grid-cols-2 gap-6">
        <EditableField
          value={formData.entry_date || ''}
          label="Entry Date"
          isEditing={isEditing}
          onChange={(v) => updateField('entry_date', v)}
          type="date"
          required
        />
        <EditableSelect
          value={formData.reason || ''}
          label="Reason for Entry"
          isEditing={isEditing}
          onChange={(v) => updateField('reason', v)}
          options={entryReasonOptions}
          required
        />
        <EditableField
          value={formData.receipt_reference || ''}
          label="Receipt Reference"
          isEditing={isEditing}
          onChange={(v) => updateField('receipt_reference', v)}
          placeholder="Receipt or reference number"
        />
        <EditableSelect
          value={(formData.entry_method as string) || ''}
          label="Entry Method"
          isEditing={isEditing}
          onChange={(v) => updateField('entry_method', v)}
          options={ENTRY_METHOD_OPTIONS}
        />
      </div>
    </WorkspaceSection>
  );
}
