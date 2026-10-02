import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { useWorkspacePage } from '../../hooks/useWorkspacePage';

// Use vi.hoisted so mocks are available before vi.mock runs
const { mockHasPermission, mockIsRestricted, mockSetEntityContext } = vi.hoisted(() => ({
  mockHasPermission: vi.fn().mockReturnValue(true),
  mockIsRestricted: vi.fn().mockReturnValue(false),
  mockSetEntityContext: vi.fn(),
}));

// Mock usePermissions
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: vi.fn().mockReturnValue({
    hasPermission: mockHasPermission,
    permissions: ['loans.edit', 'objects.edit'],
  }),
}));

// Mock useFieldAccess
vi.mock('../../hooks/useFieldAccess', () => ({
  useFieldAccess: vi.fn().mockReturnValue({
    isRestricted: mockIsRestricted,
    hasRestrictions: false,
  }),
}));

// Mock AgentChatContext
vi.mock('../../contexts/AgentChatContext', () => ({
  useAgentChatContext: vi.fn().mockReturnValue({
    setEntityContext: mockSetEntityContext,
    isOpen: false,
    entityContext: null,
    openChat: vi.fn(),
    closeChat: vi.fn(),
  }),
}));

function createWrapper(initialRoute = '/organizations/org-1/collections/loans/loan-1/edit') {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <MemoryRouter initialEntries={[initialRoute]}>
        {children}
      </MemoryRouter>
    );
  };
}

const defaultConfig = {
  entityType: 'loan_out',
  entityId: 'loan-1',
  entityLabel: 'LOAN.001',
  orgId: 'org-1',
  editPermission: 'loans.edit',
};

