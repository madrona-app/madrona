import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Plus,
  GitBranch,
  Edit2,
  Trash2,
  X,
  Loader2,
  AlertCircle,
  MoreVertical,
  Package,
  ExternalLink,
  ArrowRight,
  ArrowLeft,
  Search,
} from 'lucide-react';
import {
  getObjectRelationships,
  createObjectRelationship,
  updateObjectRelationship,
  deleteObjectRelationship,
  getCollectionObjects,
  searchWikidataArtworks,
} from '../../lib/api';
import type { WikidataArtworkResult } from '../../lib/api/authorities';
import type { ObjectRelationship, CollectionObjectListItem } from '../../lib/schemas';
import SlideOver from '../ui/SlideOver';
import { ModalPortal } from '../ModalPortal';

interface ObjectRelationshipsManagerProps {
  organizationId: string;
  objectId: string;
  readOnly?: boolean;
  embedded?: boolean;
  onCountChange?: (count: number) => void;
}

const RELATIONSHIP_TYPES = [
  { value: 'study_for', label: 'Study For' },
  { value: 'copy_of', label: 'Copy Of' },
  { value: 'part_of', label: 'Part Of' },
  { value: 'pendant_of', label: 'Pendant Of' },
  { value: 'version_of', label: 'Version Of' },
  { value: 'derived_from', label: 'Derived From' },
  { value: 'model_for', label: 'Model For' },
  { value: 'preparatory_for', label: 'Preparatory For' },
  { value: 'related_to', label: 'Related To' },
  { value: 'after', label: 'After' },
  { value: 'based_on', label: 'Based On' },
  { value: 'replica_of', label: 'Replica Of' },
  { value: 'depicts', label: 'Depicts' },
  { value: 'depicted_in', label: 'Depicted In' },
];

const TYPE_LABELS: Record<string, string> = Object.fromEntries(
  RELATIONSHIP_TYPES.map(t => [t.value, t.label])
);

