/**
 * Breadcrumbs — Public site breadcrumb navigation.
 *
 * Renders: Home > Parent > ... > Current
 */

import { Link } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';
import type { PageAncestor } from '../../../types/content';

interface BreadcrumbsProps {
  orgSlug: string;
  ancestors: PageAncestor[];
  currentTitle: string;
}

export function Breadcrumbs({ orgSlug, ancestors, currentTitle }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-archive flex-wrap">
      <Link
        to={`/c/${orgSlug}`}
        className="inline-flex items-center gap-1 hover:text-ink transition-colors"
      >
        <Home size={14} />
        <span>Home</span>
      </Link>

      {ancestors.map((ancestor) => (
        <span key={ancestor.page_id} className="inline-flex items-center gap-1.5">
          <ChevronRight size={12} className="text-archive/50" />
          <Link
            to={`/c/${orgSlug}/pages/${ancestor.slug}`}
            className="hover:text-ink transition-colors"
          >
            {ancestor.title}
          </Link>
        </span>
      ))}

      <span className="inline-flex items-center gap-1.5">
        <ChevronRight size={12} className="text-archive/50" />
        <span className="text-ink font-medium">{currentTitle}</span>
      </span>
    </nav>
  );
}
