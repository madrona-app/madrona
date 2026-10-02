import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVisitorChat } from '../../hooks/useVisitorChat';

// Mock import.meta.env
vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:5000/api');

// Mock crypto.randomUUID
const mockUUID = 'test-uuid-1234';
vi.stubGlobal('crypto', {
  randomUUID: vi.fn().mockReturnValue(mockUUID),
});

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('useVisitorChat', () => {
  const defaultOptions = {
    orgSlug: 'test-museum',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  describe('initialization', () => {
    it('returns default state', () => {
      const { result } = renderHook(() => useVisitorChat(defaultOptions));

      expect(result.current.messages).toEqual([]);
      expect(result.current.isStreaming).toBe(false);
      expect(result.current.activeTool).toBeNull();
      expect(result.current.error).toBeNull();
    });

    it('creates session ID in localStorage', () => {
      renderHook(() => useVisitorChat(defaultOptions));

      expect(localStorage.getItem('madrona-visitor-session:test-museum')).toBe(mockUUID);
    });

    it('reuses existing session ID', () => {
      localStorage.setItem('madrona-visitor-session:test-museum', 'existing-id');

      renderHook(() => useVisitorChat(defaultOptions));

      expect(localStorage.getItem('madrona-visitor-session:test-museum')).toBe('existing-id');
    });

    it('loads persisted messages from sessionStorage', () => {
      const messages = [
        { id: 'msg-1', role: 'user', content: 'Hello', isStreaming: false },
        { id: 'msg-2', role: 'assistant', content: 'Hi!', isStreaming: false },
      ];
      sessionStorage.setItem(
        'madrona-visitor-messages:test-museum',
        JSON.stringify(messages)
      );

      const { result } = renderHook(() => useVisitorChat(defaultOptions));

      expect(result.current.messages).toHaveLength(2);
      expect(result.current.messages[0].content).toBe('Hello');
    });

    it('strips stale streaming flags from persisted messages', () => {
      const messages = [
        { id: 'msg-1', role: 'user', content: 'Hello', isStreaming: true },
      ];
      sessionStorage.setItem(
        'madrona-visitor-messages:test-museum',
        JSON.stringify(messages)
      );

      const { result } = renderHook(() => useVisitorChat(defaultOptions));

      expect(result.current.messages[0].isStreaming).toBe(false);
    });
  });

  describe('context entity changes', () => {
    it('clears conversation when context entity changes', () => {
      sessionStorage.setItem('madrona-visitor-conv:test-museum', 'old-conv');
      const messages = [
        { id: 'msg-1', role: 'user', content: 'Hello', isStreaming: false },
      ];
      sessionStorage.setItem(
        'madrona-visitor-messages:test-museum',
        JSON.stringify(messages)
      );

      const { result, rerender } = renderHook(
        ({ contextEntityId }) => useVisitorChat({ ...defaultOptions, contextEntityId }),
        { initialProps: { contextEntityId: 'obj-1' } }
      );

      // Change context entity
      rerender({ contextEntityId: 'obj-2' });

      expect(result.current.messages).toEqual([]);
      expect(sessionStorage.getItem('madrona-visitor-conv:test-museum')).toBeNull();
    });
  });

  describe('sendMessage', () => {
    it('creates conversation on first message then sends', async () => {
      // Mock conversation creation
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ conversation_id: 'new-conv' }),
        })
        // Mock chat SSE response (empty stream, just done)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          body: {
            getReader: () => ({
              read: vi.fn()
                .mockResolvedValueOnce({
                  done: false,
                  value: new TextEncoder().encode('event: done\ndata: {"message_id":"m1"}\n\n'),
                })
                .mockResolvedValueOnce({ done: true, value: undefined }),
            }),
          },
        });

      const { result } = renderHook(() => useVisitorChat(defaultOptions));

      await act(async () => {
        await result.current.sendMessage('Hello');
      });

      // Should have created conversation first
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[0][0]).toContain('/conversations');

      // User message should be in the list
      const userMsg = result.current.messages.find(m => m.role === 'user');
      expect(userMsg?.content).toBe('Hello');
    });

    it('sets error when conversation creation fails', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });

      const { result } = renderHook(() => useVisitorChat(defaultOptions));

      await act(async () => {
        await result.current.sendMessage('Hello');
      });

      expect(result.current.error).toBe('Failed to create conversation');
    });

    it('handles fetch errors gracefully', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ conversation_id: 'conv-1' }),
        })
        .mockRejectedValueOnce(new Error('Network failure'));

      const { result } = renderHook(() => useVisitorChat(defaultOptions));

      await act(async () => {
        await result.current.sendMessage('Hello');
      });

      expect(result.current.error).toBe('Network failure');
      expect(result.current.isStreaming).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('unmounts cleanly without errors', () => {
      const { unmount } = renderHook(() => useVisitorChat(defaultOptions));

      expect(() => unmount()).not.toThrow();
    });
  });

  describe('message persistence', () => {
    it('persists messages to sessionStorage when they change', () => {
      // Pre-populate with a message via sessionStorage
      const messages = [
        { id: 'msg-1', role: 'user', content: 'Hello', isStreaming: false },
      ];
      sessionStorage.setItem(
        'madrona-visitor-messages:test-museum',
        JSON.stringify(messages)
      );

      renderHook(() => useVisitorChat(defaultOptions));

      // The hook should have loaded and persisted back (stripped streaming flags)
      const persisted = sessionStorage.getItem('madrona-visitor-messages:test-museum');
      expect(persisted).toBeTruthy();
      const parsed = JSON.parse(persisted!);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].content).toBe('Hello');
    });
  });
});
