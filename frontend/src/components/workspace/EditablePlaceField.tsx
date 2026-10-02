/**
 * EditablePlaceField Component
 *
 * An editable field for places that integrates with Getty TGN via AuthorityAutocomplete.
 * Handles the conversion between the flat backend format (place + tgn_id) and the
 * AuthorityBackedValue format used by the autocomplete component.
 */

import { useState, useId } from 'react';
import { MapPin, ExternalLink, X } from 'lucide-react';
import { AuthorityAutocomplete } from '../collections/AuthorityAutocomplete';
import type { AuthorityBackedValue } from '../collections/AuthorityAutocomplete';
import { cn } from '../../lib/utils';

interface EditablePlaceFieldProps {
  /** Field label */
  label: string;
  /** Place name value */
  value: string;
  /** Optional TGN ID for the place */
  tgnId?: string | null;
  /** Whether the field is in edit mode */
  isEditing: boolean;
  /** Callback when the place value changes */
  onChange: (value: string, tgnId: string | null) => void;
  /** Optional callback when field loses focus (for autosave) */
  onSave?: () => void;
  /** Placeholder text */
  placeholder?: string;
  /** Additional CSS class */
  className?: string;
}

/**
 * Extract flat values from AuthorityBackedValue
 */
function fromAuthorityValue(authorityValue: AuthorityBackedValue | null): { value: string; tgnId: string | null } {
  if (!authorityValue) {
    return { value: '', tgnId: null };
  }

  let tgnId: string | null = null;

  // Look for TGN authority
  const tgnAuthority = authorityValue.authorities?.find(a => a.source === 'TGN');
  if (tgnAuthority?.uri) {
    // Extract ID from URI like "http://vocab.getty.edu/tgn/7008038"
    const match = tgnAuthority.uri.match(/\/tgn\/(\d+)/);
    if (match) {
      tgnId = match[1];
    }
  }

  return {
    value: authorityValue.value,
    tgnId,
  };
}

export function EditablePlaceField({
  label,
  value,
  tgnId,
  isEditing,
  onChange,
  onSave,
  placeholder = 'Search for a place...',
  className,
}: EditablePlaceFieldProps) {
  const fieldId = useId();
  // In edit mode, track if user is searching for a replacement
  const [isSearching, setIsSearching] = useState(false);

  // Handle change from autocomplete
  const handleChange = (newValue: AuthorityBackedValue | null) => {
    const { value: newPlaceValue, tgnId: newTgnId } = fromAuthorityValue(newValue);
    onChange(newPlaceValue, newTgnId);
    setIsSearching(false);
    onSave?.();
  };

  // Clear the current value
  const handleClear = () => {
    onChange('', null);
    setIsSearching(true);
    onSave?.();
  };

  // View mode
  if (!isEditing) {
    if (!value) {
      return (
        <div className={className}>
          <label htmlFor={fieldId} className="block text-sm font-medium text-archive mb-1">{label}</label>
          <p id={fieldId} className="text-archive italic">Not specified</p>
        </div>
      );
    }

    return (
      <div className={className}>
        <label htmlFor={fieldId} className="block text-sm font-medium text-archive mb-1">{label}</label>
        <div id={fieldId} className="flex items-center gap-2">
          <MapPin size={14} className="text-archive flex-shrink-0" />
          <span className="text-ink">{value}</span>
          {tgnId && (
            <a
              href={`http://vocab.getty.edu/tgn/${tgnId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-archive hover:text-bark bg-stone px-1.5 py-0.5 rounded"
              title="View in Getty TGN"
            >
              Getty TGN
              <ExternalLink size={10} />
            </a>
          )}
        </div>
      </div>
    );
  }

  // Edit mode - show current value with option to change, or show search
  return (
    <div className={cn('space-y-1', className)}>
      <label htmlFor={fieldId} className="block text-sm font-medium text-ink">{label}</label>

      {/* If we have a value and not actively searching, show the current value */}
      {value && !isSearching ? (
        <div className="flex items-center gap-2 p-2 border border-lichen rounded-lg bg-parchment">
          <MapPin size={14} className="text-archive flex-shrink-0" />
          <span className="flex-1 text-ink">{value}</span>
          {tgnId && (
            <span className="text-xs text-semantic-success bg-semantic-success/10 px-1.5 py-0.5 rounded">
              TGN Linked
            </span>
          )}
          <button
            type="button"
            onClick={() => setIsSearching(true)}
            className="text-xs text-bark hover:text-copper-dark"
          >
            Change
          </button>
          <button
            type="button"
            onClick={handleClear}
            className="text-archive hover:text-semantic-error p-0.5"
            title="Clear"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        /* Show search interface */
        <div className="space-y-2">
          <AuthorityAutocomplete
            fieldType="place"
            value={null}
            onChange={handleChange}
            placeholder={placeholder}
            showVerifiedBadge={false}
          />
          {value && isSearching && (
            <button
              type="button"
              onClick={() => setIsSearching(false)}
              className="text-xs text-archive hover:text-ink"
            >
              Cancel (keep "{value}")
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default EditablePlaceField;
