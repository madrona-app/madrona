import { useQuery } from '@tanstack/react-query';
import { Palette } from 'lucide-react';
import {
  getObjectStylePeriods,
  linkObjectStylePeriod,
  unlinkObjectStylePeriod,
  getStylePeriodAuthorities,
  createStylePeriodAuthority,
  searchVocabulary,
} from '../../lib/api';
import type { ObjectStylePeriod, StylePeriodAuthority } from '../../lib/schemas';
import { RecordLinker } from '../records';

interface StylePeriodLinkerProps {
  organizationId: string;
  objectId: string;
  readOnly?: boolean;
  embedded?: boolean;
  onCountChange?: (count: number) => void;
}

/** Unified search result for combined local + AAT search */
interface StylePeriodSearchResult {
  id: string;
  source: 'local' | 'aat';
  preferred_term: string;
  authority_id?: string;
  authority_type?: string;
  date_display?: string;
  aat_id?: string;
  scope_note?: string;
  broader_term?: string;
}

const CERTAINTY_LABELS: Record<string, string> = {
  certain: 'Certain',
  probable: 'Probable',
  possible: 'Possible',
};

const CERTAINTY_OPTIONS = [
  { value: '', label: 'Not specified' },
  { value: 'certain', label: 'Certain' },
  { value: 'probable', label: 'Probable' },
  { value: 'possible', label: 'Possible' },
];

const TYPE_OPTIONS = [
  { value: 'style', label: 'Style' },
  { value: 'period', label: 'Period' },
  { value: 'movement', label: 'Movement' },
  { value: 'school', label: 'School' },
  { value: 'group', label: 'Group' },
];

