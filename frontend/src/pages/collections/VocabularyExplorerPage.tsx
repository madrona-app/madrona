import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Search,
  ExternalLink,
  Loader2,
  BookOpen,
  User,
  MapPin,
  Layers,
  Wrench,
  Palette,
  Package,
  CheckCircle,
  Plus,
  Info,
  RefreshCw,
  Network,
  X,
  ArrowUp,
  ArrowDown,
  Link2,
} from 'lucide-react';
import {
  searchVocabulary,
  importGettyTerm,
  getVocabularyTermHierarchy,
} from '../../lib/api';
import type { VocabularyTerm, VocabularyTraversalTerm } from '../../lib/schemas';
import { useToast } from '../../contexts/ToastContext';
import { ModalPortal } from '../../components/ModalPortal';
import { cn } from '../../lib/utils';
import { formatRelativeTime as fmtRelativeTime, formatDateTime } from '@/lib/formatters';

type VocabularyType = 'aat' | 'ulan' | 'tgn';
type AatFacet = 'materials' | 'techniques' | 'styles_periods' | 'object_types' | '';

const VOCABULARY_TABS: { id: VocabularyType; label: string; icon: typeof BookOpen; description: string }[] = [
  {
    id: 'aat',
    label: 'Art & Architecture Thesaurus',
    icon: BookOpen,
    description: 'Materials, techniques, styles, periods, and object types',
  },
  {
    id: 'ulan',
    label: 'Union List of Artist Names',
    icon: User,
    description: 'Artists, architects, and other creators',
  },
  {
    id: 'tgn',
    label: 'Thesaurus of Geographic Names',
    icon: MapPin,
    description: 'Places, regions, and geographic features',
  },
];

// Getty AAT marks organizational/non-applicable nodes with angle brackets,
// e.g. `<materials by composition>`. They're hierarchy scaffolding, not
// concepts that should be applied to objects.
function isGuideTerm(label: string | null | undefined): boolean {
  if (!label) return false;
  const trimmed = label.trim();
  return trimmed.startsWith('<') && trimmed.endsWith('>');
}

const AAT_FACETS: { id: AatFacet; label: string; icon: typeof Layers }[] = [
  { id: '', label: 'All Categories', icon: BookOpen },
  { id: 'materials', label: 'Materials', icon: Layers },
  { id: 'techniques', label: 'Techniques', icon: Wrench },
  { id: 'styles_periods', label: 'Styles & Periods', icon: Palette },
  { id: 'object_types', label: 'Object Types', icon: Package },
];

