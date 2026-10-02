/**
 * Form Block — Custom form with configurable fields.
 */

import { useState, useCallback } from 'react';
import Checkbox from '../../../../components/Checkbox';
import { Plus, Trash2, ChevronDown, GripVertical, CheckCircle, Loader2 } from 'lucide-react';
import { cn } from '../../../../lib/utils';

// =============================================================================
// Shared Types
// =============================================================================

interface BlockEditorComponentProps {
  content: Record<string, unknown>;
  onChange: (content: Record<string, unknown>) => void;
}

interface BlockRendererComponentProps {
  content: Record<string, unknown>;
}

type FieldType = 'text' | 'email' | 'textarea' | 'select';

interface FormField {
  label: string;
  type: FieldType;
  required: boolean;
}

const FIELD_TYPE_OPTIONS: { value: FieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'email', label: 'Email' },
  { value: 'textarea', label: 'Textarea' },
  { value: 'select', label: 'Select' },
];

// =============================================================================
// Editor
// =============================================================================

export function FormEditor({ content, onChange }: BlockEditorComponentProps) {
  const fields = (content.fields as FormField[]) || [];
  const actionUrl = (content.action_url as string) || '';
  const successMessage = (content.success_message as string) || '';

  const updateField = useCallback(
    (index: number, updates: Partial<FormField>) => {
      const updated = fields.map((field, i) =>
        i === index ? { ...field, ...updates } : field,
      );
      onChange({ ...content, fields: updated });
    },
    [fields, content, onChange],
  );

  const addField = useCallback(() => {
    onChange({
      ...content,
      fields: [...fields, { label: '', type: 'text' as FieldType, required: false }],
    });
  }, [fields, content, onChange]);

  const removeField = useCallback(
    (index: number) => {
      onChange({ ...content, fields: fields.filter((_, i) => i !== index) });
    },
    [fields, content, onChange],
  );

  const moveField = useCallback(
    (index: number, direction: -1 | 1) => {
      const target = index + direction;
      if (target < 0 || target >= fields.length) return;
      const updated = [...fields];
      [updated[index], updated[target]] = [updated[target], updated[index]];
      onChange({ ...content, fields: updated });
    },
    [fields, content, onChange],
  );

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-ink mb-1">
          Form Action URL <span className="text-semantic-error">*</span>
        </label>
        <input
          type="text"
          value={actionUrl}
          onChange={(e) => onChange({ ...content, action_url: e.target.value })}
          placeholder="e.g., /api/forms/contact or https://..."
          className="border border-lichen rounded-lg px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 w-full"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-ink mb-1">
          Success Message
        </label>
        <input
          type="text"
          value={successMessage}
          onChange={(e) => onChange({ ...content, success_message: e.target.value })}
          placeholder="e.g., Thank you! We'll be in touch."
          className="border border-lichen rounded-lg px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 w-full"
        />
      </div>

      {/* Fields */}
      <div>
        <label className="block text-sm font-medium text-ink mb-2">
          Form Fields
        </label>

        {fields.length === 0 && (
          <p className="text-sm text-archive italic">
            No fields yet. Add one below.
          </p>
        )}

        <div className="space-y-3">
          {fields.map((field, index) => (
            <div
              key={index}
              className="border border-lichen rounded-lg p-3 space-y-2 bg-stone"
            >
              <div className="flex items-center gap-2">
                <GripVertical size={14} className="shrink-0 text-archive" />
                <span className="text-xs text-archive font-medium">
                  Field #{index + 1}
                </span>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => moveField(index, -1)}
                  disabled={index === 0}
                  className="p-1 text-archive hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Move up"
                >
                  <ChevronDown size={14} className="rotate-180" />
                </button>
                <button
                  type="button"
                  onClick={() => moveField(index, 1)}
                  disabled={index === fields.length - 1}
                  className="p-1 text-archive hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Move down"
                >
                  <ChevronDown size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => removeField(index)}
                  className="p-1 text-archive hover:text-semantic-error"
                  title="Remove field"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2 items-end">
                <div className="col-span-1">
                  <label className="block text-xs text-archive mb-1">
                    Label
                  </label>
                  <input
                    type="text"
                    value={field.label}
                    onChange={(e) => updateField(index, { label: e.target.value })}
                    placeholder="Field label"
                    className="border border-lichen rounded-lg px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 w-full"
                  />
                </div>

                <div>
                  <label className="block text-xs text-archive mb-1">
                    Type
                  </label>
                  <select
                    value={field.type}
                    onChange={(e) => updateField(index, { type: e.target.value as FieldType })}
                    className="border border-lichen rounded-lg px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 w-full"
                  >
                    {FIELD_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={cn(
                    'flex items-center gap-2 text-sm cursor-pointer px-3 py-2',
                    field.required ? 'text-bark' : 'text-archive',
                  )}>
                    <Checkbox
                      checked={field.required}
                      onChange={(e) => updateField(index, { required: e.target.checked })}
                    />
                    Required
                  </label>
                </div>
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addField}
          className="flex items-center gap-2 px-3 py-2 text-sm text-archive border border-dashed border-lichen rounded-lg hover:border-bark hover:text-bark transition-colors w-full mt-2"
        >
          <Plus size={14} />
          Add Field
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// Renderer
// =============================================================================

export function FormRenderer({ content }: BlockRendererComponentProps) {
  const fields = (content.fields as FormField[]) || [];
  const actionUrl = (content.action_url as string) || '';
  const successMessage = (content.success_message as string) || 'Thank you! Your submission has been received.';

  const [formData, setFormData] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = useCallback((label: string, value: string) => {
    setFormData((prev) => ({ ...prev, [label]: value }));
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!actionUrl) return;

      setSubmitting(true);
      setError(null);

      try {
        const res = await fetch(actionUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        });

        if (!res.ok) {
          throw new Error('Submission failed. Please try again.');
        }

        setSubmitted(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      } finally {
        setSubmitting(false);
      }
    },
    [actionUrl, formData],
  );

  if (fields.length === 0) return null;

  if (submitted) {
    return (
      <div className="rounded-lg border border-semantic-success/30 bg-semantic-success/5 px-8 py-10 text-center">
        <CheckCircle size={32} className="mx-auto text-semantic-success mb-3" />
        <p className="text-base font-medium text-ink">{successMessage}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
      {fields.map((field, index) => {
        const fieldId = `form-field-${index}`;
        const value = formData[field.label] || '';

        return (
          <div key={index}>
            <label htmlFor={fieldId} className="block text-sm font-medium text-ink mb-1">
              {field.label}
              {field.required && <span className="text-semantic-error ml-0.5">*</span>}
            </label>

            {field.type === 'textarea' ? (
              <textarea
                id={fieldId}
                required={field.required}
                value={value}
                onChange={(e) => handleChange(field.label, e.target.value)}
                rows={4}
                className="w-full px-4 py-2.5 rounded-lg text-sm text-ink border border-lichen bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 resize-none"
              />
            ) : (
              <input
                id={fieldId}
                type={field.type === 'email' ? 'email' : 'text'}
                required={field.required}
                value={value}
                onChange={(e) => handleChange(field.label, e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg text-sm text-ink border border-lichen bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              />
            )}
          </div>
        );
      })}

      {error && (
        <p className="text-sm text-semantic-error">{error}</p>
      )}

      <button
        type="submit"
        disabled={submitting || !actionUrl}
        className="px-6 py-2.5 rounded-lg text-sm font-medium bg-bark text-parchment hover:bg-copper-dark transition-colors disabled:opacity-50"
      >
        {submitting ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          'Submit'
        )}
      </button>
    </form>
  );
}