describe('useWorkspacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
    mockIsRestricted.mockReturnValue(false);
  });

  describe('create mode', () => {
    it('detects create mode when no entityId', () => {
      const { result } = renderHook(
        () => useWorkspacePage({ ...defaultConfig, entityId: undefined }),
        { wrapper: createWrapper('/organizations/org-1/collections/loans/create') }
      );

      expect(result.current.isCreateMode).toBe(true);
    });

    it('allows editing in create mode regardless of permissions', () => {
      mockHasPermission.mockReturnValue(false);

      const { result } = renderHook(
        () => useWorkspacePage({ ...defaultConfig, entityId: undefined }),
        { wrapper: createWrapper('/organizations/org-1/collections/loans/create') }
      );

      expect(result.current.canEdit).toBe(true);
      expect(result.current.isEditing).toBe(true);
    });
  });

  describe('edit mode', () => {
    it('detects non-create mode with entityId', () => {
      const { result } = renderHook(
        () => useWorkspacePage(defaultConfig),
        { wrapper: createWrapper() }
      );

      expect(result.current.isCreateMode).toBe(false);
    });

    it('computes canEdit from editPermission', () => {
      mockHasPermission.mockReturnValue(true);

      const { result } = renderHook(
        () => useWorkspacePage(defaultConfig),
        { wrapper: createWrapper() }
      );

      expect(result.current.canEdit).toBe(true);
    });

    it('denies editing when permission is missing', () => {
      mockHasPermission.mockReturnValue(false);

      const { result } = renderHook(
        () => useWorkspacePage(defaultConfig),
        { wrapper: createWrapper() }
      );

      expect(result.current.canEdit).toBe(false);
      // isEditing should be clamped by canEdit
      expect(result.current.isEditing).toBe(false);
    });

    it('uses explicit canEdit override', () => {
      const { result } = renderHook(
        () => useWorkspacePage({ ...defaultConfig, canEdit: false, editPermission: undefined }),
        { wrapper: createWrapper() }
      );

      expect(result.current.canEdit).toBe(false);
      expect(result.current.isEditing).toBe(false);
    });

    it('defaults canEdit to true when no editPermission provided', () => {
      const { result } = renderHook(
        () => useWorkspacePage({ ...defaultConfig, editPermission: undefined }),
        { wrapper: createWrapper() }
      );

      expect(result.current.canEdit).toBe(true);
    });
  });

  describe('setIsEditing', () => {
    it('allows toggling editing mode', () => {
      const { result } = renderHook(
        () => useWorkspacePage(defaultConfig),
        { wrapper: createWrapper() }
      );

      expect(result.current.isEditing).toBe(true);

      act(() => {
        result.current.setIsEditing(false);
      });

      expect(result.current.isEditing).toBe(false);

      act(() => {
        result.current.setIsEditing(true);
      });

      expect(result.current.isEditing).toBe(true);
    });

    it('clamps isEditing when canEdit is false', () => {
      mockHasPermission.mockReturnValue(false);

      const { result } = renderHook(
        () => useWorkspacePage(defaultConfig),
        { wrapper: createWrapper() }
      );

      act(() => {
        result.current.setIsEditing(true);
      });

      // Even though we set it to true, canEdit is false so isEditing stays false
      expect(result.current.isEditing).toBe(false);
    });
  });

  describe('dialog states', () => {
    it('manages delete confirm dialog', () => {
      const { result } = renderHook(
        () => useWorkspacePage(defaultConfig),
        { wrapper: createWrapper() }
      );

      expect(result.current.dialogs.showDeleteConfirm).toBe(false);

      act(() => {
        result.current.dialogs.setShowDeleteConfirm(true);
      });

      expect(result.current.dialogs.showDeleteConfirm).toBe(true);
    });

    it('manages create task dialog', () => {
      const { result } = renderHook(
        () => useWorkspacePage(defaultConfig),
        { wrapper: createWrapper() }
      );

      expect(result.current.dialogs.showCreateTask).toBe(false);

      act(() => {
        result.current.dialogs.setShowCreateTask(true);
      });

      expect(result.current.dialogs.showCreateTask).toBe(true);
    });
  });

  describe('agent chat context', () => {
    it('sets entity context when entityId and label are provided', () => {
      renderHook(
        () => useWorkspacePage(defaultConfig),
        { wrapper: createWrapper() }
      );

      expect(mockSetEntityContext).toHaveBeenCalledWith({
        type: 'loan_out',
        id: 'loan-1',
        label: 'LOAN.001',
      });
    });

    it('does not set entity context in create mode', () => {
      renderHook(
        () => useWorkspacePage({ ...defaultConfig, entityId: undefined, entityLabel: undefined }),
        { wrapper: createWrapper('/organizations/org-1/collections/loans/create') }
      );

      expect(mockSetEntityContext).not.toHaveBeenCalledWith(
        expect.objectContaining({ id: expect.any(String) })
      );
    });

    it('clears entity context on unmount', () => {
      const { unmount } = renderHook(
        () => useWorkspacePage(defaultConfig),
        { wrapper: createWrapper() }
      );

      unmount();

      expect(mockSetEntityContext).toHaveBeenCalledWith(null);
    });
  });

  describe('field access', () => {
    it('exposes isRestricted and hasRestrictions', () => {
      const { result } = renderHook(
        () => useWorkspacePage(defaultConfig),
        { wrapper: createWrapper() }
      );

      expect(typeof result.current.isRestricted).toBe('function');
      expect(typeof result.current.hasRestrictions).toBe('boolean');
    });
  });

  describe('new layout', () => {
    it('enables new layout by default for existing records', () => {
      const { result } = renderHook(
        () => useWorkspacePage(defaultConfig),
        { wrapper: createWrapper() }
      );

      expect(result.current.useNewLayout).toBe(true);
    });

    it('disables new layout in create mode', () => {
      const { result } = renderHook(
        () => useWorkspacePage({ ...defaultConfig, entityId: undefined }),
        { wrapper: createWrapper('/organizations/org-1/collections/loans/create') }
      );

      expect(result.current.useNewLayout).toBe(false);
    });

    it('disables new layout when layout=classic query param present', () => {
      const { result } = renderHook(
        () => useWorkspacePage(defaultConfig),
        { wrapper: createWrapper('/organizations/org-1/collections/loans/loan-1/edit?layout=classic') }
      );

      expect(result.current.useNewLayout).toBe(false);
    });
  });

  describe('hasPermission', () => {
    it('delegates to usePermissions', () => {
      const { result } = renderHook(
        () => useWorkspacePage(defaultConfig),
        { wrapper: createWrapper() }
      );

      result.current.hasPermission('some.permission');
      expect(mockHasPermission).toHaveBeenCalledWith('some.permission');
    });
  });
});
