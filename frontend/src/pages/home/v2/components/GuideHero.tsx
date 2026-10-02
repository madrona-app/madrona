import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, RotateCcw } from 'lucide-react';
import { ChatMarkdown } from '../../../../components/ui/ChatMarkdown';
import { MadronaLoader } from '../../../../components/ui/MadronaLoader';
import { apiFetch, API_BASE_URL } from '../../../../lib/apiClient';

interface GuideHeroProps {
  orgId: string | undefined;
  /** v1: hardcoded. v2 (TODO): derived from recent collection activity. */
  suggestions: string[];
}

interface Turn {
  question: string;
  answer: string;
  streaming: boolean;
  error?: string;
}

export function GuideHero({ orgId, suggestions }: GuideHeroProps) {
  const [value, setValue] = useState('');
  const [turn, setTurn] = useState<Turn | null>(null);
  const [convId, setConvId] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const ask = async (prompt: string) => {
    const question = prompt.trim();
    if (!orgId || !question || inFlightRef.current) return;

    inFlightRef.current = true;
    setValue('');
    setTurn({ question, answer: '', streaming: true });

    try {
      let activeConvId = convId;
      if (!activeConvId) {
        const created = await apiFetch<{ conversation_id: string }>(
          '/guide/chat/conversations',
          { method: 'POST' },
        );
        activeConvId = created.conversation_id;
        setConvId(activeConvId);
      }

      const res = await fetch(
        `${API_BASE_URL}/guide/chat/conversations/${activeConvId}/chat`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ message: question }),
        },
      );

      if (!res.ok) {
        setTurn({ question, answer: '', streaming: false, error: 'Sorry, something went wrong.' });
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';

      while (reader) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        const text = decoder.decode(chunk, { stream: true });
        for (const line of text.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (typeof data.text === 'string') {
              assistantContent += data.text;
              setTurn((prev) =>
                prev ? { ...prev, answer: assistantContent, streaming: true } : prev,
              );
            }
          } catch {
            /* skip malformed line */
          }
        }
      }

      setTurn((prev) => (prev ? { ...prev, streaming: false } : prev));
    } catch {
      setTurn({ question, answer: '', streaming: false, error: 'Connection error.' });
    } finally {
      inFlightRef.current = false;
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    ask(value);
  };

  const reset = () => {
    setTurn(null);
    setConvId(null);
    setValue('');
  };

  return (
    <section
      className="relative overflow-hidden bg-forest rounded-xl p-4 sm:p-6 mb-5 sm:mb-6"
      aria-label="Ask Guide"
    >
      <span
        aria-hidden
        className="absolute -top-10 -right-8 w-44 h-44 rounded-full border border-copper/20 pointer-events-none"
      />
      <span
        aria-hidden
        className="absolute top-5 right-5 w-20 h-20 rounded-full border border-copper/15 pointer-events-none"
      />

      <div className="relative flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full bg-copper" />
        <span className="text-[11px] tracking-[0.18em] text-parchment uppercase font-medium">
          Guide
        </span>
        {turn && (
          <button
            type="button"
            onClick={reset}
            className="ml-auto text-[11px] text-parchment/60 hover:text-parchment flex items-center gap-1 focus-visible:outline-parchment"
          >
            <RotateCcw size={11} />
            Start over
          </button>
        )}
      </div>

      {!turn && (
        <p className="font-serif italic text-lg text-parchment leading-relaxed max-w-[580px] mb-4 relative m-0">
          “What would you like to know about the collection today?”
        </p>
      )}

      <form
        onSubmit={onSubmit}
        className="relative bg-parchment/[0.06] border border-parchment/20 rounded-lg px-3.5 py-3 flex items-center gap-3"
      >
        <span className="text-parchment/40 text-sm">›</span>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Ask anything about the collection…"
          disabled={turn?.streaming}
          className="flex-1 bg-transparent border-none outline-none text-parchment placeholder:text-parchment/40 text-sm disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!value.trim() || turn?.streaming}
          className="border border-parchment/70 text-parchment font-medium text-xs px-3.5 py-1.5 rounded-md hover:bg-parchment/10 hover:border-parchment disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-parchment/40 focus-visible:ring-offset-2 focus-visible:ring-offset-forest"
        >
          Ask
        </button>
      </form>

      {turn && (
        <div className="relative mt-4 space-y-3">
          <div className="font-serif italic text-sm text-parchment/85">
            {turn.question}
          </div>
          <div className="bg-parchment/[0.04] border border-parchment/15 rounded-lg px-4 py-3 text-sm text-parchment/95 leading-relaxed min-h-[2.5rem]">
            {turn.error ? (
              <span className="text-copper">{turn.error}</span>
            ) : turn.answer ? (
              <ChatMarkdown
                text={turn.answer}
                isStreaming={turn.streaming}
                className="prose-invert prose-sm prose-p:my-1 prose-p:text-parchment/95"
              />
            ) : (
              <MadronaLoader variant="dots" dotSize={6} />
            )}
          </div>
          {convId && !turn.streaming && (
            <Link
              to={`/organizations/${orgId}/guide/chat?conversationId=${convId}`}
              className="inline-flex items-center gap-1 text-[11px] text-parchment/85 hover:text-parchment no-underline focus-visible:outline-parchment"
            >
              Continue in Guide
              <ArrowRight size={11} />
            </Link>
          )}
        </div>
      )}

      {!turn && suggestions.length > 0 && (
        <div className="relative flex flex-wrap gap-2 mt-3">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => ask(s)}
              className="bg-parchment/[0.08] text-parchment/85 border border-parchment/20 px-2.5 py-1 rounded-full text-[11px] hover:bg-parchment/15 focus-visible:outline-parchment"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
