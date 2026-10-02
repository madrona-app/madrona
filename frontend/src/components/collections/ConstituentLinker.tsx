import { useQuery } from '@tanstack/react-query';
import { User, Building2, Users, CheckCircle } from 'lucide-react';
import {
  getObjectConstituents,
  addObjectConstituent,
  removeObjectConstituent,
  searchConstituents,
  importUlan,
  createConstituent,
} from '../../lib/api/constituents';
import type { ConstituentXref, ConstituentSearchResult } from '../../lib/api/constituents';
import { RecordLinker } from '../records';
import { useLookupCategory } from '../../hooks/useLookupValues';

interface ConstituentLinkerProps {
  organizationId: string;
  objectId: string;
  isEditing?: boolean;
  entityType?: string;
  /** If provided, only these roles are shown and available for linking. */
  allowedRoles?: string[];
  /** If provided, these roles are excluded from display and linking. */
  excludedRoles?: string[];
  /** Override the title shown above the linked list. */
  title?: string;
  /** Override the add button label. */
  addLabel?: string;
  /** Called when linked item count changes — for parent badge display */
  onCountChange?: (count: number) => void;
}

function constituentIcon(type?: string) {
  if (type === 'organization' || type === 'corporate_body' || type === 'dealer' || type === 'auction_house') {
    return <Building2 size={16} className="text-archive" />;
  }
  if (type === 'family' || type === 'department') {
    return <Users size={16} className="text-archive" />;
  }
  return <User size={16} className="text-archive" />;
}

/**
 * Component to link constituents to a collection object via ConXrefs.
 * Search-first pattern with create fallback.
 */
