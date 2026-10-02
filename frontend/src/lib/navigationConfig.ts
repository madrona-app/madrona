import {
  Workflow,
  History,
  Search,
  Wrench,
  BarChart3,
  Layers,
  Users,
  UserCog,
  FileText,
  GitBranch,
  Package,
  AppWindow,
  Building2,
  LayoutGrid,
  BookOpen,
  ArrowRightLeft,
  Calendar,
  Scale,
  Heart,
  // WORK section icons
  Inbox,
  // procedure icons
  ClipboardCheck,
  ListChecks,
  FileEdit,
  PackageOpen,
  Archive,
  Download,
  Upload,
  Hammer,
  PackageX,
  Trash2,
  Shield,
  ShieldCheck,
  AlertTriangle,
  AlertCircle,
  FileQuestion,
  ClipboardList,
  // Valuation and Reproduction icons
  DollarSign,
  Copy,
  // Shipping icons
  Truck,
  Box,
  // Media/DAM icons
  Film,
  Library,
  FolderHeart,
  Share2,
  Droplets,
  Activity,
  Globe,
  Tag,
  ScanBarcode,
  Sparkles,
  GitCompare,
  User,
  // Settings icon
  Settings,
  Key,
  // Content CMS icons
  PenSquare,
  // Guide icons
  Bot,
  QrCode,
  type LucideIcon,
} from 'lucide-react';
import { FaDatabase } from 'react-icons/fa';
import type { IconType } from 'react-icons';

export type NavIcon = LucideIcon | IconType;

export interface NavItem {
  id: string;
  label: string;
  /** Path pattern with :orgId placeholder. Optional if item only has children. */
  path?: string;
  icon: NavIcon;
  requiresPermission?: string;
  /**
   * Application this item belongs to; hidden when the organization has it
   * switched off (or the deployment cannot serve it). Products already gate
   * on `appKey` — this is for sections living INSIDE another product's nav,
   * e.g. Guide Studio's plans/drafts in the Collections sidebar.
   */
  requiresApp?: string;
  dataTour?: string;
  /** If true, only exact path matches are considered active (no prefix matching) */
  exact?: boolean;
  /** Nested child items (creates expandable section) */
  children?: NavItem[];
  /** If true, item starts expanded */
  defaultExpanded?: boolean;
  /** Dynamic badge component ID (rendered by ProductNavItem) */
  badgeId?: 'task-count' | 'approval-count' | 'draft-count' | 'plan-count';
  /**
   * Brand accent for a section. 'studio' marks Madrona's intelligence layer
   * (Guide Studio) — the section label + icon render in copper (spec §5).
   */
  accent?: 'studio';
}

export interface Product {
  id: string;
  label: string;
  icon: NavIcon;
  badge?: 'coming-soon' | 'beta' | 'new';
  /** Application key for access control (e.g., 'bridge', 'collections') */
  appKey?: string;
  items: NavItem[];
}

export interface AdminItem {
  id: string;
  label: string;
  path: string;
  icon: NavIcon;
  requiresPermission: string;
}

/**
 * Product navigation configuration
 * Products are the top-level navigation concept (Bridge, Collections, etc.)
 */
