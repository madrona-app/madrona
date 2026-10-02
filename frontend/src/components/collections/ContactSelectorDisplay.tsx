/**
 * ContactSelectorDisplay
 *
 * Reusable component that renders a contact field with view and edit modes.
 * Replaces ~30 lines of duplicated contact display/edit JSX that appears
 * across 11+ workspace pages.
 */

import { useQuery } from '@tanstack/react-query';
import { User, Search, X } from 'lucide-react';
import { MadronaLoader } from '../ui/MadronaLoader';
import { getContact } from '../../lib/api';

interface ContactSelectorDisplayProps {
  /** Organization ID for API calls */
  orgId: string;
  /** The selected contact ID (or undefined/empty for no selection) */
  contactId: string | undefined;
  /** Label for the field, e.g., "Primary contact", "Borrower" */
  label: string;
  /** Whether the field is in edit mode */
  isEditing: boolean;
  /** Called when user clicks to open the contact selector */
  onSelect: () => void;
  /** Called when user clicks the X to clear the selection */
  onClear: () => void;
  /** Placeholder text for empty state (default: "Search or create...") */
  placeholder?: string;
  /** Whether to show the contact's organization (default: true) */
  showOrganization?: boolean;
  /** Whether the field is required (shows red asterisk) */
  required?: boolean;
  /** Fallback display name when contact data hasn't loaded yet */
  fallbackName?: string;
}

export function ContactSelectorDisplay({
  orgId,
  contactId,
  label,
  isEditing,
  onSelect,
  onClear,
  placeholder = 'Search or create...',
  showOrganization = true,
  required = false,
  fallbackName,
}: ContactSelectorDisplayProps) {
  const hasContact = !!contactId;

  const { data: contact, isLoading } = useQuery({
    queryKey: ['contact', orgId, contactId],
    queryFn: () => getContact(orgId, contactId!),
    enabled: !!orgId && hasContact,
  });

  const contactName = contact?.name ?? fallbackName;
  const organizationName = showOrganization ? contact?.organization_name : null;

  return (
    <div>
      <label className="block text-sm font-medium text-ink mb-1.5">
        {label}
        {required && <span className="text-semantic-error"> *</span>}
      </label>

      {isEditing ? (
        <div className="flex items-center gap-2">
          {hasContact ? (
            <>
              <div className="flex-1 flex items-center gap-2 px-3 py-2 border border-lichen rounded-lg bg-parchment">
                {isLoading ? (
                  <MadronaLoader variant="dots" />
                ) : (
                  <>
                    <User size={16} className="text-archive flex-shrink-0" />
                    <span className="text-sm text-ink">{contactName}</span>
                    {organizationName && (
                      <span className="text-xs text-archive">({organizationName})</span>
                    )}
                  </>
                )}
                <button
                  type="button"
                  onClick={onClear}
                  className="ml-auto p-1 text-archive hover:text-semantic-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 rounded"
                  aria-label={`Clear ${label}`}
                >
                  <X size={14} />
                </button>
              </div>
              <button
                type="button"
                onClick={onSelect}
                className="px-3 py-2 text-sm text-bark hover:text-copper-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 rounded"
              >
                Change
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onSelect}
              className="flex-1 flex items-center gap-2 px-3 py-2 border border-dashed border-lichen rounded-lg text-sm text-archive hover:border-bark hover:text-bark hover:bg-bark/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            >
              <Search size={16} />
              {placeholder}
            </button>
          )}
        </div>
      ) : (
        <div className="text-sm text-ink">
          {hasContact ? (
            isLoading ? (
              <MadronaLoader variant="dots" />
            ) : (
              <span>
                {contactName}
                {organizationName && (
                  <span className="text-archive ml-1">({organizationName})</span>
                )}
              </span>
            )
          ) : fallbackName ? (
            <span>{fallbackName}</span>
          ) : (
            <span className="text-archive">Not specified</span>
          )}
        </div>
      )}
    </div>
  );
}
