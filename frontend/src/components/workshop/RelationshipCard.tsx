import { X, ExternalLink, User, Building2, MapPin } from 'lucide-react';
import { cn } from '../../lib/utils';

interface RelationshipCardProps {
  /** Primary display name */
  name: string;
  /** Role or type label (e.g., "Creator", "Donor") */
  role?: string;
  /** Secondary info (e.g., dates, organization) */
  subtitle?: string;
  /** Thumbnail URL */
  thumbnailUrl?: string;
  /** Type of relationship for icon selection */
  type?: 'person' | 'organization' | 'place';
  /** Called when remove button is clicked */
  onRemove?: () => void;
  /** Called when card is clicked for editing */
  onClick?: () => void;
  /** Link to detail page */
  detailUrl?: string;
  /** Additional className */
  className?: string;
}

const TYPE_ICONS = {
  person: User,
  organization: Building2,
  place: MapPin,
};

/**
 * A card displaying a linked relationship (person, org, place).
 * Supports inline removal and click-to-edit.
 */
export function RelationshipCard({
  name,
  role,
  subtitle,
  thumbnailUrl,
  type = 'person',
  onRemove,
  onClick,
  detailUrl,
  className,
}: RelationshipCardProps) {
  const Icon = TYPE_ICONS[type];

  const cardContent = (
    <>
      {/* Avatar/Icon */}
      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-stone/50 flex items-center justify-center overflow-hidden">
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <Icon size={18} className="text-archive" />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-ink truncate">{name}</span>
          {role && (
            <span className="flex-shrink-0 text-xs px-1.5 py-0.5 bg-azurite/10 text-azurite rounded">
              {role}
            </span>
          )}
        </div>
        {subtitle && (
          <p className="text-xs text-archive truncate mt-0.5">{subtitle}</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {detailUrl && (
          <a
            href={detailUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 text-archive hover:text-bark rounded transition-colors"
            title="View details"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink size={14} />
          </a>
        )}
        {onRemove && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="p-1.5 text-archive hover:text-semantic-error rounded transition-colors"
            title="Remove"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </>
  );

  const cardClasses = cn(
    'group flex items-center gap-3 p-3 rounded-lg border border-lichen/50 bg-parchment',
    'transition-all duration-150',
    onClick && 'cursor-pointer hover:border-bark/30 hover:shadow-sm',
    className
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn(cardClasses, 'w-full text-left')}>
        {cardContent}
      </button>
    );
  }

  return <div className={cardClasses}>{cardContent}</div>;
}

interface EmptyRelationshipStateProps {
  /** Message to display */
  message: string;
  /** Call-to-action button text */
  actionText: string;
  /** Called when action button is clicked */
  onAction: () => void;
  /** Icon type */
  type?: 'person' | 'organization' | 'place';
  /** Additional className */
  className?: string;
}

/**
 * Empty state for relationship sections with invitational language.
 */
export function EmptyRelationshipState({
  message,
  actionText,
  onAction,
  type = 'person',
  className,
}: EmptyRelationshipStateProps) {
  const Icon = TYPE_ICONS[type];

  return (
    <div
      className={cn(
        'flex flex-col items-center py-8 px-4 text-center',
        'border-2 border-dashed border-lichen/50 rounded-lg',
        'bg-stone/20',
        className
      )}
    >
      <div className="w-12 h-12 rounded-full bg-stone/50 flex items-center justify-center mb-3">
        <Icon size={24} className="text-archive" />
      </div>
      <p className="text-sm text-archive mb-4">{message}</p>
      <button
        type="button"
        onClick={onAction}
        className="btn btn-secondary text-sm"
      >
        {actionText}
      </button>
    </div>
  );
}
