import { useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Loader2, Plus, ArrowLeft } from 'lucide-react';
import SlideOver from '../ui/SlideOver';
import { MetadataFieldRenderer } from './MetadataFieldRenderer';
import type { SearchConfig, MetadataFieldDef, CreateConfig, RemoteCacheConfig } from './types';

interface RecordLinkerSlideOverProps<TSearch> {
  isOpen: boolean;
  onClose: () => void;
  search: SearchConfig<TSearch>;
  metadataFields?: MetadataFieldDef[];
  create?: CreateConfig;
  remoteCache?: RemoteCacheConfig<TSearch>;
  bulkSelect?: boolean;
  linkedIds: Set<string>;
  onLink: (item: TSearch, metadata: Record<string, any>) => Promise<void>;
  submitLabel?: string;
}

export function RecordLinkerSlideOver<TSearch>({
  isOpen,
  onClose,
  search,
  metadataFields = [],
  create,
  remoteCache,
  bulkSelect = false,
  linkedIds,
  onLink,
  submitLabel,
}: RecordLinkerSlideOverProps<TSearch>) {
  const [mode, setMode] = useState<'search' | 'create'>('search');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedItem, setSelectedItem] = useState<TSearch | null>(null);
  const [selectedItems, setSelectedItems] = useState<Map<string, TSearch>>(new Map());
  const [hasSearched, setHasSearched] = useState(false);
  const [metadata, setMetadata] = useState<Record<string, any>>(() => {
    const defaults: Record<string, any> = {};
    metadataFields.forEach((f) => {
      if (f.defaultValue !== undefined) defaults[f.key] = f.defaultValue;
    });
    return defaults;
  });
  const [createFormData, setCreateFormData] = useState<Record<string, any>>({});
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const minSearchLength = search.minSearchLength ?? 2;

  // Search query
  const { data: searchResults, isLoading: isSearching } = useQuery({
    queryKey: [...search.queryKey, searchTerm],
    queryFn: () => search.searchFn(searchTerm),
    enabled: isOpen && mode === 'search' && searchTerm.length >= minSearchLength,
  });

  // Filter out already-linked items
  const filteredResults = useMemo(() => {
    const results = searchResults ?? [];
    if (search.filterLinked) return search.filterLinked(results, linkedIds);
    return results.filter((item) => !linkedIds.has(search.getSearchItemId(item)));
  }, [searchResults, linkedIds, search]);

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchTerm(value);
      if (!bulkSelect) setSelectedItem(null);
      if (value.length >= minSearchLength) setHasSearched(true);
    },
    [bulkSelect, minSearchLength]
  );

  const handleSelect = useCallback(
    (item: TSearch) => {
      if (bulkSelect) {
        const id = search.getSearchItemId(item);
        setSelectedItems((prev) => {
          const next = new Map(prev);
          if (next.has(id)) next.delete(id);
          else next.set(id, item);
          return next;
        });
      } else {
        setSelectedItem(item);
      }
    },
    [bulkSelect, search]
  );

  const handleMetadataChange = useCallback((key: string, value: any) => {
    setMetadata((prev) => ({ ...prev, [key]: value }));
  }, []);

  const getDefaultMetadata = useCallback(() => {
    const defaults: Record<string, any> = {};
    metadataFields.forEach((f) => {
      if (f.defaultValue !== undefined) defaults[f.key] = f.defaultValue;
    });
    return defaults;
  }, [metadataFields]);

  const resetForm = useCallback(() => {
    setMode('search');
    setSearchTerm('');
    setSelectedItem(null);
    setSelectedItems(new Map());
    setHasSearched(false);
    setError(null);
    setIsSubmitting(false);
    setMetadata(getDefaultMetadata());
    setCreateFormData({});
  }, [getDefaultMetadata]);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [resetForm, onClose]);

  const handleSubmit = useCallback(async () => {
    setError(null);

    // Create mode
    if (mode === 'create' && create) {
      if (create.canSubmit && !create.canSubmit(createFormData)) {
        setError('Please fill in all required fields');
        return;
      }
      setIsSubmitting(true);
      try {
        await create.onCreateSubmit(createFormData, metadata);
        resetForm();
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
        setIsSubmitting(false);
      }
      return;
    }

    // Search mode
    const items = bulkSelect
      ? Array.from(selectedItems.values())
      : selectedItem
        ? [selectedItem]
        : [];

    if (items.length === 0) {
      setError(
        bulkSelect ? 'Please select at least one item' : 'Please select an item'
      );
      return;
    }

    for (const field of metadataFields) {
      if (field.required && !metadata[field.key]) {
        setError(`${field.label} is required`);
        return;
      }
    }

    setIsSubmitting(true);
    try {
      if (bulkSelect) {
        await Promise.all(items.map((item) => onLink(item, metadata)));
      } else {
        await onLink(items[0], metadata);
      }
      resetForm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setIsSubmitting(false);
    }
  }, [
    mode,
    create,
    createFormData,
    bulkSelect,
    selectedItems,
    selectedItem,
    metadataFields,
    metadata,
    onLink,
    resetForm,
    onClose,
  ]);

  const showNoResults =
    hasSearched &&
    !isSearching &&
    searchTerm.length >= minSearchLength &&
    filteredResults.length === 0;

  const hasSelection = bulkSelect ? selectedItems.size > 0 : !!selectedItem;
  const isRemoteSelected =
    !bulkSelect && selectedItem && remoteCache?.isRemote(selectedItem);

  const getSubmitLabel = () => {
    if (mode === 'create' && create) return create.submitLabel || 'Create & Link';
    if (bulkSelect)
      return `Add ${selectedItems.size} Item${selectedItems.size !== 1 ? 's' : ''}`;
    if (isRemoteSelected && remoteCache?.importButtonLabel)
      return remoteCache.importButtonLabel;
    return submitLabel || 'Add';
  };

  const canSubmitCreate =
    mode === 'create' && create
      ? create.canSubmit
        ? create.canSubmit(createFormData)
        : true
      : false;

  const preSelectionFields = metadataFields.filter((f) => !f.showAfterSelection);
  const postSelectionFields = metadataFields.filter((f) => f.showAfterSelection);

  return (
    <SlideOver
      isOpen={isOpen}
      onClose={handleClose}
      title={mode === 'create' && create ? create.label : search.title}
      subtitle={mode === 'search' ? search.subtitle : undefined}
      width="md"
      footer={
        <div className="flex justify-end gap-2">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm border border-lichen rounded-lg hover:bg-stone/50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={
              isSubmitting ||
              (mode === 'search' ? !hasSelection : !canSubmitCreate)
            }
            className="px-4 py-2 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark disabled:opacity-50 flex items-center gap-2"
          >
            {isSubmitting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                {mode === 'create' ? 'Creating...' : 'Adding...'}
              </>
            ) : (
              getSubmitLabel()
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Error */}
        {error && (
          <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-sm text-semantic-error">
            {error}
          </div>
        )}

        {mode === 'search' ? (
          <>
            {/* Pre-selection metadata fields */}
            {preSelectionFields.length > 0 && (
              <MetadataFieldRenderer
                fields={preSelectionFields}
                values={metadata}
                onChange={handleMetadataChange}
              />
            )}

            {/* Search input */}
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">
                {search.searchLabel || 'Search'}
              </label>
              <div className="relative">
                <Search
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-archive"
                />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder={search.placeholder || 'Search...'}
                  className="w-full pl-9 pr-4 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                  autoFocus
                />
              </div>
            </div>

            {/* Search results */}
            <div className="border border-lichen rounded-lg overflow-hidden">
              {searchTerm.length < minSearchLength ? (
                <div className="p-6 text-center text-archive text-sm">
                  Type at least {minSearchLength} character
                  {minSearchLength !== 1 ? 's' : ''} to search...
                </div>
              ) : isSearching ? (
                <div className="p-6 text-center text-archive">
                  <Loader2 size={16} className="inline animate-spin mr-2" />
                  Searching...
                </div>
              ) : filteredResults.length > 0 ? (
                <div className="max-h-64 overflow-y-auto">
                  {filteredResults.map((item) => {
                    const id = search.getSearchItemId(item);
                    const isSelected = bulkSelect
                      ? selectedItems.has(id)
                      : selectedItem
                        ? search.getSearchItemId(selectedItem) === id
                        : false;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => handleSelect(item)}
                        className={`w-full text-left px-3 py-2.5 hover:bg-stone/50 border-b border-lichen last:border-b-0 flex items-center gap-3 ${
                          isSelected
                            ? 'bg-bark/10 border-l-2 border-l-bark'
                            : ''
                        }`}
                      >
                        {search.renderSearchItem(item, isSelected)}
                      </button>
                    );
                  })}
                </div>
              ) : showNoResults ? (
                <div className="p-6 text-center">
                  <p className="text-sm text-archive mb-3">
                    {search.noResultsMessage
                      ? search.noResultsMessage.includes('{term}')
                        ? search.noResultsMessage.replace('{term}', searchTerm)
                        : `${search.noResultsMessage} "${searchTerm}"`
                      : `No results found for "${searchTerm}"`}
                  </p>
                  {create && (
                    <button
                      type="button"
                      onClick={() => setMode('create')}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-parchment bg-bark rounded-lg hover:bg-copper-dark"
                    >
                      <Plus size={16} />
                      {create.label}
                    </button>
                  )}
                </div>
              ) : null}
            </div>

            {/* Create link when results exist */}
            {create &&
              searchTerm.length >= minSearchLength &&
              filteredResults.length > 0 && (
                <div className="text-center pt-2 border-t border-lichen">
                  <button
                    type="button"
                    onClick={() => setMode('create')}
                    className="text-sm text-bark hover:text-copper-dark"
                  >
                    Or {create.label.toLowerCase()}
                  </button>
                </div>
              )}

            {/* Selected indicator (single select) */}
            {!bulkSelect && selectedItem && (
              <div
                className={`p-3 rounded-lg border ${
                  isRemoteSelected
                    ? 'bg-semantic-warning/5 border-semantic-warning/20'
                    : 'bg-bark/5 border-bark/20'
                }`}
              >
                <p className="text-xs text-archive mb-1">
                  {isRemoteSelected && remoteCache?.selectedRemoteText
                    ? remoteCache.selectedRemoteText
                    : 'Selected:'}
                </p>
                <p className="text-sm font-medium text-ink">
                  {search.getSearchItemLabel(selectedItem)}
                </p>
              </div>
            )}

            {/* Bulk selection summary */}
            {bulkSelect && selectedItems.size > 0 && (
              <div className="p-3 bg-bark/5 border border-bark/20 rounded-lg">
                <p className="text-sm text-ink">
                  {selectedItems.size} item{selectedItems.size !== 1 ? 's' : ''}{' '}
                  selected
                </p>
              </div>
            )}

            {/* Post-selection metadata fields */}
            {hasSelection && postSelectionFields.length > 0 && (
              <MetadataFieldRenderer
                fields={postSelectionFields}
                values={metadata}
                onChange={handleMetadataChange}
              />
            )}
          </>
        ) : create ? (
          <>
            <button
              type="button"
              onClick={() => setMode('search')}
              className="flex items-center gap-1 text-sm text-archive hover:text-ink"
            >
              <ArrowLeft size={14} />
              Back to search
            </button>
            {create.renderCreateFields({
              searchTerm,
              formData: createFormData,
              setFormData: setCreateFormData,
              metadata,
            })}
          </>
        ) : null}
      </div>
    </SlideOver>
  );
}
