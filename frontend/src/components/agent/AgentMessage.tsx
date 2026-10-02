/**
 * Single message bubble in the agent chat.
 *
 * Renders assistant messages as markdown (bold, italic, lists, links, etc.).
 * Internal links use React Router navigation to avoid full page reloads.
 */

import { useMemo, useState, useCallback } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { MarkdownHooks as ReactMarkdown } from 'react-markdown';
import {
  ArrowRight,
  Copy,
  Check,
  MousePointerClick,
  ThumbsUp,
  ThumbsDown,
} from 'lucide-react';
import { DelegationCard } from './DelegationCard';
import { PlanChecklist } from './PlanChecklist';
import type { PlanRunOutcome } from './PlanChecklist';
import { MadronaLoader } from '../ui/MadronaLoader';
import { API_BASE_URL, getCsrfToken } from '../../lib/apiClient';
import { useAgentChatContextOptional } from '../../contexts/AgentChatContext';
import { ObjectCards } from './ObjectCards';
import { useActiveProduct, workBasePath } from '../../hooks/useActiveProduct';
import type { AgentMessage as AgentMessageType, AgentMessageUI } from '../../hooks/useAgentChat';

interface AgentMessageProps {
  message: AgentMessageType;
}

/**
 * Render the "Go there →" button for a navigate_to tool result.
 * Substitutes `:orgId` with the current org param at click time and closes
 * the chat panel after navigation so the destination is visible.
 */
function NavigationHintButton({ hint }: { hint: AgentMessageUI & { kind: 'navigation' } }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { orgId } = useParams<{ orgId: string }>();
  const closeChat = useAgentChatContextOptional()?.closeChat ?? (() => {});

  const resolvedPath = useMemo(() => {
    if (!orgId) return hint.target.path;
    return hint.target.path.replace(':orgId', orgId);
  }, [hint.target.path, orgId]);

  // Don't show the button if the user is already on (or under) the
  // target page — e.g. they're on /collections/entries/{id} and the
  // hint points to /collections/entries. Clicking "Ask Guide why"
  // from a detail page shouldn't offer a button back to the list.
  const alreadyThere = location.pathname.startsWith(resolvedPath);
  if (alreadyThere) return null;

  const handleClick = () => {
    navigate(resolvedPath);
    closeChat();
  };

  const breadcrumbText = hint.target.breadcrumb.length > 0
    ? hint.target.breadcrumb.join(' / ')
    : hint.target.label;

  return (
    <button
      type="button"
      onClick={handleClick}
      className="mt-2 inline-flex items-center gap-2 rounded-md border border-lichen bg-parchment px-3 py-1.5 text-xs font-medium text-bark hover:bg-bark/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
      aria-label={`Go to ${hint.target.label}`}
    >
      <span className="truncate max-w-[220px]">{breadcrumbText}</span>
      <ArrowRight size={14} aria-hidden="true" />
    </button>
  );
}

/**
 * Render a "Jump to {section}" button for a section hint from lookup_madrona_field.
 * Sets a query param that workspace pages listen for to expand and scroll to the section.
 */
function SectionHintButton({ hint }: { hint: AgentMessageUI & { kind: 'section' } }) {
  const [, setSearchParams] = useSearchParams();
  const closeChat = useAgentChatContextOptional()?.closeChat ?? (() => {});

  const handleClick = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('action', 'expand-section');
      next.set('section', hint.sectionId);
      if (hint.fieldPath) next.set('field', hint.fieldPath);
      return next;
    }, { replace: true });
    closeChat();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="mt-1 mr-1 inline-flex items-center gap-1.5 rounded-md border border-lichen bg-parchment px-2.5 py-1 text-xs font-medium text-bark hover:bg-bark/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
      aria-label={`Jump to ${hint.label} section`}
    >
      <MousePointerClick size={12} aria-hidden="true" />
      <span>Jump to {hint.label}</span>
    </button>
  );
}

/**
 * While streaming, hide any trailing incomplete markdown link so the user
 * never sees raw [text](url) characters being typed out.
 */
function bufferIncompleteMarkdown(text: string): string {
  const lastBracket = text.lastIndexOf('[');
  if (lastBracket !== -1) {
    const tail = text.slice(lastBracket);
    if (!/\[[^\]]+\]\([^)]+\)/.test(tail)) {
      return text.slice(0, lastBracket);
    }
  }
  return text;
}

function MarkdownContent({ text, isStreaming }: { text: string; isStreaming?: boolean }) {
  const navigate = useNavigate();
  const safeText = isStreaming ? bufferIncompleteMarkdown(text) : text;

  const components = useMemo(() => ({
    // Route internal links through React Router
    a: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children?: React.ReactNode }) => {
      const isInternal = href?.startsWith('/');
      return (
        <a
          href={href}
          onClick={isInternal ? (e) => { e.preventDefault(); navigate(href!); } : undefined}
          className="underline decoration-1 underline-offset-2 hover:opacity-80"
          {...props}
        >
          {children}
        </a>
      );
    },
    // Keep paragraphs inline-friendly (no extra margin in chat bubbles)
    p: ({ children }: { children?: React.ReactNode }) => <p className="mb-2 last:mb-0">{children}</p>,
    // Lists
    ul: ({ children }: { children?: React.ReactNode }) => <ul className="list-disc pl-4 mb-2 last:mb-0">{children}</ul>,
    ol: ({ children }: { children?: React.ReactNode }) => <ol className="list-decimal pl-4 mb-2 last:mb-0">{children}</ol>,
    li: ({ children }: { children?: React.ReactNode }) => <li className="mb-0.5">{children}</li>,
    // Code
    code: ({ children, className }: { children?: React.ReactNode; className?: string }) => {
      const isBlock = className?.startsWith('language-');
      if (isBlock) {
        return <code className="block bg-ink/10 rounded px-2 py-1 text-xs my-1 overflow-x-auto">{children}</code>;
      }
      return <code className="bg-ink/10 rounded px-1 py-0.5 text-xs">{children}</code>;
    },
  }), [navigate]);

  return <ReactMarkdown components={components}>{safeText}</ReactMarkdown>;
}