export function StylePeriodLinker({
  organizationId,
  objectId,
  readOnly = false,
  embedded = false,
  onCountChange,
}: StylePeriodLinkerProps) {
  const { data: stylePeriods, isLoading } = useQuery({
    queryKey: ['object-style-periods', organizationId, objectId],
    queryFn: () => getObjectStylePeriods(organizationId, objectId),
    enabled: !!organizationId && !!objectId,
  });

  const items = stylePeriods || [];

  const linker = (
    <RecordLinker<ObjectStylePeriod, StylePeriodSearchResult>
      organizationId={organizationId}
      onCountChange={onCountChange}
      title="Styles & Periods"
      addLabel="Add Style/Period"
      emptyMessage="No styles/periods linked yet."
      linkedItems={items}
      isLoading={isLoading}
      getItemId={(link) => link.link_id}
      getLinkedEntityId={(link) => link.authority_id}
      renderItem={(link) => (
        <>
          <Palette size={16} className="text-archive" />
          <div className="min-w-0">
            <div className="text-sm font-medium text-ink truncate">
              {link.authority?.preferred_term || 'Unknown'}
            </div>
            <div className="flex items-center gap-2 text-xs text-archive">
              {link.authority?.authority_type && (
                <span className="capitalize">{link.authority.authority_type}</span>
              )}
              {link.assignment_certainty && link.assignment_certainty !== 'certain' && (
                <span>
                  ({CERTAINTY_LABELS[link.assignment_certainty] || link.assignment_certainty})
                </span>
              )}
            </div>
          </div>
        </>
      )}
      getItemHref={(link) =>
        `/organizations/${organizationId}/collections/style-period-authorities/${link.authority_id}`
      }
      isEditing={!readOnly}
      onLink={async (result: StylePeriodSearchResult, metadata) => {
        let authorityId = result.authority_id;
        if (result.source === 'aat') {
          const newAuth = await createStylePeriodAuthority(organizationId, {
            preferred_term: result.preferred_term,
            authority_type: 'style' as StylePeriodAuthority['authority_type'],
            aat_id: result.aat_id,
          });
          authorityId = newAuth.authority_id;
        }
        if (!authorityId) throw new Error('Unable to resolve authority');
        await linkObjectStylePeriod(organizationId, objectId, {
          authority_id: authorityId,
          assignment_certainty: metadata.certainty || undefined,
          assignment_note: metadata.assignment_note || undefined,
        });
      }}
      onUnlink={async (link) => {
        await unlinkObjectStylePeriod(organizationId, objectId, link.link_id);
      }}
      metadataFields={[
        {
          key: 'certainty',
          label: 'Certainty',
          type: 'select',
          options: CERTAINTY_OPTIONS,
        },
        {
          key: 'assignment_note',
          label: 'Assignment Note',
          type: 'textarea',
          placeholder: 'Notes about this style/period assignment...',
        },
      ]}
      remoteCache={{
        isRemote: (result) => result.source === 'aat',
        remoteLabel: 'AAT',
        importButtonLabel: 'Import & Link',
        selectedRemoteText: 'Will import from Getty AAT:',
      }}
      create={{
        label: 'Create New Style/Period',
        submitLabel: 'Create & Link',
        renderCreateFields: ({ searchTerm, formData, setFormData }) => (
          <div className="p-4 bg-stone/30 rounded-lg space-y-4">
            <h4 className="text-sm font-medium text-ink flex items-center gap-2">
              <Palette size={16} />
              New Style/Period
            </h4>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                Term <span className="text-semantic-error">*</span>
              </label>
              <input
                type="text"
                value={formData.term ?? searchTerm}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, term: e.target.value }))
                }
                className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                placeholder="e.g., Baroque"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Type</label>
              <select
                value={formData.type || 'style'}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, type: e.target.value }))
                }
                className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
              >
                {TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ),
        onCreateSubmit: async (formData, metadata) => {
          const newAuth = await createStylePeriodAuthority(organizationId, {
            preferred_term: (formData.term || '').trim(),
            authority_type: (formData.type || 'style') as StylePeriodAuthority['authority_type'],
          });
          await linkObjectStylePeriod(organizationId, objectId, {
            authority_id: newAuth.authority_id,
            assignment_certainty: metadata.certainty || undefined,
            assignment_note: metadata.assignment_note || undefined,
          });
        },
        canSubmit: (formData) => !!formData.term?.trim(),
      }}
      search={{
        title: 'Link Style/Period',
        subtitle: 'Search Getty AAT and local authorities',
        placeholder: 'Search styles & periods (e.g., Baroque, Renaissance)...',
        searchLabel: 'Search Getty AAT & Local',
        queryKey: ['style-period-combined-search', organizationId],
        searchFn: async (term) => {
          const [localRes, aatRes] = await Promise.all([
            getStylePeriodAuthorities(organizationId, {
              search: term,
              status: 'active',
              limit: 20,
            }),
            searchVocabulary(organizationId, {
              vocabulary_type: 'aat',
              query: term,
              limit: 15,
              facet: 'styles_periods',
            }),
          ]);
          const results: StylePeriodSearchResult[] = [];
          (localRes?.items || []).forEach(
            (auth: StylePeriodAuthority) => {
              results.push({
                id: auth.authority_id,
                source: 'local',
                preferred_term: auth.preferred_term,
                authority_id: auth.authority_id,
                authority_type: auth.authority_type,
                date_display: auth.date_display ?? undefined,
                aat_id: auth.aat_id ?? undefined,
              });
            }
          );
          (aatRes?.terms || []).forEach((t) => {
            results.push({
              id: `aat-${t.external_id || t.preferred_term}`,
              source: 'aat',
              preferred_term: t.preferred_term,
              scope_note: t.scope_note || undefined,
              broader_term: t.broader_term || undefined,
              aat_id: t.external_id || undefined,
            });
          });
          return results;
        },
        getSearchItemId: (result) => result.id,
        getSearchItemLabel: (result) => result.preferred_term,
        renderSearchItem: (result) => (
          <>
            <Palette size={16} className="text-archive flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm text-ink font-medium truncate">
                  {result.preferred_term}
                </p>
                {result.source === 'aat' && (
                  <span className="flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium bg-stone text-archive rounded">
                    AAT
                  </span>
                )}
              </div>
              <p className="text-xs text-archive truncate">
                {result.source === 'local'
                  ? [
                      result.authority_type,
                      result.date_display,
                      result.aat_id ? 'AAT' : null,
                    ]
                      .filter(Boolean)
                      .join(' \u00b7 ') || 'Local authority'
                  : result.scope_note || result.broader_term || 'Getty AAT'}
              </p>
            </div>
          </>
        ),
      }}
      invalidateKeys={[['object-style-periods', organizationId, objectId], ['collection-object', organizationId, objectId]]}
      submitLabel="Link Style/Period"
    />
  );

  if (embedded) return linker;

  return (
    <div className="card">
      <div className="p-4">{linker}</div>
    </div>
  );
}

export default StylePeriodLinker;
