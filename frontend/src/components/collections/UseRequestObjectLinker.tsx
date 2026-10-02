import { useQuery } from '@tanstack/react-query';
import { Package } from 'lucide-react';
import {
  getUseRequestObjects,
  addUseRequestObject,
  removeUseRequestObject,
  getCollectionObjects,
} from '../../lib/api';
import type { CollectionObjectListItem } from '../../lib/schemas';
import { RecordLinker } from '../records';

interface UseRequestObjectLinkerProps {
  organizationId: string;
  requestId: string;
  isEditing?: boolean;
  onCountChange?: (count: number) => void;
}

/**
 * Component to manage objects linked to a use request.
 */
export function UseRequestObjectLinker({
  organizationId,
  requestId,
  isEditing = false,
  onCountChange,
}: UseRequestObjectLinkerProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['use-request-objects', organizationId, requestId],
    queryFn: () => getUseRequestObjects(organizationId, requestId),
  });

  return (
    <RecordLinker
      organizationId={organizationId}
      onCountChange={onCountChange}
      title="Requested Objects"
      addLabel="Add Object"
      emptyMessage="No objects linked to this request."
      linkedItems={data?.objects || []}
      isLoading={isLoading}
      getItemId={(link) => link.request_object_id}
      getLinkedEntityId={(link) => link.object_id}
      renderItem={(link) => (
        <>
          <Package size={16} className="text-archive" />
          <div>
            <div className="text-sm font-medium text-ink">
              {link.object?.object_number || 'Unknown'}
            </div>
            <div className="text-xs text-archive">
              {link.object?.title || link.object?.object_name || 'Untitled'}
            </div>
          </div>
        </>
      )}
      getItemHref={(link) =>
        `/organizations/${organizationId}/collections/objects/${link.object_id}`
      }
      isEditing={isEditing}
      onLink={async (obj: CollectionObjectListItem) => {
        await addUseRequestObject(organizationId, requestId, { object_id: obj.object_id });
      }}
      onUnlink={async (link) => {
        await removeUseRequestObject(organizationId, requestId, link.object_id);
      }}
      search={{
        title: 'Add Object',
        subtitle: 'Search for an object to add to this request',
        placeholder: 'Search by object number or title...',
        searchLabel: 'Search Objects',
        queryKey: ['collection-objects-search', organizationId],
        searchFn: async (term) => {
          const result = await getCollectionObjects(organizationId, { search: term, limit: 20 });
          return result.items || [];
        },
        getSearchItemId: (obj) => obj.object_id,
        getSearchItemLabel: (obj) => obj.object_number,
        renderSearchItem: (obj) => (
          <>
            <Package size={16} className="text-archive flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-sm text-ink font-medium truncate">{obj.object_number}</p>
              <p className="text-xs text-archive truncate">
                {obj.title || obj.object_name || 'Untitled'}
              </p>
            </div>
          </>
        ),
      }}
      invalidateKeys={[['use-request-objects', organizationId, requestId]]}
      submitLabel="Add Object"
    />
  );
}
