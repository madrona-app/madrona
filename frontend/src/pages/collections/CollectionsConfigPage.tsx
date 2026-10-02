import { useMemo } from 'react';
import { Outlet, useNavigate, useLocation, useParams } from 'react-router-dom';
import { MapPin, Settings, List, Palette, Globe, FileText, Shield, Library } from 'lucide-react';
import { useOrganization } from '../../contexts/useOrganization';
import { useAuth } from '../../hooks/useAuth';

interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

interface NavSection {
  section?: string;
  items: NavItem[];
}

export default function CollectionsConfigPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { orgId } = useParams<{ orgId: string }>();
  const { activeOrganizationId } = useOrganization();
  const { hasAppAccess } = useAuth();
  const organizationId = orgId || activeOrganizationId;
  const hasDiscoverApp = hasAppAccess('discover');

  const navSections: NavSection[] = useMemo(() => [
    {
      section: 'Settings',
      items: [
        {
          id: 'general',
          label: 'General',
          path: `/organizations/${organizationId}/collections/config`,
          icon: Settings,
        },
        {
          id: 'scope',
          label: 'Collection Scope',
          path: `/organizations/${organizationId}/collections/config/scope`,
          icon: Library,
        },
      ],
    },
    {
      section: 'Storage',
      items: [
        {
          id: 'locations',
          label: 'Locations',
          path: `/organizations/${organizationId}/collections/config/locations`,
          icon: MapPin,
        },
      ],
    },
    {
      section: 'Vocabularies',
      items: [
        {
          id: 'lookup-values',
          label: 'Lookup Values',
          path: `/organizations/${organizationId}/collections/config/lookup-values`,
          icon: List,
        },
      ],
    },
    {
      section: 'Documents',
      items: [
        {
          id: 'branding',
          label: 'Branding',
          path: `/organizations/${organizationId}/collections/config/branding`,
          icon: Palette,
        },
        {
          id: 'report-templates',
          label: 'Report Templates',
          path: `/organizations/${organizationId}/collections/config/report-templates`,
          icon: FileText,
        },
      ],
    },
    {
      section: 'Compliance',
      items: [
        {
          id: 'procedure',
          label: 'Procedure Enforcement',
          path: `/organizations/${organizationId}/collections/config/procedure`,
          icon: Shield,
        },
      ],
    },
    // Only show Discover section if org has the discover app
    ...(hasDiscoverApp ? [{
      section: 'Public',
      items: [
        {
          id: 'discover',
          label: 'Discover',
          path: `/organizations/${organizationId}/collections/config/discover`,
          icon: Globe,
        },
      ],
    }] : []),
  ], [organizationId, hasDiscoverApp]);

  const isActive = (path: string) => {
    if (path === `/organizations/${organizationId}/collections/config`) {
      return location.pathname === path;
    }
    return location.pathname.startsWith(path);
  };

  return (
    <div className="flex h-full -mx-4 sm:-mx-6 lg:-mx-8 -my-6">
      {/* Secondary navigation sidebar */}
      <div className="w-56 bg-stone/50 border-r border-lichen flex-shrink-0 ml-6">
        <div className="p-4 pt-6">
          <h2 className="text-base font-semibold text-ink mb-0.5">Collections Configuration</h2>
          <p className="text-xs text-archive">Manage your Collections setup</p>
        </div>
        <nav className="px-2 pb-6">
          {navSections.map((section, sectionIdx) => (
            <div key={sectionIdx} className={sectionIdx > 0 ? 'mt-6' : ''}>
              {section.section && (
                <div className="px-2 mb-1.5 pt-1.5 border-t border-lichen/50">
                  <h3 className="text-xs font-semibold text-archive uppercase" style={{ letterSpacing: '0.08em' }}>
                    {section.section}
                  </h3>
                </div>
              )}
              {section.items.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.path);
                return (
                  <button
                    key={item.id}
                    onClick={() => navigate(item.path)}
                    className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded text-sm transition-colors ${
                      active
                        ? 'bg-stone text-ink font-medium'
                        : 'text-ink hover:bg-stone/70'
                    }`}
                  >
                    <Icon size={16} className={active ? 'text-ink' : 'text-archive'} />
                    {item.label}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </div>

      {/* Main content area */}
      <div className="flex-1 overflow-auto pl-8 pr-6 py-6">
        <Outlet />
      </div>
    </div>
  );
}
