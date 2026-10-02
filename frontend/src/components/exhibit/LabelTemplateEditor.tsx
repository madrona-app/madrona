import { useState } from 'react';
import Checkbox from '../Checkbox';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, GripVertical, Loader2 } from 'lucide-react';
import { createLabelTemplate, updateLabelTemplate, type LabelTemplate } from '../../lib/api';
import SlideOver from '../ui/SlideOver';

interface LabelTemplateEditorProps {
  isOpen: boolean;
  organizationId: string;
  template?: LabelTemplate | null;
  onClose: () => void;
  onSuccess: () => void;
}

const LABEL_TYPES = [
  { value: 'tombstone', label: 'Tombstone', description: 'Standard artwork identification label' },
  { value: 'extended', label: 'Extended', description: 'Extended label with interpretation' },
  { value: 'wall', label: 'Wall Text', description: 'Large wall text or panel' },
  { value: 'didactic', label: 'Didactic', description: 'Educational or interpretive text' },
];

const FIELD_SOURCES = [
  { value: 'object.creator', label: 'Artist/Creator' },
  { value: 'object.title', label: 'Title' },
  { value: 'object.date_created', label: 'Date' },
  { value: 'object.medium', label: 'Medium' },
  { value: 'object.dimensions', label: 'Dimensions' },
  { value: 'object.credit_line', label: 'Credit Line' },
  { value: 'object.object_number', label: 'Object Number' },
  { value: 'object.description', label: 'Description' },
  { value: 'exhibition_object.credit_line_override', label: 'Credit Override' },
  { value: 'exhibition_object.section', label: 'Section' },
];

const FIELD_FORMATS = [
  { value: '', label: 'Normal' },
  { value: 'uppercase', label: 'UPPERCASE' },
  { value: 'italic', label: 'Italic' },
  { value: 'bold', label: 'Bold' },
];

interface TemplateField {
  name: string;
  source: string;
  format?: string;
}

