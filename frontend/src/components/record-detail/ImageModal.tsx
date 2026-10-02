/**
 * ImageModal - Full-screen image viewer with zoom and gallery navigation
 *
 * MVP Features:
 * - Open, close (Esc, click outside, X button)
 * - Fit to screen (default)
 * - 100% zoom (click or button)
 * - Pan when zoomed (drag)
 * - Next/prev navigation (arrows, keyboard)
 * - Focus trap (accessibility)
 *
 * @see /docs/record-detail-page-redesign.md
 */

import { useState, useRef, useEffect, useCallback, type MouseEvent, type TouchEvent } from 'react';
import {
  X,
  Maximize2,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAccessibleModal, getModalAriaProps } from '../../hooks/useAccessibleModal';
import { ModalPortal } from '../ModalPortal';

// =============================================================================
// TYPES
// =============================================================================

export interface ImageModalMedia {
  /** Unique identifier */
  id: string;
  /** URL for full-size image (original) */
  url: string;
  /** URL for medium preview derivative */
  preview_url?: string;
  /** URL for small thumbnail derivative */
  thumbnail_url?: string;
  /** Alt text for accessibility */
  alt?: string;
  /** Optional title/caption */
  title?: string;
  /** Original filename */
  filename?: string;
  /** Width in pixels (for aspect ratio) */
  width?: number;
  /** Height in pixels (for aspect ratio) */
  height?: number;
  /** Rights-derived download gate; drives which download action is offered */
  download_access?: 'direct' | 'request' | 'blocked' | null;
}

export interface ImageModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback to close the modal */
  onClose: () => void;
  /** Array of media items for gallery */
  media: ImageModalMedia[];
  /** Initial index to display */
  initialIndex?: number;
  /** Whether download is allowed */
  canDownload?: boolean;
  /** Callback when direct download is clicked (download_access === 'direct') */
  onDownload?: (media: ImageModalMedia) => void;
  /** Callback to open a download request (download_access === 'request') */
  onRequestDownload?: (media: ImageModalMedia) => void;
  /** Callback to open the asset's full record in the Media app */
  onOpenInMedia?: (media: ImageModalMedia) => void;
  /** Additional CSS classes */
  className?: string;
}

type ZoomLevel = 'fit' | '100' | '200';

// =============================================================================
// ZOOM CONTROLS
// =============================================================================

interface ZoomControlsProps {
  zoomLevel: ZoomLevel;
  onZoomChange: (level: ZoomLevel) => void;
  canDownload?: boolean;
  downloadAccess?: 'direct' | 'request' | 'blocked' | null;
  onDownload?: () => void;
  onRequestDownload?: () => void;
  onOpenInMedia?: () => void;
}

function ZoomControls({
  zoomLevel,
  onZoomChange,
  canDownload,
  downloadAccess,
  onDownload,
  onRequestDownload,
  onOpenInMedia,
}: ZoomControlsProps) {
  // The download cluster is offered only when the caller permits it. The action
  // branches on the asset's rights-derived access mode; when the caller doesn't
  // provide one (legacy callers), fall back to a plain direct download.
  const showDirect =
    canDownload && !!onDownload && (downloadAccess == null || downloadAccess === 'direct');
  const showRequest = canDownload && downloadAccess === 'request' && !!onRequestDownload;
  const showBlocked = canDownload && downloadAccess === 'blocked';
  const showCluster = showDirect || showRequest || showBlocked || !!onOpenInMedia;

  return (
    <div className="flex items-center gap-1 bg-ink/80 rounded-lg p-1">
      <button
        onClick={() => onZoomChange('fit')}
        className={cn(
          'p-2 rounded transition-colors',
          zoomLevel === 'fit' ? 'bg-parchment/20 text-parchment' : 'text-parchment/70 hover:text-parchment'
        )}
        title="Fit to screen"
        aria-pressed={zoomLevel === 'fit'}
      >
        <Maximize2 size={18} />
      </button>
      <button
        onClick={() => onZoomChange('100')}
        className={cn(
          'p-2 rounded transition-colors text-sm font-medium min-w-[40px]',
          zoomLevel === '100' ? 'bg-parchment/20 text-parchment' : 'text-parchment/70 hover:text-parchment'
        )}
        title="100% zoom"
        aria-pressed={zoomLevel === '100'}
      >
        100%
      </button>
      <button
        onClick={() => onZoomChange('200')}
        className={cn(
          'p-2 rounded transition-colors text-sm font-medium min-w-[40px]',
          zoomLevel === '200' ? 'bg-parchment/20 text-parchment' : 'text-parchment/70 hover:text-parchment'
        )}
        title="200% zoom"
        aria-pressed={zoomLevel === '200'}
      >
        200%
      </button>
      {showCluster && (
        <>
          <div className="w-px h-6 bg-parchment/20 mx-1" />
          {showDirect && (
            <button
              onClick={onDownload}
              className="p-2 rounded text-parchment/70 hover:text-parchment transition-colors"
              title="Download original"
            >
              <Download size={18} />
            </button>
          )}
          {showRequest && (
            <button
              onClick={onRequestDownload}
              className="p-2 rounded text-parchment/70 hover:text-parchment transition-colors"
              title="Request download sizes"
            >
              <Download size={18} />
            </button>
          )}
          {showBlocked && (
            <button
              disabled
              className="p-2 rounded text-parchment/30 cursor-not-allowed"
              title="Rights expired or restricted — download unavailable"
            >
              <Download size={18} />
            </button>
          )}
          {onOpenInMedia && (
            <button
              onClick={onOpenInMedia}
              className="p-2 rounded text-parchment/70 hover:text-parchment transition-colors"
              title="Open in Media"
            >
              <ExternalLink size={18} />
            </button>
          )}
        </>
      )}
    </div>
  );
}

