import { useId, useRef, useCallback } from 'react';
import { Check, Loader2, AlertCircle, Lock } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  RequiredFieldMessage,
} from './RequiredFieldsContext';
import {
  useRequiredField,
} from './requiredFields';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

function joinIds(...ids: Array<string | undefined | false | null>): string | undefined {
  const out = ids.filter(Boolean).join(' ');
  return out || undefined;
}

/**
 * Placeholder shown when a field is restricted by role-based field access.
 * Displays the field label with a lock icon and "Restricted" text so
 * the user knows the field exists but they lack permission to view it.
 *
 * Can be used standalone (for complex layout blocks) or internally
 * by EditableField / EditableSelect / EditableCheckbox via `restricted` prop.
 */
export function RestrictedFieldPlaceholder({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <dl className={className}>
      <dt className="text-sm font-medium text-archive mb-1">{label}</dt>
      <dd className="flex items-center gap-1.5 text-sm text-archive/60 italic">
        <Lock size={12} className="flex-shrink-0" />
        Restricted
      </dd>
    </dl>
  );
}

interface EditableFieldProps {
  /** Current value */
  value: string;
  /** Field label */
  label: string;
  /** Whether we're in edit mode */
  isEditing: boolean;
  /** Called when value changes */
  onChange: (value: string) => void;
  /** Called to persist the value */
  onSave?: () => void;
  /** External save status (from parent's autosave) */
  saveStatus?: SaveStatus;
  /** Error message when saveStatus is 'error' */
  saveError?: string | null;
  /** Placeholder text */
  placeholder?: string;
  /** Help text */
  helpText?: string;
  /** Is required */
  required?: boolean;
  /** Is multiline textarea */
  multiline?: boolean;
  /** Textarea rows */
  rows?: number;
  /** Input type */
  type?: 'text' | 'date' | 'datetime-local' | 'number' | 'email' | 'url';
  /** Render as badge in view mode */
  badge?: boolean;
  /** Additional className */
  className?: string;
  /** Empty state message */
  emptyText?: string;
  /** If true, show label with restricted indicator instead of the field */
  restricted?: boolean;
  /**
   * The record column this field edits. Inside a RequiredFieldsProvider it
   * marks the field required when the organization added it, and invalid
   * when the server reports it missing.
   */
  name?: string;
}

/**
 * A field that renders as text in View mode and input in Edit mode.
 * Designed for seamless mode transitions.
 */
