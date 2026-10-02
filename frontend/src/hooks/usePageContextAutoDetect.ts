/**
 * Auto-populate the route / product / navItemId fields of PageContext from
 * the current location.
 *
 * Mounted once in AppShell. Listens to react-router's `useLocation` and,
 * on every pathname change, finds the best-matching entry in the flat nav
 * catalog by longest prefix match on the path pattern. Workspace pages
 * still overwrite the entity/workflow/editMode fields via their own hooks;
 * this one only owns the nav-level triplet.
 */

import { useEffect, useMemo } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { getNavCatalog, type NavEntry } from '../lib/navigationCatalog';
import { usePageContext } from '../contexts/PageContext';

/** Longest-path-pattern match wins. Patterns are pre-sorted once per module load. */
function buildMatcher() {
  const catalog = getNavCatalog();
  // Pre-substitute `:orgId` with a regex placeholder so the matcher is
  // independent of the current org.
  const prepared = catalog
    .map((entry) => {
      const escaped = entry.pathPattern
        .split(':orgId')
        .map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('[^/]+');
      return {
        entry,
        // Match the pattern as a prefix; use a trailing `(?:/|$)` so
        // `/collections` does not swallow `/collections/conservation`.
        pattern: new RegExp('^' + escaped + '(?:/|$)'),
        length: entry.pathPattern.length,
      };
    })
    // Longest pattern first — ensures /collections/conservation beats /collections.
    .sort((a, b) => b.length - a.length);
  return prepared;
}

let matcherCache: ReturnType<typeof buildMatcher> | null = null;
function getMatcher() {
  if (!matcherCache) matcherCache = buildMatcher();
  return matcherCache;
}

function findNavEntry(pathname: string): NavEntry | null {
  for (const { entry, pattern } of getMatcher()) {
    if (pattern.test(pathname)) return entry;
  }
  return null;
}

export function usePageContextAutoDetect() {
  const location = useLocation();
  const params = useParams();
  const { setPageContext, hasProvider } = usePageContext();

  const match = useMemo(() => findNavEntry(location.pathname), [location.pathname]);

  useEffect(() => {
    if (!hasProvider) return;
    setPageContext({
      route: location.pathname,
      product: match?.product,
      navItemId: match ? match.id.split(':').slice(1).join(':') : undefined,
    });
    // params.orgId included in deps so routes that only differ by org
    // still fire the update — useful if the same pathname shape gets
    // re-rendered under a new org context.
  }, [location.pathname, match, params.orgId, hasProvider, setPageContext]);
}
