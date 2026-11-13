/**
 * Breadcrumbs — public site breadcrumb trail (WAI-ARIA breadcrumb pattern).
 *
 *   <nav aria-label="Breadcrumb">
 *     <ol>
 *       <li><a href="/c/org">Home</a></li>
 *       <li><a href="/c/org?q=vase">Search results for “vase”</a></li>
 *       <li><span aria-current="page">Blue vase</span></li>
 *     </ol>
 *   </nav>
 *
 * Separators are decorative (aria-hidden) so a screen reader announces a
 * list of N items with the last one marked as the current page.
 */

import { Link } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';
import type { PageAncestor } from '../../../types/content';

export interface BreadcrumbItem {
  label: string;
  /** Omit for the current page (always the last item). */
  to?: string;
}

type BreadcrumbsProps =
  | { items: BreadcrumbItem[]; orgSlug?: never; ancestors?: never; currentTitle?: never }
  | { orgSlug: string; ancestors: PageAncestor[]; currentTitle: string; items?: never };

/** Home > ancestors... > current, for CMS content pages. */
function contentPageCrumbs(orgSlug: string, ancestors: PageAncestor[], currentTitle: string): BreadcrumbItem[] {
  return [
    { label: 'Home', to: `/c/${orgSlug}` },
    ...ancestors.map((a) => ({ label: a.title, to: `/c/${orgSlug}/pages/${a.slug}` })),
    { label: currentTitle },
  ];
}

export function Breadcrumbs(props: BreadcrumbsProps) {
  const items = props.items ?? contentPageCrumbs(props.orgSlug, props.ancestors, props.currentTitle);
  if (items.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="text-sm text-archive">
      <ol className="flex items-center gap-1.5 flex-wrap">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={`${i}-${item.label}`} className="inline-flex items-center gap-1.5 min-w-0">
              {i > 0 && <ChevronRight size={12} className="text-archive/60 shrink-0" aria-hidden="true" />}
              {isLast || !item.to ? (
                <span
                  aria-current={isLast ? 'page' : undefined}
                  className={isLast ? 'text-ink font-medium break-words' : 'break-words'}
                >
                  {item.label}
                </span>
              ) : (
                <Link
                  to={item.to}
                  className="inline-flex items-center gap-1 text-bark hover:text-copper-dark underline-offset-2 hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 break-words"
                >
                  {i === 0 && <Home size={14} aria-hidden="true" className="shrink-0" />}
                  <span>{item.label}</span>
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
