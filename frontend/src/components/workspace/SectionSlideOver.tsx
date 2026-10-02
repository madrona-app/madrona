import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAccessibleModal, getModalAriaProps } from '../../hooks/useAccessibleModal';

interface SectionSlideOverProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}

/**
 * Slide-over panel for editing a workspace section.
 * Opens from the right, overlays the page content.
 */
export function SectionSlideOver({
  isOpen,
  onClose,
  title,
  icon,
  children,
}: SectionSlideOverProps) {
  const { modalRef, titleId } = useAccessibleModal({
    isOpen,
    onClose,
    titlePrefix: 'section-slide-over',
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-ink/20 transition-opacity"
        onClick={onClose}
      />

      {/* Slide-over panel */}
      <div className="absolute inset-y-0 right-0 flex max-w-full pl-10">
        <div
          ref={modalRef}
          className={cn(
            'w-screen max-w-lg bg-parchment shadow-xl flex flex-col',
            'animate-in slide-in-from-right duration-200'
          )}
          {...getModalAriaProps(titleId)}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-lichen flex-shrink-0">
            <div className="flex items-center gap-3">
              {icon && <span className="text-bark">{icon}</span>}
              <h2 id={titleId} className="text-lg font-serif font-medium text-forest">
                {title}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 text-archive hover:text-ink rounded-lg transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