export function ConstituentLinker({
  organizationId,
  objectId,
  isEditing = false,
  entityType = 'collection_object',
  allowedRoles,
  excludedRoles,
  title: titleOverride,
  addLabel: addLabelOverride,
  onCountChange,
}: ConstituentLinkerProps) {
  // Map entity type to lookup category key
  const categoryKey = `constituent_role_${entityType === 'collection_object' ? 'object' : entityType}`;
  const { options: lookupOptions, getLabel: _getLabel, isLoading: _rolesLoading } = useLookupCategory(categoryKey);

  // Derive role options from lookup data (system values seeded per entity type)
  const allRoleOptions = lookupOptions.map(opt => ({ value: opt.value, label: opt.label }));

  // Filter to allowed/excluded roles if specified
  let roleOptions = allRoleOptions;
  if (allowedRoles) {
    roleOptions = roleOptions.filter(opt => allowedRoles.includes(opt.value));
  }
  if (excludedRoles) {
    roleOptions = roleOptions.filter(opt => !excludedRoles.includes(opt.value));
  }

  const roleLabels: Record<string, string> = {};
  for (const opt of roleOptions) {
    // Pluralize label for group headers
    roleLabels[opt.value] = opt.label.endsWith('s') ? opt.label : opt.label + 's';
  }

  const roleOrder = roleOptions.map(r => r.value);

  const { data: linkedXrefs, isLoading } = useQuery({
    queryKey: ['object-constituents', organizationId, objectId],
    queryFn: () => getObjectConstituents(organizationId, objectId),
  });

  // Filter displayed xrefs to allowed/excluded roles
  const allXrefs = linkedXrefs || [];
  let xrefs = allXrefs;
  if (allowedRoles) {
    xrefs = xrefs.filter(x => allowedRoles.includes(x.role));
  }
  if (excludedRoles) {
    xrefs = xrefs.filter(x => !excludedRoles.includes(x.role));
  }

  return (
    <RecordLinker<ConstituentXref, ConstituentSearchResult>
      organizationId={organizationId}
      title={titleOverride || "Linked People and Organizations"}
      addLabel={addLabelOverride || "Add Person or Organization"}
      emptyMessage="No people or organizations linked to this object."
      linkedItems={xrefs}
      isLoading={isLoading}
      getItemId={(xref) => xref.xref_id}
      getLinkedEntityId={(xref) => xref.constituent_id}
      getItemGroup={(xref) => xref.role}
      groupLabels={roleLabels}
      groupOrder={roleOrder}
      renderItem={(xref) => (
        <>
          {constituentIcon(xref.constituent?.constituent_type)}
          <div>
            <div className="text-sm font-medium text-ink">
              {xref.display_name_override || xref.constituent?.name || 'Unknown'}
            </div>
            <div className="text-xs text-archive">
              {xref.role_qualifier && <span>{xref.role_qualifier}</span>}
              {xref.attribution_certainty && xref.attribution_certainty !== 'certain' && (
                <span className="ml-1">({xref.attribution_certainty})</span>
              )}
              {xref.constituent?.ulan_id && (
                <a
                  href={`http://vocab.getty.edu/ulan/${xref.constituent.ulan_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 text-bark hover:text-copper-dark"
                  onClick={(e) => e.stopPropagation()}
                >
                  ULAN
                </a>
              )}
              {xref.constituent?.is_verified && (
                <span className="ml-2 inline-flex items-center gap-0.5 text-forest">
                  <CheckCircle size={10} />
                  Verified
                </span>
              )}
            </div>
          </div>
        </>
      )}
      getItemHref={(xref) =>
        `/organizations/${organizationId}/collections/constituents/${xref.constituent_id}`
      }
      isEditing={isEditing}
      onLink={async (result: ConstituentSearchResult, metadata) => {
        let constituentId = result.constituent_id;
        // If this is a ULAN result, import it first
        if (result.source === 'ulan' && result.ulan_id) {
          const imported = await importUlan(organizationId, { ulan_id: result.ulan_id });
          constituentId = imported.constituent_id;
        }
        if (!constituentId) throw new Error('Invalid selection');
        await addObjectConstituent(organizationId, objectId, {
          constituent_id: constituentId,
          role: metadata.role || roleOptions[0]?.value || allowedRoles?.[0] || 'creator',
        });
      }}
      onUnlink={async (xref) => {
        await removeObjectConstituent(organizationId, objectId, xref.xref_id);
      }}
      metadataFields={[
        {
          key: 'role',
          label: 'Role',
          type: 'select',
          options: roleOptions,
          defaultValue: roleOptions[0]?.value || allowedRoles?.[0] || 'creator',
          required: true,
        },
      ]}
      remoteCache={{
        isRemote: (result) => result.source === 'ulan',
        remoteLabel: 'ULAN',
        importButtonLabel: 'Import & Add',
        selectedRemoteText: 'Will import from Getty ULAN:',
      }}
      create={{
        label: 'Create New Person or Organization',
        submitLabel: 'Create & Link',
        renderCreateFields: ({ searchTerm, formData, setFormData }) => (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">
                Type <span className="text-semantic-error">*</span>
              </label>
              <div className="flex gap-4">
                {([
                  { value: 'person', label: 'Person', Icon: User },
                  { value: 'organization', label: 'Organization', Icon: Building2 },
                ] as const).map(({ value, label, Icon }) => (
                  <label
                    key={value}
                    className={`flex-1 flex items-center justify-center gap-2 p-3 border rounded-lg cursor-pointer transition-colors ${
                      (formData.constituent_type || 'person') === value
                        ? 'border-bark bg-bark/5'
                        : 'border-lichen hover:border-bark/30'
                    }`}
                  >
                    <input
                      type="radio"
                      name="constituent_type"
                      value={value}
                      checked={(formData.constituent_type || 'person') === value}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, constituent_type: e.target.value }))
                      }
                      className="sr-only"
                    />
                    <Icon
                      size={18}
                      className={
                        (formData.constituent_type || 'person') === value
                          ? 'text-bark'
                          : 'text-archive'
                      }
                    />
                    <span className="text-sm font-medium">{label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">
                Name <span className="text-semantic-error">*</span>
              </label>
              <input
                type="text"
                value={formData.name ?? searchTerm}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder={
                  (formData.constituent_type || 'person') === 'person'
                    ? 'Enter person name...'
                    : 'Enter organization name...'
                }
                className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">
                Role <span className="text-semantic-error">*</span>
              </label>
              <select
                value={formData.role || roleOptions[0]?.value || allowedRoles?.[0] || 'creator'}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, role: e.target.value }))
                }
                className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
              >
                {roleOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs text-archive">
              A new constituent will be created and linked to this object.
            </p>
          </div>
        ),
        onCreateSubmit: async (formData) => {
          const newConstituent = await createConstituent(organizationId, {
            name: formData.name,
            constituent_type: formData.constituent_type || 'person',
          });
          await addObjectConstituent(organizationId, objectId, {
            constituent_id: newConstituent.constituent_id,
            role: formData.role || roleOptions[0]?.value || allowedRoles?.[0] || 'creator',
          });
        },
        canSubmit: (formData) => !!formData.name?.trim(),
      }}
      search={{
        title: 'Add Person or Organization',
        subtitle: 'Search local records or Getty ULAN',
        placeholder: 'Type a name to search (e.g., Monet, Picasso)...',
        searchLabel: 'Search Local Records & Getty ULAN',
        queryKey: ['constituents-ulan-search', organizationId],
        searchFn: async (term) => {
          const result = await searchConstituents(organizationId, {
            q: term,
            include_ulan: true,
            limit: 20,
          });
          return result.results || [];
        },
        getSearchItemId: (r) => r.id,
        getSearchItemLabel: (r) => r.label,
        filterLinked: (items, linkedIds) =>
          items.filter((r) => {
            if (r.source === 'local' && r.constituent_id) {
              return !linkedIds.has(r.constituent_id);
            }
            return true;
          }),
        renderSearchItem: (result) => (
          <>
            <User size={16} className="text-archive flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm text-ink font-medium truncate">{result.label}</p>
                {result.source === 'ulan' && (
                  <span className="flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium bg-stone text-archive rounded">
                    ULAN
                  </span>
                )}
              </div>
              <p className="text-xs text-archive truncate">
                {[result.nationality, result.dates, result.roles?.slice(0, 2).join(', ')]
                  .filter(Boolean)
                  .join(' \u00b7 ') || result.description || 'No details'}
              </p>
            </div>
          </>
        ),
      }}
      invalidateKeys={[
        ['object-constituents', organizationId, objectId],
        ['constituents', organizationId],
        ['collection-object', organizationId, objectId],
      ]}
      submitLabel="Add Person or Organization"
      onCountChange={onCountChange}
    />
  );
}

export default ConstituentLinker;
