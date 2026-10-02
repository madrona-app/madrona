import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { useAgentChat } from '../../hooks/useAgentChat';
import { PageContextProvider, usePageContext } from '../../contexts/PageContext';

/**
 * Build a fake SSE Response from a sequence of (event, data) tuples.
 * Mirrors the wire format used by the backend.
 */
function sseStream(events: Array<[string, unknown]>): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const [event, data] of events) {
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(payload));
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  }) as Response;
}

// Mock apiClient
vi.mock('../../lib/apiClient', () => ({
  API_BASE_URL: 'http://localhost:5000/api',
  getCsrfToken: vi.fn().mockReturnValue('mock-csrf'),
}));

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('useAgentChat', () => {
  const defaultOptions = {
    organizationId: 'org-1',
    conversationId: 'conv-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  describe('initialization', () => {
    it('returns default state', () => {
      const { result } = renderHook(() => useAgentChat(defaultOptions));

      expect(result.current.messages).toEqual([]);
      expect(result.current.isStreaming).toBe(false);
      expect(result.current.activeTool).toBeNull();
      expect(result.current.error).toBeNull();
      expect(result.current.conversationTitle).toBeNull();
    });

    it('exposes sendMessage, createConversation, loadMessages functions', () => {
      const { result } = renderHook(() => useAgentChat(defaultOptions));

      expect(typeof result.current.sendMessage).toBe('function');
      expect(typeof result.current.createConversation).toBe('function');
      expect(typeof result.current.loadMessages).toBe('function');
      expect(typeof result.current.setConversationTitle).toBe('function');
    });
  });

  describe('conversationId reset', () => {
    it('clears messages when conversationId changes to null', () => {
      const { result, rerender } = renderHook(
        ({ conversationId }) => useAgentChat({ ...defaultOptions, conversationId }),
        { initialProps: { conversationId: 'conv-1' as string | null } }
      );

      // Simulate that there were messages (we set title as proxy)
      act(() => {
        result.current.setConversationTitle('Test Title');
      });
      expect(result.current.conversationTitle).toBe('Test Title');

      // Reset conversation
      rerender({ conversationId: null });

      expect(result.current.messages).toEqual([]);
      expect(result.current.error).toBeNull();
      expect(result.current.conversationTitle).toBeNull();
    });
  });

  describe('createConversation', () => {
    it('calls API and returns conversation_id', async () => {
      const onCreated = vi.fn();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ conversation_id: 'new-conv-1', title: 'Hello' }),
      });

      const { result } = renderHook(() =>
        useAgentChat({ ...defaultOptions, onConversationCreated: onCreated })
      );

      let convId: string | null = null;
      await act(async () => {
        convId = await result.current.createConversation();
      });

      expect(convId).toBe('new-conv-1');
      expect(onCreated).toHaveBeenCalledWith('new-conv-1');
      expect(result.current.conversationTitle).toBe('Hello');
    });

    it('sets error on API failure', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });

      const { result } = renderHook(() => useAgentChat(defaultOptions));

      let convId: string | null = null;
      await act(async () => {
        convId = await result.current.createConversation();
      });

      expect(convId).toBeNull();
      expect(result.current.error).toBe('Failed to create conversation');
    });

    it('passes context entity when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ conversation_id: 'conv-2' }),
      });

      const { result } = renderHook(() => useAgentChat(defaultOptions));

      await act(async () => {
        await result.current.createConversation({ type: 'object', id: 'obj-1' });
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.context_entity_type).toBe('object');
      expect(body.context_entity_id).toBe('obj-1');
    });
  });

  describe('loadMessages', () => {
    it('loads and filters messages from API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          messages: [
            { message_id: 'm1', role: 'user', content: 'Hello' },
            { message_id: 'm2', role: 'assistant', content: 'Hi there' },
            { message_id: 'm3', role: 'system', content: 'System prompt' },
          ],
        }),
      });

      const { result } = renderHook(() => useAgentChat(defaultOptions));

      await act(async () => {
        await result.current.loadMessages('conv-1');
      });

      expect(result.current.messages).toHaveLength(2);
      expect(result.current.messages[0]).toEqual({
        id: 'm1',
        role: 'user',
        content: 'Hello',
      });
      expect(result.current.messages[1]).toEqual({
        id: 'm2',
        role: 'assistant',
        content: 'Hi there',
      });
    });

    it('rehydrates persisted navigation ui_hints from meta', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          messages: [
            { message_id: 'u1', role: 'user', content: 'how do I accession' },
            {
              message_id: 'a1',
              role: 'assistant',
              content: 'Start by creating an object entry.',
              meta: {
                ui_hints: [
                  {
                    kind: 'navigation',
                    target: {
                      id: 'collections:entries',
                      path: '/organizations/:orgId/collections/entries',
                      label: 'Incoming',
                      breadcrumb: ['Collections', 'Transactions', 'Incoming'],
                    },
                  },
                ],
              },
            },
          ],
        }),
      });

      const { result } = renderHook(() => useAgentChat(defaultOptions));

      await act(async () => {
        await result.current.loadMessages('conv-1');
      });

      expect(result.current.messages).toHaveLength(2);
      const assistant = result.current.messages[1];
      expect(assistant.uiHints).toBeDefined();
      expect(assistant.uiHints).toHaveLength(1);
      const hint = assistant.uiHints![0];
      expect(hint.kind).toBe('navigation');
      if (hint.kind === 'navigation') {
        expect(hint.target.id).toBe('collections:entries');
        expect(hint.target.path).toContain(':orgId');
        expect(hint.target.breadcrumb).toEqual([
          'Collections',
          'Transactions',
          'Incoming',
        ]);
      }
    });

    it('ignores malformed ui_hints during rehydration', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          messages: [
            {
              message_id: 'a1',
              role: 'assistant',
              content: 'hi',
              meta: {
                ui_hints: [
                  { kind: 'navigation', target: { id: 'x' } }, // no path — drop
                  { kind: 'unknown', target: { path: '/x' } }, // wrong kind — drop
                  null, // garbage — drop
                ],
              },
            },
          ],
        }),
      });

      const { result } = renderHook(() => useAgentChat(defaultOptions));
      await act(async () => {
        await result.current.loadMessages('conv-1');
      });

      // All three were malformed → uiHints should not be set
      expect(result.current.messages[0].uiHints).toBeUndefined();
    });

    it('leaves uiHints undefined when meta is absent', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          messages: [
            { message_id: 'a1', role: 'assistant', content: 'hi' },
          ],
        }),
      });

      const { result } = renderHook(() => useAgentChat(defaultOptions));
      await act(async () => {
        await result.current.loadMessages('conv-1');
      });

      expect(result.current.messages[0].uiHints).toBeUndefined();
    });

    it('sets error on load failure', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });

      const { result } = renderHook(() => useAgentChat(defaultOptions));

      await act(async () => {
        await result.current.loadMessages('conv-1');
      });

      expect(result.current.error).toBe('Failed to load messages');
    });
  });

  describe('sendMessage', () => {
    it('does nothing when conversationId is null', async () => {
      const { result } = renderHook(() =>
        useAgentChat({ ...defaultOptions, conversationId: null })
      );

      await act(async () => {
        await result.current.sendMessage('Hello');
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.current.messages).toEqual([]);
    });

    it('appends user message immediately on send', async () => {
      // Mock a never-resolving fetch to catch intermediate state
      mockFetch.mockReturnValueOnce(new Promise(() => {}));

      const { result } = renderHook(() => useAgentChat(defaultOptions));

      // Don't await - we want to check intermediate state
      act(() => {
        result.current.sendMessage('Hello');
      });

      // User message should appear immediately
      expect(result.current.messages.length).toBeGreaterThanOrEqual(1);
      expect(result.current.messages[0].role).toBe('user');
      expect(result.current.messages[0].content).toBe('Hello');
    });
  });

  describe('page context', () => {
    it('includes a minimal page_context with just the route when no provider is mounted', async () => {
      mockFetch.mockReturnValueOnce(new Promise(() => {}));

      const { result } = renderHook(() => useAgentChat(defaultOptions));

      act(() => {
        result.current.sendMessage('Hello');
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.message).toBe('Hello');
      // Fallback context carries the current pathname — still useful for the
      // agent even without a mounted provider. All other fields are absent.
      expect(body.page_context).toBeDefined();
      expect(body.page_context.route).toBeTruthy();
      expect(body.page_context.product).toBeUndefined();
      expect(body.page_context.entity).toBeUndefined();
      expect(body.page_context.workflow).toBeUndefined();
    });

    it('includes page_context from the provider when present', async () => {
      mockFetch.mockReturnValueOnce(new Promise(() => {}));

      // Helper that mounts the provider and seeds context before sending.
      function ProviderWrap({ children }: { children: React.ReactNode }) {
        return React.createElement(PageContextProvider, null, children);
      }
      const { result } = renderHook(
        () => {
          const chat = useAgentChat(defaultOptions);
          const page = usePageContext();
          return { chat, page };
        },
        { wrapper: ProviderWrap },
      );

      act(() => {
        result.current.page.setPageContext({
          route: '/organizations/abc/collections/conservation/xyz',
          product: 'collections',
          navItemId: 'conservation',
          editMode: true,
          entity: { type: 'conservation_treatment', id: 'xyz', label: 'CT-001' },
          workflow: { status: 'in_progress', blockingCount: 2, topBlockers: ['A', 'B'] },
        });
      });

      act(() => {
        result.current.chat.sendMessage('what is left?');
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.message).toBe('what is left?');
      expect(body.page_context).toBeDefined();
      expect(body.page_context.route).toContain('/conservation/');
      expect(body.page_context.navItemId).toBe('conservation');
      expect(body.page_context.editMode).toBe(true);
      expect(body.page_context.entity.id).toBe('xyz');
      expect(body.page_context.workflow.blockingCount).toBe(2);
      expect(body.page_context.workflow.topBlockers).toHaveLength(2);
    });
  });

  describe('navigation UI hints from tool results', () => {
    it('attaches a navigation hint to the assistant message when tool_end carries one', async () => {
      mockFetch.mockResolvedValueOnce(
        sseStream([
          ['tool_start', { tool: 'navigate_to' }],
          [
            'tool_end',
            {
              tool: 'navigate_to',
              ui: {
                kind: 'navigation',
                target: {
                  id: 'collections:conservation',
                  path: '/organizations/:orgId/collections/conservation',
                  label: 'Conservation',
                  breadcrumb: ['Collections', 'Care & Risk', 'Conservation'],
                },
              },
            },
          ],
          ['text_delta', { text: 'Opening Conservation.' }],
          ['done', { message_id: 'm-1' }],
        ]),
      );

      const { result } = renderHook(() => useAgentChat(defaultOptions));

      await act(async () => {
        await result.current.sendMessage('take me to conservation');
      });

      // Assistant message is the second one (user message is first)
      const assistantMsg = result.current.messages.find((m) => m.role === 'assistant');
      expect(assistantMsg).toBeDefined();
      expect(assistantMsg?.content).toBe('Opening Conservation.');
      expect(assistantMsg?.uiHints).toBeDefined();
      expect(assistantMsg?.uiHints?.length).toBe(1);
      const hint = assistantMsg!.uiHints![0];
      expect(hint.kind).toBe('navigation');
      if (hint.kind === 'navigation') {
        expect(hint.target.path).toContain(':orgId');
        expect(hint.target.label).toBe('Conservation');
        expect(hint.target.breadcrumb).toEqual(['Collections', 'Care & Risk', 'Conservation']);
      }
    });

    it('ignores tool_end events without a ui hint', async () => {
      mockFetch.mockResolvedValueOnce(
        sseStream([
          ['tool_start', { tool: 'search_collection' }],
          ['tool_end', { tool: 'search_collection' }],
          ['text_delta', { text: 'Results...' }],
          ['done', { message_id: 'm-2' }],
        ]),
      );

      const { result } = renderHook(() => useAgentChat(defaultOptions));

      await act(async () => {
        await result.current.sendMessage('find a painting');
      });

      const assistantMsg = result.current.messages.find((m) => m.role === 'assistant');
      expect(assistantMsg?.uiHints).toBeUndefined();
    });

    it('does not lift a malformed ui hint (missing target.path)', async () => {
      mockFetch.mockResolvedValueOnce(
        sseStream([
          ['tool_start', { tool: 'navigate_to' }],
          ['tool_end', { tool: 'navigate_to', ui: { kind: 'navigation', target: { id: 'x' } } }],
          ['text_delta', { text: 'Done.' }],
          ['done', { message_id: 'm-3' }],
        ]),
      );

      const { result } = renderHook(() => useAgentChat(defaultOptions));

      await act(async () => {
        await result.current.sendMessage('navigate');
      });

      const assistantMsg = result.current.messages.find((m) => m.role === 'assistant');
      expect(assistantMsg?.uiHints).toBeUndefined();
    });
  });

  describe('cleanup', () => {
    it('unmounts cleanly without errors', () => {
      const { unmount } = renderHook(() => useAgentChat(defaultOptions));

      // Should not throw on unmount
      expect(() => unmount()).not.toThrow();
    });

    it('returns stable function references', () => {
      const { result, rerender } = renderHook(() => useAgentChat(defaultOptions));

      const firstSendMessage = result.current.sendMessage;
      const firstCreateConversation = result.current.createConversation;

      rerender();

      // Functions should be stable (memoized via useCallback)
      expect(result.current.sendMessage).toBe(firstSendMessage);
      expect(result.current.createConversation).toBe(firstCreateConversation);
    });
  });
});