export function EditableField({
  value,
  label,
  isEditing,
  onChange,
  onSave,
  saveStatus = 'idle',
  saveError,
  placeholder,
  helpText,
  required = false,
  multiline = false,
  rows = 3,
  type = 'text',
  badge = false,
  className,
  emptyText = '—',
  restricted = false,
  name,
}: EditableFieldProps) {
  const fieldId = useId();
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const errorId = label ? `editable-field-${label.toLowerCase().replace(/\s+/g, '-')}-error` : undefined;
  const {
    required: showRequired,
    orgRequired,
    error: fieldError,
    register,
    onEdited,
  } = useRequiredField(name, required);
  const setInputRef = useCallback((el: HTMLInputElement | HTMLTextAreaElement | null) => {
    inputRef.current = el;
    register(el);
  }, [register]);
  const invalid = saveStatus === 'error' || !!fieldError;
  const helpId = helpText ? `${fieldId}-help` : undefined;
  const describedBy = joinIds(saveStatus === 'error' && errorId, fieldError?.id, helpId);

  // Handle blur to trigger save
  const handleBlur = useCallback(() => {
    onSave?.();
  }, [onSave]);

  // Restricted field rendering
  if (restricted) {
    return <RestrictedFieldPlaceholder label={label} className={className} />;
  }

  // View mode rendering
  if (!isEditing) {
    if (!value) {
      return (
        <dl className={className}>
          <dt className="text-sm font-medium text-archive mb-1">{label}</dt>
          <dd className="text-archive italic text-sm">{emptyText}</dd>
          {fieldError && <RequiredFieldMessage error={fieldError} as="dd" />}
        </dl>
      );
    }

    return (
      <dl className={className}>
        <dt className="text-sm font-medium text-archive mb-1">{label}</dt>
        <dd className="text-ink">
          {badge ? (
            <span className="badge">{value}</span>
          ) : multiline ? (
            <span className="whitespace-pre-wrap text-sm">{value}</span>
          ) : (
            value
          )}
        </dd>
        {fieldError && <RequiredFieldMessage error={fieldError} as="dd" />}
      </dl>
    );
  }

  // Edit mode rendering
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={fieldId} className="flex items-center justify-between">
        <span className="text-sm font-medium text-ink">
          {label}
          {showRequired && <span className="text-semantic-error ml-0.5">*</span>}
        </span>
        {/* Inline save status */}
        {saveStatus !== 'idle' && (
          <span
            className={cn(
              'flex items-center gap-1 text-xs transition-opacity',
              saveStatus === 'saving' && 'text-archive',
              saveStatus === 'saved' && 'text-semantic-success',
              saveStatus === 'error' && 'text-semantic-error'
            )}
          >
            {saveStatus === 'saving' && <Loader2 size={12} className="animate-spin" />}
            {saveStatus === 'saved' && <Check size={12} className="stroke-[2.5]" />}
            {saveStatus === 'error' && <AlertCircle size={12} />}
            <span
              className="hidden sm:inline"
              title={saveStatus === 'error' && saveError ? saveError : undefined}
              id={saveStatus === 'error' ? errorId : undefined}
              role={saveStatus === 'error' ? 'alert' : undefined}
            >
              {saveStatus === 'saving' && 'Saving'}
              {saveStatus === 'saved' && 'Saved'}
              {saveStatus === 'error' && (saveError ? `Error: ${saveError.slice(0, 40)}` : 'Error')}
            </span>
          </span>
        )}
      </label>

      {multiline ? (
        <textarea
          id={fieldId}
          ref={setInputRef}
          value={value}
          onChange={(e) => { onEdited(); onChange(e.target.value); }}
          onBlur={handleBlur}
          placeholder={placeholder}
          rows={rows}
          required={required}
          aria-required={orgRequired ? true : undefined}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
          className="input w-full"
        />
      ) : (
        <input
          id={fieldId}
          ref={setInputRef}
          type={type}
          value={value}
          onChange={(e) => { onEdited(); onChange(e.target.value); }}
          onBlur={handleBlur}
          placeholder={placeholder}
          required={required}
          aria-required={orgRequired ? true : undefined}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
          className="input w-full"
        />
      )}

      {fieldError && <RequiredFieldMessage error={fieldError} />}
      {helpText && <p id={helpId} className="text-xs text-archive">{helpText}</p>}
    </div>
  );
}

interface EditableSelectProps {
  value: string;
  label: string;
  isEditing: boolean;
  onChange: (value: string) => void;
  onSave?: () => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  required?: boolean;
  /** External save status (from parent's autosave) */
  saveStatus?: SaveStatus;
  /** Error message when saveStatus is 'error' */
  saveError?: string | null;
  badge?: boolean;
  className?: string;
  emptyText?: string;
  /** If true, show label with restricted indicator instead of the field */
  restricted?: boolean;
  /** The record column this select edits (see EditableField `name`). */
  name?: string;
  /** Help text, announced with the select via aria-describedby */
  helpText?: string;
}

/**
 * A select field that renders as text in View mode and dropdown in Edit mode.
 */