export function LabelTemplateEditor({
  isOpen,
  organizationId,
  template,
  onClose,
  onSuccess,
}: LabelTemplateEditorProps) {
  const queryClient = useQueryClient();
  const isEditMode = !!template;

  // Form state
  const [name, setName] = useState(template?.name || '');
  const [labelType, setLabelType] = useState<LabelTemplate['label_type']>(
    template?.label_type || 'tombstone'
  );
  const [fields, setFields] = useState<TemplateField[]>(
    template?.template_fields?.fields || [
      { name: 'artist', source: 'object.creator', format: 'uppercase' },
      { name: 'title', source: 'object.title', format: 'italic' },
      { name: 'date', source: 'object.date_created' },
      { name: 'medium', source: 'object.medium' },
    ]
  );
  const [fontFamily, setFontFamily] = useState(template?.font_family || 'Arial');
  const [fontSize, setFontSize] = useState(template?.font_size_pt || 12);
  const [widthCm, setWidthCm] = useState(template?.width_cm || '');
  const [heightCm, setHeightCm] = useState(template?.height_cm || '');
  const [isDefault, setIsDefault] = useState(template?.is_default || false);
  const [error, setError] = useState<string | null>(null);

  // Mutations
  const createMutation = useMutation({
    mutationFn: () =>
      createLabelTemplate(organizationId, {
        name,
        label_type: labelType,
        template_fields: { fields, layout: 'vertical' },
        font_family: fontFamily,
        font_size_pt: fontSize,
        width_cm: widthCm ? Number(widthCm) : undefined,
        height_cm: heightCm ? Number(heightCm) : undefined,
        is_default: isDefault,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['label-templates', organizationId] });
      onSuccess();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      updateLabelTemplate(organizationId, template!.template_id, {
        name,
        label_type: labelType,
        template_fields: { fields, layout: 'vertical' },
        font_family: fontFamily,
        font_size_pt: fontSize,
        width_cm: widthCm ? Number(widthCm) : undefined,
        height_cm: heightCm ? Number(heightCm) : undefined,
        is_default: isDefault,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['label-templates', organizationId] });
      onSuccess();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const addField = () => {
    setFields([...fields, { name: '', source: 'object.title' }]);
  };

  const removeField = (index: number) => {
    setFields(fields.filter((_, i) => i !== index));
  };

  const updateField = (index: number, updates: Partial<TemplateField>) => {
    setFields(
      fields.map((field, i) => (i === index ? { ...field, ...updates } : field))
    );
  };

  const handleSubmit = () => {
    setError(null);
    if (!name.trim()) {
      setError('Template name is required');
      return;
    }
    if (fields.length === 0) {
      setError('At least one field is required');
      return;
    }

    if (isEditMode) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <SlideOver
      isOpen={isOpen}
      onClose={onClose}
      title={isEditMode ? 'Edit Label Template' : 'Create Label Template'}
      subtitle="Define the fields and formatting for exhibition labels"
      width="lg"
      footer={
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-lichen rounded-lg hover:bg-stone/50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isPending}
            className="px-4 py-2 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark hover:text-parchment disabled:opacity-50 flex items-center gap-2"
          >
            {isPending ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Saving...
              </>
            ) : isEditMode ? (
              'Save Changes'
            ) : (
              'Create Template'
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        {error && (
          <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-sm text-semantic-error">
            {error}
          </div>
        )}

        {/* Basic info */}
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-ink mb-1.5">
              Template Name <span className="text-semantic-error">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Standard Tombstone"
              className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">
              Label Type
            </label>
            <select
              value={labelType}
              onChange={(e) => setLabelType(e.target.value as LabelTemplate['label_type'])}
              className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            >
              {LABEL_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center">
            <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
              <Checkbox
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
              />
              Set as default template
            </label>
          </div>
        </div>

        {/* Typography */}
        <div>
          <h4 className="text-sm font-medium text-ink mb-3">Typography</h4>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-archive mb-1">Font Family</label>
              <select
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value)}
                className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
              >
                <option value="Arial">Arial</option>
                <option value="Helvetica">Helvetica</option>
                <option value="Times New Roman">Times New Roman</option>
                <option value="Georgia">Georgia</option>
                <option value="Verdana">Verdana</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-archive mb-1">Font Size (pt)</label>
              <input
                type="number"
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
                min={8}
                max={72}
                className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-archive mb-1">Width (cm)</label>
                <input
                  type="number"
                  value={widthCm}
                  onChange={(e) => setWidthCm(e.target.value)}
                  step="0.5"
                  min={0}
                  placeholder="-"
                  className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                />
              </div>
              <div>
                <label className="block text-xs text-archive mb-1">Height (cm)</label>
                <input
                  type="number"
                  value={heightCm}
                  onChange={(e) => setHeightCm(e.target.value)}
                  step="0.5"
                  min={0}
                  placeholder="-"
                  className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Fields */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium text-ink">Label Fields</h4>
            <button
              onClick={addField}
              className="flex items-center gap-1 text-sm text-bark hover:text-copper-dark"
            >
              <Plus size={14} />
              Add Field
            </button>
          </div>

          <div className="space-y-2">
            {fields.map((field, index) => (
              <div
                key={index}
                className="flex items-center gap-2 p-3 bg-stone/30 rounded-lg"
              >
                <GripVertical size={14} className="text-archive cursor-move" />

                <input
                  type="text"
                  value={field.name}
                  onChange={(e) => updateField(index, { name: e.target.value })}
                  placeholder="Field name"
                  className="w-24 px-2 py-1.5 border border-lichen rounded text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                />

                <select
                  value={field.source}
                  onChange={(e) => updateField(index, { source: e.target.value })}
                  className="flex-1 px-2 py-1.5 border border-lichen rounded text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                >
                  {FIELD_SOURCES.map((source) => (
                    <option key={source.value} value={source.value}>
                      {source.label}
                    </option>
                  ))}
                </select>

                <select
                  value={field.format || ''}
                  onChange={(e) =>
                    updateField(index, { format: e.target.value || undefined })
                  }
                  className="w-28 px-2 py-1.5 border border-lichen rounded text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                >
                  {FIELD_FORMATS.map((format) => (
                    <option key={format.value} value={format.value}>
                      {format.label}
                    </option>
                  ))}
                </select>

                <button
                  onClick={() => removeField(index)}
                  className="p-1.5 text-semantic-error hover:text-semantic-error/80"
                  title="Remove field"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}

            {fields.length === 0 && (
              <div className="text-center py-6 text-archive text-sm border border-dashed border-lichen rounded-lg">
                No fields defined. Click "Add Field" to start building your label.
              </div>
            )}
          </div>
        </div>

        {/* Preview */}
        <div>
          <h4 className="text-sm font-medium text-ink mb-3">Preview</h4>
          <div
            className="p-4 border border-lichen rounded-lg bg-parchment"
            style={{ fontFamily, fontSize: `${fontSize}px` }}
          >
            {fields.map((field, index) => {
              let text = `[${field.name || FIELD_SOURCES.find(s => s.value === field.source)?.label || field.source}]`;
              let className = '';

              if (field.format === 'uppercase') {
                text = text.toUpperCase();
              }
              if (field.format === 'italic') {
                className = 'italic';
              }
              if (field.format === 'bold') {
                className = 'font-bold';
              }

              return (
                <div key={index} className={className}>
                  {text}
                </div>
              );
            })}
            {fields.length === 0 && (
              <div className="text-archive italic">Label preview will appear here</div>
            )}
          </div>
        </div>
      </div>
    </SlideOver>
  );
}

export default LabelTemplateEditor;