export default function VocabularyExplorerPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [activeVocabulary, setActiveVocabulary] = useState<VocabularyType>('aat');
  const [aatFacet, setAatFacet] = useState<AatFacet>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [importingTerms, setImportingTerms] = useState<Set<string>>(new Set());
  const [selectedTermId, setSelectedTermId] = useState<string | null>(null);

  // Debounce search
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    // Simple debounce
    const timeout = setTimeout(() => {
      setDebouncedQuery(value);
    }, 300);
    return () => clearTimeout(timeout);
  };

  // Search vocabulary (orgId used for API routing but terms are global)
  const { data: searchResults, isLoading: isSearching } = useQuery({
    queryKey: ['vocabulary-explorer', activeVocabulary, aatFacet, debouncedQuery],
    queryFn: () =>
      searchVocabulary(orgId!, {
        vocabulary_type: activeVocabulary,
        query: debouncedQuery,
        limit: 50,
        facet: activeVocabulary === 'aat' && aatFacet ? aatFacet : undefined,
      }),
    enabled: !!orgId && debouncedQuery.length >= 2,
  });

  // Import term mutation (terms are stored globally, shared across all orgs)
  const importMutation = useMutation({
    mutationFn: (term: VocabularyTerm & { facet?: string }) =>
      importGettyTerm(orgId!, {
        vocabulary: term.vocabulary as 'aat' | 'ulan' | 'tgn',
        external_id: term.external_id!,
        external_uri: term.external_uri || undefined,
        preferred_term: term.preferred_term,
        scope_note: term.scope_note || undefined,
        broader_term: term.broader_term || undefined,
        facet: term.facet || (activeVocabulary === 'aat' && aatFacet ? aatFacet : undefined),
      }),
    onSuccess: (data, term) => {
      setImportingTerms((prev) => {
        const next = new Set(prev);
        next.delete(term.external_id!);
        return next;
      });
      // Invalidate to refresh the cached status
      queryClient.invalidateQueries({ queryKey: ['vocabulary-explorer'] });
      if (data.status === 'already_exists') {
        showToast({
          type: 'info',
          title: 'Already imported',
          message: `"${term.preferred_term}" is already in your library.`,
        });
      } else {
        showToast({
          type: 'success',
          title: 'Import queued',
          message:
            `"${term.preferred_term}" will appear once the background ` +
            'sync completes. Refresh in a moment.',
        });
      }
    },
    onError: (err, term) => {
      setImportingTerms((prev) => {
        const next = new Set(prev);
        next.delete(term.external_id!);
        return next;
      });
      showToast({
        type: 'error',
        title: 'Import failed',
        message: err instanceof Error ? err.message : 'Could not import term.',
      });
    },
  });

  const handleImportTerm = (term: VocabularyTerm) => {
    if (!term.external_id || term.term_id) return; // Already cached or no external ID
    setImportingTerms((prev) => new Set(prev).add(term.external_id!));
    importMutation.mutate({ ...term, facet: term.facet ?? undefined });
  };

  const getExternalUrl = (term: VocabularyTerm): string => {
    if (term.external_uri) return term.external_uri;
    if (term.external_id) {
      // Currently only Getty vocabularies, but could expand
      return `https://vocab.getty.edu/${term.vocabulary}/${term.external_id}`;
    }
    return '#';
  };

  const results = searchResults?.terms || [];

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Header */}
      <div className="bg-parchment border border-lichen rounded-lg p-6">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-bark/10 rounded-lg">
            <BookOpen size={28} className="text-bark" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-ink">Controlled Vocabularies</h1>
            <p className="text-sm text-archive mt-1 leading-relaxed max-w-2xl">
              Search and browse controlled vocabularies to find standardized terms for
              materials, techniques, styles, artists, and places. Imported terms are shared
              across all organizations and grow as museums use them.
            </p>
          </div>
        </div>
      </div>

      {/* Vocabulary Tabs */}
      <div className="bg-parchment border border-lichen rounded-lg overflow-hidden">
        <div className="flex border-b border-lichen">
          {VOCABULARY_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeVocabulary === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveVocabulary(tab.id);
                  setSearchQuery('');
                  setDebouncedQuery('');
                }}
                className={cn(
                  'flex-1 px-4 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2',
                  isActive
                    ? 'bg-bark/5 text-bark border-b-2 border-bark -mb-px'
                    : 'text-archive hover:text-ink hover:bg-stone/30'
                )}
              >
                <Icon size={18} />
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="sm:hidden">{tab.id.toUpperCase()}</span>
              </button>
            );
          })}
        </div>

        {/* Vocabulary Description */}
        <div className="px-4 py-3 bg-stone/30 border-b border-lichen">
          <p className="text-sm text-archive flex items-center gap-2">
            <Info size={14} />
            {VOCABULARY_TABS.find((t) => t.id === activeVocabulary)?.description}
          </p>
        </div>

        {/* AAT Facet Filter */}
        {activeVocabulary === 'aat' && (
          <div className="px-4 py-3 border-b border-lichen bg-parchment/50">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-ink mr-2">Category:</span>
              {AAT_FACETS.map((facet) => {
                const Icon = facet.icon;
                const isActive = aatFacet === facet.id;
                return (
                  <button
                    key={facet.id}
                    onClick={() => setAatFacet(facet.id)}
                    className={cn(
                      'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full transition-colors',
                      isActive
                        ? 'bg-bark text-parchment'
                        : 'bg-parchment border border-lichen text-archive hover:text-ink hover:border-bark/30'
                    )}
                  >
                    <Icon size={14} />
                    {facet.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Search Input */}
        <div className="p-4 border-b border-lichen">
          <div className="relative max-w-xl">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-archive" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder={getSearchPlaceholder(activeVocabulary, aatFacet)}
              className="w-full pl-10 pr-10 py-2.5 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark text-sm"
              autoFocus
            />
            {isSearching && (
              <Loader2
                size={16}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-archive animate-spin"
              />
            )}
          </div>
          <p className="text-xs text-archive mt-2">
            Type at least 2 characters to search.
          </p>
        </div>

        {/* Results */}
        <div className="min-h-[400px]">
          {debouncedQuery.length < 2 ? (
            <div className="flex flex-col items-center justify-center py-16 text-archive">
              <Search size={48} className="mb-4 opacity-30" />
              <p className="text-sm">Enter a search term to explore vocabularies</p>
            </div>
          ) : isSearching ? (
            <div className="flex flex-col items-center justify-center py-16 text-archive">
              <Loader2 size={32} className="mb-4 animate-spin" />
              <p className="text-sm">Searching {activeVocabulary.toUpperCase()}...</p>
            </div>
          ) : results.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-archive">
              <BookOpen size={48} className="mb-4 opacity-30" />
              <p className="text-sm">No results found for "{debouncedQuery}"</p>
              <p className="text-xs mt-1">Try a different search term or category</p>
            </div>
          ) : (
            <div className="divide-y divide-lichen">
              {results.map((term) => (
                <TermRow
                  key={term.external_id || term.term_id || term.preferred_term}
                  term={term}
                  vocabulary={activeVocabulary}
                  externalUrl={getExternalUrl(term)}
                  isImporting={importingTerms.has(term.external_id || '')}
                  onImport={() => handleImportTerm(term)}
                  onViewHierarchy={
                    term.term_id ? () => setSelectedTermId(term.term_id!) : undefined
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {selectedTermId && orgId && (
        <HierarchyPanel
          orgId={orgId}
          termId={selectedTermId}
          onSelectTerm={setSelectedTermId}
          onClose={() => setSelectedTermId(null)}
        />
      )}
    </div>
  );
}

function getSearchPlaceholder(vocabulary: VocabularyType, facet: AatFacet): string {
  if (vocabulary === 'ulan') return 'Search artists, architects, creators...';
  if (vocabulary === 'tgn') return 'Search places, cities, regions...';
  switch (facet) {
    case 'materials':
      return 'Search materials (e.g., oil paint, canvas, bronze)...';
    case 'techniques':
      return 'Search techniques (e.g., etching, impasto, gilding)...';
    case 'styles_periods':
      return 'Search styles & periods (e.g., Baroque, Renaissance)...';
    case 'object_types':
      return 'Search object types (e.g., painting, sculpture)...';
    default:
      return 'Search AAT terms...';
  }
}

interface TermRowProps {
  term: VocabularyTerm;
  vocabulary: VocabularyType;
  externalUrl: string;
  isImporting: boolean;
  onImport: () => void;
  onViewHierarchy?: () => void;
}

function formatRelativeTime(isoString: string): string {
  return fmtRelativeTime(isoString);
}

function TermRow({
  term,
  vocabulary,
  externalUrl,
  isImporting,
  onImport,
  onViewHierarchy,
}: TermRowProps) {
  const isCached = !!term.term_id;
  const isGuide = isGuideTerm(term.preferred_term);

  return (
    <div className="px-4 py-3 hover:bg-stone/30 transition-colors">
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3
              className={cn(
                'font-medium text-ink',
                isGuide && 'italic text-archive',
              )}
            >
              {term.preferred_term}
            </h3>
            {isGuide && (
              <span
                className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-stone/60 text-archive rounded-full"
                title="Getty AAT guide term — used to organize the hierarchy, not to describe objects"
              >
                Guide term
              </span>
            )}
            {isCached && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-forest/10 text-forest rounded-full">
                <CheckCircle size={10} />
                Imported
              </span>
            )}
            {isCached && term.hierarchy_fetched_at && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs text-archive bg-stone/50 rounded-full"
                title={`Last synced: ${formatDateTime(term.hierarchy_fetched_at)}`}
              >
                <RefreshCw size={10} />
                Synced {formatRelativeTime(term.hierarchy_fetched_at)}
              </span>
            )}
            {isCached && term.usage_count > 0 && (
              <span className="text-xs text-archive" title="Times used across all organizations">
                Used {term.usage_count}×
              </span>
            )}
            {term.external_id && (
              <span className="text-xs text-archive font-mono">
                {vocabulary.toUpperCase()}: {term.external_id}
              </span>
            )}
          </div>

          {term.scope_note && (
            <p className="text-sm text-archive line-clamp-2 mb-1">{term.scope_note}</p>
          )}

          {term.broader_term && (
            <p className="text-xs text-archive">
              <span className="font-medium">Broader:</span> {term.broader_term}
            </p>
          )}

          {/* ULAN-specific fields */}
          {vocabulary === 'ulan' && term.dates && (
            <p className="text-xs text-archive">
              <span className="font-medium">Dates:</span> {term.dates}
            </p>
          )}
          {vocabulary === 'ulan' && term.nationality && (
            <p className="text-xs text-archive">
              <span className="font-medium">Nationality:</span> {term.nationality}
            </p>
          )}

          {/* TGN-specific fields */}
          {vocabulary === 'tgn' && term.place_type && (
            <p className="text-xs text-archive">
              <span className="font-medium">Type:</span> {term.place_type}
            </p>
          )}
          {vocabulary === 'tgn' && term.parent_place && (
            <p className="text-xs text-archive">
              <span className="font-medium">In:</span> {term.parent_place}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {onViewHierarchy && (
            <button
              type="button"
              onClick={onViewHierarchy}
              className="inline-flex items-center gap-1 px-2 py-1.5 text-xs text-bark hover:text-copper-dark border border-lichen rounded hover:border-bark/30 transition-colors"
              title="View hierarchy (broader, narrower, related)"
            >
              <Network size={12} />
              Hierarchy
            </button>
          )}

          <a
            href={externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2 py-1.5 text-xs text-bark hover:text-copper-dark border border-lichen rounded hover:border-bark/30 transition-colors"
            title="View source"
          >
            <ExternalLink size={12} />
            Source
          </a>

          {!isCached && term.external_id && !isGuide && (
            <button
              onClick={onImport}
              disabled={isImporting}
              className="inline-flex items-center gap-1 px-2 py-1.5 text-xs bg-bark text-parchment rounded hover:bg-copper-dark transition-colors disabled:opacity-50"
              title="Import to local vocabulary"
            >
              {isImporting ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Plus size={12} />
              )}
              Import
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface HierarchyPanelProps {
  orgId: string;
  termId: string;
  onSelectTerm: (termId: string) => void;
  onClose: () => void;
}

function HierarchyPanel({ orgId, termId, onSelectTerm, onClose }: HierarchyPanelProps) {
  // Pass sync=true so the route blocks on Getty when the hierarchy is stale
  // or never fetched. Without this, the first response is empty and the user
  // has to click refresh after Celery catches up.
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['vocabulary-hierarchy', orgId, termId],
    queryFn: () => getVocabularyTermHierarchy(orgId, termId, { sync: true }),
    enabled: !!termId,
  });

  return (
    <ModalPortal>
    <div className="fixed inset-0 z-[1000] flex">
      <button
        type="button"
        aria-label="Close hierarchy panel"
        onClick={onClose}
        className="flex-1 bg-ink/40"
      />
      <aside
        role="dialog"
        aria-label="Vocabulary term hierarchy"
        className="w-full max-w-md bg-parchment border-l border-lichen shadow-xl flex flex-col"
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-lichen bg-parchment-warm">
          <div className="flex items-center gap-2 min-w-0">
            <Network size={16} className="text-bark shrink-0" />
            <h2 className="text-sm font-semibold text-ink truncate">
              {data?.term.preferred_term ?? 'Term hierarchy'}
            </h2>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              className="p-1.5 text-archive hover:text-ink hover:bg-stone/50 rounded transition-colors disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-archive hover:text-ink hover:bg-stone/50 rounded transition-colors"
              title="Close"
            >
              <X size={16} />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12 text-archive">
              <Loader2 size={24} className="mb-3 animate-spin" />
              <p className="text-sm">Loading hierarchy…</p>
            </div>
          ) : isError ? (
            <div className="px-4 py-6 text-sm text-semantic-error">
              Failed to load hierarchy
              {error instanceof Error ? `: ${error.message}` : '.'}
            </div>
          ) : data ? (
            <div className="divide-y divide-lichen">
              <section className="px-4 py-3">
                <div className="text-xs uppercase tracking-wide text-archive font-medium mb-1">
                  {data.term.vocabulary.toUpperCase()}
                  {data.term.external_id ? ` · ${data.term.external_id}` : ''}
                </div>
                <div className="text-base text-ink font-medium">
                  {data.term.preferred_term}
                </div>
                {data.term.hierarchy_path && (
                  <div className="text-xs text-archive mt-1 break-words">
                    {data.term.hierarchy_path}
                  </div>
                )}
                {data.term.scope_note && (
                  <p className="text-sm text-archive mt-2 leading-relaxed">
                    {data.term.scope_note}
                  </p>
                )}
              </section>

              <HierarchySection
                icon={<ArrowUp size={14} className="text-bark" />}
                label="Broader"
                terms={data.broader_terms}
                emptyText="No broader terms."
                onSelectTerm={onSelectTerm}
                indentByDepth
              />

              <HierarchySection
                icon={<ArrowDown size={14} className="text-bark" />}
                label="Narrower"
                terms={data.narrower_terms}
                emptyText="No narrower terms."
                onSelectTerm={onSelectTerm}
                indentByDepth
              />

              <HierarchySection
                icon={<Link2 size={14} className="text-bark" />}
                label="Related"
                terms={data.related_terms}
                emptyText="No related terms."
                onSelectTerm={onSelectTerm}
              />
            </div>
          ) : null}
        </div>
      </aside>
    </div>
    </ModalPortal>
  );
}

interface HierarchySectionProps {
  icon: React.ReactNode;
  label: string;
  terms: VocabularyTraversalTerm[];
  emptyText: string;
  onSelectTerm: (termId: string) => void;
  indentByDepth?: boolean;
}

function HierarchySection({
  icon,
  label,
  terms,
  emptyText,
  onSelectTerm,
  indentByDepth = false,
}: HierarchySectionProps) {
  return (
    <section className="px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink">
          {label}
        </h3>
        <span className="text-xs text-archive">({terms.length})</span>
      </div>
      {terms.length === 0 ? (
        <p className="text-xs text-archive italic">{emptyText}</p>
      ) : (
        <ul className="space-y-1">
          {terms.map((t) => {
            const indent = indentByDepth && t.depth ? Math.min(t.depth - 1, 5) * 12 : 0;
            const guide = isGuideTerm(t.preferred_term);
            return (
              <li key={t.term_id}>
                <button
                  type="button"
                  onClick={() => onSelectTerm(t.term_id)}
                  style={indent ? { paddingLeft: `${indent}px` } : undefined}
                  className={cn(
                    'w-full text-left text-sm hover:bg-stone/40 rounded px-2 py-1 transition-colors flex items-center gap-2',
                    guide
                      ? 'italic text-archive hover:text-ink'
                      : 'text-bark hover:text-copper-dark',
                  )}
                  title={
                    guide
                      ? 'Guide term — organizational, not applied to objects'
                      : undefined
                  }
                >
                  <span className="truncate">{t.preferred_term}</span>
                  {guide && (
                    <span className="text-[10px] uppercase tracking-wide text-archive shrink-0">
                      guide
                    </span>
                  )}
                  {t.external_id && (
                    <span className="text-xs text-archive font-mono shrink-0">
                      {t.vocabulary.toUpperCase()} · {t.external_id}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
