import { useQuery } from '@tanstack/react-query';
import { Calendar } from 'lucide-react';
import { formatDateShort } from '../../lib/formatters';
import {
  getObjectEvents,
  getEvents,
  createEvent,
  addEventObject,
  removeEventObject,
} from '../../lib/api';
import type { Event } from '../../lib/schemas';
import { RecordLinker } from '../records';
import { useLookupValues } from '../../hooks/useLookupValues';

interface ObjectEventLinkerProps {
  organizationId: string;
  objectId: string;
  objectNumber?: string;
  objectTitle?: string;
  isEditing?: boolean;
  onCountChange?: (count: number) => void;
}

const ROLE_OPTIONS = [
  { value: 'primary', label: 'Primary', description: 'Central to the event' },
  { value: 'supporting', label: 'Supporting', description: 'Provides context' },
  { value: 'reference', label: 'Reference', description: 'Mentioned only' },
];

const PLANNED_USE_OPTIONS = [
  { value: 'display', label: 'Display', description: 'Object will be on view' },
  { value: 'discuss', label: 'Discuss', description: 'Object will be discussed/shown' },
  { value: 'handle', label: 'Handle', description: 'Object will be physically handled' },
  { value: 'photograph', label: 'Photograph', description: 'Object will be photographed' },
  { value: 'record', label: 'Record', description: 'Object will be recorded on video' },
];

const ROLE_STYLES: Record<string, string> = {
  primary: 'bg-bark/10 text-bark',
  supporting: 'bg-forest/10 text-forest',
  reference: 'bg-stone text-archive',
};

const USE_STYLES: Record<string, string> = {
  display: 'bg-semantic-info/10 text-semantic-info',
  discuss: 'bg-stone text-ink',
  handle: 'bg-semantic-warning/10 text-semantic-warning',
  photograph: 'bg-copper/10 text-copper',
  record: 'bg-copper/10 text-copper',
};

const STATUS_STYLES: Record<string, string> = {
  scheduled: 'bg-semantic-info/10 text-semantic-info',
  completed: 'bg-semantic-success/10 text-semantic-success',
  cancelled: 'bg-semantic-error/10 text-semantic-error',
  draft: 'bg-stone text-archive',
};

/**
 * Component to manage events linked to a collection object.
 */
