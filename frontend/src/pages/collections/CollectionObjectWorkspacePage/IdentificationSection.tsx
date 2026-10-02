import { Tag } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getOtherNumberTypes } from '../../../lib/api';
import { WorkspaceSection, EditableField, EditableSelect } from '../../../components/workspace';
import {
  TitlesField,
  ClassificationsField,
  type OtherNumber,
} from '../../../components/collections/ObjectFieldComponents';
import { DepartmentSelector } from '../../../components/collections/DepartmentSelector';
import { useLookupCategory } from '../../../hooks/useLookupValues';
import { Plus, X } from 'lucide-react';
import type { BaseSectionProps } from './types';
import { OBJECT_TYPES, OBJECT_STATUSES } from './types';

type IdentificationSectionProps = BaseSectionProps

export function IdentificationSection({
  orgId,
  objectId: _objectId,
  isEditing,
  isCreateMode: _isCreateMode,
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
}: IdentificationSectionProps) {
  const { options: classificationOptions } = useLookupCategory('classification');

  return (
    <WorkspaceSection
      id="identification"
      title="Identification"
      icon={<Tag size={18} />}
      hint={sectionSummaries?.identification}
      isEmpty={isEmpty}
      isExpanded={expandedSections.identification}
      onToggle={() => toggleSection('identification')}
      isEditing={isEditing}
      sectionRef={(el) => { sectionRefs.current['identification'] = el; }}
      order={getSectionOrder('identification')}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <EditableField
          label="Object Number"
          value={isEditing ? (formData?.object_number || '') : (object?.object_number || '')}
          isEditing={isEditing}
          onChange={(v) => updateField('object_number', v)}
          onSave={handleFieldBlur}
          required
          placeholder="e.g., 2024.001"
        />
        <EditableSelect
          label="Object Type"
          value={isEditing ? (formData?.object_type || '') : (object?.object_type || '')}
          isEditing={isEditing}
          onChange={(v) => updateField('object_type', v)}
          onSave={handleFieldBlur}
          options={OBJECT_TYPES}
          placeholder="Select type..."
        />
        <EditableField
          label="Object Name"
          value={isEditing ? (formData?.object_name || '') : (object?.object_name || '')}
          isEditing={isEditing}
          onChange={(v) => updateField('object_name', v)}
          onSave={handleFieldBlur}
          placeholder="Common name (e.g., Vase, Portrait)"
          className="sm:col-span-2"
        />
        <EditableSelect
          label="Status"
          value={isEditing ? (formData?.object_status || '') : (object?.object_status || '')}
          isEditing={isEditing}
          onChange={(v) => updateField('object_status', v)}
          onSave={handleFieldBlur}
          options={OBJECT_STATUSES}
          badge
        />
        <EditableField
          label="Number of Objects"
          value={isEditing ? (formData?.number_of_objects?.toString() || '1') : (object?.number_of_objects?.toString() || '1')}
          isEditing={isEditing}
          onChange={(v) => updateField('number_of_objects', parseInt(v) || 1)}
          onSave={handleFieldBlur}
          type="number"
        />

        {/* Titles - Complex field */}
        <div className="sm:col-span-2">
          <TitlesField
            titles={isEditing ? (formData?.titles || []) : (object?.titles || [])}
            isEditing={isEditing}
            onChange={(titles) => updateField('titles', titles)}
            onAdd={() => {
              const isFirst = (formData?.titles?.length || 0) === 0;
              updateFieldSilent('titles', [
                ...(formData?.titles || []),
                { title: '', title_type: null, language: null, is_preferred: isFirst },
              ]);
            }}
            onSave={handleFieldBlur}
          />
        </div>

        {/* Classifications - Complex field */}
        <div className="sm:col-span-2">
          <ClassificationsField
            classifications={isEditing ? (formData?.classifications || []) : (object?.classifications || [])}
            isEditing={isEditing}
            onChange={(classifications) => updateField('classifications', classifications)}
            onAdd={() => updateFieldSilent('classifications', [...(formData?.classifications || []), { term: '' }])}
            onSave={handleFieldBlur}
            lookupOptions={classificationOptions}
          />
        </div>

        {/* Date & Place of Creation */}
        <EditableField
          label="Date"
          value={isEditing ? (formData?.creation_date_display || '') : (object?.creation_date_display || '')}
          isEditing={isEditing}
          onChange={(v) => updateField('creation_date_display', v)}
          onSave={handleFieldBlur}
          placeholder="e.g., c. 1890, 19th century"
        />
        <EditableField
          label="Place of Creation"
          value={isEditing ? (formData?.creation_place || '') : (object?.creation_place || '')}
          isEditing={isEditing}
          onChange={(v) => updateField('creation_place', v)}
          onSave={handleFieldBlur}
          placeholder="Place of creation"
        />
        <DepartmentSelector
          organizationId={orgId}
          value={isEditing ? (formData?.department_id ?? null) : (object?.department_id ?? null)}
          onChange={(deptId) => updateField('department_id', deptId)}
          isEditing={isEditing}
          label="Department"
          onBlur={handleFieldBlur}
        />
        <EditableField
          label="Production Reason"
          value={isEditing ? (formData?.production_reason || '') : (object?.production_reason || '')}
          isEditing={isEditing}
          onChange={(v) => updateField('production_reason', v)}
          onSave={handleFieldBlur}
          placeholder="Why the object was created..."
        />
        <EditableField
          label="Production Note"
          value={isEditing ? (formData?.production_note || '') : (object?.production_note || '')}
          isEditing={isEditing}
          onChange={(v) => updateField('production_note', v)}
          onSave={handleFieldBlur}
          multiline
          rows={2}
          placeholder="Additional production details..."
          className="sm:col-span-2"
        />

        {/* Other Numbers - Complex field */}
        <div className="sm:col-span-2">
          <OtherNumbersField
            organizationId={orgId}
            numbers={isEditing ? (formData?.other_numbers || []) : (object?.other_numbers || [])}
            isEditing={isEditing}
            onChange={(numbers) => updateField('other_numbers', numbers)}
            onAdd={() => updateFieldSilent('other_numbers', [...(formData?.other_numbers || []), { type: '', value: '' }])}
            onSave={handleFieldBlur}
          />
        </div>
      </div>
    </WorkspaceSection>
  );
}

