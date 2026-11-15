import { useId } from 'react';
import { MapPin, Search, User, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { WorkspaceSection, EditableField } from '../../../components/workspace';
import { useRequiredField } from '../../../components/workspace/requiredFields';
import { RequiredFieldMessage } from '../../../components/workspace/RequiredFieldsContext';
import { ContactSelectorSlideOver } from '../../../components/collections/ConstituentSelectorSlideOver';
import { useContactSelector } from '../../../hooks/useContactSelector';
import { getContact } from '../../../lib/api';
import type { FormData } from './types';

interface VenueSectionProps {
  formData: FormData;
  isExpanded: boolean;
  isEditing: boolean;
  order: number | undefined;
  onToggle: () => void;
  onUpdateField: <K extends keyof FormData>(field: K, value: FormData[K]) => void;
  onFieldBlur: () => void;
  organizationId?: string;
}

export function VenueSection({
  formData,
  isExpanded,
  isEditing,
  order,
  onToggle,
  onUpdateField,
  onFieldBlur,
  organizationId,
}: VenueSectionProps) {
  const uid = useId();
  const selector = useContactSelector();
  const { register: venueRegister, error: venueError } = useRequiredField('venue_id', false, 'venue', formData.venue_id);
  const { data: venueContact } = useQuery({
    queryKey: ['contact', organizationId, formData.venue_id],
    queryFn: () => getContact(organizationId!, formData.venue_id),
    enabled: !!organizationId && !!formData.venue_id,
  });
  return (
    <>
    <WorkspaceSection
      id="venue"
      title="Venue"
      icon={<MapPin size={18} />}
      isExpanded={isExpanded}
      onToggle={onToggle}
      isEditing={isEditing}
      order={order}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div role="group" aria-labelledby={`${uid}-venue-contact`} className="md:col-span-2">
          <span id={`${uid}-venue-contact`} className="block text-sm font-medium text-ink mb-1.5">
            Venue Contact
          </span>
          {isEditing ? (
            <div className="flex items-center gap-2">
              {formData.venue_id && venueContact ? (
                <div className="flex-1 flex items-center gap-2 px-3 py-2 border border-lichen rounded-lg bg-parchment">
                  <User size={16} className="text-archive flex-shrink-0" aria-hidden="true" />
                  <span className="text-sm text-ink">{venueContact.name}</span>
                  <button
                    type="button"
                    onClick={() => onUpdateField('venue_id', '')}
                    aria-label={`Remove venue contact ${venueContact.name}`}
                    className="ml-auto p-1 rounded text-archive hover:text-semantic-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  ref={venueRegister}
                  aria-describedby={venueError?.id}
                  onClick={() => selector.open()}
                  className="flex-1 flex items-center gap-2 px-3 py-2 border border-dashed border-lichen rounded-lg text-sm text-archive hover:border-bark hover:text-bark transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                >
                  <Search size={16} aria-hidden="true" />
                  Search or create venue contact...
                </button>
              )}
              {formData.venue_id && (
                <button
                  type="button"
                  ref={venueRegister}
                  aria-describedby={venueError?.id}
                  onClick={() => selector.open()}
                  aria-label="Change venue contact"
                  className="px-3 py-2 text-sm text-bark hover:text-copper-dark rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                >
                  Change
                </button>
              )}
            </div>
          ) : (
            <div className="text-sm text-ink">
              {venueContact ? venueContact.name : <span className="text-archive">Not specified</span>}
            </div>
          )}
          {venueError && <RequiredFieldMessage error={venueError} />}
        </div>
        <EditableField
          name="venue_name"
          label="Venue Name"
          value={formData.venue_name}
          isEditing={isEditing}
          onChange={(v) => onUpdateField('venue_name', v)}
          onSave={onFieldBlur}
          className="md:col-span-2"
        />
        <EditableField
          name="venue_street"
          label="Street Address"
          value={formData.venue_street}
          isEditing={isEditing}
          onChange={(v) => onUpdateField('venue_street', v)}
          onSave={onFieldBlur}
          className="md:col-span-2"
        />
        <EditableField
          name="venue_city"
          label="City"
          value={formData.venue_city}
          isEditing={isEditing}
          onChange={(v) => onUpdateField('venue_city', v)}
          onSave={onFieldBlur}
        />
        <EditableField
          name="venue_state"
          label="State/Province"
          value={formData.venue_state}
          isEditing={isEditing}
          onChange={(v) => onUpdateField('venue_state', v)}
          onSave={onFieldBlur}
        />
        <EditableField
          name="venue_postal_code"
          label="Postal Code"
          value={formData.venue_postal_code}
          isEditing={isEditing}
          onChange={(v) => onUpdateField('venue_postal_code', v)}
          onSave={onFieldBlur}
        />
        <EditableField
          name="venue_country"
          label="Country"
          value={formData.venue_country}
          isEditing={isEditing}
          onChange={(v) => onUpdateField('venue_country', v)}
          onSave={onFieldBlur}
        />
      </div>
    </WorkspaceSection>
    {organizationId && (
      <ContactSelectorSlideOver
        isOpen={selector.isOpen}
        onClose={selector.close}
        onSelect={selector.createSelectHandler((id) => onUpdateField('venue_id', id))}
        organizationId={organizationId}
        title="Select Venue Contact"
        subtitle="The venue (or its contact) where the borrowed objects will be shown."
      />
    )}
    </>
  );
}
