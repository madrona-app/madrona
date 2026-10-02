import { useQuery } from '@tanstack/react-query';
import { MapPin } from 'lucide-react';
import {
  getObjectPlaceAuthorities,
  linkObjectPlaceAuthority,
  unlinkObjectPlaceAuthority,
  getPlaceAuthorities,
  createPlaceAuthority,
  searchVocabulary,
} from '../../lib/api';
import type { ObjectPlaceAuthority, PlaceAuthority, VocabularyTerm } from '../../lib/schemas';
import { RecordLinker } from '../records';

/** Unified search result for local place authorities + TGN */
interface PlaceSearchResult {
  id: string;
  label: string;
  source: 'local' | 'tgn';
  place_type?: string;
  parent_place?: string;
  // local
  place_authority_id?: string;
  // tgn
  tgn_id?: string;
  tgn_uri?: string;
  latitude?: number;
  longitude?: number;
}

/** Map TGN place types to our allowed place_type values */
const TGN_PLACE_TYPE_MAP: Record<string, PlaceAuthority['place_type']> = {
  'inhabited places': 'city',
  'cities': 'city',
  'towns': 'city',
  'villages': 'city',
  'municipalities': 'city',
  'capitals': 'city',
  'national capitals': 'city',
  'neighborhoods': 'district',
  'districts': 'district',
  'boroughs': 'district',
  'quarters': 'district',
  'nations': 'country',
  'sovereign states': 'country',
  'countries': 'country',
  'states': 'state',
  'departments': 'state',
  'provinces': 'province',
  'regions': 'region',
  'historical regions': 'region',
  'autonomous communities': 'region',
  'continents': 'continent',
  'rivers': 'body_of_water',
  'seas': 'body_of_water',
  'oceans': 'body_of_water',
  'lakes': 'body_of_water',
  'bays': 'body_of_water',
  'buildings': 'building',
  'churches': 'building',
  'museums': 'building',
  'palaces': 'building',
  'temples': 'building',
  'archaeological sites': 'site',
  'historical sites': 'site',
  'sites': 'site',
};

function mapTgnPlaceType(tgnType: string | undefined): PlaceAuthority['place_type'] {
  if (!tgnType) return 'place';
  return TGN_PLACE_TYPE_MAP[tgnType.toLowerCase()] || 'place';
}

interface PlaceAuthorityLinkerProps {
  organizationId: string;
  objectId: string;
  readOnly?: boolean;
  embedded?: boolean;
  /** If provided, only these roles are shown and available for linking. */
  allowedRoles?: string[];
  /** If provided, these roles are excluded from display and linking. */
  excludedRoles?: string[];
  /** Override the title shown above the linked list. */
  title?: string;
  /** Override the add button label. */
  addLabel?: string;
  onCountChange?: (count: number) => void;
}

const ROLE_LABELS: Record<string, string> = {
  creation_place: 'Creation Place',
  discovery_place: 'Discovery Place',
  depicted_place: 'Depicted Place',
  associated_place: 'Associated Place',
  former_location: 'Former Location',
  original_location: 'Original Location',
  intended_location: 'Intended Location',
};

const ROLE_OPTIONS = [
  { value: 'creation_place', label: 'Creation Place' },
  { value: 'discovery_place', label: 'Discovery Place' },
  { value: 'depicted_place', label: 'Depicted Place' },
  { value: 'associated_place', label: 'Associated Place' },
  { value: 'former_location', label: 'Former Location' },
  { value: 'original_location', label: 'Original Location' },
  { value: 'intended_location', label: 'Intended Location' },
];

const PLACE_TYPE_OPTIONS = [
  { value: 'city', label: 'City' },
  { value: 'region', label: 'Region' },
  { value: 'country', label: 'Country' },
  { value: 'site', label: 'Site' },
  { value: 'building', label: 'Building' },
];

