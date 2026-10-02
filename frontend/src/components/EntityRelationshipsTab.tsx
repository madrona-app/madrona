import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { GitBranch, ArrowRight, ArrowLeft, Plus, Trash2, X, Search, List, Network } from 'lucide-react';
import {
  getEntityRelationships,
  createEntityRelationship,
  deleteEntityRelationship,
  getRelationshipTypes,
  searchEntities,
} from '../lib/api';
import type { EntityRelationship } from '../lib/api';
import { RelationshipGraph } from './RelationshipGraph';
import { logger } from '../lib/logger';

interface EntityRelationshipsTabProps {
  entityKey: string;
  organizationId: string;
}

export function EntityRelationshipsTab({ entityKey, organizationId }: EntityRelationshipsTabProps) {
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState<'list' | 'graph'>('list');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newRelType, setNewRelType] = useState('');
  const [newTargetKey, setNewTargetKey] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ entity_key: string; payload?: { label?: string } }>>([]);
  const [searching, setSearching] = useState(false);

  // Fetch relationships
  const { data, isLoading, error } = useQuery({
    queryKey: ['entityRelationships', entityKey, organizationId],
    queryFn: () => getEntityRelationships(entityKey, organizationId, { direction: 'all' }),
    enabled: !!entityKey && !!organizationId,
  });

  // Fetch relationship types for the dropdown
  const { data: typesData } = useQuery({
    queryKey: ['relationshipTypes', organizationId],
    queryFn: () => getRelationshipTypes(organizationId),
    enabled: !!organizationId,
  });

  // Create relationship mutation
  const createMutation = useMutation({
    mutationFn: (params: { targetEntityKey: string; relationshipType: string }) =>
      createEntityRelationship({
        source_entity_key: entityKey,
        target_entity_key: params.targetEntityKey,
        relationship_type: params.relationshipType,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entityRelationships', entityKey] });
      setShowAddForm(false);
      setNewRelType('');
      setNewTargetKey('');
      setSearchQuery('');
      setSearchResults([]);
    },
  });

  // Delete relationship mutation
  const deleteMutation = useMutation({
    mutationFn: (relationshipId: string) => deleteEntityRelationship(relationshipId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entityRelationships', entityKey] });
    },
  });

  // Search for entities
  const handleSearch = async () => {
    if (!searchQuery.trim() || !organizationId) return;
    setSearching(true);
    try {
      const results = await searchEntities(organizationId, { query: { q: searchQuery }, limit: 10 });
      // Filter out the current entity and map to expected format
      setSearchResults(
        results.hits
          .filter(hit => hit.entity_key !== entityKey)
          .map(hit => ({ entity_key: hit.entity_key, payload: { label: hit.title } }))
      );
    } catch (err) {
      logger.error('Search failed:', err);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  // Group relationships by direction and type
  const outgoing = data?.items.filter(r => r.source_entity_key === entityKey) || [];
  const incoming = data?.items.filter(r => r.target_entity_key === entityKey) || [];

  // Group by relationship type
  const groupByType = (rels: EntityRelationship[]) => {
    const grouped: Record<string, EntityRelationship[]> = {};
    for (const rel of rels) {
      if (!grouped[rel.relationship_type]) {
        grouped[rel.relationship_type] = [];
      }
      grouped[rel.relationship_type].push(rel);
    }
    return grouped;
  };

  const outgoingByType = groupByType(outgoing);
  const incomingByType = groupByType(incoming);

  if (isLoading) {
    return <div className="text-center py-8 text-archive">Loading relationships...</div>;
  }

  if (error) {
    return <div className="text-center py-8 text-semantic-error">Error loading relationships</div>;
  }

  const totalCount = (data?.items.length || 0);
  // Extract type names from API response, or use fallback defaults
  const relationshipTypes: string[] = typesData?.relationship_types
    ? typesData.relationship_types.map((t: { type: string; count: number }) => t.type)
    : ['relatedTo', 'hasMedia', 'partOf', 'hasPart', 'references'];

  return (
    <div className="space-y-6">
      {/* Header with count, view toggle, and add button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-archive" />
            <span className="text-sm text-archive">
              {totalCount} relationship{totalCount !== 1 ? 's' : ''}
            </span>
          </div>
          {/* View mode toggle */}
          <div className="flex items-center border border-lichen rounded-md overflow-hidden">
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 text-sm flex items-center gap-1 ${
                viewMode === 'list' ? 'bg-stone text-ink' : 'text-archive hover:text-ink'
              }`}
              title="List view"
            >
              <List className="h-4 w-4" />
              <span className="hidden sm:inline">List</span>
            </button>
            <button
              onClick={() => setViewMode('graph')}
              className={`px-3 py-1.5 text-sm flex items-center gap-1 border-l border-lichen ${
                viewMode === 'graph' ? 'bg-stone text-ink' : 'text-archive hover:text-ink'
              }`}
              title="Graph view"
            >
              <Network className="h-4 w-4" />
              <span className="hidden sm:inline">Graph</span>
            </button>
          </div>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-bark text-parchment rounded hover:bg-bark/90"
        >
          <Plus className="h-4 w-4" />
          Add Relationship
        </button>
      </div>

      {/* Add relationship form */}
      {showAddForm && (
        <div className="bg-lichen border border-lichen rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-ink">Add Relationship</h4>
            <button
              onClick={() => {
                setShowAddForm(false);
                setNewRelType('');
                setNewTargetKey('');
                setSearchQuery('');
                setSearchResults([]);
              }}
              className="text-stone hover:text-archive"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Relationship type */}
            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                Relationship Type
              </label>
              <select
                value={newRelType}
                onChange={(e) => setNewRelType(e.target.value)}
                className="w-full px-3 py-2 border border-lichen rounded-md text-sm"
              >
                <option value="">Select type...</option>
                {relationshipTypes.map((type: string) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>

            {/* Target entity search */}
            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                Target Entity
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder="Search entities..."
                  className="flex-1 px-3 py-2 border border-lichen rounded-md text-sm"
                />
                <button
                  onClick={handleSearch}
                  disabled={searching}
                  className="px-3 py-2 bg-stone border border-lichen rounded-md hover:bg-stone/80"
                >
                  <Search className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Search results */}
          {searchResults.length > 0 && (
            <div className="border border-lichen rounded-md max-h-40 overflow-y-auto">
              {searchResults.map((entity) => (
                <button
                  key={entity.entity_key}
                  onClick={() => {
                    setNewTargetKey(entity.entity_key);
                    setSearchQuery(entity.payload?.label || entity.entity_key);
                    setSearchResults([]);
                  }}
                  className={`w-full px-3 py-2 text-left text-sm hover:bg-lichen border-b border-lichen last:border-b-0 ${
                    newTargetKey === entity.entity_key ? 'bg-stone' : ''
                  }`}
                >
                  <span className="font-medium">{entity.payload?.label || entity.entity_key}</span>
                  <span className="text-stone text-xs ml-2">{entity.entity_key}</span>
                </button>
              ))}
            </div>
          )}

          {/* Selected target */}
          {newTargetKey && (
            <p className="text-sm text-archive">
              Selected: <code className="bg-stone px-1 rounded">{newTargetKey}</code>
            </p>
          )}

          {/* Submit button */}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowAddForm(false)}
              className="px-4 py-2 text-sm text-archive hover:text-ink"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (newRelType && newTargetKey) {
                  createMutation.mutate({ targetEntityKey: newTargetKey, relationshipType: newRelType });
                }
              }}
              disabled={!newRelType || !newTargetKey || createMutation.isPending}
              className="btn-primary text-sm disabled:opacity-50"
            >
              {createMutation.isPending ? 'Creating...' : 'Create Relationship'}
            </button>
          </div>

          {createMutation.isError && (
            <p className="text-sm text-semantic-error">
              Error: {(createMutation.error as Error).message}
            </p>
          )}
        </div>
      )}

      {/* Graph view */}
      {viewMode === 'graph' && (
        <RelationshipGraph
          entityKey={entityKey}
          organizationId={organizationId}
          onEntityClick={(key) => {
            window.location.href = `/organizations/${organizationId}/bridge/entities/${encodeURIComponent(key)}`;
          }}
        />
      )}

      {/* List view */}
      {viewMode === 'list' && (
        <>
          {/* No relationships */}
          {totalCount === 0 && !showAddForm && (
            <div className="text-center py-12 text-archive">
              <GitBranch className="h-12 w-12 mx-auto mb-3 text-stone" />
              <p>No relationships found</p>
              <p className="text-sm mt-1">Add a relationship to connect this entity to others</p>
            </div>
          )}

          {/* Outgoing relationships */}
      {Object.keys(outgoingByType).length > 0 && (
        <div className="space-y-4">
          <h4 className="text-sm font-medium text-ink flex items-center gap-2">
            <ArrowRight className="h-4 w-4" />
            Outgoing Relationships
          </h4>
          {Object.entries(outgoingByType).map(([type, rels]) => (
            <div key={type} className="border border-lichen rounded-lg overflow-hidden">
              <div className="bg-lichen px-4 py-2 border-b border-lichen">
                <span className="text-sm font-medium text-ink">{type}</span>
                <span className="text-xs text-archive ml-2">({rels.length})</span>
              </div>
              <div className="divide-y divide-lichen">
                {rels.map((rel) => (
                  <div key={rel.relationship_id} className="px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <ArrowRight className="h-4 w-4 text-stone" />
                      <Link
                        to={`/organizations/${organizationId}/bridge/entities/${encodeURIComponent(rel.target_entity_key)}`}
                        className="link-subtle text-sm"
                      >
                        {rel.target_entity_key.split(':').pop() || rel.target_entity_key}
                      </Link>
                      <span className="text-xs text-stone">{rel.target_entity_key}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      {rel.created_by_source && (
                        <span className={
                          rel.created_by_source === 'manual' ? 'badge-info-subtle' :
                          rel.created_by_source === 'auto_link' ? 'badge-success-subtle' :
                          'badge-neutral'
                        }>
                          {rel.created_by_source}
                        </span>
                      )}
                      <button
                        onClick={() => deleteMutation.mutate(rel.relationship_id)}
                        disabled={deleteMutation.isPending}
                        className="text-stone hover:text-semantic-error"
                        title="Delete relationship"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Incoming relationships */}
      {Object.keys(incomingByType).length > 0 && (
        <div className="space-y-4">
          <h4 className="text-sm font-medium text-ink flex items-center gap-2">
            <ArrowLeft className="h-4 w-4" />
            Incoming Relationships
          </h4>
          {Object.entries(incomingByType).map(([type, rels]) => (
            <div key={type} className="border border-lichen rounded-lg overflow-hidden">
              <div className="bg-lichen px-4 py-2 border-b border-lichen">
                <span className="text-sm font-medium text-ink">{type}</span>
                <span className="text-xs text-archive ml-2">({rels.length})</span>
              </div>
              <div className="divide-y divide-lichen">
                {rels.map((rel) => (
                  <div key={rel.relationship_id} className="px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <ArrowLeft className="h-4 w-4 text-stone" />
                      <Link
                        to={`/organizations/${organizationId}/bridge/entities/${encodeURIComponent(rel.source_entity_key)}`}
                        className="link-subtle text-sm"
                      >
                        {rel.source_entity_key.split(':').pop() || rel.source_entity_key}
                      </Link>
                      <span className="text-xs text-stone">{rel.source_entity_key}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      {rel.created_by_source && (
                        <span className={
                          rel.created_by_source === 'manual' ? 'badge-info-subtle' :
                          rel.created_by_source === 'auto_link' ? 'badge-success-subtle' :
                          'badge-neutral'
                        }>
                          {rel.created_by_source}
                        </span>
                      )}
                      <button
                        onClick={() => deleteMutation.mutate(rel.relationship_id)}
                        disabled={deleteMutation.isPending}
                        className="text-stone hover:text-semantic-error"
                        title="Delete relationship"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
        </>
      )}
    </div>
  );
}
