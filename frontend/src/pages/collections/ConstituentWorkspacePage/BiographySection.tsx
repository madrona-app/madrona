import { BookOpen } from 'lucide-react';
import {
  WorkspaceSection,
  EditableField,
  EditablePlaceField,
} from '../../../components/workspace';
import type { BaseSectionProps } from './types';

interface BiographySectionProps extends BaseSectionProps {
  updatePlaceField: (
    placeField: 'birth_place' | 'death_place',
    value: string,
    tgnId: string | null,
  ) => void;
}

export function BiographySection({
  isEditing,
  formData,
  updateField,
  handleFieldBlur,
  expandedSections,
  toggleSection,
  sectionRefs,
  getSectionOrder,
  isEmpty,
  sectionSummaries,
  updatePlaceField,
}: BiographySectionProps) {
  return (
    <WorkspaceSection
      id="biography"
      title="Biography"
      icon={<BookOpen size={18} />}
      isExpanded={expandedSections.biography}
      onToggle={() => toggleSection('biography')}
      isEditing={isEditing}
      sectionRef={(el) => { sectionRefs.current['biography'] = el; }}
      order={getSectionOrder('biography')}
      isEmpty={isEmpty}
      sectionHint={sectionSummaries?.biography}
    >
      <div className="space-y-8">
        {/* Dates and Places */}
        <div>
          <h4 className="text-sm font-medium text-archive uppercase tracking-wide mb-4">
            Existence Dates
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <EditableField
              label="Birth Date (Display)"
              value={formData.birth_date_display}
              onChange={(v) => updateField('birth_date_display', v)}
              onSave={handleFieldBlur}
              isEditing={isEditing}
              placeholder="e.g., July 15, 1606"
            />
            <EditablePlaceField
              label="Birth Place"
              value={formData.birth_place}
              tgnId={formData.birth_place_tgn_id}
              isEditing={isEditing}
              onChange={(value, tgnId) =>
                updatePlaceField('birth_place', value, tgnId)
              }
              onSave={handleFieldBlur}
              placeholder="e.g., Leiden, Netherlands"
            />
            <EditableField
              label="Death Date (Display)"
              value={formData.death_date_display}
              onChange={(v) => updateField('death_date_display', v)}
              onSave={handleFieldBlur}
              isEditing={isEditing}
              placeholder="e.g., October 4, 1669"
            />
            <EditablePlaceField
              label="Death Place"
              value={formData.death_place}
              tgnId={formData.death_place_tgn_id}
              isEditing={isEditing}
              onChange={(value, tgnId) =>
                updatePlaceField('death_place', value, tgnId)
              }
              onSave={handleFieldBlur}
              placeholder="e.g., Amsterdam, Netherlands"
            />
            <EditableField
              label="Active Period (Display)"
              value={formData.active_date_display}
              onChange={(v) => updateField('active_date_display', v)}
              onSave={handleFieldBlur}
              isEditing={isEditing}
              placeholder="e.g., 1625-1669"
              className="md:col-span-2"
            />
          </div>
        </div>

        {/* Biographical Text */}
        <div>
          <h4 className="text-sm font-medium text-archive uppercase tracking-wide mb-4">
            Biographical Text
          </h4>
          <div className="space-y-6">
            <EditableField
              label="Biography"
              value={formData.biography}
              onChange={(v) => updateField('biography', v)}
              onSave={handleFieldBlur}
              isEditing={isEditing}
              multiline
              rows={6}
              placeholder="Enter biographical information..."
            />
            <EditableField
              label="Biography Source"
              value={formData.biography_source}
              onChange={(v) => updateField('biography_source', v)}
              onSave={handleFieldBlur}
              isEditing={isEditing}
              placeholder="Source of biographical information"
            />
          </div>
        </div>
      </div>
    </WorkspaceSection>
  );
}