export const products: Product[] = [
  {
    id: 'bridge',
    label: 'Bridge',
    icon: Workflow,
    appKey: 'bridge',
    items: [
      {
        id: 'pipeline',
        label: 'Pipeline',
        path: '/organizations/:orgId/bridge',
        icon: GitBranch,
        dataTour: 'nav-pipeline',
        exact: true,
      },
      {
        id: 'runs',
        label: 'Run History',
        path: '/organizations/:orgId/bridge/runs',
        icon: History,
        dataTour: 'nav-runs',
      },
      {
        id: 'reports',
        label: 'Reports',
        path: '/organizations/:orgId/bridge/reports',
        icon: BarChart3,
        dataTour: 'nav-reports',
      },
      {
        id: 'datasets',
        label: 'Datasets',
        path: '/organizations/:orgId/bridge/datasets',
        icon: FaDatabase,
        dataTour: 'nav-datasets',
      },
      {
        id: 'search',
        label: 'Search',
        path: '/organizations/:orgId/bridge/search',
        icon: Search,
        dataTour: 'nav-search',
      },
      {
        id: 'config',
        label: 'Configuration',
        path: '/organizations/:orgId/bridge/setup',
        icon: Wrench,
        requiresPermission: 'connectors.view',
        dataTour: 'nav-config',
      },
    ],
  },
  {
    id: 'collections',
    label: 'Collections',
    icon: Layers,
    appKey: 'collections',
    items: [
      // ============================================================================
      // WORK - Tasks and Work Sets scoped to Collections
      // ============================================================================
      {
        id: 'work',
        label: 'Work',
        icon: Inbox,
        children: [
          {
            id: 'my-tasks',
            label: 'My Tasks',
            path: '/organizations/:orgId/collections/work',
            icon: Inbox,
            badgeId: 'task-count',
            exact: true,
          },
          {
            id: 'workspaces',
            label: 'Work Sets',
            path: '/organizations/:orgId/collections/work/workspaces',
            icon: Layers,
          },
          {
            id: 'approvals',
            label: 'Approvals',
            path: '/organizations/:orgId/collections/work/approvals',
            icon: ClipboardCheck,
            badgeId: 'approval-count',
          },
        ],
      },
      {
        // Madrona's intelligence layer (Guide Studio): agent-produced work —
        // plans and the drafts they deposit for review. Copper-accented (spec §5).
        id: 'intelligence',
        label: 'Intelligence',
        icon: Layers,
        accent: 'studio',
        // Guide Studio's output. With Guide off there is nothing here to list,
        // and the plan-count badge polls an endpoint that 503s every minute.
        requiresApp: 'guide',
        defaultExpanded: true,
        children: [
          {
            id: 'plans',
            label: 'Plans',
            path: '/organizations/:orgId/collections/work/plans',
            icon: ListChecks,
            badgeId: 'plan-count',
          },
          {
            id: 'drafts',
            label: 'Drafts',
            path: '/organizations/:orgId/collections/work/drafts',
            icon: FileEdit,
            badgeId: 'draft-count',
          },
        ],
      },
      // ============================================================================
      // COLLECTION - Authoritative catalog of collection items
      // Intentionally minimal; Objects are the anchor of the system
      // ============================================================================
      {
        id: 'collection',
        label: 'Collection',
        icon: Package,
        children: [
          {
            id: 'objects',
            label: 'Cataloging',
            path: '/organizations/:orgId/collections/objects',
            icon: BookOpen,
            requiresPermission: 'collections.view',
          },
        ],
      },
      // ============================================================================
      // TRANSACTIONS - Custody- or status-changing workflows
      // Governed primarily by registrar practice
      // ============================================================================
      {
        id: 'transactions',
        label: 'Transactions',
        icon: ArrowRightLeft,
        children: [
          {
            id: 'entries',
            label: 'Incoming',
            path: '/organizations/:orgId/collections/entries',
            icon: PackageOpen,
            requiresPermission: 'entries.view',
          },
          {
            id: 'acquisitions',
            label: 'Acquisitions',
            path: '/organizations/:orgId/collections/acquisitions',
            icon: Archive,
            requiresPermission: 'acquisitions.view',
          },
          {
            id: 'loans-in',
            label: 'Loans In',
            path: '/organizations/:orgId/collections/loans-in',
            icon: Download,
            requiresPermission: 'loans.view',
          },
          {
            id: 'loans-out',
            label: 'Loans Out',
            path: '/organizations/:orgId/collections/loans-out',
            icon: Upload,
            requiresPermission: 'loans.view',
          },
          {
            id: 'exits',
            label: 'Departures',
            path: '/organizations/:orgId/collections/exits',
            icon: PackageX,
            requiresPermission: 'exits.view',
          },
          {
            id: 'deaccessions',
            label: 'Deaccessions',
            path: '/organizations/:orgId/collections/deaccessions',
            icon: Trash2,
            requiresPermission: 'deaccession.view',
          },
          {
            id: 'movements',
            label: 'Movements',
            path: '/organizations/:orgId/collections/movements',
            icon: Truck,
            requiresPermission: 'movements.view',
          },
          {
            id: 'shipments',
            label: 'Shipments',
            path: '/organizations/:orgId/collections/shipments',
            icon: Box,
            requiresPermission: 'shipments.view',
          },
        ],
      },
      // ============================================================================
      // EXHIBITIONS - Planning, design, and execution
      // ============================================================================
      {
        id: 'exhibitions',
        label: 'Exhibitions',
        icon: LayoutGrid,
        children: [
          {
            id: 'exhibitions-list',
            label: 'Exhibitions',
            path: '/organizations/:orgId/collections/exhibitions',
            icon: LayoutGrid,
            requiresPermission: 'exhibit.view',
          },
          {
            id: 'venues',
            label: 'Venues',
            path: '/organizations/:orgId/collections/venues',
            icon: Building2,
            requiresPermission: 'venues.view',
          },
        ],
      },
      // ============================================================================
      // CARE & RISK - Physical stewardship, risk exposure, object wellbeing
      // ============================================================================
      {
        id: 'care-risk',
        label: 'Care & Risk',
        icon: Heart,
        children: [
          {
            id: 'risk-overview',
            label: 'Risk Overview',
            path: '/organizations/:orgId/collections/risk-overview',
            icon: Shield,
            requiresPermission: 'condition_reports.view',
          },
          {
            id: 'condition-reports',
            label: 'Condition Reports',
            path: '/organizations/:orgId/collections/condition-reports',
            icon: ClipboardCheck,
            requiresPermission: 'condition_reports.view',
          },
          {
            id: 'conservation',
            label: 'Conservation',
            path: '/organizations/:orgId/collections/conservation',
            icon: Hammer,
            requiresPermission: 'conservation.view',
          },
          {
            id: 'incidents',
            label: 'Incidents',
            path: '/organizations/:orgId/collections/incidents',
            icon: AlertCircle,
            requiresPermission: 'incidents.view',
          },
          {
            id: 'valuations',
            label: 'Valuations',
            path: '/organizations/:orgId/collections/valuations',
            icon: DollarSign,
            requiresPermission: 'valuations.view',
          },
          {
            id: 'insurance',
            label: 'Insurance',
            path: '/organizations/:orgId/collections/insurance',
            icon: Shield,
            requiresPermission: 'insurance.view',
          },
          {
            id: 'indemnity',
            label: 'Indemnity',
            path: '/organizations/:orgId/collections/insurance/indemnities',
            icon: Shield,
            requiresPermission: 'insurance.view',
          },
          {
            id: 'emergency-plans',
            label: 'Emergency Plans',
            path: '/organizations/:orgId/collections/emergency-plans',
            icon: AlertTriangle,
            requiresPermission: 'emergency_plans.view',
          },
        ],
      },
      // ============================================================================
      // RIGHTS & REPRODUCTION - Intellectual property, permissions, fulfillment
      // ============================================================================
      {
        id: 'rights-reproduction',
        label: 'Rights & Reproduction',
        icon: Shield,
        children: [
          {
            id: 'rights',
            label: 'Rights',
            path: '/organizations/:orgId/collections/rights',
            icon: Shield,
            requiresPermission: 'rights.view',
          },
          {
            id: 'use-requests',
            label: 'Use Requests',
            path: '/organizations/:orgId/collections/use-requests',
            icon: FileQuestion,
            requiresPermission: 'use_requests.view',
          },
          {
            id: 'reproduction-requests',
            label: 'Reproduction Requests',
            path: '/organizations/:orgId/collections/reproduction-requests',
            icon: Copy,
            requiresPermission: 'reproduction_requests.view',
          },
        ],
      },
      // ============================================================================
      // PEOPLE & ORGANIZATIONS - Unified constituent records
      // ============================================================================
      {
        id: 'constituents',
        label: 'People and Organizations',
        path: '/organizations/:orgId/collections/constituents',
        icon: Users,
        requiresPermission: 'constituents.view',
      },
      // ============================================================================
      // PROGRAMS & RESEARCH - Events, vocabularies, documentation
      // ============================================================================
      {
        id: 'programs-research',
        label: 'Programs & Research',
        icon: Calendar,
        children: [
          {
            id: 'events',
            label: 'Events',
            path: '/organizations/:orgId/collections/events',
            icon: Calendar,
            requiresPermission: 'events.view',
          },
          {
            id: 'vocabularies',
            label: 'Controlled Vocabularies',
            path: '/organizations/:orgId/collections/vocabularies',
            icon: Tag,
            requiresPermission: 'authorities.view',
          },
        ],
      },
      // ============================================================================
      // GOVERNANCE - Institutional oversight, compliance, policy-driven review
      // ============================================================================
      {
        id: 'governance',
        label: 'Governance',
        icon: Scale,
        children: [
          {
            id: 'reviews',
            label: 'Collections Reviews',
            path: '/organizations/:orgId/collections/reviews',
            icon: ClipboardList,
            requiresPermission: 'reviews.view',
          },
          {
            id: 'audits',
            label: 'Audit Campaigns',
            path: '/organizations/:orgId/collections/audits',
            icon: Search,
            requiresPermission: 'audits.view',
          },
        ],
      },
      // ============================================================================
      // INVENTORY - Barcode-driven inventory management
      // ============================================================================
      {
        id: 'inventory',
        label: 'Inventory',
        icon: ScanBarcode,
        children: [
          {
            id: 'barcode-labels',
            label: 'Barcode Labels',
            path: '/organizations/:orgId/collections/barcodes/labels',
            icon: Tag,
            requiresPermission: 'barcodes.view',
          },
          {
            id: 'barcode-scanner',
            label: 'Scanner',
            path: '/organizations/:orgId/collections/barcodes/scanner',
            icon: ScanBarcode,
            requiresPermission: 'barcodes.scan',
          },
          {
            id: 'scan-history',
            label: 'Scan History',
            path: '/organizations/:orgId/collections/barcodes/scans',
            icon: History,
            requiresPermission: 'barcodes.view',
          },
        ],
      },
      // ============================================================================
      // CONFIGURATION - Application settings
      // ============================================================================
      {
        id: 'config',
        label: 'Configuration',
        path: '/organizations/:orgId/collections/config',
        icon: Wrench,
        requiresPermission: 'org.manage_settings',
      },
    ],
  },
  {
    id: 'media',
    label: 'Media',
    icon: Film,
    appKey: 'media',
    items: [
      // ============================================================================
      // WORK - Tasks and Work Sets scoped to Media
      // ============================================================================
      {
        id: 'work',
        label: 'Work',
        icon: Inbox,
        children: [
          {
            id: 'my-tasks',
            label: 'My Tasks',
            path: '/organizations/:orgId/media/work',
            icon: Inbox,
            badgeId: 'task-count',
            exact: true,
          },
          {
            id: 'workspaces',
            label: 'Work Sets',
            path: '/organizations/:orgId/media/work/workspaces',
            icon: Layers,
          },
          {
            id: 'approvals',
            label: 'Approvals',
            path: '/organizations/:orgId/media/work/approvals',
            icon: ClipboardCheck,
            badgeId: 'approval-count',
          },
        ],
      },
      {
        // Intelligence layer (Guide Studio) — copper-accented (spec §5).
        id: 'intelligence',
        label: 'Intelligence',
        icon: Layers,
        accent: 'studio',
        // Guide Studio's output. With Guide off there is nothing here to list,
        // and the plan-count badge polls an endpoint that 503s every minute.
        requiresApp: 'guide',
        defaultExpanded: true,
        children: [
          {
            id: 'plans',
            label: 'Plans',
            path: '/organizations/:orgId/media/work/plans',
            icon: ListChecks,
            badgeId: 'plan-count',
          },
          {
            id: 'drafts',
            label: 'Drafts',
            path: '/organizations/:orgId/media/work/drafts',
            icon: FileEdit,
            badgeId: 'draft-count',
          },
        ],
      },
      // ============================================================================
      // PRIMARY - Daily work destinations
      // ============================================================================
      {
        id: 'library',
        label: 'Library',
        path: '/organizations/:orgId/media',
        icon: Library,
        requiresPermission: 'media.view',
        exact: true,
      },
      {
        id: 'collections',
        label: 'Lightboxes',
        path: '/organizations/:orgId/media/collections',
        icon: FolderHeart,
        requiresPermission: 'media.view',
      },
      {
        id: 'my-shares',
        label: 'My Shared Links',
        path: '/organizations/:orgId/media/my-shares',
        icon: Share2,
        requiresPermission: 'media.view',
      },
      {
        id: 'download-requests',
        label: 'Download Requests',
        path: '/organizations/:orgId/media/download-requests',
        icon: Download,
        requiresPermission: 'download_requests.view',
      },
      {
        id: 'my-download-requests',
        label: 'My Requests',
        path: '/organizations/:orgId/media/my-download-requests',
        icon: User,
        requiresPermission: 'media.view',
      },
      // ============================================================================
      // TOOLS - Operational utilities (collapsed by default)
      // ============================================================================
      {
        id: 'tools',
        label: 'Tools',
        icon: Wrench,
        requiresPermission: 'org.manage_settings',
        children: [
          {
            id: 'publishing',
            label: 'Publishing',
            path: '/organizations/:orgId/media/publishing',
            icon: Globe,
            requiresPermission: 'media.publish',
          },
          {
            id: 'processing-jobs',
            label: 'Processing Jobs',
            path: '/organizations/:orgId/media/processing-jobs',
            icon: Activity,
            requiresPermission: 'media.view',
          },
          {
            id: 'preservation',
            label: 'Preservation',
            path: '/organizations/:orgId/media/preservation',
            icon: ShieldCheck,
            requiresPermission: 'media.view',
          },
          {
            id: 'analytics',
            label: 'Analytics',
            path: '/organizations/:orgId/media/analytics',
            icon: BarChart3,
            requiresPermission: 'media.view',
          },
          {
            id: 'review-queue',
            label: 'Review Queue',
            path: '/organizations/:orgId/media/review-queue',
            icon: ClipboardCheck,
            requiresPermission: 'media.edit',
          },
        ],
      },
      // ============================================================================
      // SETTINGS - Configuration (collapsed by default)
      // ============================================================================
      {
        id: 'settings',
        label: 'Settings',
        icon: Settings,
        requiresPermission: 'org.manage_settings',
        children: [
          {
            id: 'watermark-templates',
            label: 'Watermark Templates',
            path: '/organizations/:orgId/media/watermark-templates',
            icon: Droplets,
            requiresPermission: 'org.manage_settings',
          },
          {
            id: 'metadata-templates',
            label: 'Metadata Templates',
            path: '/organizations/:orgId/media/metadata-templates',
            icon: FileText,
            requiresPermission: 'org.manage_settings',
          },
          {
            id: 'tag-settings',
            label: 'Tag Settings',
            path: '/organizations/:orgId/media/tag-settings',
            icon: Tag,
            requiresPermission: 'org.manage_settings',
          },
          {
            id: 'derivative-settings',
            label: 'Derivative Sizes',
            path: '/organizations/:orgId/media/derivative-settings',
            icon: Layers,
            requiresPermission: 'org.manage_settings',
          },
          {
            id: 'ai-config',
            label: 'AI Tagging',
            path: '/organizations/:orgId/media/ai-config',
            icon: Sparkles,
            requiresPermission: 'org.manage_settings',
          },
          {
            id: 'field-inheritance',
            label: 'Field Inheritance',
            path: '/organizations/:orgId/media/field-inheritance',
            icon: GitCompare,
            requiresPermission: 'org.manage_settings',
          },
          {
            id: 'config',
            label: 'Configuration',
            path: '/organizations/:orgId/media/config',
            icon: Wrench,
            requiresPermission: 'org.manage_settings',
          },
        ],
      },
    ],
  },
  {
    id: 'content',
    label: 'Content',
    icon: Globe,
    appKey: 'content',
    items: [
      {
        id: 'pages',
        label: 'Pages',
        path: '/organizations/:orgId/content/pages',
        icon: FileText,
        requiresPermission: 'content.view',
      },
      {
        id: 'posts',
        label: 'Blog',
        path: '/organizations/:orgId/content/posts',
        icon: PenSquare,
        requiresPermission: 'content.view',
      },
      {
        id: 'categories',
        label: 'Categories',
        path: '/organizations/:orgId/content/categories',
        icon: Tag,
        requiresPermission: 'content.view',
      },
      {
        id: 'site-settings',
        label: 'Site Settings',
        path: '/organizations/:orgId/content/site-settings',
        icon: Settings,
        requiresPermission: 'content.edit',
      },
    ],
  },
  {
    id: 'guide',
    label: 'Guide',
    icon: Bot,
    appKey: 'guide',
    items: [
      {
        id: 'guide-corpus',
        label: 'Corpus',
        path: '/organizations/:orgId/guide/documents',
        icon: FileText,
        // Building the org's shared knowledge base is an admin task.
        requiresPermission: 'org.manage_settings',
      },
      {
        id: 'guide-widget',
        label: 'Widget & Embed',
        path: '/organizations/:orgId/guide/widget',
        icon: Share2,
        requiresPermission: 'org.manage_settings',
      },
      {
        id: 'guide-qr',
        label: 'QR Codes',
        path: '/organizations/:orgId/guide/qr',
        icon: QrCode,
        requiresPermission: 'org.manage_settings',
      },
      {
        id: 'guide-visitor-insights',
        label: 'Visitor Insights',
        path: '/organizations/:orgId/guide/visitors',
        icon: Sparkles,
        requiresPermission: 'org.manage_settings',
      },
    ],
  },
];

