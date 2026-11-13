import { useId, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getLocationOptions } from '../../../lib/api';
import type { LocationOption } from '../../../lib/api';

interface LocationSelectProps {
  orgId: string;
  /** Visible label for the select */
  label: string;
  value: string;
  onChange: (locationId: string, location: LocationOption | undefined) => void;
  required?: boolean;
  /** Id of an element describing an error, linked with aria-describedby */
  errorId?: string;
  invalid?: boolean;
}

/**
 * Native location chooser: a filter box that narrows a labelled <select>.
 * Two native controls instead of a custom combobox, so screen readers use
 * their own well-known patterns.
 */
export function LocationSelect({ orgId, label, value, onChange, required, errorId, invalid }: LocationSelectProps) {
  const baseId = useId();
  const filterId = `${baseId}-filter`;
  const selectId = `${baseId}-select`;
  const hintId = `${baseId}-hint`;
  const [filter, setFilter] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(filter.trim()), 300);
    return () => clearTimeout(t);
  }, [filter]);

  const { data, isLoading } = useQuery({
    queryKey: ['location-options', orgId, debounced],
    queryFn: () => getLocationOptions(orgId, debounced || undefined),
    enabled: !!orgId,
  });
  const options = data?.items ?? [];

  const describedBy = [hintId, invalid && errorId ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className="flex flex-col gap-2">
      <div>
        <label htmlFor={filterId} className="block text-sm font-medium text-ink mb-1">
          Filter locations
        </label>
        <input
          id={filterId}
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="input w-full min-h-[44px]"
          autoComplete="off"
        />
      </div>
      <div>
        <label htmlFor={selectId} className="block text-sm font-medium text-ink mb-1">
          {label}
          {required && <span aria-hidden="true"> *</span>}
        </label>
        <select
          id={selectId}
          value={value}
          required={required}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value, options.find(o => o.location_id === e.target.value))}
          className="w-full min-h-[44px] px-3 py-2 border border-lichen rounded-lg bg-parchment text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
        >
          <option value="">{isLoading ? 'Loading locations…' : 'Choose a location'}</option>
          {options.map((loc) => (
            <option key={loc.location_id} value={loc.location_id}>
              {loc.path && loc.path !== loc.name ? `${loc.name} (${loc.path})` : loc.name}
            </option>
          ))}
        </select>
        <p id={hintId} className="text-xs text-accessible-gray mt-1">
          {isLoading
            ? 'Loading locations.'
            : `${options.length} location${options.length === 1 ? '' : 's'} listed${debounced ? ` matching “${debounced}”` : ''}.`}
        </p>
      </div>
    </div>
  );
}
