import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Checkbox from '../Checkbox';
import {
  Plus,
  BookOpen,
  Loader2,
  AlertCircle,
  ExternalLink,
  Search,
  Star,
  X,
  ArrowLeft,
} from 'lucide-react';
import {
  getObjectCitations,
  unlinkObjectCitation,
  linkObjectCitation,
  getCitations,
  createCitation,
  getCitation,
  updateCitation,
} from '../../lib/api';
import type { ObjectCitationLink, Citation } from '../../lib/schemas';
import SlideOver from '../ui/SlideOver';
import ConfirmDialog from '../ConfirmDialog';

interface ObjectCitationsManagerProps {
  organizationId: string;
  objectId: string;
  readOnly?: boolean;
  embedded?: boolean;
  onCountChange?: (count: number) => void;
}

const TYPE_LABELS: Record<string, string> = {
  book: 'Book',
  monograph: 'Monograph',
  article: 'Article',
  journal_article: 'Journal Article',
  exhibition_catalog: 'Exhibition Catalog',
  collection_catalog: 'Collection Catalog',
  auction_catalog: 'Auction Catalog',
  dissertation: 'Dissertation',
  thesis: 'Thesis',
  website: 'Website',
  database: 'Database',
  unpublished: 'Unpublished',
  correspondence: 'Correspondence',
  archival: 'Archival',
  newspaper: 'Newspaper',
  magazine: 'Magazine',
  other: 'Other',
};

const TYPE_OPTIONS = [
  { value: 'book', label: 'Book' },
  { value: 'article', label: 'Article' },
  { value: 'journal_article', label: 'Journal Article' },
  { value: 'exhibition_catalog', label: 'Exhibition Catalog' },
  { value: 'collection_catalog', label: 'Collection Catalog' },
  { value: 'auction_catalog', label: 'Auction Catalog' },
  { value: 'website', label: 'Website' },
  { value: 'archival', label: 'Archival' },
  { value: 'other', label: 'Other' },
];

const TYPE_STYLES: Record<string, string> = {
  book: 'badge-info-subtle',
  monograph: 'badge-info-subtle',
  article: 'bg-forest/10 text-forest',
  journal_article: 'bg-forest/10 text-forest',
  exhibition_catalog: 'bg-copper/10 text-copper',
  collection_catalog: 'bg-copper/10 text-copper',
  auction_catalog: 'bg-copper/10 text-copper',
  website: 'bg-bark/10 text-bark',
  other: 'badge-neutral',
};

