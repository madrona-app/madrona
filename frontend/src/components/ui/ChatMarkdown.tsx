/**
 * Shared markdown renderer for chat messages.
 *
 * Renders bold, italic, links, lists, and code blocks.
 * Buffers incomplete markdown links during streaming to avoid
 * showing raw [text](url) characters.
 */

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { MarkdownHooks as ReactMarkdown } from 'react-markdown';


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


interface ChatMarkdownProps {
  text: string;
  isStreaming?: boolean;
  className?: string;
}

export function ChatMarkdown({ text, isStreaming, className }: ChatMarkdownProps) {
  const navigate = useNavigate();
  const safeText = isStreaming ? bufferIncompleteMarkdown(text) : text;

  const components = useMemo(() => ({
    a: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children?: React.ReactNode }) => {
      const isInternal = href?.startsWith('/');
      return (
        <a
          href={href}
          onClick={isInternal ? (e) => { e.preventDefault(); navigate(href!); } : undefined}
          target={isInternal ? undefined : '_blank'}
          rel={isInternal ? undefined : 'noopener noreferrer'}
          className="text-bark underline decoration-1 underline-offset-2 hover:text-copper-dark"
          {...props}
        >
          {children}
        </a>
      );
    },
    p: ({ children }: { children?: React.ReactNode }) => <p className="mb-2 last:mb-0">{children}</p>,
    ul: ({ children }: { children?: React.ReactNode }) => <ul className="list-disc pl-4 mb-2 last:mb-0">{children}</ul>,
    ol: ({ children }: { children?: React.ReactNode }) => <ol className="list-decimal pl-4 mb-2 last:mb-0">{children}</ol>,
    li: ({ children }: { children?: React.ReactNode }) => <li className="mb-0.5">{children}</li>,
    strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold">{children}</strong>,
    code: ({ children, className }: { children?: React.ReactNode; className?: string }) => {
      const isBlock = className?.startsWith('language-');
      if (isBlock) {
        return <code className="block bg-ink/10 rounded px-2 py-1 text-xs my-1 overflow-x-auto">{children}</code>;
      }
      return <code className="bg-ink/10 rounded px-1 py-0.5 text-xs">{children}</code>;
    },
  }), [navigate]);

  const markdown = <ReactMarkdown components={components}>{safeText}</ReactMarkdown>;
  return className ? <div className={className}>{markdown}</div> : markdown;
}