/**
 * Admin navigation items
 * Each requires specific RBAC permission
 */
export const adminItems: AdminItem[] = [
  {
    id: 'users',
    label: 'Users',
    path: '/organizations/:orgId/admin/users',
    icon: Users,
    requiresPermission: 'org.manage_members',
  },
  {
    id: 'roles',
    label: 'Role Management',
    path: '/organizations/:orgId/admin/roles',
    icon: UserCog,
    requiresPermission: 'org.manage_roles',
  },
  {
    id: 'applications',
    label: 'Applications',
    path: '/organizations/:orgId/admin/applications',
    icon: LayoutGrid,
    requiresPermission: 'org.manage_settings',
  },
  {
    id: 'departments',
    label: 'Departments',
    path: '/organizations/:orgId/admin/departments',
    icon: Building2,
    requiresPermission: 'departments.manage_members',
  },
  {
    id: 'entity-audit',
    label: 'Change History',
    path: '/organizations/:orgId/admin/entity-audit',
    icon: History,
    requiresPermission: 'org.view_audit_logs',
  },
  {
    id: 'api-keys',
    label: 'API Keys',
    path: '/organizations/:orgId/admin/api-keys',
    icon: Key,
    requiresPermission: 'org.manage_api_keys',
  },
];

/**
 * Platform Admin navigation items
 * Only accessible to users with platform.admin role
 */