export function EditableSelect({
  value,
  label,
  isEditing,
  onChange,
  onSave,
  options,
  placeholder = 'Select...',
  required = false,
  saveStatus = 'idle',
  saveError,
  badge = false,
  className,
  emptyText = '—',
  restricted = false,
  name,
  helpText,
}: EditableSelectProps) {
  const fieldId = useId();
  const errorId = label ? `editable-select-${label.toLowerCase().replace(/\s+/g, '-')}-error` : undefined;
  const {
    required: showRequired,
    orgRequired,
    error: fieldError,
    register,
    onEdited,
  } = useRequiredField(name, required);
  const invalid = saveStatus === 'error' || !!fieldError;
  const helpId = helpText ? `${fieldId}-help` : undefined;
  const describedBy = joinIds(saveStatus === 'error' && errorId, fieldError?.id, helpId);
  const displayValue = options.find((o) => o.value === value)?.label || value;

  // Restricted field rendering
  if (restricted) {
    return <RestrictedFieldPlaceholder label={label} className={className} />;
  }

  // View mode
  if (!isEditing) {
    if (!value) {
      return (
        <dl className={className}>
          <dt className="text-sm font-medium text-archive mb-1">{label}</dt>
          <dd className="text-archive italic text-sm">{emptyText}</dd>
          {fieldError && <RequiredFieldMessage error={fieldError} as="dd" />}
        </dl>
      );
    }

    return (
      <dl className={className}>
        <dt className="text-sm font-medium text-archive mb-1">{label}</dt>
        <dd className="text-ink">
          {badge ? <span className="badge">{displayValue}</span> : displayValue}
        </dd>
        {fieldError && <RequiredFieldMessage error={fieldError} as="dd" />}
      </dl>
    );
  }

  // Edit mode
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={fieldId} className="flex items-center justify-between">
        <span className="text-sm font-medium text-ink">
          {label}
          {showRequired && <span className="text-semantic-error ml-0.5">*</span>}
        </span>
        {/* Inline save status */}
        {saveStatus !== 'idle' && (
          <span
            className={cn(
              'flex items-center gap-1 text-xs transition-opacity',
              saveStatus === 'saving' && 'text-archive',
              saveStatus === 'saved' && 'text-semantic-success',
              saveStatus === 'error' && 'text-semantic-error'
            )}
          >
            {saveStatus === 'saving' && <Loader2 size={12} className="animate-spin" />}
            {saveStatus === 'saved' && <Check size={12} className="stroke-[2.5]" />}
            {saveStatus === 'error' && <AlertCircle size={12} />}
            <span
              className="hidden sm:inline"
              title={saveStatus === 'error' && saveError ? saveError : undefined}
              id={saveStatus === 'error' ? errorId : undefined}
              role={saveStatus === 'error' ? 'alert' : undefined}
            >
              {saveStatus === 'saving' && 'Saving'}
              {saveStatus === 'saved' && 'Saved'}
              {saveStatus === 'error' && (saveError ? `Error: ${saveError.slice(0, 40)}` : 'Error')}
            </span>
          </span>
        )}
      </label>
      <select
        id={fieldId}
        ref={register}
        value={value}
        onChange={(e) => {
          onEdited();
          onChange(e.target.value);
          onSave?.();
        }}
        required={required}
        aria-required={orgRequired ? true : undefined}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        className="input w-full"
      >
        <option value="">{placeholder}</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {fieldError && <RequiredFieldMessage error={fieldError} />}
      {helpText && <p id={helpId} className="text-xs text-archive">{helpText}</p>}
    </div>
  );
}

interface EditableCheckboxProps {
  value: boolean;
  label: string;
  isEditing: boolean;
  onChange: (value: boolean) => void;
  onSave?: () => void;
  description?: string;
  className?: string;
  /** If true, show label with restricted indicator instead of the field */
  restricted?: boolean;
}

/**
 * A checkbox that renders as badge/text in View mode and checkbox in Edit mode.
 */
export function EditableCheckbox({
  value,
  label,
  isEditing,
  onChange,
  onSave,
  description,
  className,
  restricted = false,
}: EditableCheckboxProps) {
  const fieldId = useId();

  // Restricted field rendering
  if (restricted) {
    return <RestrictedFieldPlaceholder label={label} className={className} />;
  }

  // View mode
  if (!isEditing) {
    return (
      <dl className={className}>
        <dt className="text-sm font-medium text-archive mb-1">{label}</dt>
        <dd className="text-ink">
          {value ? (
            <span className="badge bg-semantic-success/10 text-semantic-success">Yes</span>
          ) : (
            <span className="text-archive text-sm">No</span>
          )}
        </dd>
      </dl>
    );
  }

  // Edit mode
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={fieldId} className="flex items-center gap-3 cursor-pointer">
        <input
          id={fieldId}
          type="checkbox"
          checked={value}
          aria-describedby={description ? `${fieldId}-description` : undefined}
          onChange={(e) => {
            onChange(e.target.checked);
            onSave?.();
          }}
          className="form-checkbox w-4 h-4 text-bark border-lichen rounded focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
        />
        <span className="text-sm font-medium text-ink">{label}</span>
      </label>
      {description && <p id={`${fieldId}-description`} className="text-xs text-archive ml-7">{description}</p>}
    </div>
  );
}
