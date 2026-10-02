/**
 * LazySection - Deferred rendering for below-the-fold sections
 *
 * Wraps section content to enable lazy loading based on visibility.
 * Uses Intersection Observer to render content only when the section
 * is about to become visible.
 *
 * Per spec: Lazy-load heavy COMPONENTS, not sections
 * (API returns full record - section lazy-loading doesn't reduce network time)
 *
 * @see /docs/record-detail-page-redesign.md
 */

import {
  useState,
  useEffect,
  useRef,
  type ReactNode,
  Suspense,
  lazy,
  type ComponentType,
} from 'react';
import { cn } from '../../lib/utils';
import { MadronaLoader } from '../ui/MadronaLoader';

// =============================================================================
// TYPES
// =============================================================================

export interface LazySectionProps {
  /** Content to render lazily */
  children: ReactNode;
  /** Placeholder height while loading (prevents layout shift) */
  minHeight?: number;
  /** Root margin for intersection observer (loads earlier) */
  rootMargin?: string;
  /** Whether to always render (bypass lazy loading) */
  eager?: boolean;
  /** Additional CSS classes */
  className?: string;
}

export interface LazyComponentLoaderProps<P extends object> {
  /** Factory function that imports the component */
  loader: () => Promise<{ default: ComponentType<P> }>;
  /** Props to pass to the loaded component */
  props: P;
  /** Fallback while loading */
  fallback?: ReactNode;
  /** Minimum height for loading state */
  minHeight?: number;
}

// =============================================================================
// LOADING PLACEHOLDER
// =============================================================================

interface LoadingPlaceholderProps {
  minHeight?: number;
}

function LoadingPlaceholder({ minHeight = 100 }: LoadingPlaceholderProps) {
  return (
    <div
      className="flex items-center justify-center text-archive"
      style={{ minHeight }}
    >
      <MadronaLoader variant="dots" />
      <span className="sr-only">Loading...</span>
    </div>
  );
}

// =============================================================================
// LAZY SECTION COMPONENT
// =============================================================================

export function LazySection({
  children,
  minHeight = 100,
  rootMargin = '200px',
  eager = false,
  className,
}: LazySectionProps) {
  const [isVisible, setIsVisible] = useState(eager);
  const [hasRendered, setHasRendered] = useState(eager);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (eager || hasRendered) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          setHasRendered(true);
          observer.disconnect();
        }
      },
      {
        rootMargin,
        threshold: 0,
      }
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, [eager, hasRendered, rootMargin]);

  // Once rendered, always keep rendered (prevents re-triggering on scroll back)
  if (hasRendered) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div
      ref={containerRef}
      className={cn('lazy-section', className)}
      style={{ minHeight }}
    >
      {isVisible ? (
        children
      ) : (
        <LoadingPlaceholder minHeight={minHeight} />
      )}
    </div>
  );
}

// =============================================================================
// LAZY COMPONENT LOADER
// =============================================================================

/**
 * Wrapper for React.lazy with Suspense
 * Use this for heavy components like tables, charts, maps
 */
export function LazyComponentLoader<P extends object>({
  loader,
  props,
  fallback,
  minHeight = 100,
}: LazyComponentLoaderProps<P>) {
  const LazyComponent = lazy(loader);

  return (
    <Suspense fallback={fallback || <LoadingPlaceholder minHeight={minHeight} />}>
      <LazyComponent {...props} />
    </Suspense>
  );
}

// =============================================================================
// UTILITY: CREATE LAZY COMPONENT
// =============================================================================

/**
 * Creates a lazy-loadable version of a component
 *
 * @example
 * const LazyMediaGallery = createLazyComponent(
 *   () => import('./MediaGallery')
 * );
 *
 * // Usage:
 * <LazyMediaGallery media={media} />
 */
export function createLazyComponent<P extends object>(
  loader: () => Promise<{ default: ComponentType<P> }>
): ComponentType<P & { fallback?: ReactNode }> {
  const LazyComponent = lazy(loader);

  return function LazyWrapper({ fallback, ...props }: P & { fallback?: ReactNode }) {
    return (
      <Suspense fallback={fallback || <LoadingPlaceholder />}>
        <LazyComponent {...(props as P)} />
      </Suspense>
    );
  };
}

// =============================================================================
// PREDEFINED LAZY COMPONENTS
// Per spec: Heavy components to lazy-load
// =============================================================================

/**
 * Virtualization thresholds for large lists
 * Only virtualize when items exceed these counts
 */
export const VIRTUALIZATION_THRESHOLDS = {
  relatedObjects: 50,
  citations: 100,
  mediaItems: 30,
} as const;

/**
 * Check if a list should be virtualized
 */
export function shouldVirtualize(
  listType: keyof typeof VIRTUALIZATION_THRESHOLDS,
  itemCount: number
): boolean {
  return itemCount > VIRTUALIZATION_THRESHOLDS[listType];
}

export default LazySection;
