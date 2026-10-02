/**
 * SSE streaming hook for the public visitor gallery guide.
 *
 * Adapted from useAgentChat — hits /api/guide/<orgSlug>/... endpoints,
 * no auth headers or CSRF tokens, uses a localStorage session ID.
 *
 * Persists conversationId and messages in sessionStorage so the chat
 * survives React Router navigations (each discover page remounts
 * CollectionSiteShell independently).
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { AgentMessage } from './useAgentChat';

// Same-origin by default, matching lib/apiClient.ts. The Docker build sets
// no VITE_* vars, so a localhost fallback pointed the visitor widget at a
// port nothing serves; Vite proxies /api to the backend in dev.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

// Storage keys are org-scoped so visitors at different museum sites
// don't share session identity or conversation state.
function sessionKey(orgSlug: string) { return `madrona-visitor-session:${orgSlug}`; }
function convKey(orgSlug: string) { return `madrona-visitor-conv:${orgSlug}`; }
function messagesKey(orgSlug: string) { return `madrona-visitor-messages:${orgSlug}`; }

function getOrCreateSessionId(orgSlug: string): string {
  const key = sessionKey(orgSlug);
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

function loadPersistedMessages(orgSlug: string): AgentMessage[] {
  try {
    const raw = sessionStorage.getItem(messagesKey(orgSlug));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AgentMessage[];
    // Strip any stale streaming flags
    return parsed.map(m => ({ ...m, isStreaming: false }));
  } catch {
    return [];
  }
}

function persistMessages(orgSlug: string, messages: AgentMessage[]) {
  try {
    // Only persist completed messages (not mid-stream placeholders)
    const safe = messages.filter(m => !m.isStreaming);
    sessionStorage.setItem(messagesKey(orgSlug), JSON.stringify(safe));
  } catch {
    // sessionStorage full — non-critical
  }
}

interface ToolEvent {
  tool: string;
  active: boolean;
}

interface UseVisitorChatOptions {
  orgSlug: string;
  contextEntityType?: string;
  contextEntityId?: string;
  locale?: string;
  /** Invoked when the assistant finishes streaming, with the final text. */
  onAssistantDone?: (text: string) => void;
  /** How the current message was composed; forwarded to the backend. */
  inputMode?: 'voice' | 'text';
}

interface UseVisitorChatReturn {
  messages: AgentMessage[];
  isStreaming: boolean;
  activeTool: ToolEvent | null;
  error: string | null;
  sendMessage: (text: string) => Promise<void>;
}

export function useVisitorChat({ orgSlug, contextEntityType, contextEntityId, locale, onAssistantDone, inputMode }: UseVisitorChatOptions): UseVisitorChatReturn {
  const [messages, setMessages] = useState<AgentMessage[]>(() => loadPersistedMessages(orgSlug));
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Kept fresh on every render so the stable sendMessage callback reads the
  // latest values without churning its dependency list.
  const onAssistantDoneRef = useRef(onAssistantDone);
  onAssistantDoneRef.current = onAssistantDone;
  const inputModeRef = useRef(inputMode);
  inputModeRef.current = inputMode;
  const conversationIdRef = useRef<string | null>(sessionStorage.getItem(convKey(orgSlug)));
  const sessionId = useRef(getOrCreateSessionId(orgSlug));
  // Track context entity to detect navigation between objects
  const contextRef = useRef<string | undefined>(contextEntityId);

  // Persist messages whenever they change (debounced by React batching)
  useEffect(() => {
    persistMessages(orgSlug, messages);
  }, [orgSlug, messages]);

  // When context entity changes (visitor navigated to a different object), start a fresh conversation
  useEffect(() => {
    if (contextRef.current !== contextEntityId) {
      contextRef.current = contextEntityId;
      // Clear existing conversation so next message creates a new one with fresh context
      conversationIdRef.current = null;
      sessionStorage.removeItem(convKey(orgSlug));
      setMessages([]);
      sessionStorage.removeItem(messagesKey(orgSlug));
      setError(null);
    }
  }, [contextEntityId, orgSlug]);

  // Strip /api suffix — the guide endpoints are at /api/guide/...
  const baseUrl = API_BASE_URL.replace(/\/api\/?$/, '');

  const createConversation = useCallback(async (): Promise<string | null> => {
    try {
      const body: Record<string, string> = { session_id: sessionId.current };
      if (contextEntityType) body.context_entity_type = contextEntityType;
      if (contextEntityId) body.context_entity_id = contextEntityId;
      if (locale) body.locale = locale;
      const res = await fetch(`${baseUrl}/api/guide/${orgSlug}/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed to create conversation');
      const data = await res.json();
      const convId = data.conversation_id;
      sessionStorage.setItem(convKey(orgSlug), convId);
      return convId;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }, [baseUrl, orgSlug, contextEntityType, contextEntityId, locale]);

  const sendMessage = useCallback(async (text: string) => {
    if (isStreaming) return;

    // Create conversation on first message
    if (!conversationIdRef.current) {
      const convId = await createConversation();
      if (!convId) return;
      conversationIdRef.current = convId;
    }

    const convId = conversationIdRef.current;

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
      const controller = new AbortController();
      abortRef.current = controller;

      const res = await fetch(
        `${baseUrl}/api/guide/${orgSlug}/conversations/${convId}/chat`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
          message: text,
          session_id: sessionId.current,
          locale,
          ...(inputModeRef.current ? { input_mode: inputModeRef.current } : {}),
        }),
          signal: controller.signal,
        },
      );

      if (res.status === 429) {
        setError('Too many requests — please wait a moment and try again.');
        setMessages(prev => prev.filter(m => m.id !== assistantId));
        return;
      }

      if (!res.ok) {
        throw new Error(`Chat request failed: ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      // Accumulate streamed text so we can hand the complete reply to
      // onAssistantDone (e.g. for text-to-speech) once streaming finishes.
      let assistantText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

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
                  assistantText += data.text;
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === assistantId
                        ? { ...m, content: m.content + data.text }
                        : m,
                    ),
                  );
                  break;
                case 'tool_start':
                  setActiveTool({ tool: data.tool, active: true });
                  break;
                case 'tool_end':
                  setActiveTool(null);
                  // Lift tool-attached UI hints (e.g. object cards) onto the
                  // streaming assistant message so they render + persist.
                  if (data.ui) {
                    setMessages(prev =>
                      prev.map(m =>
                        m.id === assistantId
                          ? { ...m, uiHints: [...(m.uiHints ?? []), data.ui] }
                          : m,
                      ),
                    );
                  }
                  break;
                case 'done':
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === assistantId
                        ? { ...m, id: data.message_id || m.id, isStreaming: false }
                        : m,
                    ),
                  );
                  if (assistantText) onAssistantDoneRef.current?.(assistantText);
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
      setIsStreaming(false);
      setActiveTool(null);
      abortRef.current = null;
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantId ? { ...m, isStreaming: false } : m,
        ),
      );
    }
  }, [baseUrl, orgSlug, isStreaming, createConversation, locale]);

  // Cleanup on unmount
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
    sendMessage,
  };
}