export function PlaceAuthorityLinker({
  organizationId,
  objectId,
  readOnly = false,
  embedded = false,
  allowedRoles,
  excludedRoles,
  title: titleOverride,
  addLabel: addLabelOverride,
  onCountChange,
}: PlaceAuthorityLinkerProps) {
  const { data: placeAuthorities, isLoading } = useQuery({
    queryKey: ['object-place-authorities', organizationId, objectId],
    queryFn: () => getObjectPlaceAuthorities(organizationId, objectId),
    enabled: !!organizationId && !!objectId,
  });

  const allItems = placeAuthorities || [];
  let items = allItems;
  if (allowedRoles) items = items.filter(link => allowedRoles.includes(link.role));
  if (excludedRoles) items = items.filter(link => !excludedRoles.includes(link.role));

  const roleFilter = (value: string) => {
    if (allowedRoles && !allowedRoles.includes(value)) return false;
    if (excludedRoles && excludedRoles.includes(value)) return false;
    return true;
  };

  const filteredRoleLabels = Object.fromEntries(
    Object.entries(ROLE_LABELS).filter(([k]) => roleFilter(k))
  );
  const filteredRoleOptions = ROLE_OPTIONS.filter(opt => roleFilter(opt.value));
  const filteredRoleOrder = Object.keys(ROLE_LABELS).filter(roleFilter);

  const linker = (
    <RecordLinker<ObjectPlaceAuthority, PlaceSearchResult>
      organizationId={organizationId}
      onCountChange={onCountChange}
      title={titleOverride || "Places"}
      addLabel={addLabelOverride || "Add Place"}
      emptyMessage="No places linked yet."
      linkedItems={items}
      isLoading={isLoading}
      getItemId={(link) => link.link_id}
      getLinkedEntityId={(link) => link.place_authority_id}
      getItemGroup={(link) => link.role}
      groupLabels={filteredRoleLabels}
      groupOrder={filteredRoleOrder}
      renderItem={(link) => (
        <>
          <MapPin size={16} className="text-archive" />
          <div className="min-w-0">
            <div className="text-sm font-medium text-ink truncate">
              {link.place_authority?.preferred_name || 'Unknown'}
            </div>
            {link.date_display && (
              <p className="text-xs text-archive">{link.date_display}</p>
            )}
          </div>
        </>
      )}
      getItemHref={(link) =>
        `/organizations/${organizationId}/collections/place-authorities/${link.place_authority_id}`
      }
      isEditing={!readOnly}
      onLink={async (result: PlaceSearchResult, metadata) => {
        let placeAuthorityId = result.place_authority_id;

        // If TGN result, create a local place authority from it first.
        // Coordinates arrive with the TGN search result; passing them here
        // means the place is born with geometry and plots on maps
        // immediately (the backend also geocodes by tgn_id as a fallback).
        if (result.source === 'tgn' && result.tgn_id) {
          const newPlace = await createPlaceAuthority(organizationId, {
            preferred_name: result.label,
            place_type: mapTgnPlaceType(result.place_type),
            tgn_id: result.tgn_id,
            ...(result.latitude != null && result.longitude != null
              ? { coordinates_lat: result.latitude, coordinates_lng: result.longitude }
              : {}),
          });
          placeAuthorityId = newPlace.place_authority_id;
        }

        if (!placeAuthorityId) throw new Error('Invalid selection');

        await linkObjectPlaceAuthority(organizationId, objectId, {
          place_authority_id: placeAuthorityId,
          role: metadata.role || filteredRoleOptions[0]?.value || 'creation_place',
          date_display: metadata.date_display || undefined,
          notes: metadata.notes || undefined,
        });
      }}
      onUnlink={async (link) => {
        await unlinkObjectPlaceAuthority(organizationId, objectId, link.link_id);
      }}
      metadataFields={[
        {
          key: 'role',
          label: 'Role',
          type: 'select',
          options: filteredRoleOptions,
          defaultValue: filteredRoleOptions[0]?.value || 'creation_place',
          required: true,
        },
        {
          key: 'date_display',
          label: 'Date',
          type: 'text',
          placeholder: 'e.g., ca. 1500',
        },
        {
          key: 'notes',
          label: 'Notes',
          type: 'textarea',
          placeholder: 'Notes about this place association...',
        },
      ]}
      create={{
        label: 'Create New Place',
        submitLabel: 'Create & Link',
        renderCreateFields: ({ searchTerm, formData, setFormData, metadata }) => (
          <div className="space-y-4">
            <div className="p-4 bg-stone/30 rounded-lg space-y-4">
              <h4 className="text-sm font-medium text-ink flex items-center gap-2">
                <MapPin size={16} />
                New Place Details
              </h4>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">
                  Name <span className="text-semantic-error">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name ?? searchTerm}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, name: e.target.value }))
                  }
                  className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                  placeholder="e.g., Florence"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Type</label>
                <select
                  value={formData.place_type || 'city'}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, place_type: e.target.value }))
                  }
                  className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                >
                  {PLACE_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="border-t border-lichen pt-4 space-y-4">
              <h4 className="text-sm font-medium text-ink">Link Details</h4>
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">
                  Role <span className="text-semantic-error">*</span>
                </label>
                <select
                  value={formData.role || metadata.role || 'creation_place'}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, role: e.target.value }))
                  }
                  className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                >
                  {filteredRoleOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">Date</label>
                <input
                  type="text"
                  value={formData.date_display ?? metadata.date_display ?? ''}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, date_display: e.target.value }))
                  }
                  className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                  placeholder="e.g., ca. 1500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">Notes</label>
                <textarea
                  value={formData.notes ?? metadata.notes ?? ''}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, notes: e.target.value }))
                  }
                  rows={2}
                  className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark resize-none"
                />
              </div>
            </div>
          </div>
        ),
        onCreateSubmit: async (formData, metadata) => {
          const newPlace = await createPlaceAuthority(organizationId, {
            preferred_name: (formData.name || '').trim(),
            place_type: (formData.place_type || 'city') as PlaceAuthority['place_type'],
          });
          await linkObjectPlaceAuthority(organizationId, objectId, {
            place_authority_id: newPlace.place_authority_id,
            role: formData.role || metadata.role || 'creation_place',
            date_display: formData.date_display || metadata.date_display || undefined,
            notes: formData.notes || metadata.notes || undefined,
          });
        },
        canSubmit: (formData) => !!formData.name?.trim(),
      }}
      remoteCache={{
        isRemote: (result) => result.source === 'tgn',
        remoteLabel: 'TGN',
        importButtonLabel: 'Import & Add',
        selectedRemoteText: 'Will import from Getty TGN:',
      }}
      search={{
        title: 'Link Place',
        subtitle: 'Search local records or Getty TGN',
        placeholder: 'Type a place name to search (e.g., Florence, Paris)...',
        searchLabel: 'Search Local Records & Getty TGN',
        queryKey: ['place-authorities-tgn-search', organizationId],
        searchFn: async (term) => {
          // Search local place authorities and TGN in parallel
          const [localResult, tgnResult] = await Promise.all([
            getPlaceAuthorities(organizationId, {
              search: term,
              status: 'active',
              limit: 20,
            }).catch(() => ({ items: [] as PlaceAuthority[] })),
            searchVocabulary(organizationId, {
              vocabulary_type: 'tgn',
              query: term,
              limit: 15,
            }).catch(() => ({ terms: [] as VocabularyTerm[] })),
          ]);

          const localResults: PlaceSearchResult[] = (localResult.items || []).map(
            (p) => ({
              id: p.place_authority_id,
              label: p.preferred_name,
              source: 'local' as const,
              place_type: p.place_type,
              place_authority_id: p.place_authority_id,
            })
          );

          // Build a set of TGN IDs already imported locally
          const localTgnIds = new Set(
            (localResult.items || [])
              .map((p) => p.tgn_id)
              .filter(Boolean)
          );

          const tgnResults: PlaceSearchResult[] = (tgnResult.terms || [])
            .filter((t) => t.external_id && !localTgnIds.has(t.external_id))
            .map((t) => ({
              id: `tgn-${t.external_id}`,
              label: t.preferred_term,
              source: 'tgn' as const,
              place_type: t.place_type || undefined,
              parent_place: t.parent_place || undefined,
              tgn_id: t.external_id || undefined,
              tgn_uri: t.external_uri || undefined,
              latitude: t.latitude ?? undefined,
              longitude: t.longitude ?? undefined,
            }));

          return [...localResults, ...tgnResults];
        },
        getSearchItemId: (r) => r.id,
        getSearchItemLabel: (r) => r.label,
        filterLinked: (items, linkedIds) =>
          items.filter((r) => {
            if (r.source === 'local' && r.place_authority_id) {
              return !linkedIds.has(r.place_authority_id);
            }
            return true;
          }),
        renderSearchItem: (result) => (
          <>
            <MapPin size={16} className="text-archive flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm text-ink font-medium truncate">{result.label}</p>
                {result.source === 'tgn' && (
                  <span className="flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium bg-stone text-archive rounded">
                    TGN
                  </span>
                )}
              </div>
              <p className="text-xs text-archive truncate">
                {[result.place_type, result.parent_place].filter(Boolean).join(' · ') || 'Place'}
              </p>
            </div>
          </>
        ),
      }}
      invalidateKeys={[['object-place-authorities', organizationId, objectId], ['collection-object', organizationId, objectId]]}
      submitLabel="Link Place"
    />
  );

  if (embedded) return linker;

  return (
    <div className="card">
      <div className="p-4">{linker}</div>
    </div>
  );
}

export default PlaceAuthorityLinker;
