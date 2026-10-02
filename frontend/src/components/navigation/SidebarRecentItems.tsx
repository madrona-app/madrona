/**
 * SidebarRecentItems - Compact recent items list for the sidebar.
 *
 * Shows a small list of recently visited record pages with type icons,
 * truncated labels as links, and active-state highlighting.
 */

import { Link, useLocation } from 'react-router-dom';
import {
  Package,
  ClipboardCheck,
  Download,
  Upload,
  Archive,
  ArrowRightLeft,
  Hammer,
  AlertCircle,
  FileQuestion,
  LayoutGrid,
  FileText,
  Shield,
  MapPin,
  Palette,
  Tag,
  BookOpen,
  ScrollText,
  Search,
  Calendar,
  ShieldCheck,
  Siren,
  DollarSign,
  User,
} from 'lucide-react';
import type { RecentItem } from '../../contexts/WorkContext';

const TYPE_ICONS: Record<string, typeof Package> = {
  object: Package,
  condition_report: ClipboardCheck,
  loan_in: Download,
  loan_out: Upload,
  acquisition: Archive,
  movement: ArrowRightLeft,
  conservation: Hammer,
  incident: AlertCircle,
  use_request: FileQuestion,
  exhibition: LayoutGrid,
  object_entry: FileText,
  object_exit: FileText,
  deaccession: FileText,
  valuation: DollarSign,
  emergency_plan: Siren,
  reproduction_request: FileQuestion,
  rights: Shield,
  biography: User,
  constituent: User,
  'place-authority': MapPin,
  'style-period-authority': Palette,
  'subject-authority': Tag,
  citation: BookOpen,
  documentation_plan: ScrollText,
  collections_review: Search,
  audit_campaign: ShieldCheck,
  event: Calendar,
  'insurance-policy': Shield,
};

interface SidebarRecentItemsProps {
  recentItems: RecentItem[];
  limit?: number;
}

export function SidebarRecentItems({ recentItems, limit = 5 }: SidebarRecentItemsProps) {
  const location = useLocation();
  const items = recentItems.slice(0, limit);

  if (items.length === 0) {
    return (
      <p className="px-3 py-2 text-xs text-archive/70 italic">
        No recent items
      </p>
    );
  }

  return (
    <nav aria-label="Recent items">
      {items.map((item) => {
        const Icon = TYPE_ICONS[item.type] || Package;
        const isActive = location.pathname.replace(/\/edit$/, '') === item.path;

        return (
          <Link
            key={`${item.type}-${item.id}`}
            to={item.path}
            className={`sidebar-nav-item ${isActive ? 'sidebar-nav-item--active' : ''}`}
            title={item.sublabel ? `${item.label} - ${item.sublabel}` : item.label}
          >
            <Icon size={16} className="sidebar-nav-item-icon flex-shrink-0" />
            <span className="sidebar-nav-item-label truncate text-xs">
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
