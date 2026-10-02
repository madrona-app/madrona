import { useState, useEffect, useCallback, useRef } from 'react';
import { Check, AlertCircle, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface AutosaveFieldProps {
  /** Current value */
  value: string;
  /** Called when value changes (local state update) */
  onChange: (value: string) => void;
  /** Called to persist the value (API call) */
  onSave: (value: string) => Promise<void>;
  /** Field label */
  label?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Help text below the field */
  helpText?: string;
  /** Required field indicator */
  required?: boolean;
  /** Multiline textarea */
  multiline?: boolean;
  /** Number of rows for textarea */
  rows?: number;
  /** Input type for single-line inputs */
  type?: 'text' | 'date' | 'number' | 'email' | 'url';
  /** Disable the field */
  disabled?: boolean;
  /** Additional className */
  className?: string;
  /** Debounce delay in ms before autosave (default: 800) */
  debounceMs?: number;
}

/**
 * A field that auto-saves on blur or after typing pause.
 * Shows inline save status with subtle feedback.
 */
export function AutosaveField({
  value,
  onChange,
  onSave,
  label,
  placeholder,
  helpText,
  required = false,
  multiline = false,
  rows = 3,
  type = 'text',
  disabled = false,
  className,
  debounceMs = 800,
}: AutosaveFieldProps) {
  const [localValue, setLocalValue] = useState(value);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const originalValueRef = useRef(value);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  // Track if component is mounted
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Sync local value when prop changes externally
  useEffect(() => {
    setLocalValue(value);
    originalValueRef.current = value;
  }, [value]);

  // Clear saved status after delay
  useEffect(() => {
    if (status === 'saved') {
      const timer = setTimeout(() => {
        if (isMountedRef.current) {
          setStatus('idle');
        }
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  const performSave = useCallback(async (valueToSave: string) => {
    // Only save if value actually changed
    if (valueToSave === originalValueRef.current) {
      return;
    }

    setStatus('saving');
    setErrorMessage(null);

    try {
      await onSave(valueToSave);
      if (isMountedRef.current) {
        originalValueRef.current = valueToSave;
        setStatus('saved');
      }
    } catch (err) {
      if (isMountedRef.current) {
        setStatus('error');
        setErrorMessage(err instanceof Error ? err.message : 'Failed to save');
      }
    }
  }, [onSave]);

  const handleChange = useCallback((newValue: string) => {
    setLocalValue(newValue);
    onChange(newValue);

    // Clear any pending debounce
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Set up debounced save
    debounceTimerRef.current = setTimeout(() => {
      performSave(newValue);
    }, debounceMs);
  }, [onChange, performSave, debounceMs]);

  const handleBlur = useCallback(() => {
    // Clear debounce and save immediately on blur
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    performSave(localValue);
  }, [localValue, performSave]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const inputClasses = cn(
    'input w-full transition-colors',
    status === 'error' && 'border-semantic-error focus-visible:ring-semantic-error/30',
    status === 'saved' && 'border-semantic-success/50',
    className
  );

  const renderStatusIndicator = () => {
    if (status === 'idle') return null;

    return (
      <span
        className={cn(
          'absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-xs transition-opacity duration-200',
          status === 'saving' && 'text-archive',
          status === 'saved' && 'text-semantic-success',
          status === 'error' && 'text-semantic-error'
        )}
      >
        {status === 'saving' && (
          <>
            <Loader2 size={12} className="animate-spin" />
            <span className="hidden sm:inline">Saving</span>
          </>
        )}
        {status === 'saved' && (
          <>
            <Check size={12} className="stroke-[2.5]" />
            <span className="hidden sm:inline">Saved</span>
          </>
        )}
        {status === 'error' && (
          <>
            <AlertCircle size={12} />
            <span className="hidden sm:inline">Error</span>
          </>
        )}
      </span>
    );
  };

  return (
    <div className="space-y-1.5">
      {label && (
        <label className="block text-sm font-medium text-ink">
          {label}
          {required && <span className="text-semantic-error ml-0.5">*</span>}
        </label>
      )}

      <div className="relative">
        {multiline ? (
          <textarea
            value={localValue}
            onChange={(e) => handleChange(e.target.value)}
            onBlur={handleBlur}
            placeholder={placeholder}
            rows={rows}
            disabled={disabled}
            className={cn(inputClasses, 'pr-16')}
          />
        ) : (
          <input
            type={type}
            value={localValue}
            onChange={(e) => handleChange(e.target.value)}
            onBlur={handleBlur}
            placeholder={placeholder}
            disabled={disabled}
            className={cn(inputClasses, 'pr-16')}
          />
        )}

        {!multiline && renderStatusIndicator()}
      </div>

      {/* Help text or error message */}
      {(helpText || errorMessage) && (
        <p className={cn(
          'text-xs',
          errorMessage ? 'text-semantic-error' : 'text-archive'
        )}>
          {errorMessage || helpText}
        </p>
      )}
    </div>
  );
}

/**
 * Hook for managing autosave state at the page level.
 * Tracks all pending saves and provides unified status.
 */
export function useAutosaveManager() {
  const [pendingSaves, setPendingSaves] = useState<Set<string>>(new Set());
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const registerPendingSave = useCallback((fieldId: string) => {
    setPendingSaves((prev) => new Set(prev).add(fieldId));
    setHasUnsavedChanges(true);
  }, []);

  const completeSave = useCallback((fieldId: string) => {
    setPendingSaves((prev) => {
      const next = new Set(prev);
      next.delete(fieldId);
      return next;
    });
    setLastSaved(new Date());
    setHasUnsavedChanges(false);
  }, []);

  const isSaving = pendingSaves.size > 0;

  return {
    isSaving,
    lastSaved,
    hasUnsavedChanges,
    registerPendingSave,
    completeSave,
  };
}
