import { ROLE_OPTIONS, QUALIFIER_SUGGESTIONS, CERTAINTY_OPTIONS } from './constants';

interface LinkDetailsFormProps {
  role: string;
  onRoleChange: (role: string) => void;
  roleQualifier: string;
  onRoleQualifierChange: (value: string) => void;
  certainty: string;
  onCertaintyChange: (value: string) => void;
  displayNameOverride: string;
  onDisplayNameOverrideChange: (value: string) => void;
  notes: string;
  onNotesChange: (value: string) => void;
  /** Unique prefix for datalist IDs to avoid collisions */
  idPrefix?: string;
}

/**
 * Shared form fields for link details, used in both Add and Edit slide-overs.
 */
export function LinkDetailsForm({
  role,
  onRoleChange,
  roleQualifier,
  onRoleQualifierChange,
  certainty,
  onCertaintyChange,
  displayNameOverride,
  onDisplayNameOverrideChange,
  notes,
  onNotesChange,
  idPrefix = '',
}: LinkDetailsFormProps) {
  const datalistId = `${idPrefix}qualifier-suggestions`;

  return (
    <>
      {/* Role */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-ink mb-1.5">
          Role <span className="text-semantic-error">*</span>
        </label>
        <select value={role} onChange={(e) => onRoleChange(e.target.value)} className="input w-full">
          {ROLE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Role Qualifier */}
      {role === 'creator' && (
        <div className="mb-4">
          <label className="block text-sm font-medium text-ink mb-1.5">
            Attribution Qualifier
          </label>
          <input
            type="text"
            value={roleQualifier}
            onChange={(e) => onRoleQualifierChange(e.target.value)}
            list={datalistId}
            placeholder="e.g., attributed to"
            className="input w-full"
          />
          <datalist id={datalistId}>
            {QUALIFIER_SUGGESTIONS.map((q) => (
              <option key={q} value={q} />
            ))}
          </datalist>
        </div>
      )}

      {/* Certainty */}
      {role === 'creator' && (
        <div className="mb-4">
          <label className="block text-sm font-medium text-ink mb-1.5">
            Attribution Certainty
          </label>
          <select value={certainty} onChange={(e) => onCertaintyChange(e.target.value)} className="input w-full">
            {CERTAINTY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      )}

      {/* Display Name Override */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-ink mb-1.5">
          Display Name Override
        </label>
        <input
          type="text"
          value={displayNameOverride}
          onChange={(e) => onDisplayNameOverrideChange(e.target.value)}
          placeholder="Override authority name for this object"
          className="input w-full"
        />
      </div>

      {/* Notes */}
      <div>
        <label className="block text-sm font-medium text-ink mb-1.5">Notes</label>
        <textarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          rows={2}
          className="input w-full"
        />
      </div>
    </>
  );
}
