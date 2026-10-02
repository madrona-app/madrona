import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UserRoleCard, UserRoleCardOverlay, type OrgUser } from '../../../components/roles/UserRoleCard';

// Mock dnd-kit
vi.mock('@dnd-kit/sortable', () => ({
  useSortable: vi.fn(() => ({
    attributes: { role: 'button' },
    listeners: { onMouseDown: vi.fn() },
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  })),
}));

vi.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: {
      toString: (transform: any) => transform ? `translate(${transform.x}px, ${transform.y}px)` : null,
    },
  },
}));

describe('UserRoleCard', () => {
  const mockUser: OrgUser = {
    user_id: 'user-123',
    email: 'john@example.com',
    name: 'John Doe',
    role_id: 'role-1',
    role_key: 'admin',
    role_display_name: 'Admin',
    status: 'active',
    user_status: 'active',
    created_at: '2024-01-15T10:00:00Z',
  };

  describe('basic rendering', () => {
    it('renders user name', () => {
      render(<UserRoleCard user={mockUser} />);
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    it('renders user email', () => {
      render(<UserRoleCard user={mockUser} />);
      expect(screen.getByText('john@example.com')).toBeInTheDocument();
    });

    it('renders "No name" when name is missing', () => {
      const userWithoutName = { ...mockUser, name: undefined };
      render(<UserRoleCard user={userWithoutName} />);
      expect(screen.getByText('No name')).toBeInTheDocument();
    });
  });

  describe('initials', () => {
    it('displays initials from full name', () => {
      render(<UserRoleCard user={mockUser} />);
      expect(screen.getByText('JD')).toBeInTheDocument();
    });

    it('displays single initial for single name', () => {
      const singleNameUser = { ...mockUser, name: 'John' };
      render(<UserRoleCard user={singleNameUser} />);
      expect(screen.getByText('J')).toBeInTheDocument();
    });

    it('displays email initial when no name', () => {
      const noNameUser = { ...mockUser, name: undefined, email: 'alice@example.com' };
      render(<UserRoleCard user={noNameUser} />);
      expect(screen.getByText('A')).toBeInTheDocument();
    });
  });

  describe('status badges', () => {
    it('shows Active badge for active user', () => {
      render(<UserRoleCard user={mockUser} />);
      expect(screen.getByText('Active')).toBeInTheDocument();
    });

    it('shows Invited badge for invited user', () => {
      const invitedUser = { ...mockUser, user_status: 'invited' as const };
      render(<UserRoleCard user={invitedUser} />);
      expect(screen.getByText('Invited')).toBeInTheDocument();
    });

    it('shows Deactivated badge for deactivated membership', () => {
      const deactivatedUser = { ...mockUser, status: 'deactivated' as const };
      render(<UserRoleCard user={deactivatedUser} />);
      expect(screen.getByText('Deactivated')).toBeInTheDocument();
    });

    it('prioritizes Deactivated over Invited', () => {
      const deactivatedInvited = {
        ...mockUser,
        status: 'deactivated' as const,
        user_status: 'invited' as const,
      };
      render(<UserRoleCard user={deactivatedInvited} />);
      expect(screen.getByText('Deactivated')).toBeInTheDocument();
      expect(screen.queryByText('Invited')).not.toBeInTheDocument();
    });
  });

  describe('dragging state', () => {
    it('applies opacity when isDragging prop is true', () => {
      const { container } = render(<UserRoleCard user={mockUser} isDragging />);
      expect(container.firstChild).toHaveClass('opacity-50');
    });

    it('does not have opacity-50 when not dragging', () => {
      const { container } = render(<UserRoleCard user={mockUser} />);
      expect(container.firstChild).not.toHaveClass('opacity-50');
    });
  });

  describe('overlay rendering', () => {
    it('applies overlay styles when isOverlay is true', () => {
      const { container } = render(<UserRoleCard user={mockUser} isOverlay />);
      expect(container.firstChild).toHaveClass('shadow-xl');
      expect(container.firstChild).toHaveClass('rotate-3');
    });

    it('does not apply overlay styles when isOverlay is false', () => {
      const { container } = render(<UserRoleCard user={mockUser} />);
      expect(container.firstChild).not.toHaveClass('shadow-xl');
      expect(container.firstChild).not.toHaveClass('rotate-3');
    });
  });

  describe('drag handle', () => {
    it('renders drag handle icon', () => {
      const { container } = render(<UserRoleCard user={mockUser} />);
      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });
  });

  describe('styling', () => {
    it('has white background', () => {
      const { container } = render(<UserRoleCard user={mockUser} />);
      expect(container.firstChild).toHaveClass('bg-parchment');
    });

    it('has border and rounded corners', () => {
      const { container } = render(<UserRoleCard user={mockUser} />);
      expect(container.firstChild).toHaveClass('border');
      expect(container.firstChild).toHaveClass('rounded-lg');
    });
  });
});

describe('UserRoleCardOverlay', () => {
  const mockUser: OrgUser = {
    user_id: 'user-456',
    email: 'jane@example.com',
    name: 'Jane Smith',
    role_id: 'role-2',
    role_key: 'viewer',
    role_display_name: 'Viewer',
    status: 'active',
    user_status: 'active',
    created_at: '2024-01-15T10:00:00Z',
  };

  it('renders UserRoleCard with isOverlay prop', () => {
    const { container } = render(<UserRoleCardOverlay user={mockUser} />);
    expect(container.firstChild).toHaveClass('shadow-xl');
    expect(container.firstChild).toHaveClass('rotate-3');
  });

  it('displays user information', () => {
    render(<UserRoleCardOverlay user={mockUser} />);
    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    expect(screen.getByText('jane@example.com')).toBeInTheDocument();
  });
});
