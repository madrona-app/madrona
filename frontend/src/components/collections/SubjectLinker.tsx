import { useQuery } from '@tanstack/react-query';
import { Tag, Globe } from 'lucide-react';
import {
  getObjectSubjects,
  linkObjectSubject,
  unlinkObjectSubject,
  getSubjectAuthorities,
  createSubjectAuthority,
  searchSubjectsExternal,
} from '../../lib/api';
import type { ObjectSubject, SubjectAuthority } from '../../lib/schemas';
import { RecordLinker } from '../records';

// A search result that can be either a local SubjectAuthority or an external suggestion
interface SubjectSearchItem {
  // Common
  authority_id: string;
  preferred_term: string;
  subject_type: string;
  // Local fields
  aat_id?: string | null;
  iconclass_id?: string | null;
  wikidata_id?: string | null;
  description?: string | null;
  status?: string;
  // External marker
  _external?: {
    source: string; // 'AAT', 'Iconclass', 'Wikidata'
    uri: string;
    label: string;
  };
}

interface SubjectLinkerProps {
  organizationId: string;
  objectId: string;
  readOnly?: boolean;
  embedded?: boolean;
  onCountChange?: (count: number) => void;
}

const SUBJECT_TYPE_LABELS: Record<string, string> = {
  iconographic: 'Iconographic',
  narrative: 'Narrative',
  thematic: 'Thematic',
  genre: 'Genre',
  decorative: 'Decorative',
  symbolic: 'Symbolic',
};

const TYPE_OPTIONS = [
  { value: 'iconographic', label: 'Iconographic' },
  { value: 'narrative', label: 'Narrative' },
  { value: 'thematic', label: 'Thematic' },
  { value: 'genre', label: 'Genre' },
  { value: 'decorative', label: 'Decorative' },
  { value: 'symbolic', label: 'Symbolic' },
];

