import { Ruler } from 'lucide-react';
import { WorkspaceSection, EditableField, EditableSelect } from '../../../components/workspace';
import { MeasurementsField, InscriptionsField, NameListField } from '../../../components/collections/ObjectFieldComponents';
import { MaterialLinker } from '../../../components/collections/MaterialLinker';
import { TechniqueLinker } from '../../../components/collections/TechniqueLinker';
import type { BaseSectionProps } from './types';

type PhysicalSectionProps = BaseSectionProps

export function PhysicalSection({
  orgId,
  objectId,
  isEditing,
  formData,
  object,
  updateField,
  updateFieldSilent,
  handleFieldBlur,
  expandedSections,
  toggleSection,
  sectionRefs,
  getSectionOrder,
  isEmpty,
  sectionSummaries,
}: PhysicalSectionProps) {
  return (
    <WorkspaceSection
      id="physical"
      title="Physical Description"
      icon={<Ruler size={18} />}
      hint={sectionSummaries?.physical}
      isEmpty={isEmpty}
      isExpanded={expandedSections.physical}
      onToggle={() => toggleSection('physical')}
      isEditing={isEditing}
      sectionRef={(el) => { sectionRefs.current['physical'] = el; }}
      order={getSectionOrder('physical')}
    >
      <div className="space-y-4">
        <EditableField
          label="Physical Description"
          value={isEditing ? (formData?.physical_description || '') : (object?.physical_description || '')}
          isEditing={isEditing}
          onChange={(v) => updateField('physical_description', v)}
          onSave={handleFieldBlur}
          multiline
          rows={2}
          placeholder="Overall physical description..."
        />

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <EditableField
            label="Color"
            value={isEditing ? (formData?.color || '') : (object?.color || '')}
            isEditing={isEditing}
            onChange={(v) => updateField('color', v)}
            onSave={handleFieldBlur}
            placeholder="e.g., polychrome, gilt"
          />
          <EditableField
            label="Form"
            value={isEditing ? (formData?.form || '') : (object?.form || '')}
            isEditing={isEditing}
            onChange={(v) => updateField('form', v)}
            onSave={handleFieldBlur}
            placeholder="e.g., rectangular, oval"
          />
          <EditableField
            label="Orientation"
            value={isEditing ? (formData?.orientation || '') : (object?.orientation || '')}
            isEditing={isEditing}
            onChange={(v) => updateField('orientation', v)}
            onSave={handleFieldBlur}
            placeholder="e.g., portrait, landscape"
          />
        </div>

        {/* Materials - Using AAT vocabulary linker */}
        <MaterialLinker
          organizationId={orgId}
          objectId={objectId!}
          isEditing={isEditing}
        />

        {/* Techniques - Using AAT vocabulary linker */}
        <TechniqueLinker
          organizationId={orgId}
          objectId={objectId!}
          isEditing={isEditing}
        />

        {/* Measurements */}
        <MeasurementsField
          measurements={isEditing ? (formData?.measurements || []) : (object?.measurements || [])}
          isEditing={isEditing}
          onChange={(m) => updateField('measurements', m)}
          onAdd={() => updateFieldSilent('measurements', [...(formData?.measurements || []), { dimension: '', value: 0, unit: 'cm', part: null }])}
          onSave={handleFieldBlur}
        />

        {/* Inscriptions */}
        <InscriptionsField
          inscriptions={isEditing ? (formData?.inscriptions || []) : (object?.inscriptions || [])}
          isEditing={isEditing}
          onChange={(i) => updateField('inscriptions', i)}
          onAdd={() => updateFieldSilent('inscriptions', [...(formData?.inscriptions || []), ''])}
          onSave={handleFieldBlur}
        />

        {/* Watermarks */}
        <NameListField
          label="Watermarks"
          items={isEditing ? (formData?.watermarks || []) : (object?.watermarks || [])}
          isEditing={isEditing}
          onChange={(items) => updateField('watermarks', items)}
          onSave={handleFieldBlur}
          nameKey="identification"
          placeholder="Watermark identification..."
          secondaryFields={[
            { key: 'description', label: 'Description', placeholder: 'Description...' },
            { key: 'briquet_number', label: 'Briquet #', placeholder: 'Briquet number...' },
            { key: 'location_on_work', label: 'Location', placeholder: 'Location on work...' },
          ]}
        />

        {/* Technical Attributes */}
        <NameListField
          label="Technical Attributes"
          items={isEditing ? (formData?.technical_attributes || []) : (object?.technical_attributes || [])}
          isEditing={isEditing}
          onChange={(items) => updateField('technical_attributes', items)}
          onSave={handleFieldBlur}
          nameKey="name"
          placeholder="Attribute name..."
          secondaryFields={[
            { key: 'value', label: 'Value', placeholder: 'Value...' },
          ]}
        />

        {/* Edition, Print State & Age */}
        <div className="pt-4 border-t border-lichen">
          <h4 className="text-sm font-medium text-ink mb-3">Edition & Print State</h4>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <EditableField
              label="Edition"
              value={isEditing ? (formData?.edition || '') : (object?.edition || '')}
              isEditing={isEditing}
              onChange={(v) => updateField('edition', v)}
              onSave={handleFieldBlur}
              placeholder="e.g., 2nd edition"
            />
            <EditableField
              label="Copy Number"
              value={isEditing ? (formData?.copy_number || '') : (object?.copy_number || '')}
              isEditing={isEditing}
              onChange={(v) => updateField('copy_number', v)}
              onSave={handleFieldBlur}
              placeholder="e.g., 3/50"
            />
            <EditableField
              label="Edition Note"
              value={isEditing ? (formData?.edition_note || '') : (object?.edition_note || '')}
              isEditing={isEditing}
              onChange={(v) => updateField('edition_note', v)}
              onSave={handleFieldBlur}
              placeholder="Notes about the edition..."
            />
            <EditableField
              label="State Number"
              value={isEditing ? (formData?.state_number?.toString() || '') : (object?.state_number?.toString() || '')}
              isEditing={isEditing}
              onChange={(v) => updateField('state_number', v ? parseInt(v) : null)}
              onSave={handleFieldBlur}
              type="number"
              placeholder="e.g., 2"
            />
            <EditableField
              label="Total States"
              value={isEditing ? (formData?.total_states?.toString() || '') : (object?.total_states?.toString() || '')}
              isEditing={isEditing}
              onChange={(v) => updateField('total_states', v ? parseInt(v) : null)}
              onSave={handleFieldBlur}
              type="number"
              placeholder="e.g., 5"
            />
            <EditableField
              label="State Description"
              value={isEditing ? (formData?.state_description || '') : (object?.state_description || '')}
              isEditing={isEditing}
              onChange={(v) => updateField('state_description', v)}
              onSave={handleFieldBlur}
              placeholder="Description of this state..."
            />
            <EditableSelect
              label="Catalog Level"
              value={isEditing ? (formData?.catalog_level || '') : (object?.catalog_level || '')}
              isEditing={isEditing}
              onChange={(v) => updateField('catalog_level', v)}
              options={[
                { value: 'item', label: 'Item' },
                { value: 'volume', label: 'Volume' },
                { value: 'group', label: 'Group' },
                { value: 'subgroup', label: 'Subgroup' },
                { value: 'set', label: 'Set' },
              ]}
              placeholder="Select..."
            />
            <EditableField
              label="Age"
              value={isEditing ? (formData?.age || '') : (object?.age || '')}
              isEditing={isEditing}
              onChange={(v) => updateField('age', v)}
              onSave={handleFieldBlur}
              placeholder="e.g., 200"
            />
            <EditableSelect
              label="Age Qualifier"
              value={isEditing ? (formData?.age_qualifier || '') : (object?.age_qualifier || '')}
              isEditing={isEditing}
              onChange={(v) => updateField('age_qualifier', v)}
              options={[
                { value: 'circa', label: 'Circa' },
                { value: 'before', label: 'Before' },
                { value: 'after', label: 'After' },
                { value: 'exact', label: 'Exact' },
              ]}
              placeholder="Select..."
            />
            <EditableSelect
              label="Age Unit"
              value={isEditing ? (formData?.age_unit || '') : (object?.age_unit || '')}
              isEditing={isEditing}
              onChange={(v) => updateField('age_unit', v)}
              options={[
                { value: 'years', label: 'Years' },
                { value: 'centuries', label: 'Centuries' },
                { value: 'millennia', label: 'Millennia' },
              ]}
              placeholder="Select..."
            />
          </div>
        </div>

        {/* Construction & Installation */}
        <div className="pt-4 border-t border-lichen">
          <h4 className="text-sm font-medium text-ink mb-3">Construction & Installation</h4>
          <div className="space-y-4">
            <EditableField
              label="Facture Description"
              value={isEditing ? (formData?.facture_description || '') : (object?.facture_description || '')}
              isEditing={isEditing}
              onChange={(v) => updateField('facture_description', v)}
              onSave={handleFieldBlur}
              multiline
              rows={2}
              placeholder="Construction, fabrication, or facture details..."
            />
            <EditableField
              label="Arrangement"
              value={isEditing ? (formData?.arrangement || '') : (object?.arrangement || '')}
              isEditing={isEditing}
              onChange={(v) => updateField('arrangement', v)}
              onSave={handleFieldBlur}
              multiline
              rows={2}
              placeholder="How components are arranged..."
            />
            <EditableField
              label="Installation Instructions"
              value={isEditing ? (formData?.installation_instructions || '') : (object?.installation_instructions || '')}
              isEditing={isEditing}
              onChange={(v) => updateField('installation_instructions', v)}
              onSave={handleFieldBlur}
              multiline
              rows={3}
              placeholder="Installation, mounting, or display instructions..."
            />
          </div>
        </div>
      </div>
    </WorkspaceSection>
  );
}