// OtherNumbersField component (moved from main file)
function OtherNumbersField({
  organizationId,
  numbers,
  isEditing,
  onChange,
  onAdd,
  onSave,
}: {
  organizationId: string;
  numbers: OtherNumber[];
  isEditing: boolean;
  onChange: (numbers: OtherNumber[]) => void;
  onAdd: () => void;
  onSave: () => void;
}) {
  const { data: typesData } = useQuery({
    queryKey: ['other-number-types', organizationId],
    queryFn: () => getOtherNumberTypes(organizationId),
    enabled: !!organizationId,
  });

  const types = typesData?.types || [];

  const getTypeName = (code: string) => {
    const found = types.find((t) => t.code === code || t.name === code);
    return found?.name || code;
  };

  if (!isEditing) {
    if (numbers.length === 0) return null;
    return (
      <div>
        <dt className="text-sm font-medium text-archive mb-1">Other Numbers</dt>
        <dd className="text-ink">
          {numbers.map((n, i) => (
            <span key={i} className="inline-flex items-center gap-1 mr-3">
              <span className="text-archive text-sm">{getTypeName(n.type)}:</span> {n.value}
            </span>
          ))}
        </dd>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-ink">Other Numbers</label>
        <button type="button" onClick={onAdd} className="text-sm text-bark hover:text-copper-dark flex items-center gap-1">
          <Plus size={14} />
          Add number
        </button>
      </div>
      <div className="space-y-2">
        {numbers.map((n, i) => (
          <div key={i} className="flex items-center gap-2">
            <select
              value={n.type}
              onChange={(e) => {
                const updated = [...numbers];
                updated[i] = { ...updated[i], type: e.target.value };
                onChange(updated);
              }}
              onBlur={onSave}
              className="input w-48"
            >
              <option value="">Select type...</option>
              {types.map((t) => (
                <option key={t.type_id} value={t.code}>
                  {t.name}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={n.value}
              onChange={(e) => {
                const updated = [...numbers];
                updated[i] = { ...updated[i], value: e.target.value };
                onChange(updated);
              }}
              onBlur={onSave}
              placeholder="Number"
              className="input flex-1"
            />
            <button
              type="button"
              onClick={() => {
                onChange(numbers.filter((_, idx) => idx !== i));
                onSave();
              }}
              className="p-1 text-archive hover:text-semantic-error"
            >
              <X size={16} />
            </button>
          </div>
        ))}
        {numbers.length === 0 && (
          <p className="text-sm text-archive italic">No other numbers added</p>
        )}
      </div>
    </div>
  );
}
