import {
  products,
  adminItems,
  platformAdminItems,
  type NavItem,
  type Product,
} from '../../../src/lib/navigationConfig';

/**
 * Test route information.
 */
export interface TestRoute {
  path: string;
  name: string;
  product: string;
  isPublic?: boolean;
  requiresPermission?: string;
}

/**
 * Public (unauthenticated) routes.
 */
export const PUBLIC_ROUTES: TestRoute[] = [
  { path: '/sign-in', name: 'Sign In', product: 'auth', isPublic: true },
  {
    path: '/forgot-password',
    name: 'Forgot Password',
    product: 'auth',
    isPublic: true,
  },
];

/**
 * Extract all routes from a NavItem recursively.
 */
function extractRoutesFromNavItem(
  item: NavItem,
  product: string,
  orgId: string
): TestRoute[] {
  const routes: TestRoute[] = [];

  // Add the item's path if it has one
  if (item.path) {
    routes.push({
      path: item.path.replace(':orgId', orgId),
      name: item.label,
      product,
      requiresPermission: item.requiresPermission,
    });
  }

  // Recursively extract from children
  if (item.children) {
    for (const child of item.children) {
      routes.push(...extractRoutesFromNavItem(child, product, orgId));
    }
  }

  return routes;
}

/**
 * Extract all routes from a Product.
 */
function extractRoutesFromProduct(
  product: Product,
  orgId: string
): TestRoute[] {
  const routes: TestRoute[] = [];

  for (const item of product.items) {
    routes.push(...extractRoutesFromNavItem(item, product.id, orgId));
  }

  return routes;
}

/**
 * Generate all authenticated routes for a given organization.
 */
export function generateAuthenticatedRoutes(orgId: string): TestRoute[] {
  const routes: TestRoute[] = [];

  // Extract routes from all products
  for (const product of products) {
    routes.push(...extractRoutesFromProduct(product, orgId));
  }

  // Add admin routes
  for (const item of adminItems) {
    routes.push({
      path: item.path.replace(':orgId', orgId),
      name: item.label,
      product: 'admin',
      requiresPermission: item.requiresPermission,
    });
  }

  // Add platform admin routes
  for (const item of platformAdminItems) {
    routes.push({
      path: item.path.replace(':orgId', orgId),
      name: item.label,
      product: 'platform-admin',
      requiresPermission: item.requiresPermission,
    });
  }

  return routes;
}

/**
 * Generate all routes (public + authenticated).
 */
export function generateAllRoutes(orgId: string): TestRoute[] {
  return [...PUBLIC_ROUTES, ...generateAuthenticatedRoutes(orgId)];
}

/**
 * Get routes by product.
 */
export function getRoutesByProduct(
  orgId: string,
  productId: string
): TestRoute[] {
  const allRoutes = generateAllRoutes(orgId);
  return allRoutes.filter((route) => route.product === productId);
}

/**
 * Get routes that don't require specific permissions.
 */
export function getRoutesWithoutPermissions(orgId: string): TestRoute[] {
  const allRoutes = generateAuthenticatedRoutes(orgId);
  return allRoutes.filter((route) => !route.requiresPermission);
}

/**
 * Get route paths as a simple string array.
 */
export function getRoutePaths(routes: TestRoute[]): string[] {
  return routes.map((route) => route.path);
}

/**
 * Group routes by product.
 */
export function groupRoutesByProduct(
  routes: TestRoute[]
): Record<string, TestRoute[]> {
  const grouped: Record<string, TestRoute[]> = {};

  for (const route of routes) {
    if (!grouped[route.product]) {
      grouped[route.product] = [];
    }
    grouped[route.product].push(route);
  }

  return grouped;
}
