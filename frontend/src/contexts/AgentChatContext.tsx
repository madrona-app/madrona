import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

export interface EntityContext {
  type: string;
  id: string;
  label: string;
}

interface AgentChatContextValue {
  isOpen: boolean;
  entityContext: EntityContext | null;
  openChat: () => void;
  closeChat: () => void;
  setEntityContext: (ctx: EntityContext | null) => void;
  /**
   * Open the chat panel and send a message. The message is dispatched
   * directly via a ref to the panel's dispatch function — no effect,
   * no double-fire, one call.
   *
   * If the panel isn't mounted yet (first open), the message is queued
   * and dispatched once the panel registers its dispatch function.
   */
  openChatWithMessage: (message: string) => void;
  /**
   * Called by AgentChatPanel on mount to register its dispatch function.
   * This is the bridge between the context (which knows WHAT to send)
   * and the panel (which knows HOW to send).
   */
  registerDispatch: (fn: ((msg: string) => void) | null) => void;
}

const AgentChatContext = createContext<AgentChatContextValue | undefined>(undefined);

export function AgentChatProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [entityContext, setEntityContext] = useState<EntityContext | null>(null);

  // Direct dispatch ref — the panel registers its dispatchMessage here.
  // When openChatWithMessage is called, it calls the ref synchronously
  // (if the panel is already mounted) or queues the message for when
  // the panel mounts and registers.
  const dispatchRef = useRef<((msg: string) => void) | null>(null);
  const queuedMessageRef = useRef<string | null>(null);

  const openChat = useCallback(() => setIsOpen(true), []);
  const closeChat = useCallback(() => setIsOpen(false), []);

  const openChatWithMessage = useCallback((message: string) => {
    setIsOpen(true);
    if (!message.trim()) return;
    // If the panel is already mounted and has registered its dispatch,
    // call it directly — this is an event handler path, not an effect.
    if (dispatchRef.current) {
      dispatchRef.current(message);
    } else {
      // Panel not mounted yet (first open, lazy-loaded). Queue for
      // when it registers via registerDispatch.
      queuedMessageRef.current = message;
    }
  }, []);

  const registerDispatch = useCallback((fn: ((msg: string) => void) | null) => {
    dispatchRef.current = fn;
    // Flush any queued message from before the panel mounted.
    if (fn && queuedMessageRef.current) {
      const msg = queuedMessageRef.current;
      queuedMessageRef.current = null;
      fn(msg);
    }
  }, []);

  const value: AgentChatContextValue = {
    isOpen,
    entityContext,
    openChat,
    closeChat,
    setEntityContext,
    openChatWithMessage,
    registerDispatch,
  };

  return (
    <AgentChatContext.Provider value={value}>
      {children}
    </AgentChatContext.Provider>
  );
}

export function useAgentChatContext() {
  const context = useContext(AgentChatContext);
  if (context === undefined) {
    throw new Error('useAgentChatContext must be used within an AgentChatProvider');
  }
  return context;
}

/**
 * Optional variant for components shared with the PUBLIC visitor surfaces
 * (Discover widget, standalone guide page), which have no AgentChatProvider.
 * Returns undefined there instead of throwing — callers treat chat-panel
 * actions like closeChat as no-ops.
 */
export function useAgentChatContextOptional() {
  return useContext(AgentChatContext);
}