export function ObjectEventLinker({
  organizationId,
  objectId,
  objectNumber,
  objectTitle,
  isEditing = false,
  onCountChange,
}: ObjectEventLinkerProps) {
  const { getLookup } = useLookupValues({ context: 'events' });
  const eventTypeOptions = getLookup('event_type');
  const audienceOptions = getLookup('event_audience');

  const { data, isLoading } = useQuery({
    queryKey: ['object-events', organizationId, objectId],
    queryFn: () => getObjectEvents(organizationId, objectId),
    enabled: !!organizationId && !!objectId,
  });

  const linkedEvents = data?.events || [];

  return (
    <RecordLinker
      organizationId={organizationId}
      onCountChange={onCountChange}
      title="Linked Events"
      addLabel="Add Event"
      emptyMessage="No events linked to this object."
      linkedItems={linkedEvents}
      isLoading={isLoading}
      getItemId={(event) => event.event_id}
      renderItem={(event) => (
        <>
          <Calendar size={16} className="text-archive shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-medium text-ink truncate">
              {event.title}
            </div>
            <div className="text-xs text-archive truncate">
              {event.event_reference_number}
              {event.start_at &&
                ` \u00b7 ${formatDateShort(event.start_at)}`}
            </div>
          </div>
          {event.link && (
            <>
              <span
                className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                  ROLE_STYLES[event.link.role] || ROLE_STYLES.primary
                }`}
              >
                {event.link.role}
              </span>
              <span
                className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                  USE_STYLES[event.link.planned_use] || USE_STYLES.discuss
                }`}
              >
                {event.link.planned_use}
              </span>
            </>
          )}
          <span
            className={`px-2 py-0.5 text-xs font-medium rounded-full ${
              STATUS_STYLES[event.status] || STATUS_STYLES.draft
            }`}
          >
            {event.status}
          </span>
        </>
      )}
      getItemHref={(event) =>
        `/organizations/${organizationId}/collections/events/${event.event_id}`
      }
      isEditing={isEditing}
      onLink={async (event: Event, metadata) => {
        await addEventObject(organizationId, event.event_id, {
          object_id: objectId,
          role: metadata.role || 'primary',
          planned_use: metadata.planned_use || 'discuss',
        });
      }}
      onUnlink={async (event) => {
        if (event.link) {
          await removeEventObject(
            organizationId,
            event.event_id,
            event.link.event_object_id
          );
        }
      }}
      metadataFields={[
        {
          key: 'role',
          label: 'Object Role',
          type: 'radio-cards',
          options: ROLE_OPTIONS,
          defaultValue: 'primary',
          showAfterSelection: true,
        },
        {
          key: 'planned_use',
          label: 'Planned Use',
          type: 'radio-cards',
          options: PLANNED_USE_OPTIONS,
          defaultValue: 'discuss',
          required: true,
          showAfterSelection: true,
        },
      ]}
      create={{
        label: 'Create New Event',
        submitLabel: 'Create & Link',
        renderCreateFields: ({ searchTerm, formData, setFormData }) => (
          <div className="space-y-4">
            {(objectNumber || objectTitle) && (
              <div className="p-3 bg-stone/30 border border-lichen rounded-lg">
                <p className="text-xs text-archive mb-1">Linking to object:</p>
                <p className="text-sm font-medium text-ink">{objectNumber}</p>
                {objectTitle && (
                  <p className="text-xs text-archive">{objectTitle}</p>
                )}
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">
                Event Title <span className="text-semantic-error">*</span>
              </label>
              <input
                type="text"
                value={formData.title ?? searchTerm}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, title: e.target.value }))
                }
                placeholder="Enter event title..."
                className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">
                  Event Type <span className="text-semantic-error">*</span>
                </label>
                <select
                  value={formData.event_type ?? ''}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      event_type: e.target.value,
                    }))
                  }
                  className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                >
                  <option value="">Select type...</option>
                  {eventTypeOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">
                  Audience
                </label>
                <select
                  value={formData.audience ?? ''}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      audience: e.target.value,
                    }))
                  }
                  className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                >
                  <option value="">Select audience...</option>
                  {audienceOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">
                  Start Date/Time
                </label>
                <input
                  type="datetime-local"
                  value={formData.start_at ?? ''}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      start_at: e.target.value,
                    }))
                  }
                  className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">
                  End Date/Time
                </label>
                <input
                  type="datetime-local"
                  value={formData.end_at ?? ''}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      end_at: e.target.value,
                    }))
                  }
                  className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">
                Description
              </label>
              <textarea
                value={formData.description ?? ''}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    description: e.target.value,
                  }))
                }
                rows={2}
                placeholder="Brief description of the event..."
                className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark resize-none"
              />
            </div>
            {/* Role selection for create mode */}
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">
                Object Role
              </label>
              <div className="space-y-2">
                {ROLE_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                      (formData.role || 'primary') === option.value
                        ? 'border-bark bg-bark/5'
                        : 'border-lichen hover:border-bark/30'
                    }`}
                  >
                    <input
                      type="radio"
                      name="create_role"
                      value={option.value}
                      checked={(formData.role || 'primary') === option.value}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          role: e.target.value,
                        }))
                      }
                      className="mt-0.5"
                    />
                    <div>
                      <p className="text-sm font-medium text-ink">
                        {option.label}
                      </p>
                      <p className="text-xs text-archive">
                        {option.description}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
            {/* Planned use selection for create mode */}
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">
                Planned Use <span className="text-semantic-error">*</span>
              </label>
              <div className="space-y-2">
                {PLANNED_USE_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                      (formData.planned_use || 'discuss') === option.value
                        ? 'border-bark bg-bark/5'
                        : 'border-lichen hover:border-bark/30'
                    }`}
                  >
                    <input
                      type="radio"
                      name="create_planned_use"
                      value={option.value}
                      checked={
                        (formData.planned_use || 'discuss') === option.value
                      }
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          planned_use: e.target.value,
                        }))
                      }
                      className="mt-0.5"
                    />
                    <div>
                      <p className="text-sm font-medium text-ink">
                        {option.label}
                      </p>
                      <p className="text-xs text-archive">
                        {option.description}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>
        ),
        onCreateSubmit: async (formData) => {
          const eventData: Record<string, unknown> = {
            title: formData.title,
            status: 'draft',
          };
          if (formData.event_type) eventData.event_type = formData.event_type;
          if (formData.audience) eventData.audience = formData.audience;
          if (formData.start_at) eventData.start_at = formData.start_at;
          if (formData.end_at) eventData.end_at = formData.end_at;
          if (formData.description)
            eventData.description = formData.description;

          const newEvent = await createEvent(organizationId, eventData);

          await addEventObject(organizationId, newEvent.event_id, {
            object_id: objectId,
            role: formData.role || 'primary',
            planned_use: formData.planned_use || 'discuss',
          });
        },
        canSubmit: (formData) =>
          !!formData.title?.trim() && !!formData.event_type,
      }}
      search={{
        title: 'Add Event',
        subtitle: 'Search for an existing event or create a new one',
        placeholder: 'Search by title or reference...',
        searchLabel: 'Search Events',
        queryKey: ['events-search', organizationId],
        searchFn: async (term) => {
          const result = await getEvents(organizationId, {
            q: term,
            limit: 20,
          });
          return result.items || [];
        },
        getSearchItemId: (event) => event.event_id,
        getSearchItemLabel: (event) => event.title,
        renderSearchItem: (event) => (
          <div className="flex items-center justify-between w-full">
            <div className="min-w-0">
              <p className="text-sm text-ink font-medium truncate">
                {event.title}
              </p>
              <p className="text-xs text-archive">
                {event.event_reference_number}
                {event.start_at &&
                  ` \u00b7 ${formatDateShort(event.start_at)}`}
              </p>
            </div>
            <span
              className={`px-2 py-0.5 text-xs font-medium rounded-full shrink-0 ml-2 ${
                STATUS_STYLES[event.status] || STATUS_STYLES.draft
              }`}
            >
              {event.status}
            </span>
          </div>
        ),
      }}
      invalidateKeys={[['object-events', organizationId, objectId], ['collection-object', organizationId, objectId]]}
      submitLabel="Link Event"
    />
  );
}

export default ObjectEventLinker;