export const platformAdminItems: AdminItem[] = [
  {
    id: 'organizations',
    label: 'Organizations',
    path: '/organizations/:orgId/admin/organizations',
    icon: Building2,
    requiresPermission: 'platform.admin',
  },
  {
    id: 'bulk-user-import',
    label: 'Bulk User Import',
    path: '/organizations/:orgId/admin/bulk-import',
    icon: Users,
    requiresPermission: 'platform.admin',
  },
  {
    id: 'logs',
    label: 'Logs',
    path: '/organizations/:orgId/admin/logs',
    icon: FileText,
    requiresPermission: 'platform.admin',
  },
  {
    id: 'app-subscriptions',
    label: 'App Subscriptions',
    path: '/organizations/:orgId/admin/app-subscriptions',
    icon: AppWindow,
    requiresPermission: 'platform.admin',
  },
  {
    id: 'sso-configuration',
    label: 'SSO Configuration',
    path: '/organizations/:orgId/admin/sso',
    icon: Shield,
    requiresPermission: 'platform.admin',
  },
  {
    id: 'permissions',
    label: 'Permissions',
    path: '/organizations/:orgId/admin/permissions',
    icon: ShieldCheck,
    requiresPermission: 'platform.admin',
  },
];

/**
 * Replace :orgId placeholder with actual organization ID
 */
export function buildPath(pathPattern: string, orgId: string | null | undefined): string {
  if (!orgId) return pathPattern;
  return pathPattern.replace(':orgId', orgId);
}

/**
 * Check if a path matches the current location
 */
export function isPathActive(pathPattern: string, currentPath: string, orgId: string | null | undefined, exact?: boolean): boolean {
  const path = buildPath(pathPattern, orgId);

  // Exact match for root paths (like /organizations/:orgId/bridge)
  if (currentPath === path) return true;

  // If exact matching is requested, don't do prefix matching
  if (exact) return false;

  // For setup paths, check prefix match but not exact (allows nested routes)
  if (path.includes('/setup') && !path.includes('/setup/')) {
    return currentPath === path || currentPath.startsWith(path + '/');
  }

  // For other paths, check if current path starts with the nav path
  // but avoid matching /flow when on /flow-something
  if (currentPath.startsWith(path)) {
    const remainder = currentPath.slice(path.length);
    return remainder === '' || remainder.startsWith('/');
  }

  return false;
}
