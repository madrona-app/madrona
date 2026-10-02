/**
 * Slide-over chat panel for the AI agent.
 *
 * Opens from the right side. Streams responses via SSE.
 * Used for the staff assistant persona.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  X, Send, MessageSquare, Loader2, RotateCcw, Clock, Package, Paperclip, FileText,
  ArrowLeftRight, LogIn, LogOut, HandCoins, ClipboardCheck, Wrench,
  Truck, BadgeDollarSign, FileQuestion, AlertTriangle, Scale, Copy,
  Presentation, User, FileX,
} from 'lucide-react';
import { API_BASE_URL } from '../../lib/apiClient';
import { uploadConversationAttachment } from '../../lib/api/guideAttachments';
import { useAccessibleModal, getModalAriaProps } from '../../hooks/useAccessibleModal';
import { useAgentChat } from '../../hooks/useAgentChat';
import type { ContextEntity } from '../../hooks/useAgentChat';
import { useAgentChatContext } from '../../contexts/AgentChatContext';
import { GuideWordmark } from '../studio/GuideWordmark';
import { AgentMessage } from './AgentMessage';
import { AgentToolIndicator } from './AgentToolIndicator';
import { formatRelativeTime } from '../../lib/formatters';
import { useToast } from '../../contexts/ToastContext';

const ENTITY_TYPE_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  collection_object: Package,
  loan_in: ArrowLeftRight,
  loan_out: ArrowLeftRight,
  object_entry: LogIn,
  object_exit: LogOut,
  acquisition: HandCoins,
  condition_report: ClipboardCheck,
  conservation: Wrench,
  movement: Truck,
  valuation: BadgeDollarSign,
  use_request: FileQuestion,
  incident_report: AlertTriangle,
  right: Scale,
  reproduction_request: Copy,
  exhibition: Presentation,
  constituent: User,
  deaccession: FileX,
};

interface ConversationSummary {
  conversation_id: string;
  title: string | null;
  updated_at: string;
}

// Resume the previous conversation on open only if it was active within this
// window — continuity within a working session, a fresh start after it. The
// model receives per-turn PageContext either way, so resuming an older thread
// adds stale conversational history without any context benefit; older threads
// stay one tap away in the history list.
const RESUME_WINDOW_MS = 8 * 60 * 60 * 1000;

interface AgentChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
  organizationId: string;
}

export function AgentChatPanel({ isOpen, onClose, organizationId }: AgentChatPanelProps) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [attachments, setAttachments] = useState<
    { name: string; status: 'uploading' | 'ready' | 'error' }[]
  >([]);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hasRestoredRef = useRef(false);
  // Any explicit user/caller action (a dispatched message, "New chat", a
  // history selection) must win over the async restore below — without this
  // guard, openChatWithMessage on first open creates a conversation while the
  // restore fetch is in flight, and whichever resolves last clobbers the other.
  const userInteractedRef = useRef(false);
  const convContextRef = useRef<ContextEntity | null>(null);

  const { entityContext, registerDispatch } = useAgentChatContext();
  const { showToast: _showToast } = useToast();
  const ContextIcon = (entityContext && ENTITY_TYPE_ICONS[entityContext.type]) || Package;

  const { modalRef, titleId } = useAccessibleModal({
    isOpen,
    onClose,
    titlePrefix: 'agent-chat',
  });

  const {
    messages,
    isStreaming,
    activeTool,
    error,
    conversationTitle,
    setConversationTitle,
    sendMessage,
    createConversation,
    loadMessages,
  } = useAgentChat({
    organizationId,
    conversationId,
    onConversationCreated: setConversationId,
  });

  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/organizations/${organizationId}/agent/conversations`,
        { credentials: 'include' },
      );
      if (!res.ok) return null;
      const data = await res.json();
      const list: ConversationSummary[] = data?.conversations || [];
      setConversations(list);
      return list;
    } catch {
      return null;
    }
  }, [organizationId]);

  // Restore the most recent conversation when the panel first opens, but only
  // if it is fresh (see RESUME_WINDOW_MS) and the user hasn't already acted.
  useEffect(() => {
    if (isOpen && !hasRestoredRef.current) {
      hasRestoredRef.current = true;
      fetchConversations().then(list => {
        if (userInteractedRef.current) return;
        const recent = list?.[0];
        if (!recent) return;
        const lastActive = Date.parse(recent.updated_at);
        if (!Number.isFinite(lastActive) || Date.now() - lastActive > RESUME_WINDOW_MS) return;
        setConversationId(recent.conversation_id);
        setConversationTitle(recent.title || null);
        loadMessages(recent.conversation_id);
      });
    }
  }, [isOpen, fetchConversations, loadMessages, setConversationTitle]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeTool]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // NOTE: Previously this effect auto-reset the conversation when the user
  // navigated to a different entity (different workspace page). That was
  // necessary when conversation-level context_entity was the only way the
  // model knew which record the user was on. Since Phase 2's per-turn
  // PageContext, the model sees the live page (route, entity, workflow) on
  // every message regardless of what the conversation was created with, so
  // context drift is handled at the message level and forced resets are no
  // longer needed. The user can still start a fresh chat manually via the
  // "New chat" button.

  const handleNewChat = useCallback(() => {
    userInteractedRef.current = true;
    setConversationId(null);
    setInputValue('');
    setShowHistory(false);
    setAttachments([]);
    convContextRef.current = null;
  }, []);

  const handleToggleHistory = useCallback(() => {
    setShowHistory(prev => {
      if (!prev) fetchConversations();
      return !prev;
    });
  }, [fetchConversations]);

  const handleSelectConversation = useCallback((conv: ConversationSummary) => {
    userInteractedRef.current = true;
    setConversationId(conv.conversation_id);
    setConversationTitle(conv.title || null);
    loadMessages(conv.conversation_id);
    setShowHistory(false);
    setAttachments([]);
  }, [loadMessages, setConversationTitle]);

  const dispatchMessage = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      if (!text || isStreaming) return;
      userInteractedRef.current = true;

      // Create conversation on first message, passing entity context if present
      let activeConvId = conversationId;
      if (!activeConvId) {
        const ctxEntity = entityContext
          ? { type: entityContext.type, id: entityContext.id }
          : undefined;
        activeConvId = await createConversation(ctxEntity);
        if (!activeConvId) return;
        convContextRef.current = ctxEntity || null;
      }

      await sendMessage(text, activeConvId);
      fetchConversations();
    },
    [
      isStreaming,
      conversationId,
      entityContext,
      createConversation,
      sendMessage,
      fetchConversations,
    ],
  );

  // Register dispatch with the context so openChatWithMessage can call
  // it directly — no effect, no double-fire, one call per question.
  useEffect(() => {
    registerDispatch(dispatchMessage);
    return () => registerDispatch(null);
  }, [dispatchMessage, registerDispatch]);

  const handleSend = useCallback(async () => {
    const text = inputValue;
    setInputValue('');
    await dispatchMessage(text);
  }, [inputValue, dispatchMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Attach a document to THIS conversation only (personal RAG — never the org
  // Corpus). Creates the conversation first if the user attaches before asking.
  const handleAttach = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (attachInputRef.current) attachInputRef.current.value = '';
      if (!file) return;

      let convId = conversationId;
      if (!convId) {
        convId = await createConversation(
          entityContext ? { type: entityContext.type, id: entityContext.id } : undefined,
        );
        if (!convId) return;
      }

      setAttachments((prev) => [...prev, { name: file.name, status: 'uploading' }]);
      try {
        await uploadConversationAttachment(convId, file);
        setAttachments((prev) =>
          prev.map((a) => (a.name === file.name ? { ...a, status: 'ready' } : a)),
        );
      } catch {
        setAttachments((prev) =>
          prev.map((a) => (a.name === file.name ? { ...a, status: 'error' } : a)),
        );
      }
    },
    [conversationId, createConversation, entityContext],
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-ink/30 transition-opacity"
        onClick={onClose}
      />

      {/* Slide-over panel */}
      <div className="absolute inset-y-0 right-0 flex max-w-full pl-10">
        <div
          ref={modalRef}
          className="w-screen max-w-md bg-parchment shadow-xl flex flex-col"
          {...getModalAriaProps(titleId)}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-lichen">
            <div className="flex items-center gap-2">
              {/* Guide-voice identity (§11): italic copper wordmark, not a
                  speech-bubble icon (§8). Shows the live conversation title when
                  one exists, else the Guide brand. */}
              <h2 id={titleId} className="truncate max-w-[220px]">
                {conversationTitle
                  ? <span className="text-base font-semibold text-ink">{conversationTitle}</span>
                  : <GuideWordmark className="text-lg" />}
              </h2>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={handleToggleHistory}
                className={`p-1 rounded transition-colors ${
                  showHistory ? 'text-bark bg-bark/10' : 'text-archive hover:text-ink'
                }`}
                aria-label="Conversation history"
                title="Conversation history"
                disabled={isStreaming}
              >
                <Clock size={16} />
              </button>
              {conversationId && (
                <button
                  onClick={handleNewChat}
                  className="p-1 text-archive hover:text-ink rounded transition-colors"
                  aria-label="New chat"
                  title="New chat"
                  disabled={isStreaming}
                >
                  <RotateCcw size={16} />
                </button>
              )}
              <button
                onClick={onClose}
                className="p-1 text-archive hover:text-ink rounded transition-colors"
                aria-label="Close chat"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          {/* Entity context indicator */}
          {entityContext && !showHistory && (
            <div className="flex items-center gap-1.5 px-4 py-1.5 bg-bark/5 border-b border-lichen text-xs text-archive">
              <ContextIcon size={12} className="text-bark flex-shrink-0" />
              <span>Viewing: <span className="font-medium text-ink">{entityContext.label}</span></span>
            </div>
          )}

          {/* Messages or History */}
          {showHistory ? (
            <div className="flex-1 overflow-y-auto px-2 py-2">
              <button
                onClick={handleNewChat}
                className="w-full text-left px-3 py-2 mb-1 rounded-lg text-sm font-medium text-bark hover:bg-bark/10 transition-colors"
              >
                + New chat
              </button>
              {conversations.length === 0 ? (
                <div className="text-center text-archive text-sm py-8">
                  No past conversations
                </div>
              ) : (
                <div className="space-y-0.5">
                  {conversations.map(conv => (
                    <button
                      key={conv.conversation_id}
                      onClick={() => handleSelectConversation(conv)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                        conv.conversation_id === conversationId
                          ? 'bg-azurite/10 text-azurite font-medium'
                          : 'text-ink hover:bg-stone'
                      }`}
                    >
                      <div className="truncate">
                        {conv.title || 'Untitled'}
                      </div>
                      <div className="text-xs text-archive mt-0.5">
                        {formatRelativeTime(conv.updated_at)}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {messages.length === 0 && (
                <div className="text-center text-archive text-sm py-12">
                  <MessageSquare size={32} className="mx-auto mb-3 text-lichen" />
                  <p>Ask me anything about the collection.</p>
                  <p className="mt-1 text-xs">
                    I can search objects, look up records, and help with cataloging questions.
                  </p>
                </div>
              )}

              {messages.map((msg, index) => (
                <AgentMessage
                  key={`msg-${index}`}
                  message={msg}
                  organizationId={organizationId}
                  conversationId={conversationId ?? undefined}
                />
              ))}

              {activeTool && (
                <AgentToolIndicator
                  toolName={activeTool.tool}
                  specialist={activeTool.specialist}
                />
              )}

              {error && (
                <div className="px-3 py-2 text-sm text-semantic-error bg-semantic-error/10 rounded-lg flex items-center gap-2">
                  <span>{error}</span>
                  <button
                    onClick={() => {
                      const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
                      if (lastUserMsg && !isStreaming) {
                        setInputValue(lastUserMsg.content);
                        inputRef.current?.focus();
                      }
                    }}
                    className="inline-flex items-center gap-1 text-xs font-medium text-semantic-error hover:text-semantic-error/80 underline underline-offset-2 flex-shrink-0"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Try again
                  </button>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}

          {/* Input */}
          <div className="border-t border-lichen px-4 py-3">
            {attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {attachments.map((a, i) => (
                  <span
                    key={`${a.name}-${i}`}
                    className="inline-flex items-center gap-1 rounded-full bg-stone/50 px-2 py-0.5 text-[11px] text-ink"
                    title="Read for this conversation only — not added to the org corpus"
                  >
                    {a.status === 'uploading' ? (
                      <Loader2 size={11} className="animate-spin text-archive" />
                    ) : (
                      <FileText
                        size={11}
                        className={a.status === 'error' ? 'text-semantic-error' : 'text-archive'}
                      />
                    )}
                    <span className="max-w-[140px] truncate">{a.name}</span>
                    {a.status === 'error' && <span className="text-semantic-error">failed</span>}
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <input
                ref={attachInputRef}
                type="file"
                accept=".pdf,.docx,.txt,.md"
                className="hidden"
                onChange={handleAttach}
              />
              <button
                onClick={() => attachInputRef.current?.click()}
                disabled={isStreaming}
                className="flex-shrink-0 rounded-lg border border-lichen p-2 text-archive transition-colors
                  hover:bg-stone/40 hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                aria-label="Attach a document to this conversation"
                title="Attach a document — read for this conversation only"
              >
                <Paperclip size={18} />
              </button>
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask a question..."
                rows={1}
                className="flex-1 resize-none rounded-lg border border-lichen bg-parchment px-3 py-2 text-sm text-ink
                  placeholder:text-archive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2
                  focus-visible:ring-offset-1"
                disabled={isStreaming}
              />
              <button
                onClick={handleSend}
                disabled={!inputValue.trim() || isStreaming}
                className="flex-shrink-0 rounded-lg bg-bark p-2 text-parchment transition-colors
                  hover:bg-copper-dark disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Send message"
              >
                {isStreaming ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Send size={18} />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
