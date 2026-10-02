import { useEffect, useRef } from 'react';
import { X, Grid3X3, List } from 'lucide-react';
import type { DiscoverFacet, DiscoverSearchParams } from '../../../types/discover';
import { FilterGroup } from './FilterGroup';

const SORT_OPTIONS = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'title_asc', label: 'Title A\u2013Z' },
  { value: 'title_desc', label: 'Title Z\u2013A' },
  { value: 'date_asc', label: 'Date (oldest)' },
  { value: 'date_desc', label: 'Date (newest)' },
  { value: 'newest', label: 'Recently added' },
] as const;

const FACET_CONFIG = [
  { field: 'creator', label: 'Maker' },
  { field: 'creation_place', label: 'Place' },
  { field: 'subject', label: 'Subject' },
  { field: 'style_period', label: 'Period' },
  { field: 'object_type', label: 'Object Type' },
  { field: 'classification', label: 'Classification' },
  { field: 'material', label: 'Material' },
  { field: 'technique', label: 'Technique' },
] as const;

interface FilterPanelProps {
  isOpen: boolean;
  onClose: () => void;
  facets: DiscoverFacet[];
  params: DiscoverSearchParams;
  viewMode: 'grid' | 'list';
  onViewModeChange: (mode: 'grid' | 'list') => void;
  onSortChange: (sort: string) => void;
  onFacetToggle: (field: string, key: string) => void;
  onToggleHasImage: () => void;
  onToggleOnDisplay: () => void;
  updateParams: (updater: (prev: DiscoverSearchParams) => DiscoverSearchParams) => void;
}

function getSelectedForFacet(field: string, params: DiscoverSearchParams): string[] {
  if (field === 'object_type') return params.object_type || [];
  if (field === 'classification') return params.classification || [];
  if (field === 'style_period') return params.style_period || [];
  if (field === 'creator') return params.creator ? [params.creator] : [];
  if (field === 'material') return params.material ? [params.material] : [];
  if (field === 'technique') return params.technique ? [params.technique] : [];
  if (field === 'subject') return params.subject ? [params.subject] : [];
  if (field === 'creation_place') return params.creation_place ? [params.creation_place] : [];
  return [];
}

export function FilterPanel({
  isOpen,
  onClose,
  facets,
  params,
  viewMode,
  onViewModeChange,
  onSortChange,
  onFacetToggle,
  onToggleHasImage,
  onToggleOnDisplay,
  updateParams,
}: FilterPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const getFacet = (field: string) => facets.find((f) => f.field === field);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-ink/50 transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className={`fixed top-0 right-0 bottom-0 z-50 w-96 max-w-[90vw] bg-forest text-parchment shadow-2xl transform transition-transform duration-300 ease-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="h-full flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-5 border-b border-parchment/10">
            <h2 className="text-lg font-medium text-parchment">Filters</h2>
            <button
              onClick={onClose}
              aria-label="Close filters"
              className="text-parchment/60 hover:text-parchment transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {/* Sort */}
            <div className="mb-6">
              <label className="block text-xs font-medium text-parchment/60 uppercase tracking-wide mb-2">
                Sort by
              </label>
              <select
                value={params.sort || 'relevance'}
                onChange={(e) => onSortChange(e.target.value)}
                className="w-full border border-parchment/20 rounded-lg px-3 py-2.5 text-sm text-parchment bg-parchment/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-parchment/30 focus-visible:ring-offset-2"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value} className="bg-forest text-parchment">
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* View mode */}
            <div className="mb-6">
              <label className="block text-xs font-medium text-parchment/60 uppercase tracking-wide mb-2">
                View
              </label>
              <div className="flex border border-parchment/20 rounded-lg overflow-hidden">
                <button
                  onClick={() => onViewModeChange('grid')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm transition-colors ${
                    viewMode === 'grid'
                      ? 'bg-parchment/15 text-parchment'
                      : 'text-parchment/50 hover:text-parchment'
                  }`}
                >
                  <Grid3X3 size={16} />
                  Grid
                </button>
                <button
                  onClick={() => onViewModeChange('list')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm transition-colors ${
                    viewMode === 'list'
                      ? 'bg-parchment/15 text-parchment'
                      : 'text-parchment/50 hover:text-parchment'
                  }`}
                >
                  <List size={16} />
                  List
                </button>
              </div>
            </div>

            {/* Quick toggles */}
            <div className="mb-6 space-y-2">
              <label className="flex items-center gap-2 text-sm text-parchment/70 hover:text-parchment cursor-pointer py-0.5">
                <input
                  type="checkbox"
                  checked={!!params.has_image}
                  onChange={onToggleHasImage}
                  className="rounded border-parchment/30 bg-transparent text-bark focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                />
                <span>Only with image</span>
              </label>
              <label className="flex items-center gap-2 text-sm text-parchment/70 hover:text-parchment cursor-pointer py-0.5">
                <input
                  type="checkbox"
                  checked={!!params.on_display}
                  onChange={onToggleOnDisplay}
                  className="rounded border-parchment/30 bg-transparent text-bark focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                />
                <span>On display</span>
              </label>
            </div>

            {/* Facet groups */}
            {FACET_CONFIG.map(({ field, label }) => {
              const facet = getFacet(field);
              if (!facet || facet.buckets.length === 0) return null;
              return (
                <FilterGroup
                  key={field}
                  label={label}
                  facet={facet}
                  selected={getSelectedForFacet(field, params)}
                  onToggle={(key) => onFacetToggle(field, key)}
                />
              );
            })}

            {/* Date Range */}
            <div className="border-b border-parchment/10 pb-4 mb-4">
              <p className="text-sm font-medium text-parchment mb-2">Date Range</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g. 1850"
                  value={params.date_from || ''}
                  onChange={(e) =>
                    updateParams((prev) => ({ ...prev, date_from: e.target.value || undefined }))
                  }
                  className="w-full text-sm border border-parchment/20 rounded px-2 py-1.5 bg-parchment/5 text-parchment placeholder:text-parchment/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-parchment/30 focus-visible:ring-offset-2"
                />
                <input
                  type="text"
                  placeholder="e.g. 2025"
                  value={params.date_to || ''}
                  onChange={(e) =>
                    updateParams((prev) => ({ ...prev, date_to: e.target.value || undefined }))
                  }
                  className="w-full text-sm border border-parchment/20 rounded px-2 py-1.5 bg-parchment/5 text-parchment placeholder:text-parchment/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-parchment/30 focus-visible:ring-offset-2"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
