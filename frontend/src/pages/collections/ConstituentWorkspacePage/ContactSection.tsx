import { Mail } from 'lucide-react';
import {
  WorkspaceSection,
  EditableField,
} from '../../../components/workspace';
import type { BaseSectionProps } from './types';

export function ContactSection({
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
  isRestricted,
}: BaseSectionProps) {
  return (
    <WorkspaceSection
      id="contact"
      title="Contact Details"
      icon={<Mail size={18} />}
      isExpanded={expandedSections.contact}
      onToggle={() => toggleSection('contact')}
      isEditing={isEditing}
      sectionRef={(el) => { sectionRefs.current['contact'] = el; }}
      order={getSectionOrder('contact')}
      isEmpty={isEmpty}
      sectionHint={sectionSummaries?.contact}
    >
      <div className="space-y-8">
        {/* Communication */}
        <div>
          <h4 className="text-sm font-medium text-archive uppercase tracking-wide mb-4">
            Communication
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <EditableField
              label="Email"
              value={formData.email}
              onChange={(v) => updateField('email', v)}
              onSave={handleFieldBlur}
              isEditing={isEditing}
              type="email"
              restricted={isRestricted('email')}
            />
            <EditableField
              label="Phone"
              value={formData.phone}
              onChange={(v) => updateField('phone', v)}
              onSave={handleFieldBlur}
              isEditing={isEditing}
              restricted={isRestricted('phone')}
            />
            <EditableField
              label="Phone (Secondary)"
              value={formData.phone_secondary}
              onChange={(v) => updateField('phone_secondary', v)}
              onSave={handleFieldBlur}
              isEditing={isEditing}
              restricted={isRestricted('phone_secondary')}
            />
            <EditableField
              label="Website"
              value={formData.website}
              onChange={(v) => updateField('website', v)}
              onSave={handleFieldBlur}
              isEditing={isEditing}
              placeholder="https://..."
            />
          </div>
        </div>

        {/* Affiliation */}
        <div>
          <h4 className="text-sm font-medium text-archive uppercase tracking-wide mb-4">
            Affiliation
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <EditableField
              label="Title"
              value={formData.title}
              onChange={(v) => updateField('title', v)}
              onSave={handleFieldBlur}
              isEditing={isEditing}
              placeholder="e.g., Curator, Director"
            />
            <EditableField
              label="Role"
              value={formData.role}
              onChange={(v) => updateField('role', v)}
              onSave={handleFieldBlur}
              isEditing={isEditing}
              placeholder="e.g., Donor, Lender"
            />
            <EditableField
              label="Organization"
              value={formData.organization_name}
              onChange={(v) => updateField('organization_name', v)}
              onSave={handleFieldBlur}
              isEditing={isEditing}
              placeholder="Organization name"
            />
            <EditableField
              label="Department"
              value={formData.department}
              onChange={(v) => updateField('department', v)}
              onSave={handleFieldBlur}
              isEditing={isEditing}
              placeholder="Department name"
            />
          </div>
        </div>

        {/* Address */}
        <div>
          <h4 className="text-sm font-medium text-archive uppercase tracking-wide mb-4">
            Address
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="md:col-span-2">
              <EditableField
                label="Street Address"
                value={formData.street}
                onChange={(v) => updateField('street', v)}
                onSave={handleFieldBlur}
                isEditing={isEditing}
                placeholder="Street address"
                restricted={isRestricted('address')}
              />
            </div>
            <EditableField
              label="City"
              value={formData.city}
              onChange={(v) => updateField('city', v)}
              onSave={handleFieldBlur}
              isEditing={isEditing}
              restricted={isRestricted('address')}
            />
            <EditableField
              label="State / Province"
              value={formData.state}
              onChange={(v) => updateField('state', v)}
              onSave={handleFieldBlur}
              isEditing={isEditing}
              restricted={isRestricted('address')}
            />
            <EditableField
              label="Postal Code"
              value={formData.postal_code}
              onChange={(v) => updateField('postal_code', v)}
              onSave={handleFieldBlur}
              isEditing={isEditing}
              restricted={isRestricted('address')}
            />
            <EditableField
              label="Country"
              value={formData.country}
              onChange={(v) => updateField('country', v)}
              onSave={handleFieldBlur}
              isEditing={isEditing}
              restricted={isRestricted('address')}
            />
          </div>
        </div>
      </div>
    </WorkspaceSection>
  );
}
