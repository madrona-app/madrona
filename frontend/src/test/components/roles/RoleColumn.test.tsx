import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RoleColumn } from '../../../components/roles/RoleColumn';
import type { OrgUser } from '../../../components/roles/UserRoleCard';

// Mock dnd-kit
const mockSetNodeRef = vi.fn();
vi.mock('@dnd-kit/core', () => ({
  useDroppable: vi.fn(() => ({
    setNodeRef: mockSetNodeRef,
    isOver: false,
  })),
}));

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <div data-testid="sortable-context">{children}</div>,
  verticalListSortingStrategy: {},
  useSortable: vi.fn(() => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  })),
}));

vi.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: {
      toString: () => null,
    },
  },
}));

import { useDroppable } from '@dnd-kit/core';

const mockUseDroppable = vi.mocked(useDroppable);

describe('RoleColumn', () => {
  const mockRole = {
    role_id: 'role-admin',
    role_key: 'admin',
    display_name: 'Admin',
  };

  const mockUsers: OrgUser[] = [
    {
      user_id: 'user-1',
      email: 'john@example.com',
      name: 'John Doe',
      role_id: 'role-admin',
      role_key: 'admin',
      role_display_name: 'Admin',
      status: 'active',
      user_status: 'active',
      created_at: '2024-01-15T10:00:00Z',
    },
    {
      user_id: 'user-2',
      email: 'jane@example.com',
      name: 'Jane Smith',
      role_id: 'role-admin',
      role_key: 'admin',
      role_display_name: 'Admin',
      status: 'active',
      user_status: 'active',
      created_at: '2024-01-14T10:00:00Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDroppable.mockReturnValue({
      setNodeRef: mockSetNodeRef,
      isOver: false,
    } as any);
  });

  describe('basic rendering', () => {
    it('renders role display name', () => {
      render(<RoleColumn role={mockRole} users={mockUsers} />);
      expect(screen.getByText('Admin')).toBeInTheDocument();
    });

    it('renders user count', () => {
      render(<RoleColumn role={mockRole} users={mockUsers} />);
      expect(screen.getByText('2')).toBeInTheDocument();
    });

    it('renders all users', () => {
      render(<RoleColumn role={mockRole} users={mockUsers} />);
      expect(screen.getByText('John Doe')).toBeInTheDocument();
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('shows "No users" when users array is empty', () => {
      render(<RoleColumn role={mockRole} users={[]} />);
      expect(screen.getByText('No users')).toBeInTheDocument();
    });

    it('shows count of 0 when empty', () => {
      render(<RoleColumn role={mockRole} users={[]} />);
      expect(screen.getByText('0')).toBeInTheDocument();
    });
  });

  describe('role info tooltip', () => {
    // Info button only renders when currentApp has capabilities for the role_key,
    // or when enabledApps is provided without a currentApp. Use registrar in bridge
    // since admin has no per-app capability descriptions.
    const registrarRole = {
      role_id: 'role-registrar',
      role_key: 'registrar',
      display_name: 'Registrar',
    };

    it('shows info button when current app has capabilities for role', () => {
      render(<RoleColumn role={registrarRole} users={[]} currentApp="bridge" />);
      expect(screen.getByRole('button', { name: /info about registrar role/i })).toBeInTheDocument();
    });

    it('shows tooltip on hover', () => {
      render(<RoleColumn role={registrarRole} users={[]} currentApp="bridge" />);
      const infoButton = screen.getByRole('button', { name: /info about registrar role/i });
      fireEvent.mouseEnter(infoButton);
      expect(screen.getByText('Create and configure connectors')).toBeInTheDocument();
    });

    it('hides tooltip on mouse leave', () => {
      render(<RoleColumn role={registrarRole} users={[]} currentApp="bridge" />);
      const infoButton = screen.getByRole('button', { name: /info about registrar role/i });
      fireEvent.mouseEnter(infoButton);
      expect(screen.getByText('Create and configure connectors')).toBeInTheDocument();
      fireEvent.mouseLeave(infoButton);
      expect(screen.queryByText('Create and configure connectors')).not.toBeInTheDocument();
    });

    it('shows tooltip on focus', () => {
      render(<RoleColumn role={registrarRole} users={[]} currentApp="bridge" />);
      const infoButton = screen.getByRole('button', { name: /info about registrar role/i });
      fireEvent.focus(infoButton);
      expect(screen.getByText('Create and configure connectors')).toBeInTheDocument();
    });

    it('hides tooltip on blur', () => {
      render(<RoleColumn role={registrarRole} users={[]} currentApp="bridge" />);
      const infoButton = screen.getByRole('button', { name: /info about registrar role/i });
      fireEvent.focus(infoButton);
      fireEvent.blur(infoButton);
      expect(screen.queryByText('Create and configure connectors')).not.toBeInTheDocument();
    });

    it('displays privileges in tooltip', () => {
      render(<RoleColumn role={registrarRole} users={[]} currentApp="bridge" />);
      const infoButton = screen.getByRole('button', { name: /info about registrar role/i });
      fireEvent.mouseEnter(infoButton);
      expect(screen.getByText('Build and manage pipelines')).toBeInTheDocument();
      expect(screen.getByText('Execute pipeline runs')).toBeInTheDocument();
    });
  });

  describe('different roles', () => {
    it('shows registrar info in collections app', () => {
      const role = { role_id: 'role-r', role_key: 'registrar', display_name: 'Registrar' };
      render(<RoleColumn role={role} users={[]} currentApp="collections" />);
      const infoButton = screen.getByRole('button', { name: /info about registrar role/i });
      fireEvent.mouseEnter(infoButton);
      expect(screen.getByText('Create and manage collections')).toBeInTheDocument();
    });

    it('shows viewer info in bridge app', () => {
      const viewerRole = {
        role_id: 'role-viewer',
        role_key: 'viewer',
        display_name: 'Viewer',
      };
      render(<RoleColumn role={viewerRole} users={[]} currentApp="bridge" />);
      const infoButton = screen.getByRole('button', { name: /info about viewer role/i });
      fireEvent.mouseEnter(infoButton);
      expect(screen.getByText('View pipelines and connectors')).toBeInTheDocument();
    });

    it('does not show info button when role_key has no capabilities', () => {
      // admin has no entries in APP_ROLE_DESCRIPTIONS for any app
      render(<RoleColumn role={mockRole} users={[]} currentApp="bridge" />);
      expect(screen.queryByRole('button', { name: /info about admin role/i })).not.toBeInTheDocument();
    });
  });

  describe('droppable behavior', () => {
    it('calls useDroppable with role_id', () => {
      render(<RoleColumn role={mockRole} users={[]} />);

      expect(mockUseDroppable).toHaveBeenCalledWith({
        id: 'role-admin',
        data: {
          type: 'column',
          role: mockRole,
        },
      });
    });

    it('applies highlight when isOver prop is true', () => {
      const { container } = render(<RoleColumn role={mockRole} users={[]} isOver />);
      expect(container.firstChild).toHaveClass('border-primary');
      expect(container.firstChild).toHaveClass('bg-primary-50');
    });

    it('applies highlight when droppable isOver', () => {
      mockUseDroppable.mockReturnValue({
        setNodeRef: mockSetNodeRef,
        isOver: true,
      } as any);

      const { container } = render(<RoleColumn role={mockRole} users={[]} />);
      expect(container.firstChild).toHaveClass('border-primary');
    });

    it('does not highlight when not over', () => {
      const { container } = render(<RoleColumn role={mockRole} users={[]} />);
      expect(container.firstChild).toHaveClass('border-lichen');
      expect(container.firstChild).not.toHaveClass('border-primary');
    });
  });

  describe('sortable context', () => {
    it('wraps users in SortableContext', () => {
      render(<RoleColumn role={mockRole} users={mockUsers} />);
      expect(screen.getByTestId('sortable-context')).toBeInTheDocument();
    });
  });

  describe('styling', () => {
    it('has minimum height', () => {
      const { container } = render(<RoleColumn role={mockRole} users={[]} />);
      expect(container.firstChild).toHaveClass('min-h-[400px]');
    });

    it('has rounded corners', () => {
      const { container } = render(<RoleColumn role={mockRole} users={[]} />);
      expect(container.firstChild).toHaveClass('rounded-lg');
    });

    it('has gray background', () => {
      const { container } = render(<RoleColumn role={mockRole} users={[]} />);
      expect(container.firstChild).toHaveClass('bg-stone');
    });
  });
});