export function AgentMessage({ message, organizationId, conversationId }: AgentMessageProps & { organizationId?: string; conversationId?: string }) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);
  const [satisfaction, setSatisfaction] = useState<'positive' | 'negative' | null>(null);
  const navigate = useNavigate();
  const { activeProductId } = useActiveProduct();
  const closeChat = useAgentChatContextOptional()?.closeChat ?? (() => {});

  const sendFeedback = useCallback(async (value: 'positive' | 'negative') => {
    setSatisfaction(value);
    if (!organizationId || !conversationId) return;
    try {
      const csrf = getCsrfToken();
      await fetch(
        `${API_BASE_URL}/organizations/${organizationId}/agent/conversations/${conversationId}/messages/${message.id}/feedback`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
          },
          body: JSON.stringify({ satisfaction: value }),
        },
      );
    } catch {
      // Best-effort — don't interrupt the chat for a feedback failure
    }
  }, [organizationId, conversationId, message.id]);

  const runPlan = useCallback(async (planId: string): Promise<PlanRunOutcome> => {
    if (!organizationId) throw new Error('missing organization context');
    const csrf = getCsrfToken();
    const res = await fetch(
      `${API_BASE_URL}/organizations/${organizationId}/agent/plans/${planId}/run`,
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        },
      },
    );
    if (!res.ok) throw new Error(`run failed: ${res.status}`);
    const data = await res.json();
    return {
      status: data.status,
      halt_reason: data.halt_reason ?? null,
    };
  }, [organizationId]);

  const submitForm = useCallback(
    async (planId: string, stepId: string): Promise<PlanRunOutcome> => {
      if (!organizationId) throw new Error('missing organization context');
      const csrf = getCsrfToken();
      const res = await fetch(
        `${API_BASE_URL}/organizations/${organizationId}/agent/plans/${planId}/steps/${stepId}/form-submitted`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
          },
        },
      );
      if (!res.ok) throw new Error(`form-submitted failed: ${res.status}`);
      const data = await res.json();
      return {
        status: data.status,
        halt_reason: data.halt_reason ?? null,
      };
    },
    [organizationId],
  );

  // Hand off from the chat card to the plan's durable home in the current
  // product's Work area, deep-linked to this plan, and close the chat panel
  // (same UX as the navigation hint button).
  const openInPlans = useCallback(
    (planId: string) => {
      if (!organizationId) return;
      navigate(`${workBasePath(organizationId, activeProductId)}/plans/${planId}`);
      closeChat();
    },
    [organizationId, activeProductId, navigate, closeChat],
  );

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? 'bg-forest text-parchment whitespace-pre-wrap'
            : 'bg-stone text-ink group'
        }`}
      >
        {isUser ? message.content : (
          <>
            <MarkdownContent text={message.content} isStreaming={message.isStreaming} />
            {message.uiHints?.map((hint, idx) => {
              if (hint.kind === 'object_cards') {
                return <ObjectCards key={idx} objects={hint.objects} />;
              }
              if (hint.kind === 'navigation') {
                return <NavigationHintButton key={`nav-${idx}`} hint={hint} />;
              }
              if (hint.kind === 'section') {
                return <SectionHintButton key={`sec-${idx}`} hint={hint} />;
              }
              if (hint.kind === 'delegation') {
                return <DelegationCard key={`del-${idx}`} hint={hint} />;
              }
              if (hint.kind === 'plan') {
                return (
                  <PlanChecklist
                    key={`plan-${idx}`}
                    hint={hint}
                    onRunPlan={organizationId ? runPlan : undefined}
                    onSubmitForm={organizationId ? submitForm : undefined}
                    approvalsHref={organizationId
                      ? `/organizations/${organizationId}/collections/work/approvals`
                      : undefined}
                    onOpenInPlans={organizationId ? openInPlans : undefined}
                  />
                );
              }
              return null;
            })}
            {message.content && !message.isStreaming && (
              <div className="flex items-center gap-0.5 mt-1.5 pt-1.5 border-t border-ink/5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => sendFeedback('positive')}
                  className={`p-1 rounded transition-colors ${
                    satisfaction === 'positive'
                      ? 'text-semantic-success bg-semantic-success/10'
                      : 'text-archive hover:text-semantic-success hover:bg-ink/5'
                  }`}
                  aria-label="Helpful"
                  title="Helpful"
                >
                  <ThumbsUp className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => sendFeedback('negative')}
                  className={`p-1 rounded transition-colors ${
                    satisfaction === 'negative'
                      ? 'text-semantic-error bg-semantic-error/10'
                      : 'text-archive hover:text-semantic-error hover:bg-ink/5'
                  }`}
                  aria-label="Not helpful"
                  title="Not helpful"
                >
                  <ThumbsDown className="w-3.5 h-3.5" />
                </button>
                <div className="ml-auto">
                  <button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(message.content);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      } catch {
                        // Clipboard API may be unavailable
                      }
                    }}
                    className="p-1 rounded text-archive hover:text-ink hover:bg-ink/5 transition-colors"
                    aria-label="Copy message"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-semantic-success" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        {message.isStreaming && !message.content && (
          <MadronaLoader variant="dots" dotSize={6} />
        )}
      </div>
    </div>
  );
}
