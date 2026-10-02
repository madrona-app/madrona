import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';

export interface OrgUser {
  user_id: string;
  email: string;
  name?: string;
  role_id: string;
  role_key: string;
  role_display_name: string;
  status: 'active' | 'deactivated';
  user_status: 'active' | 'invited' | 'suspended';
  created_at: string;
}

interface UserRoleCardProps {
  user: OrgUser;
  isDragging?: boolean;
  isOverlay?: boolean;
  dataTour?: string;
}

export function UserRoleCard({ user, isDragging, isOverlay, dataTour }: UserRoleCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({
    id: user.user_id,
    data: {
      type: 'user',
      user,
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const getStatusBadge = (membershipStatus: string, userStatus: string) => {
    if (membershipStatus === 'deactivated') {
      return (
        <span className="px-1.5 py-0.5 text-xs font-medium rounded bg-stone text-accessible-gray">
          Deactivated
        </span>
      );
    }
    if (userStatus === 'invited') {
      return (
        <span className="px-1.5 py-0.5 text-xs font-medium rounded bg-semantic-warning/10 text-semantic-warning">
          Invited
        </span>
      );
    }
    return (
      <span className="px-1.5 py-0.5 text-xs font-medium rounded bg-semantic-success/10 text-semantic-success">
        Active
      </span>
    );
  };

  const getInitials = () => {
    if (user.name) {
      const parts = user.name.split(' ');
      if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
      }
      return user.name[0].toUpperCase();
    }
    return user.email[0].toUpperCase();
  };

  const dragging = isDragging || isSortableDragging;

  return (
    <div
      ref={!isOverlay ? setNodeRef : undefined}
      style={!isOverlay ? style : undefined}
      data-tour={dataTour}
      className={`
        flex items-center gap-2 p-2 bg-parchment border rounded-lg
        ${dragging ? 'opacity-50 shadow-lg ring-2 ring-primary' : 'shadow-sm'}
        ${isOverlay ? 'shadow-xl rotate-3' : ''}
        transition-shadow
      `}
    >
      {/* Drag handle */}
      <div
        {...(!isOverlay ? attributes : {})}
        {...(!isOverlay ? listeners : {})}
        className="cursor-grab active:cursor-grabbing text-archive hover:text-accessible-gray"
      >
        <GripVertical size={16} />
      </div>

      {/* Avatar */}
      <div className="flex-shrink-0 h-8 w-8 rounded-full bg-primary-100 flex items-center justify-center">
        <span className="text-primary-700 text-sm font-medium">{getInitials()}</span>
      </div>

      {/* User info */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-ink truncate">
          {user.name || 'No name'}
        </div>
        <div className="text-xs text-archive truncate">{user.email}</div>
      </div>

      {/* Status badge */}
      {getStatusBadge(user.status, user.user_status)}
    </div>
  );
}

// Non-sortable version for the DragOverlay
export function UserRoleCardOverlay({ user }: { user: OrgUser }) {
  return <UserRoleCard user={user} isOverlay />;
}
