import { useLocation } from 'react-router-dom';
import { useMemo, useEffect, useContext } from 'react';
import { products, type Product } from '../lib/navigationConfig';
import { AuthContext, type Application } from '../contexts/AuthContext';

const LAST_PRODUCT_KEY = 'madrona_last_active_product';

/**
 * Get the last active product from localStorage
 */
function getLastActiveProduct(): string | null {
  try {
    return localStorage.getItem(LAST_PRODUCT_KEY);
  } catch {
    return null;
  }
}

/**
 * Save the last active product to localStorage
 */
function setLastActiveProduct(productId: string): void {
  try {
    localStorage.setItem(LAST_PRODUCT_KEY, productId);
  } catch {
    // Ignore storage errors
  }
}

/**
 * Determine the active product based on the current URL path
 * Preserves the last active product when navigating to non-product pages (like admin)
 */
export function useActiveProduct(): {
  activeProduct: Product | null;
  activeProductId: string | null;
  isInProduct: boolean;
} {
  const location = useLocation();
  // useContext directly, not useAuth(): useAuth throws when there is no
  // provider, and this hook renders outside one in many tests.
  const apps = useContext(AuthContext)?.applications;

  const result = useMemo(() => {
    // A page is "in a product" iff the first path segment after
    // /organizations/:orgId/ matches a product's id — which IS its URL base
    // (collections, media, bridge, content, guide). This is derived from the
    // single `products` manifest, so there is NO separate prefix map or
    // non-product allow-list to keep in sync: adding a new top-level route
    // can never again silently drop the sidebar nav.
    //
    // Anything that is not a product page (home, admin, settings, account,
    // notifications, …) falls through to PRESERVE the last active product, so
    // the app chrome stays continuous across the whole session instead of
    // emptying out. That fail-safe default is the durability fix — the old
    // code returned null for any unlisted segment (e.g. `home`), which is what
    // "threw you out" of the nav.
    //
    // (Fully removing URL derivation would mean moving product identity onto
    // the route definitions and reading it from the router — a react-router
    // data-router migration, since the sidebar renders as a sibling of the
    // routed content and can't receive a route-level context. This keeps the
    // synchronous, sidebar-readable signal while deleting the brittle lists.)
    const segment =
      location.pathname.match(/\/organizations\/[^/]+\/([^/]+)/)?.[1] ?? null;
    const product = segment ? products.find(p => p.id === segment) ?? null : null;

    if (product) {
      return { activeProduct: product, activeProductId: product.id, isInProduct: true };
    }

    const lastProductId = getLastActiveProduct();
    const lastProduct = lastProductId
      ? products.find(p => p.id === lastProductId) ?? null
      : null;

    // The remembered product may since have been switched off for the
    // organization. Keeping it would leave the sidebar advertising an app
    // whose every page the route guard now blocks. Only drop it when we
    // actually know the app list: `apps` is undefined outside an
    // AuthProvider (and while /me is in flight), and guessing there would
    // blank the chrome the fallback above exists to preserve.
    if (lastProduct && apps?.length) {
      const entry = apps.find(a => a.key === lastProduct.id);
      if (entry && !(entry.enabled && entry.status === 'active')) {
        return { activeProduct: null, activeProductId: null, isInProduct: false };
      }
    }

    return { activeProduct: lastProduct, activeProductId: lastProductId, isInProduct: false };
  }, [location.pathname, apps]);

  // Save to localStorage when we're in a product page
  useEffect(() => {
    if (result.isInProduct && result.activeProductId) {
      setLastActiveProduct(result.activeProductId);
    }
  }, [result.isInProduct, result.activeProductId]);

  return {
    activeProduct: result.activeProduct,
    activeProductId: result.activeProductId,
    isInProduct: result.isInProduct,
  };
}

/**
 * Products that host the shared orchestration Work queues (plans/drafts).
 * Plans/Drafts live in a product's Work area, not in a standalone Guide app;
 * Media and Collections both surface them, product-filtered.
 */
export function workProductId(productId?: string | null): 'collections' | 'media' {
  return productId === 'media' ? 'media' : 'collections';
}

/**
 * Base path for a product's Work area (where plans/drafts/approvals live).
 * Pass the current activeProductId so links stay within the product the user
 * is in; falls back to collections.
 */
export function workBasePath(orgId: string, productId?: string | null): string {
  return `/organizations/${orgId}/${workProductId(productId)}/work`;
}

/**
 * Resolve which product's Work area to land on when context is absent — e.g. a
 * legacy /guide/plans deep-link that carries no product. Uses the last active
 * product (which, when viewing a plan, is the product whose Work hosts it).
 */
export function resolveWorkProductId(): 'collections' | 'media' {
  return workProductId(getLastActiveProduct());
}

/**
 * Get the default landing path for a product
 */
export function getProductLandingPath(productId: string, orgId: string): string {
  const defaultPaths: Record<string, string> = {
    collections: `/organizations/${orgId}/collections/objects`,
    media: `/organizations/${orgId}/media`,
    bridge: `/organizations/${orgId}/bridge`,
    content: `/organizations/${orgId}/content/pages`,
    guide: `/organizations/${orgId}/guide/chat`,
  };

  return defaultPaths[productId] || `/organizations/${orgId}/collections/objects`;
}

/**
 * Resolve the best landing path for an org based on enabled applications.
 * Checks last-used product first, then falls back by display order.
 */
export function getDefaultLandingPath(orgId: string, applications: Application[]): string {
  const isEnabled = (key: string) => {
    const app = applications.find(a => a.key === key);
    return app?.enabled && app.status === 'active';
  };

  // 1. Last-used product (from localStorage) if still enabled
  const lastProduct = getLastActiveProduct();
  if (lastProduct && isEnabled(lastProduct)) {
    return getProductLandingPath(lastProduct, orgId);
  }

  // 2. First enabled app by display order
  const productOrder = ['collections', 'bridge', 'media', 'content', 'guide'];
  for (const key of productOrder) {
    if (isEnabled(key)) {
      return getProductLandingPath(key, orgId);
    }
  }

  // 3. Any enabled app, or work page as last resort
  const firstEnabled = applications.find(a => a.enabled && a.status === 'active');
  if (firstEnabled) {
    return getProductLandingPath(firstEnabled.key, orgId);
  }

  // Nothing enabled. Collections is the historical default, but sending
  // someone to an app that is switched off lands them on the blocked-access
  // dialog the moment they sign in. Home is never app-gated, and the
  // Applications settings page is reachable from there to turn one back on.
  return `/organizations/${orgId}/home`;
}
