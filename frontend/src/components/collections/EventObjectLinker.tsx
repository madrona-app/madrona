import { useQuery } from '@tanstack/react-query';
import { Package } from 'lucide-react';
import {
  getEventObjects,
  addEventObject,
  removeEventObject,
  getCollectionObjects,
} from '../../lib/api';
import type { CollectionObjectListItem } from '../../lib/schemas';
import { RecordLinker } from '../records';

// Pending object for create mode (before event exists)
export interface PendingEventObject {
  object_id: string;
  object_number: string;
  title: string;
  role: string;
  planned_use: string;
}

interface EventObjectLinkerProps {
  organizationId: string;
  eventId?: string;
  isEditing?: boolean;
  pendingObjects?: PendingEventObject[];
  onPendingObjectsChange?: (objects: PendingEventObject[]) => void;
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

// Normalized type used for both pending and API modes
interface NormalizedEventObject {
  id: string;
  object_id: string;
  object_number: string;
  title: string;
  role: string;
  planned_use: string;
}

/**
 * Component to manage objects linked to an event.
 * Supports API mode (with eventId) and pending mode (for create flow).
 */
export function EventObjectLinker({
  organizationId,
  eventId,
  isEditing = false,
  pendingObjects = [],
  onPendingObjectsChange,
  onCountChange,
}: EventObjectLinkerProps) {
  const isPendingMode = !eventId;

  const { data, isLoading } = useQuery({
    queryKey: ['event-objects', organizationId, eventId],
    queryFn: () => getEventObjects(organizationId, eventId!),
    enabled: !isPendingMode,
  });

  // Normalize items from both sources
  const linkedItems: NormalizedEventObject[] = isPendingMode
    ? pendingObjects.map((o) => ({
        id: o.object_id,
        object_id: o.object_id,
        object_number: o.object_number,
        title: o.title,
        role: o.role,
        planned_use: o.planned_use,
      }))
    : (data?.objects || []).map((link: any) => ({
        id: link.event_object_id,
        object_id: link.object_id,
        object_number: link.object?.object_number || 'Unknown',
        title: link.object?.title || link.object?.object_name || 'Untitled',
        role: link.role,
        planned_use: link.planned_use,
      }));

  return (
    <RecordLinker<NormalizedEventObject, CollectionObjectListItem>
      organizationId={organizationId}
      onCountChange={onCountChange}
      title={isPendingMode ? 'Objects to Link' : 'Linked Objects'}
      addLabel="Add Object"
      emptyMessage={
        isPendingMode
          ? 'No objects selected yet.'
          : 'No objects linked to this event.'
      }
      linkedItems={linkedItems}
      isLoading={!isPendingMode && isLoading}
      getItemId={(item) => item.id}
      getLinkedEntityId={(item) => item.object_id}
      renderItem={(item) => (
        <>
          <Package size={16} className="text-archive shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-medium text-ink truncate">
              {item.object_number}
            </div>
            <div className="text-xs text-archive truncate">{item.title}</div>
          </div>
          <span
            className={`px-2 py-0.5 text-xs font-medium rounded-full ${
              ROLE_STYLES[item.role] || ROLE_STYLES.primary
            }`}
          >
            {item.role}
          </span>
          <span
            className={`px-2 py-0.5 text-xs font-medium rounded-full ${
              USE_STYLES[item.planned_use] || USE_STYLES.discuss
            }`}
          >
            {item.planned_use}
          </span>
        </>
      )}
      getItemHref={
        isPendingMode
          ? undefined
          : (item) =>
              `/organizations/${organizationId}/collections/objects/${item.object_id}`
      }
      isEditing={isEditing}
      onLink={async (obj: CollectionObjectListItem, metadata) => {
        const role = metadata.role || 'primary';
        const planned_use = metadata.planned_use || 'discuss';
        if (isPendingMode) {
          onPendingObjectsChange?.([
            ...pendingObjects,
            {
              object_id: obj.object_id,
              object_number: obj.object_number || 'Unknown',
              title: obj.title || obj.object_name || 'Untitled',
              role,
              planned_use,
            },
          ]);
        } else {
          await addEventObject(organizationId, eventId!, {
            object_id: obj.object_id,
            role,
            planned_use,
          });
        }
      }}
      onUnlink={async (item) => {
        if (isPendingMode) {
          onPendingObjectsChange?.(
            pendingObjects.filter((o) => o.object_id !== item.object_id)
          );
        } else {
          await removeEventObject(organizationId, eventId!, item.id);
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
      search={{
        title: 'Add Object to Event',
        subtitle: 'Search for a collection object to link',
        placeholder: 'Search by number or title...',
        searchLabel: 'Search Objects',
        queryKey: ['collection-objects-search', organizationId],
        searchFn: async (term) => {
          const result = await getCollectionObjects(organizationId, {
            search: term,
            limit: 20,
          });
          return result.items || [];
        },
        getSearchItemId: (obj) => obj.object_id,
        getSearchItemLabel: (obj) => obj.object_number,
        renderSearchItem: (obj) => (
          <>
            <Package size={16} className="text-archive flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-ink font-medium truncate">
                {obj.object_number}
              </p>
              <p className="text-xs text-archive truncate">
                {obj.title || obj.object_name || 'Untitled'}
              </p>
            </div>
          </>
        ),
      }}
      invalidateKeys={
        isPendingMode
          ? []
          : [
              ['event-objects', organizationId, eventId!],
              ['event', organizationId, eventId!],
            ]
      }
      submitLabel="Add Object"
    />
  );
}

export default EventObjectLinker;
