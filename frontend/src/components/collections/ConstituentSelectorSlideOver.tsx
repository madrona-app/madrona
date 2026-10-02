import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, User, Building2, Users, Loader2, ArrowLeft, Plus } from 'lucide-react';
import { getConstituents, createConstituent } from '../../lib/api/constituents';
import type { Constituent } from '../../lib/api/constituents';
import SlideOver from '../ui/SlideOver';

interface ConstituentSelectorSlideOverProps {
  isOpen: boolean;
  organizationId: string;
  onClose: () => void;
  onSelect: (constituentId: string) => void;
  title?: string;
  subtitle?: string;
  /** Filter to specific constituent types */
  constituentTypes?: string[];
  /** IDs to exclude from results (e.g., already selected) */
  excludeIds?: Set<string>;
}

const CONSTITUENT_TYPE_OPTIONS = [
  { value: 'person', label: 'Person' },
  { value: 'organization', label: 'Organization' },
];

function constituentIcon(type?: string, className?: string) {
  if (type === 'organization' || type === 'corporate_body' || type === 'dealer' || type === 'auction_house') {
    return <Building2 size={16} className={className || 'text-archive flex-shrink-0'} />;
  }
  if (type === 'family' || type === 'department') {
    return <Users size={16} className={className || 'text-archive flex-shrink-0'} />;
  }
  return <User size={16} className={className || 'text-archive flex-shrink-0'} />;
}

/**
 * SlideOver for searching and selecting a constituent, with option to create new.
 * Search-first pattern with create fallback.
 */