// =============================================================================
// NAVIGATION CONTROLS
// =============================================================================

interface NavButtonProps {
  direction: 'prev' | 'next';
  onClick: () => void;
  disabled?: boolean;
}

function NavButton({ direction, onClick, disabled }: NavButtonProps) {
  const Icon = direction === 'prev' ? ChevronLeft : ChevronRight;
  const label = direction === 'prev' ? 'Previous image' : 'Next image';

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'absolute top-1/2 -translate-y-1/2 p-3 rounded-full',
        'bg-ink/60 text-parchment backdrop-blur-sm',
        'transition-all duration-200',
        disabled
          ? 'opacity-30 cursor-not-allowed'
          : 'opacity-70 hover:opacity-100 hover:bg-ink/80',
        direction === 'prev' ? 'left-4' : 'right-4'
      )}
      title={label}
      aria-label={label}
    >
      <Icon size={24} />
    </button>
  );
}

// =============================================================================
// IMAGE VIEWER
// =============================================================================

interface ImageViewerProps {
  media: ImageModalMedia;
  zoomLevel: ZoomLevel;
  onZoomToggle: () => void;
}

function ImageViewer({ media, zoomLevel, onZoomToggle }: ImageViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const didDragRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, posX: 0, posY: 0 });

  // Reset position when zoom changes
  useEffect(() => {
    setPosition({ x: 0, y: 0 });
  }, [zoomLevel, media.id]);

  // Get scale based on zoom level
  const getScale = (): number => {
    switch (zoomLevel) {
      case '100':
        return 1;
      case '200':
        return 2;
      case 'fit':
      default:
        return 1; // CSS handles fit
    }
  };

  const isZoomed = zoomLevel !== 'fit';

  // Threshold in px to distinguish a click from a drag
  const DRAG_THRESHOLD = 4;

  // Mouse drag handlers
  const handleMouseDown = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (!isZoomed) return;
      e.preventDefault();
      isDraggingRef.current = true;
      didDragRef.current = false;
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        posX: position.x,
        posY: position.y,
      };
    },
    [isZoomed, position]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current || !isZoomed) return;
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
        didDragRef.current = true;
      }
      setPosition({
        x: dragStartRef.current.posX + dx,
        y: dragStartRef.current.posY + dy,
      });
    },
    [isZoomed]
  );

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  // Touch handlers for mobile
  const handleTouchStart = useCallback(
    (e: TouchEvent<HTMLDivElement>) => {
      if (!isZoomed || e.touches.length !== 1) return;
      const touch = e.touches[0];
      isDraggingRef.current = true;
      didDragRef.current = false;
      dragStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        posX: position.x,
        posY: position.y,
      };
    },
    [isZoomed, position]
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current || !isZoomed || e.touches.length !== 1) return;
      e.preventDefault();
      const touch = e.touches[0];
      const dx = touch.clientX - dragStartRef.current.x;
      const dy = touch.clientY - dragStartRef.current.y;
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
        didDragRef.current = true;
      }
      setPosition({
        x: dragStartRef.current.posX + dx,
        y: dragStartRef.current.posY + dy,
      });
    },
    [isZoomed]
  );

  const handleTouchEnd = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  // Click to toggle zoom (only if the user didn't drag)
  const handleClick = useCallback(() => {
    if (!didDragRef.current) {
      onZoomToggle();
    }
    didDragRef.current = false;
  }, [onZoomToggle]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'flex-1 flex items-center justify-center overflow-hidden',
        isZoomed ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'
      )}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onClick={handleClick}
    >
      <img
        src={media.preview_url || media.url}
        alt={media.alt || media.title || 'Image'}
        className={cn(
          'transition-transform duration-200',
          zoomLevel === 'fit' && 'max-w-full max-h-full object-contain'
        )}
        style={
          isZoomed
            ? {
                transform: `translate(${position.x}px, ${position.y}px) scale(${getScale()})`,
                transformOrigin: 'center center',
              }
            : undefined
        }
        draggable={false}
      />
    </div>
  );
}

// =============================================================================
// THUMBNAIL STRIP
// =============================================================================

interface ThumbnailStripProps {
  media: ImageModalMedia[];
  currentIndex: number;
  onSelect: (index: number) => void;
}

