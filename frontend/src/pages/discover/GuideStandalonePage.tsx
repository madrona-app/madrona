/**
 * Standalone full-page visitor guide — the WonderWay-style destination.
 *
 * Public route /c/:orgSlug/guide. The museum-level QR points here: one scan
 * opens a full-screen conversation with the collection, no app, no account.
 * Same visitor session, persona, gate, and metering as the Discover widget —
 * this is just a different client of the same visitor channel.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Send, Mic, Globe, Volume2, VolumeX, ArrowLeft } from 'lucide-react';
import { getDiscoverInfo } from '../../lib/api';
import { useVisitorChat } from '../../hooks/useVisitorChat';
import { useSpeech } from '../../hooks/useSpeech';
import { AgentMessage } from '../../components/agent/AgentMessage';
import { AgentToolIndicator } from '../../components/agent/AgentToolIndicator';
import { useLocale } from '../../lib/i18n/useLocale';
import { SUPPORTED_LOCALES, LOCALE_LABELS } from '../../lib/i18n/locales';
import type { SupportedLocale } from '../../lib/i18n/locales';

const VOICE_KEY = 'madrona-visitor-chat-voice';
const VOICE_TOGGLE_LABEL = 'Spoken responses';
const MIC_LABEL = 'Speak your question';

export function GuideStandalonePage() {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const [input, setInput] = useState('');
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [voiceMode, setVoiceMode] = useState(() => sessionStorage.getItem(VOICE_KEY) === '1');
  const [inputMode, setInputMode] = useState<'voice' | 'text'>('text');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { locale, setLocale, strings } = useLocale();
  const {
    sttSupported, ttsSupported, listening,
    startListening, stopListening, speak, cancelSpeech, primeSpeech,
  } = useSpeech();

  // Hide the initial HTML loading overlay — public pages are each
  // responsible for dismissing it (same pattern as DiscoverPage).
  useEffect(() => {
    const loader = document.getElementById('initial-loader');
    if (loader) {
      loader.classList.add('fade-out');
      setTimeout(() => loader.remove(), 300);
    }
  }, []);

  const infoQuery = useQuery({
    queryKey: ['discover-info', orgSlug],
    queryFn: () => getDiscoverInfo(orgSlug!),
    enabled: !!orgSlug,
  });
  const info = infoQuery.data;

  const { messages, isStreaming, activeTool, error, sendMessage } = useVisitorChat({
    orgSlug: orgSlug ?? '',
    locale,
    inputMode,
    onAssistantDone: (text) => {
      if (voiceMode && ttsSupported) speak(text, locale);
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeTool]);

  useEffect(() => () => cancelSpeech(), [cancelSpeech]);

  const submitText = useCallback((text: string, mode: 'voice' | 'text') => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;
    cancelSpeech();
    setInputMode(mode);
    setInput('');
    sendMessage(trimmed);
  }, [isStreaming, cancelSpeech, sendMessage]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    submitText(input, 'text');
  }, [input, submitText]);

  const handleToggleVoice = useCallback(() => {
    setVoiceMode(prev => {
      const next = !prev;
      sessionStorage.setItem(VOICE_KEY, next ? '1' : '0');
      if (next) primeSpeech();
      else cancelSpeech();
      return next;
    });
  }, [primeSpeech, cancelSpeech]);

  const handleMic = useCallback(() => {
    if (listening) {
      stopListening();
      return;
    }
    setInputMode('voice');
    startListening({
      lang: locale,
      onInterim: (text) => setInput(text),
      onFinal: (text) => submitText(text, 'voice'),
    });
  }, [listening, stopListening, startListening, locale, submitText]);

  const handleLocaleChange = useCallback((newLocale: SupportedLocale) => {
    setLocale(newLocale);
    setShowLangMenu(false);
  }, [setLocale]);

  const primaryColor = info?.primary_color || undefined;

  if (infoQuery.isLoading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-parchment">
        <p className="text-sm text-archive">Loading…</p>
      </div>
    );
  }

  if (!info || !info.widget_enabled) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-parchment px-6 text-center">
        <h1 className="text-xl font-semibold text-ink">
          {info?.organization_name || 'This collection'}
        </h1>
        <p className="text-sm text-archive max-w-sm">
          The visitor guide isn't available right now.
        </p>
        {info && (
          <Link to={`/c/${orgSlug}`} className="text-sm text-azurite hover:text-azurite-deep underline">
            Browse the collection instead
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-parchment">
      {/* Branded header */}
      <header
        className="flex shrink-0 items-center justify-between px-4 py-3 sm:px-6"
        style={{ backgroundColor: primaryColor || 'var(--c-primary, #1F3A2E)' }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <Link
            to={`/c/${orgSlug}`}
            className="p-1 text-parchment/60 hover:text-parchment transition-colors"
            aria-label="Back to collection"
          >
            <ArrowLeft size={18} />
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-parchment">
              {info.organization_name}
            </h1>
            <p className="text-xs text-parchment/60">{strings.headerTitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {ttsSupported && (
            <button
              onClick={handleToggleVoice}
              className="p-2 text-parchment/60 hover:text-parchment transition-colors"
              aria-label={VOICE_TOGGLE_LABEL}
              aria-pressed={voiceMode}
              title={VOICE_TOGGLE_LABEL}
            >
              {voiceMode ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </button>
          )}
          <div className="relative">
            <button
              onClick={() => setShowLangMenu(!showLangMenu)}
              className="p-2 text-parchment/60 hover:text-parchment transition-colors"
              aria-label={strings.languageLabel}
              title={strings.languageLabel}
            >
              <Globe size={18} />
            </button>
            {showLangMenu && (
              <div className="absolute right-0 top-full mt-1 w-36 rounded border border-lichen bg-parchment shadow-lg z-50">
                {SUPPORTED_LOCALES.map(loc => (
                  <button
                    key={loc}
                    onClick={() => handleLocaleChange(loc)}
                    className={`block w-full px-3 py-2 text-left text-sm transition-colors ${
                      loc === locale ? 'bg-bark/10 text-bark font-medium' : 'text-ink hover:bg-stone'
                    }`}
                  >
                    {LOCALE_LABELS[loc]}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Conversation */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-4 py-4 sm:px-6">
          {messages.length === 0 && (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-lg bg-stone px-4 py-3 text-sm leading-relaxed text-ink">
                {info.widget_welcome_message || strings.welcome}
              </div>
            </div>
          )}
          {messages.map(msg => (
            <AgentMessage key={msg.id} message={msg} />
          ))}
          {activeTool && <AgentToolIndicator toolName={activeTool.tool} />}
          {error && (
            <p className="text-sm text-semantic-error">{error}</p>
          )}
          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="shrink-0 border-t border-lichen bg-parchment-warm px-4 py-3 sm:px-6"
      >
        <div className="mx-auto flex w-full max-w-2xl items-center gap-2">
          {sttSupported && (
            <button
              type="button"
              onClick={handleMic}
              className={`shrink-0 rounded-full p-2.5 transition-colors focus-visible:ring-2 ring-bark/30 ring-offset-2 ${
                listening ? 'text-bark animate-pulse' : 'text-archive hover:text-ink'
              }`}
              aria-label={MIC_LABEL}
              aria-pressed={listening}
              title={MIC_LABEL}
            >
              <Mic size={20} />
            </button>
          )}
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={strings.placeholder}
            disabled={isStreaming}
            className="min-w-0 flex-1 rounded-full border border-lichen bg-parchment px-4 py-2.5 text-sm text-ink placeholder:text-archive focus:outline-none focus-visible:ring-2 ring-bark/30"
          />
          <button
            type="submit"
            disabled={!input.trim() || isStreaming}
            className="shrink-0 rounded-full p-2.5 text-parchment transition-opacity disabled:opacity-40 focus-visible:ring-2 ring-bark/30 ring-offset-2"
            style={{ backgroundColor: primaryColor || 'var(--c-primary, #1F3A2E)' }}
            aria-label={strings.sendLabel}
          >
            <Send size={18} />
          </button>
        </div>
      </form>
    </div>
  );
}

export default GuideStandalonePage;
