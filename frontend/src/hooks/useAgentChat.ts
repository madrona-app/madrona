/**
 * SSE streaming hook for AI agent chat.
 *
 * Uses fetch() + ReadableStream reader (not EventSource) so we can
 * send POST with JSON body and auth headers.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { API_BASE_URL, getCsrfToken } from '../lib/apiClient';
import { usePageContext, type PageContextValue } from '../contexts/PageContext';

/**
 * UI affordance lifted from a tool result. Today the only kind is
 * `navigation` (from the backend `navigate_to` tool); future tools may add
 * other kinds. The discriminant lives on `kind` so the renderer can switch.
 */
export type AgentMessageUI =
  | {
      kind: 'object_cards';
      /** Inline collection-object cards for visitor chat. */
      objects: Array<{
        object_id: string;
        object_number?: string | null;
        title: string;
        creator?: string | null;
        date?: string | null;
        path: string;
        thumbnail_url?: string | null;
      }>;
    }
  | {
      kind: 'navigation';
      target: {
        id: string;
        /** Path pattern with `:orgId` placeholder — substitute at click time. */
        path: string;
        label: string;
        breadcrumb: string[];
      };
    }
  | {
      kind: 'section';
      /** Section ID on the current record to scroll/expand to. */
      sectionId: string;
      /** Human label for the button, e.g. "People". */
      label: string;
      /** Optional field to highlight within the section. */
      fieldPath?: string;
    }
  | {
      kind: 'delegation';
      /** Which specialist persona answered. */
      specialist: string;
      /** The specialist's final answer text. */
      answer: string;
      /** How many specialist tool-rounds were used (1-3). */
      rounds_used: number;
      /** Per-call trace, summarized. */
      tool_calls: Array<{
        tool: string;
        succeeded: boolean;
        duration_ms: number;
        error?: string;
      }>;
      aborted?: boolean;
      error?: string;
    }
  | {
      kind: 'plan';
      /** Persisted plan id for follow-up actions (cancel, watch, drill in). */
      plan_id: string;
      /** Plan-level goal as the planner restated it. */
      goal: string;
      /** Plan status when the make_plan tool returned. */
      status:
        | 'pending'
        | 'running'
        | 'paused'
        | 'awaiting'
        | 'completed'
        | 'failed'
        | 'cancelled';
      /** Steps in declared order. */
      steps: Array<{
        step_id: string;
        idx: number;
        kind: 'tool_call' | 'delegate' | 'await';
        description: string;
        status:
          | 'pending'
          | 'running'
          | 'completed'
          | 'failed'
          | 'awaiting_user'
          | 'awaiting_external'
          | 'skipped';
        tool?: string | null;
        persona?: string | null;
        /** Set on await steps; its `kind` selects the UI await action. */
        wait_for?: {
          kind?: 'approval_request' | 'form_submission' | 'workflow_transition';
          [key: string]: unknown;
        } | null;
      }>;
    };

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  /** UI affordances attached to this message by tool calls during streaming. */
  uiHints?: AgentMessageUI[];
}

interface ToolEvent {
  tool: string;
  active: boolean;
  /** When tool=delegate_to_specialist, the chosen specialist persona. */
  specialist?: string;
}

export interface ContextEntity {
  type: string;
  id: string;
}

interface UseAgentChatOptions {
  organizationId: string;
  conversationId: string | null;
  /** Called after conversation is created; returns new conversation_id */
  onConversationCreated?: (id: string) => void;
}

interface UseAgentChatReturn {
  messages: AgentMessage[];
  isStreaming: boolean;
  activeTool: ToolEvent | null;
  error: string | null;
  conversationTitle: string | null;
  setConversationTitle: (title: string | null) => void;
  sendMessage: (text: string, overrideConversationId?: string) => Promise<void>;
  createConversation: (contextEntity?: ContextEntity) => Promise<string | null>;
  loadMessages: (conversationId: string) => Promise<void>;
}

/**
 * Strip the PageContextValue down to the wire shape expected by the backend.
 * Drops `undefined` keys so the JSON payload stays compact on every turn.
 */
function serializePageContext(ctx: PageContextValue): Record<string, unknown> | undefined {
  if (!ctx || !ctx.route) return undefined;
  const out: Record<string, unknown> = { route: ctx.route };
  if (ctx.product) out.product = ctx.product;
  if (ctx.navItemId) out.navItemId = ctx.navItemId;
  if (ctx.editMode !== undefined) out.editMode = ctx.editMode;
  if (ctx.entity) {
    out.entity = { type: ctx.entity.type, id: ctx.entity.id, label: ctx.entity.label };
  }
  if (ctx.workflow) {
    out.workflow = {
      status: ctx.workflow.status,
      blockingCount: ctx.workflow.blockingCount,
      topBlockers: ctx.workflow.topBlockers.slice(0, 5),
    };
  }
  return out;
}

