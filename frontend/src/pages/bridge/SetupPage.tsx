import { Outlet, useNavigate, useLocation, useParams } from 'react-router-dom';
import { BookOpen, Plug, GitBranch, Play, Layers, Link2 } from 'lucide-react';
import { FaDatabase } from 'react-icons/fa';
import { useOrganization } from '../../contexts/useOrganization';

interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  dataTour?: string;
}

interface NavSection {
  section?: string; // Optional section header
  items: NavItem[];
  helperText?: string; // Optional helper text below section
}

export default function SetupPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { orgId } = useParams<{ orgId: string }>();
  const { activeOrganizationId } = useOrganization();
  const organizationId = orgId || activeOrganizationId;

  // Navigation structure with semantic groupings
  // Note: Search is intentionally NOT here - it's a user exploration capability
  // that belongs only in the global top navigation, not configuration.
  const navSections: NavSection[] = [
    {
      section: 'Setup',
      items: [
        {
          id: 'guided',
          label: 'Guided Setup',
          path: `/organizations/${organizationId}/bridge/setup`,
          icon: BookOpen,
          dataTour: 'setup-guided',
        },
      ],
    },
    {
      section: 'Systems',
      items: [
        {
          id: 'connectors',
          label: 'Connectors',
          path: `/organizations/${organizationId}/bridge/setup/connectors`,
          icon: Plug,
          dataTour: 'setup-connectors',
        },
      ],
    },
    {
      section: 'Data Models',
      items: [
        {
          id: 'pipelines',
          label: 'Pipelines',
          path: `/organizations/${organizationId}/bridge/setup/pipelines`,
          icon: GitBranch,
          dataTour: 'setup-pipelines',
        },
        {
          id: 'datasets',
          label: 'Canonical Collections',
          path: `/organizations/${organizationId}/bridge/setup/datasets`,
          icon: FaDatabase,
          dataTour: 'setup-datasets',
        },
        {
          id: 'display-fields',
          label: 'Canonical Display Fields',
          path: `/organizations/${organizationId}/bridge/setup/display-fields`,
          icon: Layers,
          dataTour: 'setup-display-fields',
        },
        {
          id: 'relationships',
          label: 'Relationships',
          path: `/organizations/${organizationId}/bridge/setup/relationships`,
          icon: Link2,
          dataTour: 'setup-relationships',
        },
      ],
    },
    {
      section: 'Operations',
      items: [
        {
          id: 'pipeline-runs',
          label: 'Pipeline Runs',
          path: `/organizations/${organizationId}/bridge/setup/runs`,
          icon: Play,
          dataTour: 'setup-pipeline-runs',
        },
      ],
    },
  ];

  const isActive = (path: string) => {
    if (path === `/organizations/${organizationId}/bridge/setup`) {
      return location.pathname === path;
    }
    return location.pathname.startsWith(path);
  };

  return (
    <div className="flex h-full -mx-4 sm:-mx-6 lg:-mx-8 -my-6">
      {/* Secondary navigation sidebar - subtle styling to complement main sidebar */}
      <div className="w-56 bg-stone/50 border-r border-lichen flex-shrink-0">
        <div className="p-4 pt-6">
          <h2 className="text-base font-semibold text-ink mb-0.5">Bridge Configuration</h2>
          <p className="text-xs text-archive">Manage your Madrona setup</p>
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
              {section.helperText && (
                <div className="px-2 mt-1.5">
                  <p className="text-xs text-archive">
                    {section.helperText}
                  </p>
                </div>
              )}
            </div>
          ))}
        </nav>
      </div>

      {/* Main content area */}
      <div className="flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  );
}
