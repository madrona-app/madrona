/**
 * ContactLinkField
 *
 * A single linked contact (person or organisation) with select / remove
 * controls, using the shared ContactSelectorSlideOver picker. Stores the
 * constituent id only.
 *
 * Accessibility: the field is a labelled group; the remove button names the
 * field and the linked contact; selecting or removing is announced through a
 * role="status" region, and focus moves to the control that replaces the one
 * the user just used (remove after selecting, select after removing or
 * cancelling the picker).
 */

import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { getContact } from '../../lib/api';
import { ContactSelectorSlideOver } from './ConstituentSelectorSlideOver';

interface ContactLinkFieldProps {
  organizationId: string;
  /** Linked contact id, or '' when none. */
  contactId: string;
  onChange: (contactId: string) => void;
  /** Field label, e.g. "Agent for rights holder". */
  label: string;
  /** Show select/remove controls. Defaults to true. */
  isEditing?: boolean;
  /** Shown when nothing is linked and the field is read-only. */
  emptyText?: string;
  /** Optional help text, associated with the group. */
  hint?: string;
  /** Name to show before the contact record loads (e.g. from the list API). */
  fallbackName?: string | null;
  selectorTitle?: string;
  selectorSubtitle?: string;
  constituentTypes?: string[];
  /** Stacking class for the picker when the host is itself a high-z dialog. */
  pickerLayerClassName?: string;
}

export function ContactLinkField({
  organizationId,
  contactId,
  onChange,
  label,
  isEditing = true,
  emptyText = 'None assigned',
  hint,
  fallbackName,
  selectorTitle,
  selectorSubtitle = 'Search for an existing contact or create a new one',
  constituentTypes = ['person', 'organization', 'estate'],
  pickerLayerClassName,
}: ContactLinkFieldProps) {
  const uid = useId();
  const labelId = `${uid}-label`;
  const hintId = `${uid}-hint`;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const selectRef = useRef<HTMLButtonElement>(null);
  const removeRef = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<'select' | 'remove' | null>(null);
  const lowerLabel = label.charAt(0).toLowerCase() + label.slice(1);

  const { data: contact } = useQuery({
    queryKey: ['contact', organizationId, contactId],
    queryFn: () => getContact(organizationId, contactId),
    enabled: !!organizationId && !!contactId,
  });
  const contactName = contact?.name ?? fallbackName ?? 'Loading contact';

  // Move focus once the control that replaces the one just used has rendered.
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target || pickerOpen) return;
    const el = target === 'remove' ? removeRef.current : selectRef.current;
    if (el) {
      el.focus();
      pendingFocus.current = null;
    }
  }, [contactId, pickerOpen]);

  const setOpen = (open: boolean) => setPickerOpen(open);

  // While the picker is open, Escape closes the picker only - not a dialog or
  // panel this field sits in. Capture phase on window runs before the
  // document-level Escape handlers those hosts register.
  useEffect(() => {
    if (!pickerOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!pendingFocus.current) pendingFocus.current = contactId ? 'remove' : 'select';
      setPickerOpen(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [pickerOpen, contactId]);

  const handleRemove = () => {
    const removedName = contactName;
    pendingFocus.current = 'select';
    onChange('');
    setAnnouncement(`${label} ${removedName} removed`);
  };

  const handleClosePicker = () => {
    // The picker calls onSelect then onClose; keep the focus target onSelect set.
    if (!pendingFocus.current) pendingFocus.current = contactId ? 'remove' : 'select';
    setOpen(false);
  };

  const handleSelect = (id: string) => {
    pendingFocus.current = 'remove';
    onChange(id);
    setAnnouncement(`${label} selected`);
    setOpen(false);
  };

  return (
    <div role="group" aria-labelledby={labelId} aria-describedby={hint ? hintId : undefined}>
      <span id={labelId} className="block text-sm font-medium text-ink mb-1.5">
        {label}
      </span>
      {hint && (
        <p id={hintId} className="text-xs text-archive mb-1.5">
          {hint}
        </p>
      )}
      {contactId ? (
        <div className="flex items-center justify-between gap-2 p-3 bg-stone/30 rounded-lg">
          <div>
            <p className="font-medium text-ink">{contactName}</p>
            {contact?.organization_name && (
              <p className="text-sm text-archive">{contact.organization_name}</p>
            )}
          </div>
          {isEditing && (
            <button
              ref={removeRef}
              type="button"
              onClick={handleRemove}
              aria-label={`Remove ${lowerLabel} ${contactName}`}
              className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] text-archive hover:text-ink rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            >
              <X size={18} aria-hidden="true" />
            </button>
          )}
        </div>
      ) : isEditing ? (
        <button
          ref={selectRef}
          type="button"
          onClick={() => setOpen(true)}
          className="w-full inline-flex items-center justify-center gap-1.5 min-h-[44px] p-3 border border-dashed border-lichen rounded-lg text-archive hover:border-bark hover:text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
        >
          <Plus size={16} aria-hidden="true" />
          Select {lowerLabel}
        </button>
      ) : (
        <p className="text-archive">{emptyText}</p>
      )}
      <p role="status" className="sr-only">
        {announcement}
      </p>

      <ContactSelectorSlideOver
        isOpen={pickerOpen}
        organizationId={organizationId}
        onClose={handleClosePicker}
        onSelect={handleSelect}
        title={selectorTitle ?? `Select ${lowerLabel}`}
        subtitle={selectorSubtitle}
        constituentTypes={constituentTypes}
        layerClassName={pickerLayerClassName}
      />
    </div>
  );
}

export default ContactLinkField;
