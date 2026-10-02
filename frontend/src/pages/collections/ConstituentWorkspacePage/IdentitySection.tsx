import { useState } from 'react';
import { User, Plus, X } from 'lucide-react';
import {
  WorkspaceSection,
  EditableField,
  EditableSelect,
} from '../../../components/workspace';
import { cn } from '../../../lib/utils';
import { useLookupValues } from '../../../hooks/useLookupValues';
import type { BaseSectionProps } from './types';
import { CONSTITUENT_TYPE_OPTIONS } from './types';

export function IdentitySection({
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
}: BaseSectionProps) {
  const { getLookup } = useLookupValues({ context: 'authorities' });
  const [variantNameInput, setVariantNameInput] = useState('');

  const handleAddVariantName = () => {
    const trimmed = variantNameInput.trim();
    if (trimmed && !formData.variant_names.includes(trimmed)) {
      updateField('variant_names', [...formData.variant_names, trimmed]);
      setVariantNameInput('');
    }
  };

  const handleRemoveVariantName = (name: string) => {
    updateField(
      'variant_names',
      formData.variant_names.filter((n) => n !== name),
    );
  };

  const handleToggleLifeRole = (role: string) => {
    const current = formData.life_roles;
    if (current.includes(role)) {
      updateField('life_roles', current.filter((r) => r !== role));
    } else {
      updateField('life_roles', [...current, role]);
    }
  };

  return (
    <WorkspaceSection
      id="identity"
      title="Identity"
      icon={<User size={18} />}
      isExpanded={expandedSections.identity}
      onToggle={() => toggleSection('identity')}
      isEditing={isEditing}
      sectionRef={(el) => { sectionRefs.current['identity'] = el; }}
      order={getSectionOrder('identity')}
      isEmpty={isEmpty}
      sectionHint={sectionSummaries?.identity}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <EditableSelect
          label="Type"
          value={formData.constituent_type}
          options={CONSTITUENT_TYPE_OPTIONS}
          onChange={(v) => updateField('constituent_type', v)}
          onSave={handleFieldBlur}
          isEditing={isEditing}
        />
        <EditableField
          label="Name"
          value={formData.name}
          onChange={(v) => updateField('name', v)}
          onSave={handleFieldBlur}
          isEditing={isEditing}
          required
          placeholder="Full name or organization name"
        />
        <EditableField
          label="Display Name"
          value={formData.display_name}
          onChange={(v) => updateField('display_name', v)}
          onSave={handleFieldBlur}
          isEditing={isEditing}
          placeholder="Name as displayed publicly"
        />
        <EditableField
          label="Sort Name"
          value={formData.sort_name}
          onChange={(v) => updateField('sort_name', v)}
          onSave={handleFieldBlur}
          isEditing={isEditing}
          placeholder="e.g., Rijn, Rembrandt van"
        />
        <EditableField
          label="Given Name"
          value={formData.given_name}
          onChange={(v) => updateField('given_name', v)}
          onSave={handleFieldBlur}
          isEditing={isEditing}
          placeholder="First / given name"
        />
        <EditableField
          label="Family Name"
          value={formData.family_name}
          onChange={(v) => updateField('family_name', v)}
          onSave={handleFieldBlur}
          isEditing={isEditing}
          placeholder="Last / family name"
        />
        <EditableField
          label="Name Prefix"
          value={formData.name_prefix}
          onChange={(v) => updateField('name_prefix', v)}
          onSave={handleFieldBlur}
          isEditing={isEditing}
          placeholder="e.g., Sir, Dr., Prof."
        />
        <EditableField
          label="Name Suffix"
          value={formData.name_suffix}
          onChange={(v) => updateField('name_suffix', v)}
          onSave={handleFieldBlur}
          isEditing={isEditing}
          placeholder="e.g., Jr., III, Esq."
        />

        {/* Variant Names */}
        {isEditing ? (
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-ink mb-1.5">
              Variant Names
            </label>
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={variantNameInput}
                onChange={(e) => setVariantNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddVariantName();
                  }
                }}
                className="flex-1 px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                placeholder="Add variant name..."
              />
              <button
                type="button"
                onClick={handleAddVariantName}
                className="px-3 py-2 border border-lichen rounded-lg text-ink hover:bg-stone transition-colors"
              >
                <Plus size={16} />
              </button>
            </div>
            {formData.variant_names.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {formData.variant_names.map((name, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-stone text-ink text-sm rounded-full"
                  >
                    {name}
                    <button
                      type="button"
                      onClick={() => handleRemoveVariantName(name)}
                      className="text-archive hover:text-ink"
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : formData.variant_names.length > 0 ? (
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-archive mb-1.5">
              Variant Names
            </label>
            <div className="flex flex-wrap gap-2">
              {formData.variant_names.map((name, i) => (
                <span
                  key={i}
                  className="px-2 py-0.5 text-xs bg-stone rounded-full text-ink"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <EditableField
          label="Nationality"
          value={formData.nationality}
          onChange={(v) => updateField('nationality', v)}
          onSave={handleFieldBlur}
          isEditing={isEditing}
          placeholder="e.g., Dutch"
        />
        <EditableField
          label="Culture"
          value={formData.culture}
          onChange={(v) => updateField('culture', v)}
          onSave={handleFieldBlur}
          isEditing={isEditing}
          placeholder="e.g., Dutch Golden Age"
        />
        <EditableSelect
          label="Gender"
          value={formData.gender}
          isEditing={isEditing}
          onChange={(v) => updateField('gender', v)}
          onSave={handleFieldBlur}
          options={getLookup('gender')}
        />

        {/* Life Roles - toggleable chips */}
        {isEditing ? (
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-ink mb-1.5">
              Life Roles
            </label>
            <div className="flex flex-wrap gap-2">
              {getLookup('life_role').map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleToggleLifeRole(option.value)}
                  className={cn(
                    'px-2 py-1 text-sm rounded-full cursor-pointer transition-colors',
                    formData.life_roles.includes(option.value)
                      ? 'bg-bark text-parchment'
                      : 'bg-stone text-ink hover:bg-stone/70',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        ) : formData.life_roles.length > 0 ? (
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-archive mb-1.5">
              Life Roles
            </label>
            <div className="flex flex-wrap gap-2">
              {formData.life_roles.map((role, i) => (
                <span
                  key={i}
                  className="px-2 py-0.5 text-xs bg-semantic-info/10 text-semantic-info rounded-full"
                >
                  {role}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </WorkspaceSection>
  );
}
