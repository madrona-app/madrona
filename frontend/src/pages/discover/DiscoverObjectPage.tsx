import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  X,
  Image,
  ZoomIn,
} from 'lucide-react';
import { Helmet } from 'react-helmet-async';
import { getDiscoverObject, getDiscoverInfo } from '../../lib/api';
import { ApiError } from '../../lib/apiClient';
import type { DiscoverMediaItem } from '../../types/discover';
import { CollectionSiteShell } from './components/CollectionSiteShell';
import { RelatedObjects } from './components/RelatedObjects';
import { ShareToolbar } from './components/ShareToolbar';
import { ResponsiveImage } from '../../components/ui/ResponsiveImage';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

// ============================================================================
// Lightbox
// ============================================================================

function Lightbox({
  media,
  currentIndex,
  onClose,
  onPrev,
  onNext,
}: {
  media: DiscoverMediaItem[];
  currentIndex: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const item = media[currentIndex];

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') onPrev();
      if (e.key === 'ArrowRight') onNext();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose, onPrev, onNext]);

  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  if (!item) return null;

  return (
    <div className="fixed inset-0 z-50 bg-ink/95 flex items-center justify-center">
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-parchment/70 hover:text-parchment z-10 p-2"
      >
        <X size={28} />
      </button>

      {media.length > 1 && (
        <>
          <button
            onClick={onPrev}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-parchment/70 hover:text-parchment p-2"
          >
            <ChevronLeft size={36} />
          </button>
          <button
            onClick={onNext}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-parchment/70 hover:text-parchment p-2"
          >
            <ChevronRight size={36} />
          </button>
        </>
      )}

      <ResponsiveImage
        src={item.url}
        srcset={item.srcset}
        alt={item.alt_text || 'Object image'}
        sizes="90vw"
        className="max-w-[90vw] max-h-[90vh] object-contain"
        loading="eager"
      />

      {media.length > 1 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-parchment/60 text-sm">
          {currentIndex + 1} / {media.length}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Metadata Row
// ============================================================================

function MetadataRow({ label, children }: { label: string; children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div className="py-3 border-b border-lichen">
      <dt className="text-xs font-medium text-archive uppercase tracking-wide mb-1">{label}</dt>
      <dd className="text-sm text-ink">{children}</dd>
    </div>
  );
}

// ============================================================================
// Main Page
// ============================================================================

/**
 * Builds a schema.org VisualArtwork JSON-LD payload from the public object
 * detail response. Drives rich results in Google/Bing, LOD consumers, and
 * link-preview unfurlers. Fields kept loose-typed (`any`) because the public
 * API is a denormalized DTO, not a strictly shaped schema.
 */
function buildObjectJsonLd(
  obj: any,
  info: any,
  orgSlug: string | undefined,
): Record<string, unknown> {
  const materials: string[] = (obj.materials || [])
    .map((m: { label?: string; name?: string }) => m.label || m.name)
    .filter(Boolean);
  const techniques: string[] = (obj.techniques || [])
    .map((t: { label?: string; name?: string }) => t.label || t.name)
    .filter(Boolean);

  // Resolve primary + additional image URLs from the media array.
  const imageUrls: string[] = (obj.media || [])
    .map((m: { url?: string; full_url?: string; thumbnail_url?: string }) =>
      m.url || m.full_url || m.thumbnail_url,
    )
    .filter(Boolean);

  const creators = (obj.creators || []).map((c: string | { name?: string }) =>
    typeof c === 'string'
      ? { '@type': 'Person', name: c }
      : { '@type': 'Person', name: c.name || '' },
  );

  const publisher = info?.organization_name
    ? {
        '@type': 'Organization',
        name: info.organization_name,
        ...(orgSlug
          ? { url: `${window.location.origin}/c/${orgSlug}` }
          : {}),
      }
    : undefined;

  // Drop undefined keys so the emitted JSON is clean.
  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'VisualArtwork',
    name: obj.title || 'Untitled',
    ...(obj.brief_description ? { description: obj.brief_description } : {}),
    ...(obj.object_number ? { identifier: obj.object_number } : {}),
    ...(obj.canonical_url ? { url: obj.canonical_url } : {}),
    ...(obj.creation_date_display ? { dateCreated: obj.creation_date_display } : {}),
    ...(creators.length > 0 ? { creator: creators } : {}),
    ...(materials.length > 0 ? { artMedium: materials.join(', ') } : {}),
    ...(techniques.length > 0 ? { artworkSurface: techniques.join(', ') } : {}),
    ...(imageUrls.length > 0 ? { image: imageUrls.length === 1 ? imageUrls[0] : imageUrls } : {}),
    ...(publisher ? { publisher, isPartOf: publisher } : {}),
    inLanguage: info?.default_language || 'en',
  };

  return jsonLd;
}


export function DiscoverObjectPage() {
  const { orgSlug, objectId } = useParams<{ orgSlug: string; objectId: string }>();
  const [searchParams] = useSearchParams();
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);

  // Hide the initial loading overlay
  useEffect(() => {
    const loader = document.getElementById('initial-loader');
    if (loader) {
      loader.classList.add('fade-out');
      setTimeout(() => loader.remove(), 300);
    }
  }, []);

  // Fetch collection info for header
  const { data: info } = useQuery({
    queryKey: ['discover-info', orgSlug],
    queryFn: () => getDiscoverInfo(orgSlug!),
    enabled: !!orgSlug,
  });

  // Fetch object detail
  const { data: obj, isLoading, error } = useQuery({
    queryKey: ['discover-object', orgSlug, objectId],
    queryFn: () => getDiscoverObject(orgSlug!, objectId!),
    enabled: !!orgSlug && !!objectId,
  });

  // Detect QR scan source — log interaction and auto-open chat (once per object per session)
  useEffect(() => {
    const src = searchParams.get('src');
    if (src !== 'qr' || !orgSlug || !objectId) return;

    const guardKey = `madrona-qr-logged:${objectId}`;
    if (sessionStorage.getItem(guardKey)) return;

    const sessionId = localStorage.getItem(`madrona-visitor-session:${orgSlug}`);
    if (!sessionId) return;

    sessionStorage.setItem(guardKey, '1');

    // Same-origin by default — see lib/apiClient.ts.
    const baseUrl = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/api\/?$/, '');
    fetch(`${baseUrl}/api/guide/${orgSlug}/visitor/interaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        interaction_type: 'qr_scan',
        entity_type: 'collection_object',
        entity_id: objectId,
        source: 'qr_scan',
      }),
    }).catch(() => { /* non-critical */ });

    // Auto-open the chat widget
    sessionStorage.setItem('madrona-visitor-chat-open', '1');
  }, [searchParams, orgSlug, objectId]);

  // Build "back to results" link preserving search state
  const backLink = `/c/${orgSlug}${searchParams.toString() ? '?' + searchParams.toString() : ''}`;

  const handleLightboxPrev = useCallback(() => {
    if (!obj) return;
    setLightboxIndex((prev) => (prev !== null && prev > 0 ? prev - 1 : obj.media.length - 1));
  }, [obj]);

  const handleLightboxNext = useCallback(() => {
    if (!obj) return;
    setLightboxIndex((prev) => (prev !== null && prev < obj.media.length - 1 ? prev + 1 : 0));
  }, [obj]);

  if (isLoading) {
    return (
      <CollectionSiteShell info={info} orgSlug={orgSlug!} contextEntityType="collection_object" contextEntityId={objectId}>
        <div className="flex items-center justify-center py-20">
          <MadronaLoader />
        </div>
      </CollectionSiteShell>
    );
  }

  if (error || !obj) {
    const isRateLimit = error instanceof ApiError && error.status === 429;
    return (
      <CollectionSiteShell info={info} orgSlug={orgSlug!} contextEntityType="collection_object" contextEntityId={objectId}>
        <div className="max-w-6xl mx-auto px-4 py-4">
          <Link
            to={`/c/${orgSlug}`}
            className="text-archive hover:text-bark text-sm flex items-center gap-1 mb-8"
          >
            <ArrowLeft size={16} />
            Back to collection
          </Link>
        </div>
        <div className="max-w-6xl mx-auto px-4 py-12 text-center">
          {isRateLimit ? (
            <>
              <AlertTriangle className="w-12 h-12 text-semantic-warning mx-auto mb-4" />
              <h1 className="text-2xl font-medium text-ink mb-2">Too many requests</h1>
              <p className="text-archive">You're browsing too quickly. Please wait a moment and try again.</p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-medium text-ink mb-2">Object Not Found</h1>
              <p className="text-archive">This object is not available or has not been published.</p>
            </>
          )}
        </div>
      </CollectionSiteShell>
    );
  }

  const currentMedia = obj.media[selectedImageIndex] || obj.media[0];

  // Format display strings
  const materialsDisplay = obj.materials
    ?.map((m) => m.value || m.name)
    .filter(Boolean)
    .join(', ');

  const techniquesDisplay = obj.techniques
    ?.map((t: { value?: string; name?: string }) => t.value || t.name)
    .filter(Boolean)
    .join(', ');

  const measurementsDisplay = obj.measurements
    ?.map((m: { type?: string; value: number; unit?: string }) => `${m.type || ''}: ${m.value} ${m.unit || ''}`.trim())
    .join('; ');

  const inscriptionsDisplay = obj.inscriptions
    ?.map((i: { content?: string; text?: string }) => i.content || i.text)
    .filter(Boolean)
    .join('; ');

  return (
    <CollectionSiteShell info={info} orgSlug={orgSlug!} contextEntityType="collection_object" contextEntityId={objectId}>
      <Helmet>
        <title>
          {[obj.title || 'Untitled', info?.organization_name].filter(Boolean).join(' | ')}
        </title>
        <meta
          name="description"
          content={
            [
              obj.creators.length > 0 ? obj.creators.join(', ') : null,
              obj.creation_date_display,
              obj.brief_description,
            ]
              .filter(Boolean)
              .join(' — ')
              .slice(0, 200) || 'View this object in the collection.'
          }
        />
        {obj.canonical_url && <link rel="canonical" href={obj.canonical_url} />}
        {/* JSON-LD: VisualArtwork — lets search engines and LOD consumers
            parse structured metadata about the object. Kept in sync with the
            LOD export at GET /api/organizations/{org}/collections/objects/{id}/export/json-ld. */}
        <script type="application/ld+json">
          {JSON.stringify(buildObjectJsonLd(obj, info, orgSlug))}
        </script>
      </Helmet>

      {/* Back + share bar */}
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link
          to={backLink}
          className="text-archive hover:text-bark text-sm flex items-center gap-1 transition-colors"
        >
          <ArrowLeft size={16} />
          Back to results
        </Link>
        <ShareToolbar
          url={obj.canonical_url}
          title={obj.title || 'Untitled'}
        />
      </div>

      {/* Image hero */}
      <div className="bg-stone/20">
        <div className="max-w-7xl mx-auto flex items-center justify-center py-8 px-4">
          {currentMedia ? (
            <button
              onClick={() => setLightboxIndex(selectedImageIndex)}
              className="relative group cursor-zoom-in"
            >
              <ResponsiveImage
                src={currentMedia.url}
                srcset={currentMedia.srcset}
                alt={currentMedia.alt_text || obj.title || 'Object'}
                sizes="(max-width: 768px) 100vw, 60vw"
                className="max-h-[70vh] object-contain rounded"
                loading="eager"
              />
              <div className="absolute inset-0 bg-ink/0 group-hover:bg-ink/10 transition-colors flex items-center justify-center rounded">
                <ZoomIn className="w-8 h-8 text-parchment opacity-0 group-hover:opacity-70 transition-opacity" />
              </div>
            </button>
          ) : (
            <div className="w-full max-w-lg aspect-square flex items-center justify-center">
              <Image className="w-20 h-20 text-archive/30" />
            </div>
          )}
        </div>

        {/* Thumbnail strip */}
        {obj.media.length > 1 && (
          <div className="max-w-7xl mx-auto px-4 pb-6">
            <div className="flex gap-2 overflow-x-auto pb-2 justify-center">
              {obj.media.map((m, i) => (
                <button
                  key={m.media_id}
                  onClick={() => setSelectedImageIndex(i)}
                  className={`w-16 h-16 flex-shrink-0 rounded overflow-hidden border-2 transition-colors ${
                    selectedImageIndex === i
                      ? 'border-bark'
                      : 'border-transparent hover:border-archive/30'
                  }`}
                >
                  <ResponsiveImage
                    src={m.url}
                    srcset={m.srcset}
                    alt={m.alt_text || `Image ${i + 1}`}
                    sizes="64px"
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Metadata */}
      <div className="max-w-7xl mx-auto px-4 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-10">
          {/* Left column: title, description, provenance */}
          <div className="lg:col-span-3">
            {obj.object_number && (
              <p className="text-xs text-archive mb-2 tracking-wide">{obj.object_number}</p>
            )}

            <h1 className="font-serif text-3xl font-light text-ink mb-2">
              {obj.title || 'Untitled'}
            </h1>

            {obj.creators.length > 0 && (
              <p className="text-lg text-archive mb-1">
                {obj.creators.join(', ')}
              </p>
            )}

            {obj.creation_date_display && (
              <p className="text-sm text-archive mb-6">{obj.creation_date_display}</p>
            )}

            {obj.brief_description && (
              <div className="mb-6">
                <h2 className="text-xs font-medium text-archive uppercase tracking-wide mb-2">
                  Description
                </h2>
                <p className="text-sm text-ink leading-relaxed">{obj.brief_description}</p>
              </div>
            )}

            {obj.full_description && obj.full_description !== obj.brief_description && (
              <div className="mb-6">
                <p className="text-sm text-ink leading-relaxed">{obj.full_description}</p>
              </div>
            )}

            {obj.provenance && (
              <div className="mb-6">
                <h2 className="text-xs font-medium text-archive uppercase tracking-wide mb-2">
                  Provenance
                </h2>
                <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap">
                  {obj.provenance}
                </p>
              </div>
            )}
          </div>

          {/* Right column: structured metadata */}
          <div className="lg:col-span-2">
            <dl className="space-y-0">
              <MetadataRow label="Object Type">{obj.object_type}</MetadataRow>
              <MetadataRow label="Classification">{obj.classification}</MetadataRow>
              <MetadataRow label="Medium">{materialsDisplay}</MetadataRow>
              <MetadataRow label="Technique">{techniquesDisplay}</MetadataRow>
              <MetadataRow label="Dimensions">{measurementsDisplay}</MetadataRow>
              <MetadataRow label="Creation Place">{obj.creation_place}</MetadataRow>
              <MetadataRow label="Style / Period">{obj.style_period}</MetadataRow>
              <MetadataRow label="Inscriptions">{inscriptionsDisplay}</MetadataRow>
              <MetadataRow label="Credit Line">{obj.credit_line}</MetadataRow>
            </dl>

            {/* Attribution */}
            {currentMedia?.attribution && (
              <p className="text-xs text-archive mt-4">{currentMedia.attribution}</p>
            )}
          </div>
        </div>
      </div>

      {/* Related Objects */}
      <RelatedObjects orgSlug={orgSlug!} objectId={objectId!} />

      {/* Lightbox */}
      {lightboxIndex !== null && (
        <Lightbox
          media={obj.media}
          currentIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onPrev={handleLightboxPrev}
          onNext={handleLightboxNext}
        />
      )}
    </CollectionSiteShell>
  );
}
