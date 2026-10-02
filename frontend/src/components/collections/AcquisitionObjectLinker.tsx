import { useQuery } from '@tanstack/react-query';
import { Link as LinkIcon, Package, ExternalLink } from 'lucide-react';
import {
  getAcquisitionObjects,
  linkAcquisitionObject,
  unlinkAcquisitionObject,
  getAcquisitions,
  setObjectAcquisition,
  getCollectionObjects,
} from '../../lib/api';
import type { Acquisition, CollectionObjectListItem } from '../../lib/schemas';
import { RecordLinker, RecordLinkerSingle } from '../records';

interface AcquisitionObjectLinkerProps {
  organizationId: string;
  acquisitionId: string;
  isEditing?: boolean;
  onCountChange?: (count: number) => void;
}

/**
 * Component to manage objects linked to an acquisition.
 */
export function AcquisitionObjectLinker({
  organizationId,
  acquisitionId,
  isEditing = false,
  onCountChange,
}: AcquisitionObjectLinkerProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['acquisition-objects', organizationId, acquisitionId],
    queryFn: () => getAcquisitionObjects(organizationId, acquisitionId),
  });

  return (
    <RecordLinker
      organizationId={organizationId}
      onCountChange={onCountChange}
      title="Linked Objects"
      addLabel="Add Object"
      emptyMessage="No objects linked to this acquisition."
      linkedItems={data?.objects || []}
      isLoading={isLoading}
      getItemId={(link) => link.acquisition_object_id}
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
        await linkAcquisitionObject(organizationId, acquisitionId, obj.object_id);
      }}
      onUnlink={async (link) => {
        await unlinkAcquisitionObject(organizationId, acquisitionId, link.object_id);
      }}
      search={{
        title: 'Add Object',
        subtitle: 'Search for a collection object to link to this acquisition',
        placeholder: 'Search by number or title...',
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
      invalidateKeys={[['acquisition-objects', organizationId, acquisitionId]]}
      submitLabel="Add Object"
    />
  );
}

// Partial acquisition type for display purposes (nested in object response)
interface PartialAcquisition {
  acquisition_id: string;
  acquisition_number: string;
  acquisition_method: string;
  status: string;
  source_name?: string | null;
}

interface ObjectAcquisitionSelectorProps {
  organizationId: string;
  objectId: string;
  currentAcquisition?: PartialAcquisition | null;
  isEditing?: boolean;
  onAcquisitionChange?: (acquisition: Acquisition | null) => void;
}

/**
 * Component to select/change the acquisition for an object.
 */
export function ObjectAcquisitionSelector({
  organizationId,
  objectId,
  currentAcquisition,
  isEditing = false,
  onAcquisitionChange,
}: ObjectAcquisitionSelectorProps) {
  return (
    <RecordLinkerSingle
      organizationId={organizationId}
      singularNoun="Acquisition"
      emptyLabel="Add Acquisition"
      linkedItem={currentAcquisition ?? null}
      renderItem={(acq) => (
        <div className="flex items-center justify-between p-3 border border-lichen rounded-lg bg-parchment">
          <div className="flex items-center gap-3">
            <LinkIcon size={16} className="text-bark" />
            <div>
              <div className="text-sm font-medium text-ink">
                {acq.acquisition_number}
              </div>
              <div className="text-xs text-archive">
                {acq.acquisition_method} &bull; {acq.status}
                {acq.source_name && ` \u2022 ${acq.source_name}`}
              </div>
            </div>
          </div>
          <a
            href={`/organizations/${organizationId}/collections/acquisitions/${acq.acquisition_id}`}
            className="text-bark hover:text-copper-dark p-1"
            title="View acquisition"
          >
            <ExternalLink size={14} />
          </a>
        </div>
      )}
      isEditing={isEditing}
      onLink={async (item: Acquisition) => {
        const data = await setObjectAcquisition(organizationId, objectId, item.acquisition_id);
        onAcquisitionChange?.(data.acquisition);
      }}
      onUnlink={async () => {
        await setObjectAcquisition(organizationId, objectId, null);
        onAcquisitionChange?.(null);
      }}
      search={{
        title: 'Add Acquisition',
        subtitle: 'Search for an acquisition record to link',
        placeholder: 'Search by number or source...',
        searchLabel: 'Search Acquisitions',
        minSearchLength: 0,
        queryKey: ['acquisitions', organizationId],
        searchFn: async (term) => {
          const result = await getAcquisitions(organizationId, { q: term, limit: 20 });
          return result.items || [];
        },
        getSearchItemId: (acq) => acq.acquisition_id,
        getSearchItemLabel: (acq) => acq.acquisition_number,
        renderSearchItem: (acq) => (
          <div className="min-w-0">
            <p className="text-sm text-ink font-medium">{acq.acquisition_number}</p>
            <p className="text-xs text-archive">
              {acq.acquisition_method} &bull; {acq.status}
              {acq.source_name && ` \u2022 ${acq.source_name}`}
            </p>
          </div>
        ),
      }}
      invalidateKeys={[['collection-object', organizationId, objectId]]}
      submitLabel="Add Acquisition"
    />
  );
}