export function ObjectCitationsManager({
  organizationId,
  objectId,
  readOnly = false,
  onCountChange,
}: ObjectCitationsManagerProps) {
  const queryClient = useQueryClient();
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [viewCitationId, setViewCitationId] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<{action: () => void; title: string; message: string} | null>(null);

  const {
    data: citationsData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['object-citations', organizationId, objectId],
    queryFn: () => getObjectCitations(organizationId, objectId),
    enabled: !!organizationId && !!objectId,
  });

  const unlinkMutation = useMutation({
    mutationFn: (linkId: string) => unlinkObjectCitation(organizationId, objectId, linkId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['object-citations', organizationId, objectId] });
      queryClient.invalidateQueries({ queryKey: ['collection-object', organizationId, objectId] });
    },
  });

  const citations = citationsData?.citations || [];
  useEffect(() => { onCountChange?.(citations.length); }, [citations.length, onCountChange]);

  const handleUnlink = (link: ObjectCitationLink) => {
    setConfirmState({
      action: () => unlinkMutation.mutate(link.link_id),
      title: 'Remove Citation',
      message: `Remove "${link.citation?.brief_citation || 'this citation'}" from this object?`,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 size={24} className="animate-spin text-archive" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-sm text-archive">
        <AlertCircle size={16} />
        <span>Failed to load citations</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-ink">
          Citations ({citations.length})
        </h4>
        {!readOnly && (
          <button
            onClick={() => setShowLinkModal(true)}
            className="flex items-center gap-1 text-sm text-bark hover:text-copper-dark"
          >
            <Plus size={14} />
            Add Citation
          </button>
        )}
      </div>

      {citations.length === 0 ? (
        <div className="text-sm text-archive italic py-4 text-center">
          No citations linked.
          {!readOnly && (
            <button
              onClick={() => setShowLinkModal(true)}
              className="block mx-auto mt-2 text-bark hover:text-copper-dark"
            >
              Add citation
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {citations.map((link: ObjectCitationLink) => (
            <div key={link.link_id}>
              <CitationLinkCard
                link={link}
                organizationId={organizationId}
                readOnly={readOnly}
                onUnlink={() => handleUnlink(link)}
                onView={() => setViewCitationId(link.citation?.citation_id || null)}
              />
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={() => { confirmState?.action(); setConfirmState(null); }}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        confirmText="Confirm"
        confirmStyle="danger"
      />

      {/* Link Citation SlideOver */}
      <LinkCitationSlideOver
        isOpen={showLinkModal}
        organizationId={organizationId}
        objectId={objectId}
        existingCitationIds={citations.map(c => c.citation_id)}
        onClose={() => setShowLinkModal(false)}
        onSuccess={() => {
          setShowLinkModal(false);
          queryClient.invalidateQueries({ queryKey: ['object-citations', organizationId, objectId] });
          queryClient.invalidateQueries({ queryKey: ['collection-object', organizationId, objectId] });
        }}
      />

      {/* Citation Detail SlideOver */}
      {viewCitationId && (
        <CitationDetailSlideOver
          isOpen={!!viewCitationId}
          organizationId={organizationId}
          citationId={viewCitationId}
          onClose={() => setViewCitationId(null)}
          onUpdated={() => {
            queryClient.invalidateQueries({ queryKey: ['object-citations', organizationId, objectId] });
          }}
        />
      )}
    </div>
  );
}

// Individual citation link card
function CitationLinkCard({
  link,
  organizationId: _organizationId,
  readOnly,
  onUnlink,
  onView,
}: {
  link: ObjectCitationLink;
  organizationId: string;
  readOnly: boolean;
  onUnlink: () => void;
  onView: () => void;
}) {
  const citation = link.citation;
  if (!citation) return null;

  return (
    <div className="flex items-center justify-between p-3 border border-lichen rounded-lg bg-parchment">
      <div className="flex items-center gap-3">
        <BookOpen size={16} className="text-archive" />
        <div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${TYPE_STYLES[citation.citation_type] || 'badge-neutral'}`}>
              {TYPE_LABELS[citation.citation_type] || citation.citation_type}
            </span>
            <span className="text-sm font-medium text-ink line-clamp-1">
              {citation.brief_citation}
            </span>
            {link.is_primary && (
              <Star size={12} className="text-semantic-warning fill-semantic-warning" />
            )}
          </div>
          <div className="text-xs text-archive mt-0.5">
            {citation.author && <span>{citation.author}</span>}
            {citation.publication_year && <span> ({citation.publication_year})</span>}
            {link.page_reference && <span> • p. {link.page_reference}</span>}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onView}
          className="text-bark hover:text-copper-dark p-1"
          title="View citation"
        >
          <ExternalLink size={14} />
        </button>
        {!readOnly && (
          <button
            onClick={onUnlink}
            className="text-semantic-error hover:text-semantic-error/80 p-1"
            title="Unlink citation"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

// SlideOver to link existing citation or create new one
interface LinkCitationSlideOverProps {
  isOpen: boolean;
  organizationId: string;
  objectId: string;
  existingCitationIds: string[];
  onClose: () => void;
  onSuccess: () => void;
}

type SlideOverMode = 'search' | 'link-details' | 'create';

function LinkCitationSlideOver({
  isOpen,
  organizationId,
  objectId,
  existingCitationIds,
  onClose,
  onSuccess,
}: LinkCitationSlideOverProps) {
  const [mode, setMode] = useState<SlideOverMode>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCitation, setSelectedCitation] = useState<Citation | null>(null);

  // Link details
  const [pageReference, setPageReference] = useState('');
  const [figureReference, setFigureReference] = useState('');
  const [worksCited, setWorksCited] = useState(true);
  const [worksIllustrated, setWorksIllustrated] = useState(false);
  const [linkNote, setLinkNote] = useState('');

  // Create citation fields
  const [citationType, setCitationType] = useState('book');
  const [briefCitation, setBriefCitation] = useState('');
  const [author, setAuthor] = useState('');
  const [publicationYear, setPublicationYear] = useState('');

  const [error, setError] = useState<string | null>(null);

  // Search citations
  const { data: searchResults, isLoading: searching } = useQuery({
    queryKey: ['citations-search', organizationId, searchQuery],
    queryFn: () => getCitations(organizationId, { search: searchQuery, limit: 20 }),
    enabled: !!organizationId && searchQuery.length >= 2 && mode === 'search',
  });

  // Link existing citation
  const linkMutation = useMutation({
    mutationFn: () => linkObjectCitation(organizationId, objectId, {
      citation_id: selectedCitation!.citation_id,
      page_reference: pageReference || undefined,
      figure_reference: figureReference || undefined,
      works_cited: worksCited,
      works_illustrated: worksIllustrated,
      link_note: linkNote || undefined,
    }),
    onSuccess,
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  // Create new citation and link it
  const createAndLinkMutation = useMutation({
    mutationFn: async () => {
      // First create the citation
      const newCitation = await createCitation(organizationId, {
        citation_type: citationType,
        brief_citation: briefCitation,
        author: author || undefined,
        publication_year: publicationYear ? parseInt(publicationYear) : undefined,
      });

      // Then link it to the object
      await linkObjectCitation(organizationId, objectId, {
        citation_id: newCitation.citation_id,
        page_reference: pageReference || undefined,
        works_cited: worksCited,
      });

      return newCitation;
    },
    onSuccess: () => {
      onSuccess();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleLink = () => {
    if (!selectedCitation) {
      setError('Please select a citation');
      return;
    }
    setError(null);
    linkMutation.mutate();
  };

  const handleCreate = () => {
    if (!briefCitation.trim()) {
      setError('Brief citation is required');
      return;
    }
    setError(null);
    createAndLinkMutation.mutate();
  };

  const handleSelectCitation = (citation: Citation) => {
    setSelectedCitation(citation);
    setMode('link-details');
  };

  const resetAndClose = () => {
    setMode('search');
    setSearchQuery('');
    setSelectedCitation(null);
    setPageReference('');
    setFigureReference('');
    setWorksCited(true);
    setWorksIllustrated(false);
    setLinkNote('');
    setCitationType('book');
    setBriefCitation('');
    setAuthor('');
    setPublicationYear('');
    setError(null);
    onClose();
  };

  // Filter out already linked citations
  const availableCitations = (searchResults?.items || []).filter(
    c => !existingCitationIds.includes(c.citation_id)
  );

  const getTitle = () => {
    switch (mode) {
      case 'search': return 'Add Citation';
      case 'link-details': return 'Link Citation';
      case 'create': return 'Create Citation';
    }
  };

  const getSubtitle = () => {
    switch (mode) {
      case 'search': return 'Search for an existing citation or create a new one';
      case 'link-details': return 'Add page references and notes';
      case 'create': return 'Create a new citation and link it to this object';
    }
  };

  return (
    <SlideOver
      isOpen={isOpen}
      onClose={resetAndClose}
      title={getTitle()}
      subtitle={getSubtitle()}
      width="md"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={resetAndClose} className="btn btn-secondary">
            Cancel
          </button>
          {mode === 'link-details' && (
            <button
              onClick={handleLink}
              disabled={linkMutation.isPending}
              className="btn btn-primary"
            >
              {linkMutation.isPending ? (
                <>
                  <Loader2 size={16} className="animate-spin mr-2" />
                  Linking...
                </>
              ) : (
                'Link Citation'
              )}
            </button>
          )}
          {mode === 'create' && (
            <button
              onClick={handleCreate}
              disabled={createAndLinkMutation.isPending || !briefCitation.trim()}
              className="btn btn-primary"
            >
              {createAndLinkMutation.isPending ? (
                <>
                  <Loader2 size={16} className="animate-spin mr-2" />
                  Creating...
                </>
              ) : (
                'Create & Edit'
              )}
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-5">
        {error && (
          <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-sm text-semantic-error">
            {error}
          </div>
        )}

        {mode === 'search' && (
          <>
            {/* Search */}
            <div className="relative">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-archive" />
              <input
                type="text"
                placeholder="Search citations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                autoFocus
              />
            </div>

            {/* Results */}
            <div className="max-h-64 overflow-y-auto border border-lichen rounded-lg">
              {searching ? (
                <div className="text-center py-6">
                  <Loader2 size={20} className="animate-spin mx-auto text-archive" />
                </div>
              ) : searchQuery.length < 2 ? (
                <p className="text-sm text-archive text-center py-6">
                  Type at least 2 characters to search
                </p>
              ) : availableCitations.length === 0 ? (
                <p className="text-sm text-archive text-center py-6">
                  No citations found
                </p>
              ) : (
                availableCitations.map((citation) => (
                  <button
                    key={citation.citation_id}
                    onClick={() => handleSelectCitation(citation)}
                    className="w-full text-left p-3 hover:bg-stone/30 border-b border-lichen last:border-b-0 transition-colors"
                  >
                    <div className="flex items-start gap-2">
                      <span className={`shrink-0 inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${TYPE_STYLES[citation.citation_type] || 'badge-neutral'}`}>
                        {TYPE_LABELS[citation.citation_type] || citation.citation_type}
                      </span>
                      <div>
                        <p className="text-sm font-medium text-ink">{citation.brief_citation}</p>
                        {citation.author && (
                          <p className="text-xs text-archive">
                            {citation.author}
                            {citation.publication_year && ` (${citation.publication_year})`}
                          </p>
                        )}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>

            <div className="pt-2 border-t border-lichen">
              <button
                onClick={() => setMode('create')}
                className="text-sm text-bark hover:text-copper-dark flex items-center gap-1"
              >
                <Plus size={14} />
                Create new citation
              </button>
            </div>
          </>
        )}

        {mode === 'link-details' && selectedCitation && (
          <>
            {/* Back button */}
            <button
              onClick={() => { setMode('search'); setSelectedCitation(null); }}
              className="text-sm text-archive hover:text-ink flex items-center gap-1"
            >
              <ArrowLeft size={14} />
              Back to search
            </button>

            {/* Selected citation */}
            <div className="p-3 bg-stone/30 rounded-lg">
              <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${TYPE_STYLES[selectedCitation.citation_type] || 'badge-neutral'}`}>
                {TYPE_LABELS[selectedCitation.citation_type] || selectedCitation.citation_type}
              </span>
              <p className="text-sm font-medium text-ink mt-1">{selectedCitation.brief_citation}</p>
              {selectedCitation.author && (
                <p className="text-xs text-archive">
                  {selectedCitation.author}
                  {selectedCitation.publication_year && ` (${selectedCitation.publication_year})`}
                </p>
              )}
            </div>

            {/* Link details */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">Page(s)</label>
                <input
                  type="text"
                  value={pageReference}
                  onChange={(e) => setPageReference(e.target.value)}
                  placeholder="e.g., 45-48"
                  className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">Figure</label>
                <input
                  type="text"
                  value={figureReference}
                  onChange={(e) => setFigureReference(e.target.value)}
                  placeholder="e.g., 12"
                  className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                />
              </div>
            </div>

            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={worksCited}
                  onChange={(e) => setWorksCited(e.target.checked)}
                />
                <span className="text-sm text-ink">Works Cited</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={worksIllustrated}
                  onChange={(e) => setWorksIllustrated(e.target.checked)}
                />
                <span className="text-sm text-ink">Works Illustrated</span>
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Note</label>
              <textarea
                value={linkNote}
                onChange={(e) => setLinkNote(e.target.value)}
                placeholder="Additional notes..."
                rows={2}
                className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
              />
            </div>
          </>
        )}

        {mode === 'create' && (
          <>
            {/* Back button */}
            <button
              onClick={() => setMode('search')}
              className="text-sm text-archive hover:text-ink flex items-center gap-1"
            >
              <ArrowLeft size={14} />
              Back to search
            </button>

            {/* Citation Type */}
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">
                Citation Type <span className="text-semantic-error">*</span>
              </label>
              <select
                value={citationType}
                onChange={(e) => setCitationType(e.target.value)}
                className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
              >
                {TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Brief Citation */}
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">
                Brief Citation <span className="text-semantic-error">*</span>
              </label>
              <input
                type="text"
                value={briefCitation}
                onChange={(e) => setBriefCitation(e.target.value)}
                placeholder="e.g., Smith 2020"
                className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
              />
            </div>

            {/* Author */}
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">
                Author
              </label>
              <input
                type="text"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="e.g., John Smith"
                className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
              />
            </div>

            {/* Publication Year */}
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">
                Publication Year
              </label>
              <input
                type="text"
                value={publicationYear}
                onChange={(e) => setPublicationYear(e.target.value)}
                placeholder="e.g., 2020"
                className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
              />
            </div>

            {/* Page Reference for the link */}
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">
                Page Reference (for this object)
              </label>
              <input
                type="text"
                value={pageReference}
                onChange={(e) => setPageReference(e.target.value)}
                placeholder="e.g., 45-48"
                className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
              />
            </div>

            <p className="text-xs text-archive">
              A citation record will be created and linked to this object.
            </p>
          </>
        )}
      </div>
    </SlideOver>
  );
}

// Detail/edit slide-over for viewing a citation inline
function CitationDetailSlideOver({
  isOpen,
  organizationId,
  citationId,
  onClose,
  onUpdated,
}: {
  isOpen: boolean;
  organizationId: string;
  citationId: string;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const { data: citation, isLoading } = useQuery({
    queryKey: ['citation', organizationId, citationId],
    queryFn: () => getCitation(organizationId, citationId),
    enabled: isOpen && !!citationId,
  });

  const [formData, setFormData] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (citation) {
      setFormData({
        citation_type: citation.citation_type || 'book',
        brief_citation: citation.brief_citation || '',
        full_citation: (citation as Record<string, unknown>).full_citation as string || '',
        author: citation.author || '',
        title: (citation as Record<string, unknown>).title as string || '',
        publication: (citation as Record<string, unknown>).publication as string || '',
        publisher: (citation as Record<string, unknown>).publisher as string || '',
        publication_place: (citation as Record<string, unknown>).publication_place as string || '',
        publication_year:
          citation.publication_year != null ? String(citation.publication_year) : '',
        volume: (citation as Record<string, unknown>).volume as string || '',
        issue: (citation as Record<string, unknown>).issue as string || '',
        pages: (citation as Record<string, unknown>).pages as string || '',
        url: (citation as Record<string, unknown>).url as string || '',
        doi: (citation as Record<string, unknown>).doi as string || '',
        isbn: (citation as Record<string, unknown>).isbn as string || '',
        notes: (citation as Record<string, unknown>).notes as string || '',
      });
      setDirty(false);
    }
  }, [citation]);

  const updateMutation = useMutation({
    mutationFn: (updates: Record<string, unknown>) =>
      updateCitation(organizationId, citationId, updates),
    onSuccess: () => {
      setDirty(false);
      onUpdated();
    },
  });

  const updateField = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setDirty(true);
  };

  const handleSave = () => {
    updateMutation.mutate(formData);
  };

  const inputClass = 'w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark';

  const field = (label: string, key: string, opts?: { multiline?: boolean; placeholder?: string }) => (
    <div>
      <label className="text-sm font-medium text-ink block mb-1.5">{label}</label>
      {opts?.multiline ? (
        <textarea
          value={formData[key] || ''}
          onChange={(e) => updateField(key, e.target.value)}
          placeholder={opts?.placeholder}
          rows={3}
          className={`${inputClass} resize-none`}
        />
      ) : (
        <input
          type="text"
          value={formData[key] || ''}
          onChange={(e) => updateField(key, e.target.value)}
          placeholder={opts?.placeholder}
          className={inputClass}
        />
      )}
    </div>
  );

  return (
    <SlideOver
      isOpen={isOpen}
      onClose={onClose}
      title="Citation Details"
      subtitle={formData.brief_citation || undefined}
      width="md"
      footer={
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-archive hover:text-ink">Close</button>
          {dirty && (
            <button onClick={handleSave} disabled={updateMutation.isPending} className="btn btn-primary text-sm">
              {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
            </button>
          )}
        </div>
      }
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 size={24} className="animate-spin text-archive" />
        </div>
      ) : (
        <div className="space-y-5">
          <div>
            <label className="text-sm font-medium text-ink block mb-1.5">Type</label>
            <select
              value={formData.citation_type || 'book'}
              onChange={(e) => updateField('citation_type', e.target.value)}
              className={inputClass}
            >
              {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {field('Brief Citation', 'brief_citation', { placeholder: 'e.g., Smith 2020' })}
          {field('Full Citation', 'full_citation', { multiline: true, placeholder: 'Full bibliographic reference...' })}
          <div className="grid grid-cols-2 gap-4">
            {field('Author', 'author', { placeholder: 'Author name' })}
            {field('Year', 'publication_year', { placeholder: 'e.g., 2020' })}
          </div>
          {field('Title', 'title', { placeholder: 'Publication title' })}
          <div className="grid grid-cols-2 gap-4">
            {field('Publication', 'publication', { placeholder: 'Journal or series' })}
            {field('Publisher', 'publisher', { placeholder: 'Publisher name' })}
          </div>
          <div className="grid grid-cols-2 gap-4">
            {field('Place', 'publication_place', { placeholder: 'City' })}
            {field('Volume', 'volume')}
          </div>
          <div className="grid grid-cols-2 gap-4">
            {field('Issue', 'issue')}
            {field('Pages', 'pages', { placeholder: 'e.g., 45-48' })}
          </div>
          <div className="grid grid-cols-2 gap-4">
            {field('URL', 'url', { placeholder: 'https://...' })}
            {field('DOI', 'doi', { placeholder: '10.xxxx/...' })}
          </div>
          {field('ISBN', 'isbn')}
          {field('Notes', 'notes', { multiline: true })}
        </div>
      )}
    </SlideOver>
  );
}

export default ObjectCitationsManager;