export function ObjectRelationshipsManager({
  organizationId,
  objectId,
  readOnly = false,
  embedded = false,
  onCountChange,
}: ObjectRelationshipsManagerProps) {
  const queryClient = useQueryClient();
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingRelationship, setEditingRelationship] = useState<ObjectRelationship | null>(null);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);

  const {
    data: relationshipsData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['object-relationships', organizationId, objectId],
    queryFn: () => getObjectRelationships(organizationId, objectId),
    enabled: !!organizationId && !!objectId,
  });

  const deleteMutation = useMutation({
    mutationFn: (relationshipId: string) => deleteObjectRelationship(organizationId, relationshipId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['object-relationships', organizationId, objectId] });
      queryClient.invalidateQueries({ queryKey: ['collection-object', organizationId, objectId] });
    },
  });

  const totalRelationships = (relationshipsData?.outgoing?.length || 0) + (relationshipsData?.incoming?.length || 0);
  useEffect(() => { onCountChange?.(totalRelationships); }, [totalRelationships, onCountChange]);

  const [deleteTarget, setDeleteTarget] = useState<ObjectRelationship | null>(null);

  const handleDelete = (relationship: ObjectRelationship) => {
    setDeleteTarget(relationship);
    setActiveMenu(null);
  };

  const confirmDelete = () => {
    if (deleteTarget) {
      deleteMutation.mutate(deleteTarget.relationship_id);
      setDeleteTarget(null);
    }
  };

  if (isLoading) {
    if (embedded) {
      return (
        <div className="flex items-center justify-center py-4">
          <Loader2 size={24} className="animate-spin text-archive" />
        </div>
      );
    }
    return (
      <div className="card">
        <div className="p-4 border-b border-lichen flex items-center justify-between">
          <h3 className="font-serif font-medium text-forest">Related Works</h3>
        </div>
        <div className="p-6 flex items-center justify-center">
          <Loader2 size={24} className="animate-spin text-archive" />
        </div>
      </div>
    );
  }

  if (error) {
    if (embedded) {
      return (
        <div className="flex items-center gap-2 text-sm text-archive">
          <AlertCircle size={16} />
          <span>Failed to load relationships</span>
        </div>
      );
    }
    return (
      <div className="card">
        <div className="p-4 border-b border-lichen">
          <h3 className="font-serif font-medium text-forest">Related Works</h3>
        </div>
        <div className="p-6">
          <div className="flex items-center gap-2 text-sm text-archive">
            <AlertCircle size={16} />
            <span>Failed to load relationships</span>
          </div>
        </div>
      </div>
    );
  }

  const outgoing = relationshipsData?.outgoing || [];
  const incoming = relationshipsData?.incoming || [];

  const content = (
    <>
      {totalRelationships === 0 ? (
        <div className="text-center py-6">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-stone/50 flex items-center justify-center">
            <GitBranch size={24} className="text-archive/50" />
          </div>
          <p className="text-sm text-archive mb-3">No related works documented yet</p>
          {!readOnly && (
            <button
              onClick={() => setShowAddModal(true)}
              className="text-sm text-bark hover:text-copper-dark flex items-center gap-1.5 mx-auto"
            >
              <Plus size={14} />
              Add first relationship
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Outgoing Relationships */}
          {outgoing.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-archive uppercase tracking-wide mb-2 flex items-center gap-1">
                <ArrowRight size={12} />
                Related To
              </h4>
              <div className="space-y-2">
                {outgoing.map((rel) => (
                  <RelationshipItem
                    key={rel.relationship_id}
                    relationship={rel}
                    organizationId={organizationId}
                    direction="outgoing"
                    onEdit={() => setEditingRelationship(rel)}
                    onDelete={() => handleDelete(rel)}
                    activeMenu={activeMenu}
                    setActiveMenu={setActiveMenu}
                    readOnly={readOnly}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Incoming Relationships */}
          {incoming.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-archive uppercase tracking-wide mb-2 flex items-center gap-1">
                <ArrowLeft size={12} />
                Related From
              </h4>
              <div className="space-y-2">
                {incoming.map((rel) => (
                  <RelationshipItem
                    key={rel.relationship_id}
                    relationship={rel}
                    organizationId={organizationId}
                    direction="incoming"
                    onEdit={() => setEditingRelationship(rel)}
                    onDelete={() => handleDelete(rel)}
                    activeMenu={activeMenu}
                    setActiveMenu={setActiveMenu}
                    readOnly={readOnly}
                  />
                ))}
              </div>
            </div>
          )}

          {!readOnly && (
            <button
              onClick={() => setShowAddModal(true)}
              className="text-sm text-bark hover:text-copper-dark flex items-center gap-1.5 mt-3"
            >
              <Plus size={14} />
              Add relationship
            </button>
          )}
        </div>
      )}

      {/* Add Relationship SlideOver */}
      <AddRelationshipSlideOver
        isOpen={showAddModal}
        organizationId={organizationId}
        objectId={objectId}
        onClose={() => setShowAddModal(false)}
        onSuccess={() => {
          setShowAddModal(false);
          queryClient.invalidateQueries({ queryKey: ['object-relationships', organizationId, objectId] });
      queryClient.invalidateQueries({ queryKey: ['collection-object', organizationId, objectId] });
        }}
      />

      {/* Delete Confirmation */}
      {deleteTarget && (
        <ModalPortal>
        <div className="fixed inset-0 bg-ink/50 flex items-center justify-center z-50">
          <div className="bg-parchment rounded-institutional shadow-lg max-w-sm w-full mx-4 p-5">
            <h3 className="font-serif font-medium text-forest mb-2">Remove Relationship</h3>
            <p className="text-sm text-ink mb-4">
              Remove the relationship with{' '}
              <span className="font-medium">
                {deleteTarget.related_object_id ? 'the related object' : deleteTarget.external_work_title}
              </span>?
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteTarget(null)} className="btn btn-secondary">
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleteMutation.isPending}
                className="btn btn-danger"
              >
                {deleteMutation.isPending ? (
                  <><Loader2 size={16} className="animate-spin mr-2" />Removing...</>
                ) : 'Remove'}
              </button>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {/* Edit Modal */}
      {editingRelationship && (
        <EditRelationshipModal
          organizationId={organizationId}
          relationship={editingRelationship}
          onClose={() => setEditingRelationship(null)}
          onSuccess={() => {
            setEditingRelationship(null);
            queryClient.invalidateQueries({ queryKey: ['object-relationships', organizationId, objectId] });
      queryClient.invalidateQueries({ queryKey: ['collection-object', organizationId, objectId] });
          }}
        />
      )}
    </>
  );

  if (embedded) {
    return content;
  }

  return (
    <div className="card">
      <div className="p-4 border-b border-lichen flex items-center justify-between">
        <h3 className="font-serif font-medium text-forest flex items-center gap-2">
          <GitBranch size={18} />
          Related Works
        </h3>
        {!readOnly && (
          <button
            onClick={() => setShowAddModal(true)}
            className="btn btn-tertiary text-sm flex items-center gap-1"
          >
            <Plus size={14} />
            Add Relationship
          </button>
        )}
      </div>
      <div className="p-4">
        {content}
      </div>
    </div>
  );
}

// Relationship Item Component
interface RelationshipItemProps {
  relationship: ObjectRelationship;
  organizationId: string;
  direction: 'outgoing' | 'incoming';
  onEdit: () => void;
  onDelete: () => void;
  activeMenu: string | null;
  setActiveMenu: (id: string | null) => void;
  readOnly?: boolean;
}

function RelationshipItem({
  relationship,
  organizationId,
  direction,
  onEdit,
  onDelete,
  activeMenu,
  setActiveMenu,
  readOnly,
}: RelationshipItemProps) {
  const isExternal = !relationship.related_object_id;
  const isActive = activeMenu === relationship.relationship_id;

  return (
    <div className="flex items-center justify-between p-2 rounded-lg hover:bg-stone/30 group">
      <div className="flex items-center gap-3 min-w-0">
        <span className="badge text-xs shrink-0">
          {TYPE_LABELS[relationship.relationship_type] || relationship.relationship_type}
        </span>

        {isExternal ? (
          <div className="flex items-center gap-2.5 min-w-0">
            {relationship.external_work_thumbnail_url ? (
              <img
                src={relationship.external_work_thumbnail_url}
                alt=""
                className="w-9 h-9 rounded object-cover flex-shrink-0 bg-stone"
              />
            ) : (
              <ExternalLink size={14} className="text-archive shrink-0" />
            )}
            <div className="min-w-0">
              {relationship.external_work_identifier ? (
                <a
                  href={`https://www.wikidata.org/wiki/${relationship.external_work_identifier}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-bark hover:text-copper-dark truncate block"
                >
                  {relationship.external_work_title}
                </a>
              ) : (
                <div className="text-sm text-ink font-medium truncate">{relationship.external_work_title}</div>
              )}
              <div className="text-xs text-archive">
                {[relationship.external_work_creator, relationship.external_work_date, relationship.external_work_location]
                  .filter(Boolean)
                  .join(' • ')}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 min-w-0">
            {relationship.related_object_summary?.thumbnail_url ? (
              <img
                src={relationship.related_object_summary.thumbnail_url}
                alt=""
                className="w-9 h-9 rounded object-cover flex-shrink-0 bg-stone"
              />
            ) : (
              <Package size={14} className="text-archive shrink-0" />
            )}
            <div className="min-w-0">
              <Link
                to={`/organizations/${organizationId}/collections/objects/${direction === 'outgoing' ? relationship.related_object_id : relationship.source_object_id}`}
                className="text-sm font-medium text-bark hover:text-copper-dark truncate block"
              >
                {relationship.related_object_summary?.title || relationship.related_object_summary?.object_number || 'Untitled'}
              </Link>
              <div className="text-xs text-archive">
                {[relationship.related_object_summary?.object_number, relationship.related_object_summary?.object_type, relationship.related_object_summary?.creation_date]
                  .filter(Boolean)
                  .join(' • ')}
              </div>
            </div>
          </div>
        )}

        {relationship.sequence_number && (
          <span className="text-xs text-archive bg-stone/50 px-1.5 py-0.5 rounded">
            #{relationship.sequence_number}
          </span>
        )}
      </div>

      {!readOnly && (
        <div className="relative">
          <button
            onClick={() => setActiveMenu(isActive ? null : relationship.relationship_id)}
            className="p-1 text-archive hover:text-ink opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <MoreVertical size={16} />
          </button>

          {isActive && (
            <div className="absolute right-0 top-full mt-1 bg-parchment border border-lichen rounded-institutional shadow-lg z-50 py-1 min-w-[120px]">
              <button
                onClick={() => {
                  onEdit();
                  setActiveMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-stone/50 flex items-center gap-2"
              >
                <Edit2 size={14} />
                Edit
              </button>
              <button
                onClick={() => {
                  onDelete();
                  setActiveMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-stone/50 text-semantic-error flex items-center gap-2"
              >
                <Trash2 size={14} />
                Delete
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Add Relationship SlideOver
interface AddRelationshipSlideOverProps {
  isOpen: boolean;
  organizationId: string;
  objectId: string;
  onClose: () => void;
  onSuccess: () => void;
}

function AddRelationshipSlideOver({ isOpen, organizationId, objectId, onClose, onSuccess }: AddRelationshipSlideOverProps) {
  const [isExternal, setIsExternal] = useState(false);
  const [relatedObjectId, setRelatedObjectId] = useState<string>('');
  const [relationshipType, setRelationshipType] = useState<string>('related_to');
  const [externalTitle, setExternalTitle] = useState('');
  const [externalCreator, setExternalCreator] = useState('');
  const [externalDate, setExternalDate] = useState('');
  const [externalLocation, setExternalLocation] = useState('');
  const [externalIdentifier, setExternalIdentifier] = useState('');
  const [sequenceNumber, setSequenceNumber] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [wikidataQuery, setWikidataQuery] = useState('');
  const [debouncedWikidataQuery, setDebouncedWikidataQuery] = useState('');
  const [externalThumbnailUrl, setExternalThumbnailUrl] = useState('');

  // Reset form when slide-over opens
  React.useEffect(() => {
    if (isOpen) {
      setIsExternal(false);
      setRelatedObjectId('');
      setRelationshipType('related_to');
      setExternalTitle('');
      setExternalCreator('');
      setExternalDate('');
      setExternalLocation('');
      setExternalIdentifier('');
      setExternalThumbnailUrl('');
      setSequenceNumber('');
      setNotes('');
      setError(null);
      setSearchQuery('');
      setWikidataQuery('');
      setDebouncedWikidataQuery('');
    }
  }, [isOpen]);

  // Debounce Wikidata search
  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedWikidataQuery(wikidataQuery), 300);
    return () => clearTimeout(timer);
  }, [wikidataQuery]);

  const { data: wikidataResults, isLoading: loadingWikidata } = useQuery({
    queryKey: ['wikidata-artwork-search', organizationId, debouncedWikidataQuery],
    queryFn: () => searchWikidataArtworks(organizationId, debouncedWikidataQuery),
    enabled: isExternal && debouncedWikidataQuery.length >= 2,
  });

  const handleSelectWikidata = (result: WikidataArtworkResult) => {
    setExternalTitle(result.title);
    setExternalCreator(result.creator || '');
    setExternalDate(result.date || '');
    setExternalLocation(result.location || '');
    setExternalIdentifier(result.qid);
    setExternalThumbnailUrl(result.thumbnail_url || '');
    setWikidataQuery('');
    setDebouncedWikidataQuery('');
  };

  const { data: objectsData, isLoading: loadingObjects } = useQuery({
    queryKey: ['objects-search', organizationId, searchQuery],
    queryFn: () => getCollectionObjects(organizationId, { limit: 20 }),
    enabled: !isExternal && searchQuery.length > 1,
  });

  const createMutation = useMutation({
    mutationFn: () => createObjectRelationship(organizationId, objectId, {
      relationship_type: relationshipType,
      related_object_id: isExternal ? undefined : relatedObjectId,
      external_work_title: isExternal ? externalTitle : undefined,
      external_work_creator: isExternal ? externalCreator : undefined,
      external_work_date: isExternal ? externalDate : undefined,
      external_work_location: isExternal ? externalLocation : undefined,
      external_work_identifier: isExternal && externalIdentifier ? externalIdentifier : undefined,
      external_work_thumbnail_url: isExternal && externalThumbnailUrl ? externalThumbnailUrl : undefined,
      sequence_number: sequenceNumber ? parseInt(sequenceNumber) : undefined,
      notes: notes || undefined,
    }),
    onSuccess,
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleSubmit = () => {
    setError(null);

    if (!isExternal && !relatedObjectId) {
      setError('Please select a related object');
      return;
    }
    if (isExternal && !externalTitle.trim()) {
      setError('Please enter the external work title');
      return;
    }

    createMutation.mutate();
  };

  // Filter out current object
  const filteredObjects = objectsData?.items?.filter((o: CollectionObjectListItem) =>
    o.object_id !== objectId &&
    (o.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
     o.object_number?.toLowerCase().includes(searchQuery.toLowerCase()))
  ) || [];

  return (
    <SlideOver
      isOpen={isOpen}
      onClose={onClose}
      title="Add Relationship"
      subtitle="Link this object to other works"
      width="md"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={createMutation.isPending}
            className="btn btn-primary"
          >
            {createMutation.isPending ? (
              <>
                <Loader2 size={16} className="animate-spin mr-2" />
                Adding...
              </>
            ) : (
              'Add Relationship'
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {error && (
          <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-institutional text-sm text-semantic-error">
            {error}
          </div>
        )}

        {/* Type Toggle */}
        <div className="flex gap-2 p-1 bg-stone/50 rounded-institutional">
          <button
            type="button"
            onClick={() => setIsExternal(false)}
            className={`flex-1 py-2 px-4 text-sm rounded-institutional transition-colors ${
              !isExternal ? 'bg-parchment shadow text-ink' : 'text-archive'
            }`}
          >
            Collection Object
          </button>
          <button
            type="button"
            onClick={() => setIsExternal(true)}
            className={`flex-1 py-2 px-4 text-sm rounded-institutional transition-colors ${
              isExternal ? 'bg-parchment shadow text-ink' : 'text-archive'
            }`}
          >
            External Work
          </button>
        </div>

        {/* Relationship Type */}
        <div>
          <label className="block text-sm font-medium text-ink mb-1.5">
            Relationship Type <span className="text-semantic-error">*</span>
          </label>
          <select
            value={relationshipType}
            onChange={(e) => setRelationshipType(e.target.value)}
            className="input w-full"
          >
            {RELATIONSHIP_TYPES.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Internal Object Selection */}
        {!isExternal && (
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">
              Search Objects <span className="text-semantic-error">*</span>
            </label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by title or number..."
              className="input w-full mb-2"
            />
            <div className="max-h-48 overflow-y-auto border border-lichen rounded-institutional">
              {loadingObjects ? (
                <div className="p-4 text-center text-archive">
                  <Loader2 size={16} className="inline animate-spin mr-2" />
                  Searching...
                </div>
              ) : searchQuery.length <= 1 ? (
                <div className="p-4 text-center text-archive text-sm">Type to search...</div>
              ) : filteredObjects.length === 0 ? (
                <div className="p-4 text-center text-archive text-sm">No objects found</div>
              ) : (
                filteredObjects.map((obj: CollectionObjectListItem) => (
                  <button
                    key={obj.object_id}
                    type="button"
                    onClick={() => setRelatedObjectId(obj.object_id)}
                    className={`w-full text-left px-3 py-2.5 hover:bg-stone/50 border-b border-lichen last:border-b-0 ${
                      relatedObjectId === obj.object_id ? 'bg-bark/10 border-l-2 border-l-bark' : ''
                    }`}
                  >
                    <p className="text-sm text-ink font-medium">{obj.title || obj.object_name || 'Untitled'}</p>
                    <p className="text-xs text-archive">{obj.object_number}</p>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* External Work Fields */}
        {isExternal && (
          <>
            {/* Wikidata Search */}
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">
                Search Wikidata
              </label>
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-archive" />
                <input
                  type="text"
                  value={wikidataQuery}
                  onChange={(e) => setWikidataQuery(e.target.value)}
                  className="input w-full pl-9"
                  placeholder="Search for artworks..."
                />
                {loadingWikidata && (
                  <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-archive animate-spin" />
                )}
              </div>
              {debouncedWikidataQuery.length >= 2 && wikidataResults?.results && wikidataResults.results.length > 0 && (
                <div className="mt-1.5 max-h-48 overflow-y-auto border border-lichen rounded-institutional">
                  {wikidataResults.results.map((result) => (
                    <button
                      key={result.qid}
                      type="button"
                      onClick={() => handleSelectWikidata(result)}
                      className="w-full text-left px-3 py-2.5 hover:bg-stone/50 border-b border-lichen last:border-b-0 flex items-center gap-3"
                    >
                      {result.thumbnail_url ? (
                        <img
                          src={result.thumbnail_url}
                          alt=""
                          className="w-10 h-10 rounded object-cover flex-shrink-0 bg-stone"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded bg-stone/50 flex items-center justify-center flex-shrink-0">
                          <Package size={16} className="text-archive" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-sm text-ink font-medium truncate">{result.title}</p>
                        <p className="text-xs text-archive truncate">
                          {[result.creator, result.date, result.location].filter(Boolean).join(' · ') || result.description}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {debouncedWikidataQuery.length >= 2 && !loadingWikidata && wikidataResults?.results?.length === 0 && (
                <p className="mt-1.5 text-xs text-archive italic">No results found</p>
              )}
            </div>

            {externalIdentifier && (
              <div className="flex items-center gap-3 px-3 py-2.5 bg-semantic-info/10 border border-semantic-info/30 rounded-institutional">
                {externalThumbnailUrl ? (
                  <img src={externalThumbnailUrl} alt="" className="w-12 h-12 rounded object-cover flex-shrink-0 bg-stone" />
                ) : (
                  <div className="w-12 h-12 rounded bg-stone/50 flex items-center justify-center flex-shrink-0">
                    <Package size={18} className="text-archive" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink truncate">{externalTitle}</p>
                  <p className="text-xs text-archive truncate">
                    {[externalCreator, externalDate, externalLocation].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <a
                  href={`https://www.wikidata.org/wiki/${externalIdentifier}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-bark hover:text-copper-dark flex-shrink-0"
                  title="View on Wikidata"
                >
                  <ExternalLink size={16} />
                </a>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">
                Title <span className="text-semantic-error">*</span>
              </label>
              <input
                type="text"
                value={externalTitle}
                onChange={(e) => setExternalTitle(e.target.value)}
                className="input w-full"
                placeholder="Title of the external work..."
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">Creator</label>
                <input
                  type="text"
                  value={externalCreator}
                  onChange={(e) => setExternalCreator(e.target.value)}
                  className="input w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">Date</label>
                <input
                  type="text"
                  value={externalDate}
                  onChange={(e) => setExternalDate(e.target.value)}
                  className="input w-full"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Location</label>
              <input
                type="text"
                value={externalLocation}
                onChange={(e) => setExternalLocation(e.target.value)}
                className="input w-full"
                placeholder="e.g., Louvre, Paris"
              />
            </div>
          </>
        )}

        {/* Sequence Number */}
        <div>
          <label className="block text-sm font-medium text-ink mb-1.5">
            Sequence Number
          </label>
          <input
            type="number"
            value={sequenceNumber}
            onChange={(e) => setSequenceNumber(e.target.value)}
            className="input w-40"
            placeholder="For multi-part works"
          />
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-ink mb-1.5">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="input w-full"
            placeholder="Additional notes about this relationship..."
          />
        </div>
      </div>
    </SlideOver>
  );
}

// Edit Relationship Modal
interface EditRelationshipModalProps {
  organizationId: string;
  relationship: ObjectRelationship;
  onClose: () => void;
  onSuccess: () => void;
}

function EditRelationshipModal({ organizationId, relationship, onClose, onSuccess }: EditRelationshipModalProps) {
  const [relationshipType, setRelationshipType] = useState(relationship.relationship_type);
  const [externalTitle, setExternalTitle] = useState(relationship.external_work_title || '');
  const [externalCreator, setExternalCreator] = useState(relationship.external_work_creator || '');
  const [externalDate, setExternalDate] = useState(relationship.external_work_date || '');
  const [externalLocation, setExternalLocation] = useState(relationship.external_work_location || '');
  const [sequenceNumber, setSequenceNumber] = useState(relationship.sequence_number?.toString() || '');
  const [notes, setNotes] = useState(relationship.notes || '');
  const [error, setError] = useState<string | null>(null);

  const isExternal = !relationship.related_object_id;

  const updateMutation = useMutation({
    mutationFn: () => updateObjectRelationship(organizationId, relationship.relationship_id, {
      relationship_type: relationshipType,
      external_work_title: isExternal ? externalTitle : undefined,
      external_work_creator: isExternal ? externalCreator : undefined,
      external_work_date: isExternal ? externalDate : undefined,
      external_work_location: isExternal ? externalLocation : undefined,
      sequence_number: sequenceNumber ? parseInt(sequenceNumber) : undefined,
      notes: notes || undefined,
    }),
    onSuccess,
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    updateMutation.mutate();
  };

  return (
    <ModalPortal>
    <div className="fixed inset-0 bg-ink/50 flex items-center justify-center z-50">
      <div className="bg-parchment rounded-institutional shadow-lg max-w-lg w-full mx-4">
        <div className="p-4 border-b border-lichen flex items-center justify-between">
          <h3 className="font-serif font-medium text-forest">Edit Relationship</h3>
          <button onClick={onClose} className="text-archive hover:text-ink">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-institutional text-sm text-semantic-error">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Relationship Type</label>
            <select
              value={relationshipType}
              onChange={(e) => setRelationshipType(e.target.value)}
              className="input w-full"
            >
              {RELATIONSHIP_TYPES.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Related work summary card */}
          {!isExternal && relationship.related_object_summary && (
            <div className="flex items-center gap-3 px-3 py-2.5 bg-stone/30 border border-lichen rounded-institutional">
              {relationship.related_object_summary.thumbnail_url ? (
                <img src={relationship.related_object_summary.thumbnail_url} alt="" className="w-12 h-12 rounded object-cover flex-shrink-0 bg-stone" />
              ) : (
                <div className="w-12 h-12 rounded bg-stone/50 flex items-center justify-center flex-shrink-0">
                  <Package size={18} className="text-archive" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink truncate">{relationship.related_object_summary.title || 'Untitled'}</p>
                <p className="text-xs text-archive truncate">
                  {[relationship.related_object_summary.object_number, relationship.related_object_summary.object_type, relationship.related_object_summary.creation_date].filter(Boolean).join(' · ')}
                </p>
              </div>
            </div>
          )}

          {isExternal && (
            <>
              {relationship.external_work_identifier && (
                <div className="flex items-center gap-3 px-3 py-2.5 bg-semantic-info/10 border border-semantic-info/30 rounded-institutional">
                  {relationship.external_work_thumbnail_url ? (
                    <img src={relationship.external_work_thumbnail_url} alt="" className="w-12 h-12 rounded object-cover flex-shrink-0 bg-stone" />
                  ) : (
                    <div className="w-12 h-12 rounded bg-stone/50 flex items-center justify-center flex-shrink-0">
                      <Package size={18} className="text-archive" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink truncate">{relationship.external_work_title}</p>
                    <p className="text-xs text-archive truncate">
                      {[relationship.external_work_creator, relationship.external_work_date, relationship.external_work_location].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <a
                    href={`https://www.wikidata.org/wiki/${relationship.external_work_identifier}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-bark hover:text-copper-dark flex-shrink-0"
                    title="View on Wikidata"
                  >
                    <ExternalLink size={16} />
                  </a>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">Title</label>
                <input
                  type="text"
                  value={externalTitle}
                  onChange={(e) => setExternalTitle(e.target.value)}
                  className="input w-full"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-ink mb-1.5">Creator</label>
                  <input
                    type="text"
                    value={externalCreator}
                    onChange={(e) => setExternalCreator(e.target.value)}
                    className="input w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink mb-1.5">Date</label>
                  <input
                    type="text"
                    value={externalDate}
                    onChange={(e) => setExternalDate(e.target.value)}
                    className="input w-full"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">Location</label>
                <input
                  type="text"
                  value={externalLocation}
                  onChange={(e) => setExternalLocation(e.target.value)}
                  className="input w-full"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Sequence Number</label>
            <input
              type="number"
              value={sequenceNumber}
              onChange={(e) => setSequenceNumber(e.target.value)}
              className="input w-40"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input w-full" />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
            <button type="submit" disabled={updateMutation.isPending} className="btn btn-primary">
              {updateMutation.isPending ? (
                <>
                  <Loader2 size={16} className="animate-spin mr-2" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
    </ModalPortal>
  );
}

export default ObjectRelationshipsManager;
