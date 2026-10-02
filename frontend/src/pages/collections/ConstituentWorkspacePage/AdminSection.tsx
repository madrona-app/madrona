import { Shield, CheckCircle } from 'lucide-react';
import {
  WorkspaceSection,
  EditableField,
  EditableSelect,
  EditableCheckbox,
} from '../../../components/workspace';
import type { BaseSectionProps } from './types';
import { STATUS_OPTIONS } from './types';

export function AdminSection({
  isEditing,
  isCreateMode,
  formData,
  updateField,
  handleFieldBlur,
  expandedSections,
  toggleSection,
  sectionRefs,
  getSectionOrder,
  isEmpty,
  sectionSummaries,
  isRestricted,
}: BaseSectionProps) {
  return (
    <WorkspaceSection
      id="admin"
      title="Record Status"
      icon={<Shield size={18} />}
      isExpanded={expandedSections.admin}
      onToggle={() => toggleSection('admin')}
      isEditing={isEditing}
      sectionRef={(el) => { sectionRefs.current['admin'] = el; }}
      order={getSectionOrder('admin')}
      isEmpty={isEmpty}
      sectionHint={sectionSummaries?.admin}
    >
      <div className="space-y-8">
        {/* Status & Flags */}
        <div>
          <h4 className="text-sm font-medium text-archive uppercase tracking-wide mb-4">
            Record Status
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <EditableSelect
              label="Status"
              value={formData.status}
              options={STATUS_OPTIONS}
              onChange={(v) => updateField('status', v)}
              onSave={handleFieldBlur}
              isEditing={isEditing}
            />
            <div className="space-y-4">
              <EditableCheckbox
                label="Active"
                value={formData.is_active}
                isEditing={isEditing}
                onChange={(v) => updateField('is_active', v)}
                onSave={handleFieldBlur}
              />
              <div className="flex items-center gap-3">
                <EditableCheckbox
                  label="Verified"
                  value={formData.is_verified}
                  isEditing={isEditing}
                  onChange={(v) => updateField('is_verified', v)}
                  onSave={handleFieldBlur}
                />
                {isEditing && !formData.is_verified && (
                  <button
                    type="button"
                    onClick={() => {
                      updateField('is_verified', true);
                      if (!isCreateMode) {
                        setTimeout(() => handleFieldBlur(), 0);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-forest/30 text-forest rounded-lg hover:bg-forest/10 transition-colors"
                  >
                    <CheckCircle size={14} />
                    Verify
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Notes */}
        <div>
          <h4 className="text-sm font-medium text-archive uppercase tracking-wide mb-4">
            Notes
          </h4>
          <div className="space-y-6">
            <EditableField
              label="Notes"
              value={formData.notes}
              onChange={(v) => updateField('notes', v)}
              onSave={handleFieldBlur}
              isEditing={isEditing}
              multiline
              rows={3}
              placeholder="General notes..."
            />
            <EditableField
              label="Internal Notes"
              value={formData.internal_notes}
              onChange={(v) => updateField('internal_notes', v)}
              onSave={handleFieldBlur}
              isEditing={isEditing}
              multiline
              rows={3}
              placeholder="Internal staff notes (not publicly visible)..."
              restricted={isRestricted('internal_notes')}
            />
            <EditableField
              label="Cataloger Notes"
              value={formData.cataloger_notes}
              onChange={(v) => updateField('cataloger_notes', v)}
              onSave={handleFieldBlur}
              isEditing={isEditing}
              multiline
              rows={3}
              placeholder="Cataloging notes..."
            />
          </div>
        </div>
      </div>
    </WorkspaceSection>
  );
}
