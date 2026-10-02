import { FileText } from 'lucide-react';
import { WorkspaceSection, EditableField } from '../../../components/workspace';
import type { BaseSectionProps } from './types';

type DescriptionSectionProps = BaseSectionProps

export function DescriptionSection({
  isEditing,
  formData,
  object,
  updateField,
  handleFieldBlur,
  expandedSections,
  toggleSection,
  sectionRefs,
  getSectionOrder,
  isEmpty,
  sectionSummaries,
}: DescriptionSectionProps) {
  return (
    <WorkspaceSection
      id="description"
      title="Description"
      icon={<FileText size={18} />}
      hint={sectionSummaries?.description}
      isEmpty={isEmpty}
      isExpanded={expandedSections.description}
      onToggle={() => toggleSection('description')}
      isEditing={isEditing}
      sectionRef={(el) => { sectionRefs.current['description'] = el; }}
      order={getSectionOrder('description')}
    >
      <div className="space-y-4">
        <EditableField
          label="Brief Description"
          value={isEditing ? (formData?.brief_description || '') : (object?.brief_description || '')}
          isEditing={isEditing}
          onChange={(v) => updateField('brief_description', v)}
          onSave={handleFieldBlur}
          multiline
          rows={2}
          placeholder="A short description of the object..."
        />
        <EditableField
          label="Full Description"
          value={isEditing ? (formData?.full_description || '') : (object?.full_description || '')}
          isEditing={isEditing}
          onChange={(v) => updateField('full_description', v)}
          onSave={handleFieldBlur}
          multiline
          rows={5}
          placeholder="Detailed description..."
        />
        <EditableField
          label="Content Description"
          value={isEditing ? (formData?.content_description || '') : (object?.content_description || '')}
          isEditing={isEditing}
          onChange={(v) => updateField('content_description', v)}
          onSave={handleFieldBlur}
          multiline
          rows={3}
          placeholder="Subject matter, iconography, depicted scenes..."
        />
        <EditableField
          label="Distinguishing Features"
          value={isEditing ? (formData?.distinguishing_features || '') : (object?.distinguishing_features || '')}
          isEditing={isEditing}
          onChange={(v) => updateField('distinguishing_features', v)}
          onSave={handleFieldBlur}
          multiline
          rows={2}
          placeholder="Unique identifying marks, damage, repairs..."
        />
        <EditableField
          label="Comments"
          value={isEditing ? (formData?.comments || '') : (object?.comments || '')}
          isEditing={isEditing}
          onChange={(v) => updateField('comments', v)}
          onSave={handleFieldBlur}
          multiline
          rows={2}
          placeholder="Internal comments..."
        />
      </div>
    </WorkspaceSection>
  );
}