export function ConstituentSelectorSlideOver({
  isOpen,
  organizationId,
  onClose,
  onSelect,
  title = 'Select Person or Organization',
  subtitle = 'Search for a person or organization',
  constituentTypes,
  excludeIds,
}: ConstituentSelectorSlideOverProps) {
  const queryClient = useQueryClient();

  // Mode: 'search' (default) or 'create'
  const [mode, setMode] = useState<'search' | 'create'>('search');

  // Search state
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // Create state
  const [constituentType, setConstituentType] = useState<'person' | 'organization'>('person');
  const [name, setName] = useState('');

  const [error, setError] = useState<string | null>(null);

  // Search for constituents
  const { data: searchResults, isLoading: isSearching } = useQuery({
    queryKey: ['constituents-search', organizationId, searchTerm, constituentTypes],
    queryFn: () => getConstituents(organizationId, { q: searchTerm, limit: 20 }),
    enabled: isOpen && mode === 'search' && searchTerm.length >= 2,
  });

  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    setSelectedId(null);
    if (value.length >= 2) {
      setHasSearched(true);
    }
  };

  // Create constituent mutation
  const createMutation = useMutation({
    mutationFn: () => createConstituent(organizationId, {
      name,
      constituent_type: constituentType,
    }),
    onSuccess: (newConstituent) => {
      queryClient.invalidateQueries({ queryKey: ['constituents', organizationId] });
      resetForm();
      onSelect(newConstituent.constituent_id);
      onClose();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const resetForm = () => {
    setMode('search');
    setSearchTerm('');
    setSelectedId(null);
    setHasSearched(false);
    setConstituentType('person');
    setName('');
    setError(null);
  };

  const handleSubmit = () => {
    setError(null);
    if (mode === 'search') {
      if (!selectedId) {
        setError('Please select a person or organization');
        return;
      }
      onSelect(selectedId);
      resetForm();
      onClose();
    } else {
      if (!name.trim()) {
        setError('Please enter a name');
        return;
      }
      createMutation.mutate();
    }
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSwitchToCreate = () => {
    setMode('create');
    if (searchTerm.length > 1 && searchTerm.length < 100) {
      setName(searchTerm);
    }
  };

  const handleBackToSearch = () => {
    setMode('search');
    setName('');
    setConstituentType('person');
  };

  // Filter results
  let availableConstituents = searchResults?.items || [];

  if (constituentTypes && constituentTypes.length > 0) {
    availableConstituents = availableConstituents.filter((c: Constituent) =>
      constituentTypes.includes(c.constituent_type)
    );
  }

  if (excludeIds && excludeIds.size > 0) {
    availableConstituents = availableConstituents.filter((c: Constituent) => !excludeIds.has(c.constituent_id));
  }

  const isPending = createMutation.isPending;
  const showNoResults = hasSearched && !isSearching && searchTerm.length >= 2 && availableConstituents.length === 0;

  return (
    <SlideOver
      isOpen={isOpen}
      onClose={handleClose}
      title={mode === 'search' ? title : 'Create New Person or Organization'}
      subtitle={mode === 'search' ? subtitle : 'Create a new person or organization'}
      width="md"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={handleClose} className="px-4 py-2 text-sm border border-lichen rounded-lg hover:bg-stone/50">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isPending || (mode === 'search' && !selectedId) || (mode === 'create' && !name.trim())}
            className="px-4 py-2 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark hover:text-parchment disabled:opacity-50 flex items-center gap-2"
          >
            {isPending ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Creating...
              </>
            ) : (
              mode === 'search' ? 'Select' : 'Create & Select'
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {error && (
          <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-sm text-semantic-error">
            {error}
          </div>
        )}

        {mode === 'search' ? (
          <>
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">
                Search Constituents
              </label>
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-archive" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder="Search by name..."
                  className="w-full pl-9 pr-4 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                  autoFocus
                />
              </div>
            </div>

            <div className="border border-lichen rounded-lg overflow-hidden">
              {searchTerm.length < 2 ? (
                <div className="p-6 text-center text-archive text-sm">
                  Type at least 2 characters to search...
                </div>
              ) : isSearching ? (
                <div className="p-6 text-center text-archive">
                  <Loader2 size={16} className="inline animate-spin mr-2" />
                  Searching...
                </div>
              ) : availableConstituents.length > 0 ? (
                <div className="max-h-64 overflow-y-auto">
                  {availableConstituents.map((c: Constituent) => (
                    <button
                      key={c.constituent_id}
                      type="button"
                      onClick={() => setSelectedId(c.constituent_id)}
                      className={`w-full text-left px-3 py-2.5 hover:bg-stone/50 border-b border-lichen last:border-b-0 flex items-center gap-3 ${
                        selectedId === c.constituent_id ? 'bg-azurite/10 border-l-2 border-l-azurite' : ''
                      }`}
                    >
                      {constituentIcon(c.constituent_type)}
                      <div className="min-w-0">
                        <p className="text-sm text-ink font-medium truncate">{c.name}</p>
                        {c.organization_name && (
                          <p className="text-xs text-archive truncate">{c.organization_name}</p>
                        )}
                        {c.role && !c.organization_name && (
                          <p className="text-xs text-archive truncate">{c.role}</p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              ) : showNoResults ? (
                <div className="p-6 text-center">
                  <p className="text-sm text-archive mb-3">No people or organizations found for "{searchTerm}"</p>
                  <button
                    type="button"
                    onClick={handleSwitchToCreate}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-parchment bg-bark rounded-lg hover:bg-copper-dark hover:text-parchment"
                  >
                    <Plus size={16} />
                    Create New Person or Organization
                  </button>
                </div>
              ) : null}
            </div>

            {searchTerm.length >= 2 && availableConstituents.length > 0 && (
              <div className="text-center pt-2 border-t border-lichen">
                <button
                  type="button"
                  onClick={handleSwitchToCreate}
                  className="text-sm text-bark hover:text-copper-dark"
                >
                  Or create a new constituent
                </button>
              </div>
            )}

            {selectedId && (
              <div className="p-3 bg-bark/5 border border-bark/20 rounded-lg">
                <p className="text-xs text-archive mb-1">Selected:</p>
                <p className="text-sm font-medium text-ink">
                  {availableConstituents.find((c: Constituent) => c.constituent_id === selectedId)?.name || 'Unknown'}
                </p>
              </div>
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={handleBackToSearch}
              className="flex items-center gap-1 text-sm text-archive hover:text-ink"
            >
              <ArrowLeft size={14} />
              Back to search
            </button>

            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">
                Type <span className="text-semantic-error">*</span>
              </label>
              <div className="flex gap-4">
                {CONSTITUENT_TYPE_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex-1 flex items-center justify-center gap-2 p-3 border rounded-lg cursor-pointer transition-colors ${
                      constituentType === opt.value
                        ? 'border-bark bg-bark/5'
                        : 'border-lichen hover:border-bark/30'
                    }`}
                  >
                    <input
                      type="radio"
                      name="constituent_type"
                      value={opt.value}
                      checked={constituentType === opt.value}
                      onChange={(e) => setConstituentType(e.target.value as 'person' | 'organization')}
                      className="sr-only"
                    />
                    {opt.value === 'person' ? (
                      <User size={18} className={constituentType === opt.value ? 'text-bark' : 'text-archive'} />
                    ) : (
                      <Building2 size={18} className={constituentType === opt.value ? 'text-bark' : 'text-archive'} />
                    )}
                    <span className="text-sm font-medium">{opt.label}</span>
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
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={constituentType === 'person' ? 'Enter person name...' : 'Enter organization name...'}
                className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                autoFocus
              />
            </div>

            <p className="text-xs text-archive">
              A new constituent will be created. You can add more details later.
            </p>
          </>
        )}
      </div>
    </SlideOver>
  );
}

/** @deprecated Use ConstituentSelectorSlideOver instead */
export const ContactSelectorSlideOver = ConstituentSelectorSlideOver;

export default ConstituentSelectorSlideOver;
