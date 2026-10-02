/**
 * SkipLinks - Accessibility skip navigation links
 *
 * Provides keyboard-accessible skip links for the record detail page.
 * Hidden visually but accessible to screen readers and keyboard navigation.
 *
 * Per WCAG 2.1 Success Criterion 2.4.1: Bypass Blocks
 *
 * @see /docs/record-detail-page-redesign.md
 */

import { cn } from '../../lib/utils';

// =============================================================================
// TYPES
// =============================================================================

export interface SkipLink {
  /** Target element ID */
  href: string;
  /** Link text */
  label: string;
}

export interface SkipLinksProps {
  /** Custom skip links (defaults to standard record detail links) */
  links?: SkipLink[];
  /** Additional CSS classes */
  className?: string;
}

// =============================================================================
// DEFAULT SKIP LINKS
// =============================================================================

const DEFAULT_SKIP_LINKS: SkipLink[] = [
  { href: '#main-content', label: 'Skip to main content' },
  { href: '#section-nav', label: 'Skip to section navigation' },
  { href: '#quick-actions', label: 'Skip to quick actions' },
];

// =============================================================================
// SKIP LINKS COMPONENT
// =============================================================================

export function SkipLinks({
  links = DEFAULT_SKIP_LINKS,
  className,
}: SkipLinksProps) {
  return (
    <nav
      aria-label="Skip links"
      className={cn('skip-links', className)}
    >
      {links.map((link) => (
        <a
          key={link.href}
          href={link.href}
          className={cn(
            // Visually hidden by default
            'absolute -top-10 left-4 z-[2000]',
            'px-4 py-2 rounded-lg',
            'bg-bark text-parchment font-medium text-sm',
            'no-underline',
            // Show on focus
            'focus-visible:top-4',
            'transition-[top] duration-150 ease-out',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-parchment/30 focus-visible:ring-offset-2'
          )}
        >
          {link.label}
        </a>
      ))}
    </nav>
  );
}

export default SkipLinks;
