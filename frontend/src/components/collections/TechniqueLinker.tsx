import { useQuery } from '@tanstack/react-query';
import { Wrench, CheckCircle } from 'lucide-react';
import {
  getObjectTechniques,
  linkObjectTechnique,
  unlinkObjectTechnique,
  searchVocabulary,
  cacheVocabularyTerm,
} from '../../lib/api';
import type { VocabularyTerm } from '../../lib/schemas';
import { RecordLinker } from '../records';

interface TechniqueLinkerProps {
  organizationId: string;
  objectId: string;
  isEditing?: boolean;
  onCountChange?: (count: number) => void;
}

/**
 * Component to link techniques (AAT vocabulary terms) to a collection object.
 */
export function TechniqueLinker({
  organizationId,
  objectId,
  isEditing = false,
  onCountChange,
}: TechniqueLinkerProps) {
  const { data: linkedTechniques, isLoading } = useQuery({
    queryKey: ['object-techniques', organizationId, objectId],
    queryFn: () => getObjectTechniques(organizationId, objectId),
  });

  const techniques = linkedTechniques || [];

  return (
    <RecordLinker
      organizationId={organizationId}
      onCountChange={onCountChange}
      title="Techniques"
      addLabel="Add Technique"
      emptyMessage="No techniques linked to this object."
      linkedItems={techniques}
      isLoading={isLoading}
      getItemId={(link) => link.link_id}
      getLinkedEntityId={(link) => link.vocabulary_term_id}
      renderItem={(link) => (
        <>
          <Wrench size={16} className="text-archive" />
          <div>
            <div className="text-sm font-medium text-ink">
              {link.vocabulary_term?.preferred_term || 'Unknown Technique'}
            </div>
            <div className="text-xs text-archive">
              {link.part && <span className="mr-2">Part: {link.part}</span>}
              {link.vocabulary_term?.external_id && (
                <a
                  href={`http://vocab.getty.edu/aat/${link.vocabulary_term.external_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-bark hover:text-copper-dark"
                  onClick={(e) => e.stopPropagation()}
                >
                  AAT
                </a>
              )}
            </div>
          </div>
        </>
      )}
      isEditing={isEditing}
      onLink={async (term: VocabularyTerm, metadata) => {
        let termId = term.term_id;
        // Cache remote Getty terms first
        if (!termId && term.external_id) {
          const cached = await cacheVocabularyTerm(organizationId, {
            vocabulary: term.vocabulary,
            external_id: term.external_id,
            external_uri: term.external_uri || undefined,
            preferred_term: term.preferred_term,
            scope_note: term.scope_note || undefined,
            broader_term: term.broader_term || undefined,
            hierarchy_path: term.hierarchy_path || undefined,
            applicable_fields: ['techniques'],
          });
          termId = cached.term_id;
        }
        if (!termId) throw new Error('Unable to cache vocabulary term');
        await linkObjectTechnique(organizationId, objectId, {
          vocabulary_term_id: termId,
          part: metadata.part || undefined,
        });
      }}
      onUnlink={async (link) => {
        await unlinkObjectTechnique(organizationId, objectId, link.link_id);
      }}
      metadataFields={[
        {
          key: 'part',
          label: 'Part',
          type: 'text',
          placeholder: 'e.g., overall, decoration, frame',
          helpText: 'Specify which part of the object this technique applies to.',
        },
      ]}
      remoteCache={{
        isRemote: (term) => !term.term_id && !!term.external_id,
        remoteLabel: 'AAT',
        importButtonLabel: 'Import & Add',
        selectedRemoteText: 'Will import from Getty AAT:',
      }}
      search={{
        title: 'Add Technique',
        subtitle: 'Search Getty AAT for techniques',
        placeholder: 'Type to search techniques (e.g., impasto, etching)...',
        searchLabel: 'Search Getty AAT',
        queryKey: ['vocabulary-search', organizationId, 'aat', 'techniques'],
        searchFn: async (term) => {
          const result = await searchVocabulary(organizationId, {
            vocabulary_type: 'aat',
            query: term,
            limit: 20,
            facet: 'techniques',
          });
          return result.terms || [];
        },
        getSearchItemId: (term) =>
          term.term_id || term.external_id || term.preferred_term,
        getSearchItemLabel: (term) => term.preferred_term,
        filterLinked: (items, linkedIds) =>
          items.filter((t) => !t.term_id || !linkedIds.has(t.term_id)),
        renderSearchItem: (term) => (
          <>
            <Wrench size={16} className="text-archive flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm text-ink font-medium truncate">
                  {term.preferred_term}
                </p>
                {term.vocabulary === 'local' && (
                  <span className="flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium bg-stone text-archive rounded">
                    Custom
                  </span>
                )}
              </div>
              <p className="text-xs text-archive truncate">
                {term.hierarchy_path || term.scope_note || 'No details'}
              </p>
            </div>
            {term.external_id && (
              <CheckCircle size={12} className="text-forest flex-shrink-0" />
            )}
          </>
        ),
      }}
      invalidateKeys={[['object-techniques', organizationId, objectId], ['collection-object', organizationId, objectId]]}
      submitLabel="Add Technique"
    />
  );
}

export default TechniqueLinker;
