import { useQuery } from '@tanstack/react-query';
import { Package } from 'lucide-react';
import { formatNumber } from '../../lib/formatters';
import {
  getIncidentReport,
  addIncidentObject,
  removeIncidentObject,
  getCollectionObjects,
} from '../../lib/api';
import type {
  CollectionObjectListItem,
  IncidentReportObject,
} from '../../lib/schemas';
import { RecordLinker } from '../records';

type IncidentObjectLink = IncidentReportObject;

interface IncidentObjectLinkerProps {
  organizationId: string;
  reportId: string;
  isEditing?: boolean;
  onCountChange?: (count: number) => void;
}

const EXTENT_OPTIONS = [
  { value: 'minor', label: 'Minor' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'severe', label: 'Severe' },
  { value: 'total_loss', label: 'Total Loss' },
];

const EXTENT_STYLES: Record<string, string> = {
  minor: 'bg-stone text-archive',
  moderate: 'bg-semantic-warning/10 text-semantic-warning',
  severe: 'bg-semantic-error/10 text-semantic-error',
  total_loss: 'bg-semantic-error/20 text-semantic-error',
};

/**
 * Component to manage objects linked to an incident report.
 */
export function IncidentObjectLinker({
  organizationId,
  reportId,
  isEditing = false,
  onCountChange,
}: IncidentObjectLinkerProps) {
  const { data: report, isLoading } = useQuery({
    queryKey: ['incident-report', organizationId, reportId],
    queryFn: () => getIncidentReport(organizationId, reportId),
  });

  const linkedObjects: IncidentObjectLink[] = report?.affected_objects || [];

  return (
    <RecordLinker<IncidentObjectLink, CollectionObjectListItem>
      organizationId={organizationId}
      onCountChange={onCountChange}
      title="Affected Objects"
      addLabel="Add Object"
      emptyMessage="No objects linked to this incident."
      linkedItems={linkedObjects}
      isLoading={isLoading}
      getItemId={(link) => link.incident_object_id}
      getLinkedEntityId={(link) => link.object_id ?? ''}
      renderItem={(link) => (
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <Package size={16} className="text-archive mt-0.5 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-ink">
                {link.object_number || 'Unknown Object'}
              </span>
              {link.damage_extent && (
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    EXTENT_STYLES[link.damage_extent] || 'bg-stone text-archive'
                  }`}
                >
                  {EXTENT_OPTIONS.find((o) => o.value === link.damage_extent)?.label ||
                    link.damage_extent}
                </span>
              )}
            </div>
            {link.object_title && (
              <p className="text-xs text-archive">{link.object_title}</p>
            )}
            {link.damage_description && (
              <p className="text-xs text-archive mt-1">{link.damage_description}</p>
            )}
            {link.estimated_loss_value && (
              <p className="text-xs text-semantic-error mt-1">
                Est. loss: ${formatNumber(link.estimated_loss_value)}
              </p>
            )}
          </div>
        </div>
      )}
      getItemHref={(link) =>
        link.object_id
          ? `/organizations/${organizationId}/collections/objects/${link.object_id}`
          : null
      }
      isEditing={isEditing}
      onLink={async (obj: CollectionObjectListItem, metadata) => {
        await addIncidentObject(organizationId, reportId, {
          object_id: obj.object_id,
          damage_extent: metadata.damage_extent,
          damage_description: metadata.damage_description || null,
        });
      }}
      onUnlink={async (link) => {
        if (!link.object_id) return;
        await removeIncidentObject(organizationId, reportId, link.object_id);
      }}
      metadataFields={[
        {
          key: 'damage_extent',
          label: 'Damage Extent',
          type: 'select',
          options: EXTENT_OPTIONS,
          defaultValue: 'moderate',
          required: true,
          showAfterSelection: true,
        },
        {
          key: 'damage_description',
          label: 'Damage Description',
          type: 'textarea',
          placeholder: 'Describe the damage to this object...',
          showAfterSelection: true,
        },
      ]}
      search={{
        title: 'Add Affected Object',
        subtitle: 'Search for an object affected by this incident',
        placeholder: 'Search by object number or title...',
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
            <div className="flex-1 min-w-0">
              <p className="text-sm text-ink font-medium truncate">{obj.object_number}</p>
              <p className="text-xs text-archive truncate">
                {obj.title || obj.object_name || 'Untitled'}
              </p>
            </div>
          </>
        ),
      }}
      invalidateKeys={[['incident-report', organizationId, reportId]]}
      submitLabel="Add Object"
    />
  );
}