export function SubjectLinker({
  organizationId,
  objectId,
  readOnly = false,
  embedded = false,
  onCountChange,
}: SubjectLinkerProps) {
  const { data: subjects, isLoading } = useQuery({
    queryKey: ['object-subjects', organizationId, objectId],
    queryFn: () => getObjectSubjects(organizationId, objectId),
    enabled: !!organizationId && !!objectId,
  });

  const items = subjects || [];

  const linker = (
    <RecordLinker<ObjectSubject, SubjectSearchItem>
      organizationId={organizationId}
      onCountChange={onCountChange}
      title="Subjects"
      addLabel="Add Subject"
      emptyMessage="No subjects linked yet."
      linkedItems={items}
      isLoading={isLoading}
      getItemId={(link) => link.link_id}
      getLinkedEntityId={(link) => link.subject_authority_id}
      renderItem={(link) => (
        <>
          <Tag size={16} className="text-archive" />
          <div className="min-w-0">
            <div className="text-sm font-medium text-ink truncate">
              {link.subject_authority?.preferred_term || 'Unknown'}
            </div>
            <div className="flex items-center gap-2 text-xs text-archive">
              {link.subject_authority?.subject_type && (
                <span>
                  {SUBJECT_TYPE_LABELS[link.subject_authority.subject_type] ||
                    link.subject_authority.subject_type}
                </span>
              )}
              {link.subject_extent && <span>&middot; {link.subject_extent}</span>}
            </div>
          </div>
        </>
      )}
      getItemHref={(link) =>
        `/organizations/${organizationId}/collections/subject-authorities/${link.subject_authority_id}`
      }
      isEditing={!readOnly}
      onLink={async (subject: SubjectSearchItem, metadata) => {
        let authorityId = subject.authority_id;

        // If this is an external result, create a SubjectAuthority first
        if (subject._external) {
          const ext = subject._external;
          const newSubject = await createSubjectAuthority(organizationId, {
            preferred_term: ext.label || subject.preferred_term,
            subject_type: 'thematic' as SubjectAuthority['subject_type'],
            aat_id: ext.source === 'AAT' ? subject.authority_id.replace('aat-', '') : undefined,
            iconclass_id: ext.source === 'Iconclass' ? subject.authority_id.replace('ic-', '') : undefined,
            wikidata_id: ext.source === 'Wikidata' ? subject.authority_id.replace('wd-', '') : undefined,
          });
          authorityId = newSubject.authority_id;
        }

        await linkObjectSubject(organizationId, objectId, {
          subject_authority_id: authorityId,
          subject_extent: metadata.subject_extent || undefined,
          interpretation_note: metadata.interpretation_note || undefined,
        });
      }}
      onUnlink={async (link) => {
        await unlinkObjectSubject(organizationId, objectId, link.link_id);
      }}
      metadataFields={[
        {
          key: 'subject_extent',
          label: 'Subject Extent',
          type: 'text',
          placeholder: 'e.g., predella panel, background',
          helpText: 'Where on the work this subject appears',
        },
        {
          key: 'interpretation_note',
          label: 'Interpretation Note',
          type: 'textarea',
          placeholder: 'Notes about the interpretation of this subject...',
        },
      ]}
      create={{
        label: 'Create New Subject',
        submitLabel: 'Create & Link',
        renderCreateFields: ({ searchTerm, formData, setFormData, metadata }) => (
          <div className="space-y-4">
            <div className="p-4 bg-stone/30 rounded-lg space-y-4">
              <h4 className="text-sm font-medium text-ink flex items-center gap-2">
                <Tag size={16} />
                New Subject
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
                  placeholder="e.g., Madonna and Child"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Type</label>
                <select
                  value={formData.subject_type || 'iconographic'}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, subject_type: e.target.value }))
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
            <div className="border-t border-lichen pt-4 space-y-4">
              <h4 className="text-sm font-medium text-ink">Link Details</h4>
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">
                  Subject Extent
                </label>
                <input
                  type="text"
                  value={formData.subject_extent ?? metadata.subject_extent ?? ''}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, subject_extent: e.target.value }))
                  }
                  className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                  placeholder="e.g., predella panel, background"
                />
                <p className="text-xs text-archive mt-1">
                  Where on the work this subject appears
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">
                  Interpretation Note
                </label>
                <textarea
                  value={
                    formData.interpretation_note ?? metadata.interpretation_note ?? ''
                  }
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      interpretation_note: e.target.value,
                    }))
                  }
                  rows={2}
                  className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark resize-none"
                  placeholder="Notes about the interpretation of this subject..."
                />
              </div>
            </div>
          </div>
        ),
        onCreateSubmit: async (formData, metadata) => {
          const newSubject = await createSubjectAuthority(organizationId, {
            preferred_term: (formData.term || '').trim(),
            subject_type: (formData.subject_type ||
              'iconographic') as SubjectAuthority['subject_type'],
          });
          await linkObjectSubject(organizationId, objectId, {
            subject_authority_id: newSubject.authority_id,
            subject_extent:
              formData.subject_extent || metadata.subject_extent || undefined,
            interpretation_note:
              formData.interpretation_note ||
              metadata.interpretation_note ||
              undefined,
          });
        },
        canSubmit: (formData) => !!formData.term?.trim(),
      }}
      search={{
        title: 'Link Subject',
        subtitle: 'Search for a subject to link to this object',
        placeholder: 'Search by term...',
        searchLabel: 'Search Subjects',
        queryKey: ['subject-authorities-search', organizationId],
        searchFn: async (term): Promise<SubjectSearchItem[]> => {
          // Search local and external in parallel
          const [localResult, externalResults] = await Promise.all([
            getSubjectAuthorities(organizationId, {
              search: term,
              status: 'active',
              limit: 20,
            }),
            searchSubjectsExternal(organizationId, term, 10),
          ]);

          const localItems: SubjectSearchItem[] = (localResult.items || []).map((sa) => ({
            authority_id: sa.authority_id,
            preferred_term: sa.preferred_term,
            subject_type: sa.subject_type,
            aat_id: sa.aat_id,
            iconclass_id: sa.iconclass_id,
            wikidata_id: sa.wikidata_id,
            description: sa.description,
            status: sa.status,
          }));

          const externalItems: SubjectSearchItem[] = externalResults.map((s) => ({
            authority_id: s.id,
            preferred_term: s.label,
            subject_type: 'thematic',
            description: s.description,
            _external: s.reference ? {
              source: s.reference.source,
              uri: s.reference.uri,
              label: s.reference.label || s.label,
            } : {
              source: s.source,
              uri: '',
              label: s.label,
            },
          }));

          // Deduplicate: skip external items where a local item with the same external ID exists
          const localExternalIds = new Set<string>();
          localItems.forEach((item) => {
            if (item.aat_id) localExternalIds.add(`aat-${item.aat_id}`);
            if (item.iconclass_id) localExternalIds.add(`ic-${item.iconclass_id}`);
            if (item.wikidata_id) localExternalIds.add(`wd-${item.wikidata_id}`);
          });

          const dedupedExternal = externalItems.filter(
            (item) => !localExternalIds.has(item.authority_id)
          );

          return [...localItems, ...dedupedExternal];
        },
        getSearchItemId: (subject) => subject.authority_id,
        getSearchItemLabel: (subject) => subject.preferred_term,
        renderSearchItem: (subject) => (
          <>
            {subject._external ? (
              <Globe size={16} className="text-bark flex-shrink-0" />
            ) : (
              <Tag size={16} className="text-archive flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm text-ink font-medium truncate">{subject.preferred_term}</p>
                {subject._external && (
                  <span className="flex-shrink-0 text-xs text-archive bg-stone px-1.5 py-0.5 rounded">
                    {subject._external.source}
                  </span>
                )}
              </div>
              <p className="text-xs text-archive truncate">
                {subject._external
                  ? subject.description || subject._external.source
                  : SUBJECT_TYPE_LABELS[subject.subject_type] || subject.subject_type}
              </p>
            </div>
          </>
        ),
      }}
      invalidateKeys={[['object-subjects', organizationId, objectId], ['collection-object', organizationId, objectId]]}
      submitLabel="Link Subject"
    />
  );

  if (embedded) return linker;

  return (
    <div className="card">
      <div className="p-4">{linker}</div>
    </div>
  );
}

export default SubjectLinker;
