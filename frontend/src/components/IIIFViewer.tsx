import { useEffect, useRef, useState, useCallback } from 'react';
import { ModalPortal } from './ModalPortal';
import {
  ZoomIn,
  ZoomOut,
  RotateCw,
  Maximize,
  Minimize,
  Home,
  ChevronLeft,
  ChevronRight,
  Info,
  Download,
  X,
} from 'lucide-react';
import { logger } from '../lib/logger';
import { MadronaLoader } from './ui/MadronaLoader';

interface IIIFViewerProps {
  manifestUrl?: string;
  infoJsonUrl?: string;
  imageUrl?: string;
  className?: string;
  showNavigation?: boolean;
  showInfo?: boolean;
  /** Render as a fullscreen modal with close button */
  modal?: boolean;
  /** Callback when modal close button is clicked */
  onClose?: () => void;
  /** Callback to open a download request form. When set, a download button appears in the toolbar. */
  onRequestDownload?: () => void;
}

// Declare OpenSeadragon on window
declare global {
  interface Window {
    OpenSeadragon?: any;
  }
}

export default function IIIFViewer({
  manifestUrl,
  infoJsonUrl,
  imageUrl,
  className = '',
  showNavigation = true,
  showInfo = true,
  modal = false,
  onClose,
  onRequestDownload,
}: IIIFViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [manifest, setManifest] = useState<any>(null);
  const [showMetadata, setShowMetadata] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tileSources, setTileSources] = useState<any[]>([]);
  const [osdReady, setOsdReady] = useState(false);

  // Load OpenSeadragon from the bundle.
  //
  // This used to inject a <script> pointing at cdn.jsdelivr.net. The app is
  // served with a strict `script-src 'self'` CSP, so the browser refused it
  // and the viewer failed with "Failed to load image viewer library" — in
  // every deployment behind that nginx config, not just offline ones. The
  // package was already a declared dependency and installed; only the loading
  // path went to a CDN.
  //
  // Bundling it also matters for the product: museums self-host this, often
  // on networks that do not reach a public CDN, and a viewer that silently
  // depends on one is a viewer that does not work there. Dynamic import keeps
  // it out of the initial chunk, which is what the CDN load was buying.
  useEffect(() => {
    if (window.OpenSeadragon) {
      setOsdReady(true);
      return;
    }

    let cancelled = false;
    import('openseadragon')
      .then((mod) => {
        if (cancelled) return;
        window.OpenSeadragon = mod.default ?? mod;
        setOsdReady(true);
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load image viewer library');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Load manifest and extract tile sources
  useEffect(() => {
    if (!manifestUrl && !infoJsonUrl && !imageUrl) {
      setError('No image source provided');
      setIsLoading(false);
      return;
    }

    const loadManifest = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const sources: any[] = [];

        if (manifestUrl) {
          let response: Response;
          try {
            response = await fetch(manifestUrl, { credentials: 'include' });
          } catch {
            throw new Error('Could not connect to image server');
          }
          if (!response.ok) {
            throw new Error(`Image server returned ${response.status}`);
          }
          let manifestData: any;
          try {
            manifestData = await response.json();
          } catch {
            throw new Error('Image server returned invalid data');
          }
          setManifest(manifestData);

          const items = manifestData.items || manifestData.sequences?.[0]?.canvases || [];
          setTotalPages(items.length);

          for (const item of items) {
            try {
              const annotations = item.items?.[0]?.items || [];
              for (const anno of annotations) {
                const body = anno.body;
                if (body?.service?.[0]) {
                  sources.push({
                    '@context': 'http://iiif.io/api/image/3/context.json',
                    id: body.service[0].id,
                    type: 'ImageService3',
                    profile: body.service[0].profile || 'level2',
                    width: body.width,
                    height: body.height,
                  });
                } else if (body?.id) {
                  sources.push({
                    type: 'image',
                    url: body.id,
                    crossOriginPolicy: 'Anonymous',
                  });
                }
              }
            } catch {
              // Skip malformed canvas items
              continue;
            }
          }
        } else if (infoJsonUrl) {
          sources.push(infoJsonUrl);
          setTotalPages(1);
        } else if (imageUrl) {
          sources.push({
            type: 'image',
            url: imageUrl,
            crossOriginPolicy: 'Anonymous',
          });
          setTotalPages(1);
        }

        if (sources.length === 0) {
          throw new Error('No image sources found in manifest');
        }

        setTileSources(sources);
        setCurrentPage(0);
      } catch (e) {
        logger.error('Failed to load manifest:', e);
        setError((e as Error).message);
        setIsLoading(false);
      }
    };

    loadManifest();
  }, [manifestUrl, infoJsonUrl, imageUrl]);

  // Create viewer when ready
  useEffect(() => {
    const container = containerRef.current;
    if (!container || tileSources.length === 0 || !osdReady || !window.OpenSeadragon) {
      return;
    }

    // Destroy existing viewer
    if (viewerRef.current) {
      try {
        viewerRef.current.destroy();
      } catch (e) {
        logger.warn('Error destroying viewer:', e);
      }
      viewerRef.current = null;
    }

    setIsLoading(true);
    setError(null);

    try {
      const tileSource = tileSources[currentPage];

      viewerRef.current = window.OpenSeadragon({
        element: container,
        tileSources: tileSource,
        crossOriginPolicy: 'Anonymous',
        showNavigationControl: false,
        showFullPageControl: false,
        showZoomControl: false,
        showHomeControl: false,
        showRotationControl: false,
        gestureSettingsMouse: {
          clickToZoom: true,
          dblClickToZoom: true,
          scrollToZoom: true,
        },
        gestureSettingsTouch: {
          pinchToZoom: true,
          flickEnabled: true,
        },
        animationTime: 0.5,
        springStiffness: 10,
        visibilityRatio: 0.5,
        minZoomLevel: 0.5,
        maxZoomLevel: 10,
        constrainDuringPan: true,
      });

      viewerRef.current.addOnceHandler('open', () => {
        setIsLoading(false);
      });

      viewerRef.current.addOnceHandler('open-failed', (event: any) => {
        logger.error('OpenSeadragon open-failed:', event);
        setError('Failed to load image');
        setIsLoading(false);
      });

    } catch (e) {
      logger.error('Failed to initialize viewer:', e);
      setError((e as Error).message);
      setIsLoading(false);
    }

    return () => {
      if (viewerRef.current) {
        try {
          viewerRef.current.destroy();
        } catch (e) {
          logger.warn('Error destroying viewer:', e);
        }
        viewerRef.current = null;
      }
    };
  }, [tileSources, currentPage, osdReady]);

  // Viewer controls
  const zoomIn = useCallback(() => viewerRef.current?.viewport?.zoomBy(1.5), []);
  const zoomOut = useCallback(() => viewerRef.current?.viewport?.zoomBy(0.67), []);
  const resetView = useCallback(() => viewerRef.current?.viewport?.goHome(), []);
  const rotateRight = useCallback(() => {
    if (viewerRef.current?.viewport) {
      const current = viewerRef.current.viewport.getRotation() || 0;
      viewerRef.current.viewport.setRotation(current + 90);
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!document.fullscreenElement) {
      container.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, []);

  const goToPage = useCallback((page: number) => {
    if (page >= 0 && page < tileSources.length) {
      setCurrentPage(page);
    }
  }, [tileSources.length]);

  // Fullscreen change handler
  useEffect(() => {
    const handler = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const viewerContent = (
    // eslint-disable-next-line madrona/no-generic-tailwind-colors -- image viewer needs true black, not ink
    <div className={`relative bg-black ${modal ? 'w-full h-full' : className}`}>
      {/* Modal close button — hidden when metadata panel is open (it has its own close) */}
      {modal && onClose && !showMetadata && (
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-20 p-2 bg-ink/70 hover:bg-ink/90 text-parchment rounded-lg"
        >
          <X size={24} />
        </button>
      )}

      {/* Viewer container */}
      <div
        ref={containerRef}
        className="w-full h-full min-h-[400px]"
        style={{ background: '#1a1a1a' }}
      />

      {/* Loading state */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-ink/50">
          <div className="text-parchment text-center">
            <MadronaLoader />
            <p>Loading viewer...</p>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-ink/50">
          <div className="text-parchment text-center bg-semantic-error/80 p-4 rounded max-w-md">
            <p className="font-medium mb-2">Failed to load image</p>
            <p className="text-sm text-semantic-error">{error}</p>
          </div>
        </div>
      )}

      {/* Navigation controls */}
      {showNavigation && !isLoading && !error && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-ink/70 rounded-lg p-1">
          <button
            onClick={zoomOut}
            className="p-2 text-parchment hover:bg-parchment/20 rounded"
            title="Zoom out"
          >
            <ZoomOut size={20} />
          </button>
          <button
            onClick={zoomIn}
            className="p-2 text-parchment hover:bg-parchment/20 rounded"
            title="Zoom in"
          >
            <ZoomIn size={20} />
          </button>
          <div className="w-px h-6 bg-parchment/30 mx-1" />
          <button
            onClick={resetView}
            className="p-2 text-parchment hover:bg-parchment/20 rounded"
            title="Reset view"
          >
            <Home size={20} />
          </button>
          <button
            onClick={rotateRight}
            className="p-2 text-parchment hover:bg-parchment/20 rounded"
            title="Rotate"
          >
            <RotateCw size={20} />
          </button>
          <div className="w-px h-6 bg-parchment/30 mx-1" />
          <button
            onClick={toggleFullscreen}
            className="p-2 text-parchment hover:bg-parchment/20 rounded"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
          </button>
          {onRequestDownload && (
            <>
              <div className="w-px h-6 bg-parchment/30 mx-1" />
              <button
                onClick={onRequestDownload}
                className="p-2 text-parchment hover:bg-parchment/20 rounded"
                title="Request download"
              >
                <Download size={20} />
              </button>
            </>
          )}
        </div>
      )}

      {/* Page navigation (for multi-page manifests) */}
      {totalPages > 1 && !isLoading && !error && (
        <div className="absolute bottom-4 right-4 flex items-center gap-2 bg-ink/70 rounded-lg p-1">
          <button
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage === 0}
            className="p-2 text-parchment hover:bg-parchment/20 rounded disabled:opacity-50"
          >
            <ChevronLeft size={20} />
          </button>
          <span className="text-parchment text-sm px-2">
            {currentPage + 1} / {totalPages}
          </span>
          <button
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage === totalPages - 1}
            className="p-2 text-parchment hover:bg-parchment/20 rounded disabled:opacity-50"
          >
            <ChevronRight size={20} />
          </button>
        </div>
      )}

      {/* Info button */}
      {showInfo && manifest && !isLoading && !error && (
        <>
          <button
            onClick={() => setShowMetadata(!showMetadata)}
            className={`absolute top-4 p-2 text-parchment bg-ink/70 hover:bg-ink/90 rounded ${modal ? 'right-16' : 'right-4'}`}
            title="Show metadata"
          >
            <Info size={20} />
          </button>

          {/* Metadata panel */}
          {showMetadata && (
            <div className="absolute top-0 right-0 w-80 h-full bg-parchment shadow-xl overflow-y-auto z-10">
              <div className="p-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-medium">Image Information</h3>
                  <button onClick={() => setShowMetadata(false)}>
                    <X size={20} />
                  </button>
                </div>

                {manifest.label && (
                  <div className="mb-3">
                    <p className="text-sm text-archive">Title</p>
                    <p className="font-medium">{getLabel(manifest.label)}</p>
                  </div>
                )}

                {manifest.summary && (
                  <div className="mb-3">
                    <p className="text-sm text-archive">Description</p>
                    <p className="text-sm">{getLabel(manifest.summary)}</p>
                  </div>
                )}

                {manifest.metadata && manifest.metadata.length > 0 && (
                  <div className="border-t pt-3 mt-3">
                    <p className="text-sm text-archive mb-2">Metadata</p>
                    {manifest.metadata.map((item: any, idx: number) => (
                      <div key={idx} className="mb-2">
                        <p className="text-xs text-archive">{getLabel(item.label)}</p>
                        <p className="text-sm">{getLabel(item.value)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );

  // If modal mode, wrap in fixed modal container
  if (modal) {
    return (
      <ModalPortal>
      {/* eslint-disable-next-line madrona/no-generic-tailwind-colors -- fullscreen image viewer backdrop is true black */}
      <div className="sidebar-aware-modal fixed inset-0 z-50 bg-black">
        {viewerContent}
      </div>
      </ModalPortal>
    );
  }

  return viewerContent;
}

// Helper to extract label from IIIF language map
function getLabel(labelMap: any): string {
  if (!labelMap) return '';
  if (typeof labelMap === 'string') return labelMap;
  if (Array.isArray(labelMap)) return labelMap[0] || '';
  // Language map: { "en": ["value"] }
  const values = Object.values(labelMap);
  if (values.length > 0) {
    const first = values[0];
    if (Array.isArray(first)) return first[0] || '';
    return String(first);
  }
  return '';
}