function ThumbnailStrip({ media, currentIndex, onSelect }: ThumbnailStripProps) {
  if (media.length <= 1) return null;

  return (
    <div className="flex justify-center gap-2 py-3 px-4 bg-ink/60 backdrop-blur-sm">
      {media.map((item, index) => (
        <button
          key={item.id}
          onClick={() => onSelect(index)}
          className={cn(
            'w-12 h-12 rounded overflow-hidden transition-all',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-parchment/30 focus-visible:ring-offset-2',
            index === currentIndex
              ? 'ring-2 ring-parchment opacity-100'
              : 'opacity-50 hover:opacity-75'
          )}
          aria-label={`View image ${index + 1}`}
          aria-current={index === currentIndex ? 'true' : undefined}
        >
          <img
            src={item.thumbnail_url || item.url}
            alt=""
            className="w-full h-full object-cover"
          />
        </button>
      ))}
    </div>
  );
}

// =============================================================================
// IMAGE MODAL COMPONENT
// =============================================================================

export function ImageModal({
  isOpen,
  onClose,
  media,
  initialIndex = 0,
  canDownload = false,
  onDownload,
  onRequestDownload,
  onOpenInMedia,
  className,
}: ImageModalProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>('100');

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setCurrentIndex(initialIndex);
      setZoomLevel('100');
    }
  }, [isOpen, initialIndex]);

  // Extended modal hook with custom keyboard handling
  const { modalRef, titleId } = useAccessibleModal({
    isOpen,
    onClose,
    titlePrefix: 'image-modal',
  });

  // Navigation handlers
  const goToPrev = useCallback(() => {
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : prev));
    setZoomLevel('100');
  }, []);

  const goToNext = useCallback(() => {
    setCurrentIndex((prev) => (prev < media.length - 1 ? prev + 1 : prev));
    setZoomLevel('100');
  }, [media.length]);

  // Zoom toggle
  const toggleZoom = useCallback(() => {
    setZoomLevel((prev) => (prev === 'fit' ? '100' : 'fit'));
  }, []);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          goToPrev();
          break;
        case 'ArrowRight':
          e.preventDefault();
          goToNext();
          break;
        case '+':
        case '=':
          e.preventDefault();
          setZoomLevel((prev) => {
            if (prev === 'fit') return '100';
            if (prev === '100') return '200';
            return prev;
          });
          break;
        case '-':
          e.preventDefault();
          setZoomLevel((prev) => {
            if (prev === '200') return '100';
            if (prev === '100') return 'fit';
            return prev;
          });
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, goToPrev, goToNext]);

  if (!isOpen || media.length === 0) return null;

  const currentMedia = media[currentIndex];
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < media.length - 1;

  const handleDownload = () => {
    if (onDownload && currentMedia) {
      onDownload(currentMedia);
    }
  };

  const handleRequestDownload = () => {
    if (onRequestDownload && currentMedia) {
      onRequestDownload(currentMedia);
    }
  };

  const handleOpenInMedia = () => {
    if (onOpenInMedia && currentMedia) {
      onOpenInMedia(currentMedia);
    }
  };

  return (
    <ModalPortal>
    <div
      className={cn(
        'sidebar-aware-modal fixed inset-0 z-[1100] flex flex-col bg-ink/95 backdrop-blur-sm',
        className
      )}
      onClick={onClose}
    >
      <div
        ref={modalRef}
        {...getModalAriaProps(titleId)}
        className="flex-1 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-ink/60 backdrop-blur-sm">
          <div className="flex-1">
            <h2 id={titleId} className="text-parchment text-sm font-medium truncate">
              {currentMedia.title || currentMedia.filename || `Image ${currentIndex + 1} of ${media.length}`}
            </h2>
            {media.length > 1 && (
              <p className="text-parchment/60 text-xs mt-0.5">
                {currentIndex + 1} of {media.length}
              </p>
            )}
          </div>

          <div className="flex items-center gap-4">
            <ZoomControls
              zoomLevel={zoomLevel}
              onZoomChange={setZoomLevel}
              canDownload={canDownload}
              downloadAccess={currentMedia.download_access}
              onDownload={handleDownload}
              onRequestDownload={onRequestDownload ? handleRequestDownload : undefined}
              onOpenInMedia={onOpenInMedia ? handleOpenInMedia : undefined}
            />
            <button
              onClick={onClose}
              className="p-2 rounded text-parchment/70 hover:text-parchment hover:bg-parchment/10 transition-colors"
              title="Close (Esc)"
              aria-label="Close image viewer"
            >
              <X size={24} />
            </button>
          </div>
        </div>

        {/* Main Image Area */}
        <div className="flex-1 relative flex items-center justify-center p-4">
          <ImageViewer
            media={currentMedia}
            zoomLevel={zoomLevel}
            onZoomToggle={toggleZoom}
          />

          {/* Navigation buttons */}
          {media.length > 1 && (
            <>
              <NavButton direction="prev" onClick={goToPrev} disabled={!hasPrev} />
              <NavButton direction="next" onClick={goToNext} disabled={!hasNext} />
            </>
          )}
        </div>

        {/* Thumbnail strip */}
        <ThumbnailStrip
          media={media}
          currentIndex={currentIndex}
          onSelect={setCurrentIndex}
        />
      </div>
    </div>
    </ModalPortal>
  );
}

export default ImageModal;
