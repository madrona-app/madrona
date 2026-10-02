/**
 * Resolve the MediaDetailPage back-link from an optional `returnTo` query param.
 *
 * When a caller (e.g. a Collections object record) deep-links into the asset
 * with `?returnTo=<path>`, the back-link should send the user back there. Only
 * relative paths are honored — an absolute URL or protocol-relative value is
 * ignored to avoid an open-redirect, falling back to the Media Library.
 */
export interface MediaBackLink {
  href: string;
  label: string;
}

export function resolveMediaBackLink(
  returnTo: string | null | undefined,
  orgId: string | undefined,
): MediaBackLink {
  // Must be a site-relative path ("/...") but not protocol-relative ("//host").
  const safe = returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : null;
  if (safe) {
    return { href: safe, label: 'Back' };
  }
  return { href: `/organizations/${orgId}/media`, label: 'Media Library' };
}
