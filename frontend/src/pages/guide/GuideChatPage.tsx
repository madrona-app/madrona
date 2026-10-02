/**
 * Guide chat playground (platform version).
 *
 * Full-page chat interface with conversation history panel.
 * Platform orgs get the staff persona (collections-aware).
 * Uses /api/guide/chat/* endpoints.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bot, Copy, Check, MessageSquare, Plus, RotateCcw, Send, Trash2 } from 'lucide-react';
import { apiFetch, API_BASE_URL } from '../../lib/apiClient';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import { ChatMarkdown } from '../../components/ui/ChatMarkdown';
import { formatTime, formatDateShort } from '@/lib/formatters';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  timestamp?: Date;
}

interface ConversationSummary {
  conversation_id: string;
  title: string | null;
  created_at: string;
}

export default function GuideChatPage() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [waitingLong, setWaitingLong] = useState(false);
  const [warmupQuip, setWarmupQuip] = useState('');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastUserMessageRef = useRef<string>('');

  useEffect(() => { loadConversations(); }, []);

  // Handle ?conversationId=<id> on arrival (set by the home Guide hero's
  // "Continue in Guide" link). Strip the param after firing so reloads don't
  // re-execute. Auto-send via ?q= was removed once the home hero gained inline
  // Q&A — no caller sets that param anymore.
  const [searchParams, setSearchParams] = useSearchParams();
  const initialParamsHandledRef = useRef(false);
  useEffect(() => {
    if (initialParamsHandledRef.current) return;
    const cid = searchParams.get('conversationId');
    if (!cid) return;
    initialParamsHandledRef.current = true;
    const next = new URLSearchParams(searchParams);
    next.delete('conversationId');
    setSearchParams(next, { replace: true });
    loadMessages(cid);
    // loadMessages is intentionally omitted from deps — the effect should
    // only fire once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, waiting]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    }
  }, [input]);

  const loadConversations = async () => {
    try {
      const res = await apiFetch<{ conversations: ConversationSummary[] }>('/guide/chat/conversations');
      setConversations(res.conversations);
    } catch { /* ignore */ }
  };

  const loadMessages = useCallback(async (convId: string) => {
    try {
      const res = await apiFetch<{ messages: { role: string; content: string; created_at?: string }[] }>(
        `/guide/chat/conversations/${convId}/messages`,
      );
      setMessages(
        res.messages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content, timestamp: m.created_at ? new Date(m.created_at) : new Date() })),
      );
      setActiveConvId(convId);
    } catch { /* conversation may have been deleted */ }
  }, []);

  const selectConversation = (convId: string) => {
    if (convId === activeConvId || streaming) return;
    loadMessages(convId);
  };

  const startNewConversation = () => {
    if (streaming) return;
    setActiveConvId(null);
    setMessages([]);
    textareaRef.current?.focus();
  };

  const deleteConversation = async (convId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await apiFetch(`/guide/chat/conversations/${convId}`, { method: 'DELETE' });
      setConversations((prev) => prev.filter((c) => c.conversation_id !== convId));
      if (activeConvId === convId) {
        setActiveConvId(null);
        setMessages([]);
      }
    } catch { /* ignore */ }
  };

  const createConversation = useCallback(async () => {
    const res = await apiFetch<{ conversation_id: string }>('/guide/chat/conversations', {
      method: 'POST',
    });
    setActiveConvId(res.conversation_id);
    loadConversations();
    return res.conversation_id;
  }, []);

  const sendMessage = async (override?: string) => {
    const userMessage = (override ?? input).trim();
    if (!userMessage || streaming) return;

    setInput('');
    lastUserMessageRef.current = userMessage;
    setMessages((prev) => [...prev, { role: 'user', content: userMessage, timestamp: new Date() }]);
    setStreaming(true);
    setWaiting(true);
    setWaitingLong(false);

    let convId = activeConvId;
    if (!convId) {
      convId = await createConversation();
    }

    try {
      const res = await fetch(`${API_BASE_URL}/guide/chat/conversations/${convId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message: userMessage }),
      });

      if (!res.ok) {
        setWaiting(false);
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: '__error__:Sorry, something went wrong.', timestamp: new Date() },
        ]);
        setStreaming(false);
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';
      let firstChunk = true;

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('event: warming_up')) {
            const quips = [
              'Guide just got back from the cafe — putting on the reading glasses...',
              'Pulling the right volumes off the shelf — one moment...',
              'Flipping through the archives — this one\'s buried deep...',
              'Just unlocking the reference room — be right with you...',
              'Consulting the card catalog... yes, we still have one...',
              'Dusting off a promising lead in the stacks...',
              'Cross-referencing the collection records — almost there...',
              'Guide was in the conservation lab — washing hands, one sec...',
              'Tracking down the right curator to ask about this...',
              'Rummaging through the flat files — hang tight...',
            ];
            setWarmupQuip(quips[Math.floor(Math.random() * quips.length)]);
            setWaitingLong(true);
            continue;
          }
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.text) {
                if (firstChunk) {
                  firstChunk = false;
                  setWaiting(false);
                  setMessages((prev) => [...prev, { role: 'assistant', content: '', isStreaming: true, timestamp: new Date() }]);
                }
                assistantContent += data.text;
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { ...updated[updated.length - 1], content: assistantContent, isStreaming: true };
                  return updated;
                });
              }
            } catch { /* skip */ }
          }
        }
      }
    } catch {
      setWaiting(false);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '__error__:Connection error.', timestamp: new Date() },
      ]);
    } finally {
      setWaiting(false);
      setWaitingLong(false);
      setStreaming(false);
      setMessages((prev) => {
        if (prev.length === 0) return prev;
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last.isStreaming) {
          updated[updated.length - 1] = { ...last, isStreaming: false };
        }
        return updated;
      });
      loadConversations();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleRetry = useCallback(() => {
    if (!lastUserMessageRef.current || streaming) return;
    // Remove the error message, then re-populate and focus
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.content.startsWith('__error__:')) {
        return prev.slice(0, -1);
      }
      return prev;
    });
    setInput(lastUserMessageRef.current);
    textareaRef.current?.focus();
  }, [streaming]);

  const handleCopyMessage = useCallback(async (index: number, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch {
      // Clipboard API may be unavailable in insecure contexts
    }
  }, []);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return formatTime(d);
    }
    return formatDateShort(d);
  };

  return (
    <div className="flex -mx-4 -my-6 sm:-mx-6 lg:-mx-8 overflow-hidden" style={{ height: 'calc(100dvh - 3.5rem - 3rem)' }}>
      {/* Conversation history panel */}
      <div className="w-56 flex-shrink-0 border-r border-lichen flex flex-col bg-stone/20">
        <div className="p-2.5 border-b border-lichen">
          <button
            onClick={startNewConversation}
            disabled={streaming}
            className="w-full flex items-center gap-2 justify-center rounded-md border border-lichen px-3 py-1.5 text-xs font-medium text-ink hover:bg-stone/50 transition-colors disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" />
            New Conversation
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          {conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 px-3 text-archive">
              <MessageSquare className="w-5 h-5 mb-2 opacity-40" />
              <p className="text-[11px] text-center">Your conversations will appear here.</p>
            </div>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.conversation_id}
                role="button"
                tabIndex={0}
                onClick={() => selectConversation(conv.conversation_id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    selectConversation(conv.conversation_id);
                  }
                }}
                aria-current={conv.conversation_id === activeConvId}
                className={`w-full text-left px-3 py-2 border-b border-lichen/30 transition-colors group cursor-pointer focus-visible:ring-2 ring-bark/30 ring-inset outline-none ${
                  conv.conversation_id === activeConvId
                    ? 'bg-bark/10'
                    : 'hover:bg-stone/30'
                }`}
              >
                <div className="flex items-start gap-1.5">
                  <MessageSquare className={`w-3 h-3 mt-0.5 flex-shrink-0 ${
                    conv.conversation_id === activeConvId ? 'text-bark' : 'text-archive/50'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className={`truncate text-[11px] leading-tight ${
                      conv.conversation_id === activeConvId ? 'text-bark font-medium' : 'text-ink'
                    }`}>
                      {conv.title || 'New conversation'}
                    </p>
                    <p className="text-[10px] text-archive mt-0.5">
                      {formatDate(conv.created_at)}
                    </p>
                  </div>
                  <button
                    onClick={(e) => deleteConversation(conv.conversation_id, e)}
                    className="opacity-0 group-hover:opacity-100 text-archive hover:text-semantic-error transition-all p-0.5 -mr-0.5"
                    title="Delete"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Messages */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-auto"
        >
          {messages.length === 0 && !waiting ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center h-full text-center px-8">
              <div className="w-12 h-12 rounded-full bg-bark/10 flex items-center justify-center mb-4">
                <Bot className="w-6 h-6 text-bark" />
              </div>
              <h2 className="text-lg font-medium text-ink mb-1">Ask Guide</h2>
              <p className="text-sm text-archive max-w-sm">
                Search your collection, look up standards, find contacts, check loan status, or ask about anything in your documents.
              </p>
              <div className="flex flex-wrap gap-2 mt-6 max-w-lg justify-center">
                {[
                  'How many objects are in our collection?',
                  'What loans are overdue?',
                  'Find impressionist paintings',
                  'NAGPRA consultation requirements',
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => { setInput(suggestion); textareaRef.current?.focus(); }}
                    className="text-xs text-accessible-gray border border-lichen rounded-full px-3 py-1.5 hover:bg-stone/30 hover:border-stone transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto px-6 py-6 space-y-5">
              {messages.map((msg, i) => {
                const isError = msg.role === 'assistant' && msg.content.startsWith('__error__:');
                const displayContent = isError ? msg.content.replace('__error__:', '') : msg.content;

                return (
                  <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                    <div
                      className={`rounded-lg px-4 py-2.5 text-sm leading-relaxed ${
                        msg.role === 'user'
                          ? 'bg-bark text-parchment whitespace-pre-wrap max-w-[70%]'
                          : isError
                            ? 'bg-semantic-error/10 text-semantic-error max-w-[85%]'
                            : 'bg-stone/40 text-ink max-w-[85%] group relative'
                      }`}
                    >
                      {msg.role === 'user' ? (
                        msg.content
                      ) : isError ? (
                        <div className="flex items-center gap-2">
                          <span>{displayContent}</span>
                          <button
                            onClick={handleRetry}
                            className="inline-flex items-center gap-1 text-xs font-medium text-semantic-error hover:text-semantic-error/80 underline underline-offset-2"
                          >
                            <RotateCcw className="w-3 h-3" />
                            Try again
                          </button>
                        </div>
                      ) : (
                        <>
                          <ChatMarkdown text={msg.content} isStreaming={msg.isStreaming} />
                          {msg.content && !msg.isStreaming && (
                            <button
                              onClick={() => handleCopyMessage(i, msg.content)}
                              className="absolute top-2 right-2 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-stone transition-opacity"
                              aria-label="Copy message"
                            >
                              {copiedIndex === i ? <Check className="w-4 h-4 text-semantic-success" /> : <Copy className="w-4 h-4 text-archive" />}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                    {msg.timestamp && (
                      <span className="text-[10px] text-archive mt-1 px-1">
                        {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                );
              })}
              {waiting && (
                <div className="flex justify-start">
                  <div className="rounded-lg px-4 py-3 bg-stone/40">
                    <div className="flex items-center gap-2">
                      <MadronaLoader variant="dots" dotSize={7} />
                      {waitingLong && (
                        <span className="text-xs text-archive animate-fade-in italic">
                          {warmupQuip}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Input area */}
        <div className="border-t border-lichen bg-parchment px-6 py-3">
          <div className="max-w-3xl mx-auto flex items-end gap-3">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question..."
              rows={1}
              disabled={streaming}
              className="flex-1 resize-none rounded-lg border border-lichen bg-parchment px-4 py-2.5 text-sm leading-snug focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-1 outline-none disabled:opacity-50 placeholder:text-archive"
              style={{ minHeight: '40px', maxHeight: '120px' }}
            />
            <button
              onClick={() => sendMessage()}
              disabled={streaming || !input.trim()}
              className="btn-primary flex items-center justify-center w-10 h-10 rounded-lg flex-shrink-0 disabled:opacity-30"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
