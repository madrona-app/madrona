import { MapPin } from 'lucide-react';
import { WorkspaceSection, EditableField } from '../../../components/workspace';
import type { FormData } from './types';

interface VenueSectionProps {
  formData: FormData;
  isExpanded: boolean;
  isEditing: boolean;
  order: number | undefined;
  onToggle: () => void;
  onUpdateField: <K extends keyof FormData>(field: K, value: FormData[K]) => void;
  onFieldBlur: () => void;
}

export function VenueSection({
  formData,
  isExpanded,
  isEditing,
  order,
  onToggle,
  onUpdateField,
  onFieldBlur,
}: VenueSectionProps) {
  return (
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
        <EditableField
          label="Venue Name"
          value={formData.venue_name}
          isEditing={isEditing}
          onChange={(v) => onUpdateField('venue_name', v)}
          onSave={onFieldBlur}
          className="md:col-span-2"
        />
        <EditableField
          label="Street Address"
          value={formData.venue_street}
          isEditing={isEditing}
          onChange={(v) => onUpdateField('venue_street', v)}
          onSave={onFieldBlur}
          className="md:col-span-2"
        />
        <EditableField
          label="City"
          value={formData.venue_city}
          isEditing={isEditing}
          onChange={(v) => onUpdateField('venue_city', v)}
          onSave={onFieldBlur}
        />
        <EditableField
          label="State/Province"
          value={formData.venue_state}
          isEditing={isEditing}
          onChange={(v) => onUpdateField('venue_state', v)}
          onSave={onFieldBlur}
        />
        <EditableField
          label="Postal Code"
          value={formData.venue_postal_code}
          isEditing={isEditing}
          onChange={(v) => onUpdateField('venue_postal_code', v)}
          onSave={onFieldBlur}
        />
        <EditableField
          label="Country"
          value={formData.venue_country}
          isEditing={isEditing}
          onChange={(v) => onUpdateField('venue_country', v)}
          onSave={onFieldBlur}
        />
      </div>
    </WorkspaceSection>
  );
}
