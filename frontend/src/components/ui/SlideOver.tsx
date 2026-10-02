import React, { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface SlideOverProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  width?: 'sm' | 'md' | 'lg' | 'xl';
  footer?: React.ReactNode;
}

const WIDTH_CLASSES = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
};

export function SlideOver({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  width = 'md',
  footer,
}: SlideOverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  // Close on Escape key — only if no higher-z modal is open
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Check if a higher-z modal (like LocationPickerModal) is open
        const higherModal = document.querySelector('[data-modal-layer]');
        if (higherModal) return; // Let the higher modal handle Escape
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
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

  // Focus trap
  useEffect(() => {
    if (isOpen && panelRef.current) {
      panelRef.current.focus();
    }
  }, [isOpen]);

  // Only close if the mousedown originated on the backdrop itself
  const handleBackdropMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.target === backdropRef.current) {
      onClose();
    }
  }, [onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        ref={backdropRef}
        className="absolute inset-0 bg-ink/30 transition-opacity"
        onMouseDown={handleBackdropMouseDown}
        aria-hidden="true"
      />

      {/* Slide-over panel — bottom sheet on mobile, right rail on sm+ */}
      <div className="fixed inset-x-0 bottom-0 flex max-h-[92dvh] sm:inset-y-0 sm:right-0 sm:bottom-auto sm:left-auto sm:max-h-none sm:max-w-full sm:pl-10">
        <div
          ref={panelRef}
          tabIndex={-1}
          className={`relative w-full sm:w-screen ${WIDTH_CLASSES[width]} transform transition-transform duration-300 ease-in-out animate-slide-up sm:animate-slide-in-right`}
        >
          <div
            className="flex h-full max-h-[92dvh] sm:h-[100dvh] sm:max-h-[100dvh] flex-col bg-parchment shadow-archival-lg rounded-t-md sm:rounded-none"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          >
            {/* Drag handle (mobile only, decorative) */}
            <div className="sm:hidden flex justify-center pt-2 pb-1" aria-hidden="true">
              <div className="w-10 h-1 rounded-full bg-stone" />
            </div>
            {/* Header */}
            <div className="px-6 py-5 border-b border-lichen">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-xl font-serif font-semibold text-forest">
                    {title}
                  </h2>
                  {subtitle && (
                    <p className="mt-1 text-sm text-archive">{subtitle}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] -mr-2 text-archive hover:text-ink hover:bg-stone rounded-institutional transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                >
                  <X size={20} />
                  <span className="sr-only">Close panel</span>
                </button>
              </div>
            </div>

            {/* Content — min-h-0 lets this flex child shrink below its content
                height so overflow-y-auto actually scrolls (tall panels). */}
            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
              {children}
            </div>

            {/* Footer */}
            {footer && (
              <div className="px-6 py-4 border-t border-lichen bg-stone/30">
                {footer}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default SlideOver;