export function useAgentChat({
  organizationId,
  conversationId,
  onConversationCreated,
}: UseAgentChatOptions): UseAgentChatReturn {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conversationTitle, setConversationTitle] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Synchronous lock — state-based isStreaming is batched and can't guard
  // against two calls in the same tick (React strict mode double-fires effects).
  const streamLockRef = useRef(false);
  // Ref lookup avoids stale-closure capture inside the stable sendMessage callback.
  const { pageContextRef } = usePageContext();

  // Clear state when conversation is reset (new chat)
  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      setError(null);
      setActiveTool(null);
      setConversationTitle(null);
    }
  }, [conversationId]);

  const createConversation = useCallback(async (contextEntity?: ContextEntity): Promise<string | null> => {
    try {
      const csrf = getCsrfToken();
      const body: Record<string, string> = {};
      if (contextEntity) {
        body.context_entity_type = contextEntity.type;
        body.context_entity_id = contextEntity.id;
      }
      const res = await fetch(
        `${API_BASE_URL}/organizations/${organizationId}/agent/conversations`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
          },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) throw new Error('Failed to create conversation');
      const data = await res.json();
      onConversationCreated?.(data.conversation_id);
      if (data.title) {
        setConversationTitle(data.title);
      }
      return data.conversation_id;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }, [organizationId, onConversationCreated]);

  const loadMessages = useCallback(async (convId: string) => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/organizations/${organizationId}/agent/conversations/${convId}/messages`,
        { credentials: 'include' },
      );
      if (!res.ok) throw new Error('Failed to load messages');
      const data = await res.json();
      setMessages(
        data.messages
          .filter((m: { role: string }) => m.role === 'user' || m.role === 'assistant')
          .map((m: {
            message_id: string;
            role: string;
            content: string;
            meta?: { ui_hints?: unknown } | null;
          }) => {
            const msg: AgentMessage = {
              id: m.message_id,
              role: m.role as 'user' | 'assistant',
              content: m.content || '',
            };
            // Rehydrate persisted UI hints (navigate_to / lookup_playbook
            // navigation buttons) from meta.ui_hints so they survive page
            // refresh and conversation history replay.
            const rawHints = m.meta?.ui_hints;
            if (Array.isArray(rawHints)) {
              const hints: AgentMessageUI[] = [];
              for (const hint of rawHints) {
                if (
                  hint &&
                  typeof hint === 'object' &&
                  'kind' in hint &&
                  (hint as { kind: unknown }).kind === 'navigation' &&
                  'target' in hint &&
                  (hint as { target: unknown }).target &&
                  typeof (hint as { target: { path?: unknown } }).target.path === 'string'
                ) {
                  const target = (hint as {
                    target: {
                      id?: unknown;
                      path: string;
                      label?: unknown;
                      breadcrumb?: unknown;
                    };
                  }).target;
                  hints.push({
                    kind: 'navigation',
                    target: {
                      id: String(target.id ?? ''),
                      path: target.path,
                      label: String(target.label ?? ''),
                      breadcrumb: Array.isArray(target.breadcrumb)
                        ? target.breadcrumb.map((c) => String(c))
                        : [],
                    },
                  });
                }
              }
              if (hints.length > 0) msg.uiHints = hints;
            }
            return msg;
          }),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }, [organizationId]);

  const sendMessage = useCallback(async (text: string, overrideConversationId?: string) => {
    const convId = overrideConversationId || conversationId;
    if (!convId || streamLockRef.current) return;
    streamLockRef.current = true;

    // Append user message immediately
    const userMsg: AgentMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
    };
    setMessages(prev => [...prev, userMsg]);
    setIsStreaming(true);
    setError(null);
    setActiveTool(null);

    // Create placeholder for assistant response
    const assistantId = `assistant-${Date.now()}`;
    setMessages(prev => [
      ...prev,
      { id: assistantId, role: 'assistant', content: '', isStreaming: true },
    ]);

    try {
      const csrf = getCsrfToken();
      const controller = new AbortController();
      abortRef.current = controller;

      const pageContextPayload = serializePageContext(pageContextRef.current);

      const res = await fetch(
        `${API_BASE_URL}/organizations/${organizationId}/agent/conversations/${convId}/chat`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
          },
          body: JSON.stringify({
            message: text,
            ...(pageContextPayload ? { page_context: pageContextPayload } : {}),
          }),
          signal: controller.signal,
        },
      );

      if (!res.ok) {
        throw new Error(`Chat request failed: ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let eventType = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            const dataStr = line.slice(6);
            try {
              const data = JSON.parse(dataStr);
              switch (eventType) {
                case 'text_delta':
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === assistantId
                        ? { ...m, content: m.content + data.text }
                        : m,
                    ),
                  );
                  break;
                case 'tool_start':
                  setActiveTool({
                    tool: data.tool,
                    active: true,
                    specialist: typeof data.specialist === 'string'
                      ? data.specialist
                      : undefined,
                  });
                  break;
                case 'tool_end': {
                  setActiveTool(null);
                  // Lift UI hints onto the currently-streaming assistant message.
                  const hints: AgentMessageUI[] = [];

                  // Navigation hints (navigate_to / lookup_playbook)
                  const navHint = data.ui;
                  if (navHint && typeof navHint === 'object' && navHint.kind === 'navigation' && navHint.target?.path) {
                    hints.push({
                      kind: 'navigation',
                      target: {
                        id: String(navHint.target.id ?? ''),
                        path: String(navHint.target.path),
                        label: String(navHint.target.label ?? ''),
                        breadcrumb: Array.isArray(navHint.target.breadcrumb)
                          ? navHint.target.breadcrumb.map((c: unknown) => String(c))
                          : [],
                      },
                    });
                  }

                  // Plan hints (make_plan)
                  if (
                    navHint
                    && typeof navHint === 'object'
                    && navHint.kind === 'plan'
                    && typeof navHint.plan_id === 'string'
                    && Array.isArray(navHint.steps)
                  ) {
                    hints.push({
                      kind: 'plan',
                      plan_id: String(navHint.plan_id),
                      goal: String(navHint.goal ?? ''),
                      status: String(navHint.status ?? 'pending') as never,
                      steps: navHint.steps.map((s: Record<string, unknown>) => ({
                        step_id: String(s.step_id ?? ''),
                        idx: Number(s.idx ?? 0),
                        kind: String(s.kind ?? 'tool_call') as never,
                        description: String(s.description ?? ''),
                        status: String(s.status ?? 'pending') as never,
                        tool: s.tool ? String(s.tool) : null,
                        persona: s.persona ? String(s.persona) : null,
                      })),
                    });
                  }

                  // Section hints (lookup_madrona_field blocking fields)
                  const sectionHints = data.section_hints;
                  if (Array.isArray(sectionHints)) {
                    for (const sh of sectionHints) {
                      if (sh && typeof sh === 'object' && sh.sectionId && sh.label) {
                        hints.push({
                          kind: 'section',
                          sectionId: String(sh.sectionId),
                          label: String(sh.label),
                          fieldPath: sh.fieldPath ? String(sh.fieldPath) : undefined,
                        });
                      }
                    }
                  }

                  // Delegation result (delegate_to_specialist).
                  const delegation = data.delegation;
                  if (
                    delegation
                    && typeof delegation === 'object'
                    && typeof delegation.specialist === 'string'
                  ) {
                    hints.push({
                      kind: 'delegation',
                      specialist: String(delegation.specialist),
                      answer: String(delegation.answer ?? ''),
                      rounds_used: Number(delegation.rounds_used ?? 0),
                      tool_calls: Array.isArray(delegation.tool_calls)
                        ? delegation.tool_calls.map((c: Record<string, unknown>) => ({
                            tool: String(c.tool ?? ''),
                            succeeded: Boolean(c.succeeded),
                            duration_ms: Number(c.duration_ms ?? 0),
                            error: c.error ? String(c.error) : undefined,
                          }))
                        : [],
                      aborted: delegation.aborted === true,
                      error: delegation.error ? String(delegation.error) : undefined,
                    });
                  }

                  if (hints.length > 0) {
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === assistantId
                          ? { ...m, uiHints: [...(m.uiHints ?? []), ...hints] }
                          : m,
                      ),
                    );
                  }
                  break;
                }
                case 'done':
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === assistantId
                        ? { ...m, id: data.message_id || m.id, isStreaming: false }
                        : m,
                    ),
                  );
                  break;
                case 'title_update':
                  setConversationTitle(data.title || null);
                  break;
                case 'error':
                  setError(data.error || 'Unknown error');
                  break;
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setError((e as Error).message);
      }
    } finally {
      streamLockRef.current = false;
      setIsStreaming(false);
      setActiveTool(null);
      abortRef.current = null;
      // Ensure streaming flag is cleared on the assistant message
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantId ? { ...m, isStreaming: false } : m,
        ),
      );
    }
  }, [conversationId, organizationId, isStreaming, pageContextRef]);

  // Cleanup on unmount — abort any in-flight stream
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  return {
    messages,
    isStreaming,
    activeTool,
    error,
    conversationTitle,
    setConversationTitle,
    sendMessage,
    createConversation,
    loadMessages,
  };
}
