import { Plus, type LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  variant?: 'default' | 'compact' | 'inline';
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  variant = 'default',
}: EmptyStateProps) {
  if (variant === 'inline') {
    return (
      <div className="flex items-center justify-between py-3 px-4 bg-stone/30 rounded-institutional">
        <div className="flex items-center gap-3">
          {Icon && <Icon size={18} className="text-archive/60" />}
          <span className="text-sm text-archive">{title}</span>
        </div>
        {action && (
          <button
            onClick={action.onClick}
            className="text-sm text-bark hover:text-copper-dark flex items-center gap-1"
          >
            <Plus size={14} />
            {action.label}
          </button>
        )}
      </div>
    );
  }

  if (variant === 'compact') {
    return (
      <div className="text-center py-6">
        {Icon && (
          <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-stone/50 flex items-center justify-center">
            <Icon size={20} className="text-archive/60" />
          </div>
        )}
        <p className="text-sm text-archive mb-2">{title}</p>
        {action && (
          <button
            onClick={action.onClick}
            className="text-sm text-bark hover:text-copper-dark flex items-center gap-1 mx-auto"
          >
            <Plus size={14} />
            {action.label}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="text-center py-12 px-6">
      {Icon && (
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-stone/50 flex items-center justify-center">
          <Icon size={32} className="text-archive/50" />
        </div>
      )}
      <h3 className="text-lg font-serif font-medium text-forest mb-2">
        {title}
      </h3>
      {description && (
        <p className="text-sm text-archive max-w-sm mx-auto mb-4">
          {description}
        </p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="btn btn-primary inline-flex items-center gap-2"
        >
          <Plus size={16} />
          {action.label}
        </button>
      )}
    </div>
  );
}

export default EmptyState;
