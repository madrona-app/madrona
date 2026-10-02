import {
  Users,
  User,
  Link as LinkIcon,
  BookOpen,
  Shield,
  ArrowRightLeft,
  MapPin,
  FileText,
} from 'lucide-react';

interface RelationshipCount {
  contacts: number;
  authorities: number;
  relationships: number;
  citations: number;
  rights: number;
  movements: number;
  procedures: number;
}

interface RelationshipNavigationStripProps {
  counts: RelationshipCount;
  activeSection?: string;
  onNavigate: (sectionId: string) => void;
  hasLocation?: boolean;
}

const SECTIONS = [
  { id: 'contacts', label: 'People', icon: Users },
  { id: 'authorities', label: 'Authorities', icon: User },
  { id: 'relationships', label: 'Related Objects', icon: LinkIcon },
  { id: 'citations', label: 'Citations', icon: BookOpen },
  { id: 'rights', label: 'Rights', icon: Shield },
  { id: 'movements', label: 'Movements', icon: ArrowRightLeft },
  { id: 'procedures', label: 'Procedures', icon: FileText },
];

export function RelationshipNavigationStrip({
  counts,
  activeSection,
  onNavigate,
  hasLocation,
}: RelationshipNavigationStripProps) {
  return (
    <div className="bg-stone/30 border border-lichen rounded-institutional p-2 mb-6">
      <div className="flex items-center gap-1 overflow-x-auto">
        {/* Location indicator (not clickable, just status) */}
        {hasLocation && (
          <div className="flex items-center gap-1.5 px-3 py-2 text-sm text-semantic-success bg-semantic-success/10 rounded-lg shrink-0">
            <MapPin size={14} />
            <span>Located</span>
          </div>
        )}

        {/* Divider */}
        {hasLocation && <div className="w-px h-6 bg-lichen mx-1" />}

        {/* Navigation chips */}
        {SECTIONS.map((section) => {
          const count = counts[section.id as keyof RelationshipCount] || 0;
          const Icon = section.icon;
          const isActive = activeSection === section.id;

          return (
            <button
              key={section.id}
              onClick={() => onNavigate(section.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg shrink-0 transition-all
                         ${isActive
                           ? 'bg-bark text-parchment'
                           : count > 0
                             ? 'bg-parchment text-ink hover:bg-bark/10'
                             : 'text-archive hover:bg-parchment hover:text-ink'
                         }`}
            >
              <Icon size={14} />
              <span className="hidden sm:inline">{section.label}</span>
              {count > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full
                                ${isActive
                                  ? 'bg-parchment/20 text-parchment'
                                  : 'bg-azurite/10 text-azurite'
                                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default RelationshipNavigationStrip;
