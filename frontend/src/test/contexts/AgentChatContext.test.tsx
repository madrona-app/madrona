import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import {
  AgentChatProvider,
  useAgentChatContext,
  type EntityContext,
} from '../../contexts/AgentChatContext';

function wrapper({ children }: { children: React.ReactNode }) {
  return <AgentChatProvider>{children}</AgentChatProvider>;
}

describe('AgentChatContext', () => {
  describe('AgentChatProvider', () => {
    it('renders children', () => {
      render(
        <AgentChatProvider>
          <div data-testid="child">hello</div>
        </AgentChatProvider>
      );
      expect(screen.getByTestId('child')).toHaveTextContent('hello');
    });

    it('provides initial state with isOpen=false and null entityContext', () => {
      const { result } = renderHook(() => useAgentChatContext(), { wrapper });
      expect(result.current.isOpen).toBe(false);
      expect(result.current.entityContext).toBeNull();
    });

    it('openChat sets isOpen to true', () => {
      const { result } = renderHook(() => useAgentChatContext(), { wrapper });
      act(() => {
        result.current.openChat();
      });
      expect(result.current.isOpen).toBe(true);
    });

    it('closeChat sets isOpen to false', () => {
      const { result } = renderHook(() => useAgentChatContext(), { wrapper });
      act(() => {
        result.current.openChat();
      });
      expect(result.current.isOpen).toBe(true);
      act(() => {
        result.current.closeChat();
      });
      expect(result.current.isOpen).toBe(false);
    });

    it('setEntityContext updates the entity context', () => {
      const { result } = renderHook(() => useAgentChatContext(), { wrapper });
      const entity: EntityContext = { type: 'object', id: 'obj-1', label: 'Vase' };
      act(() => {
        result.current.setEntityContext(entity);
      });
      expect(result.current.entityContext).toEqual(entity);
    });

    it('setEntityContext can clear with null', () => {
      const { result } = renderHook(() => useAgentChatContext(), { wrapper });
      const entity: EntityContext = { type: 'object', id: 'obj-1', label: 'Vase' };
      act(() => {
        result.current.setEntityContext(entity);
      });
      expect(result.current.entityContext).not.toBeNull();
      act(() => {
        result.current.setEntityContext(null);
      });
      expect(result.current.entityContext).toBeNull();
    });
  });

  describe('openChatWithMessage', () => {
    it('opens the chat panel', () => {
      const { result } = renderHook(() => useAgentChatContext(), { wrapper });
      act(() => {
        result.current.openChatWithMessage('hello world');
      });
      expect(result.current.isOpen).toBe(true);
    });

    it('does not dispatch when message is empty/whitespace', () => {
      const dispatch = vi.fn();
      const { result } = renderHook(() => useAgentChatContext(), { wrapper });
      act(() => {
        result.current.registerDispatch(dispatch);
      });
      act(() => {
        result.current.openChatWithMessage('   ');
      });
      expect(dispatch).not.toHaveBeenCalled();
      // But should still open
      expect(result.current.isOpen).toBe(true);
    });

    it('calls dispatch directly when panel is mounted', () => {
      const dispatch = vi.fn();
      const { result } = renderHook(() => useAgentChatContext(), { wrapper });
      act(() => {
        result.current.registerDispatch(dispatch);
      });
      act(() => {
        result.current.openChatWithMessage('hello');
      });
      expect(dispatch).toHaveBeenCalledWith('hello');
    });

    it('queues message and flushes when panel registers later', () => {
      const dispatch = vi.fn();
      const { result } = renderHook(() => useAgentChatContext(), { wrapper });
      // Send message before panel registers
      act(() => {
        result.current.openChatWithMessage('queued message');
      });
      expect(dispatch).not.toHaveBeenCalled();
      // Now register dispatch — it should flush the queued message
      act(() => {
        result.current.registerDispatch(dispatch);
      });
      expect(dispatch).toHaveBeenCalledWith('queued message');
    });

    it('does not flush when registering null', () => {
      const dispatch = vi.fn();
      const { result } = renderHook(() => useAgentChatContext(), { wrapper });
      act(() => {
        result.current.openChatWithMessage('queued');
      });
      // Register null
      act(() => {
        result.current.registerDispatch(null);
      });
      expect(dispatch).not.toHaveBeenCalled();
      // Then register real dispatch — queued message should still flush
      act(() => {
        result.current.registerDispatch(dispatch);
      });
      expect(dispatch).toHaveBeenCalledWith('queued');
    });
  });

  describe('useAgentChatContext outside provider', () => {
    it('throws error when used outside provider', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(() => renderHook(() => useAgentChatContext())).toThrow(
        /useAgentChatContext must be used within an AgentChatProvider/
      );
      spy.mockRestore();
    });
  });
});
