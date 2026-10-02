/**
 * Floating chat widget for the public visitor gallery guide.
 *
 * Collapsed: circular button (bottom-right).
 * Expanded: responsive panel with messages, input, tool indicators, a locale
 * selector, and optional voice input/output when the browser supports the
 * Web Speech API.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { MessageSquare, Send, Minus, Globe, Mic, Volume2, VolumeX } from 'lucide-react';
import { useVisitorChat } from '../../../hooks/useVisitorChat';
import { useSpeech } from '../../../hooks/useSpeech';
import { AgentMessage } from '../../../components/agent/AgentMessage';
import { AgentToolIndicator } from '../../../components/agent/AgentToolIndicator';
import { useLocale } from '../../../lib/i18n/useLocale';
import { SUPPORTED_LOCALES, LOCALE_LABELS } from '../../../lib/i18n/locales';
import type { SupportedLocale } from '../../../lib/i18n/locales';

interface VisitorChatWidgetProps {
  orgSlug: string;
  contextEntityType?: string;
  contextEntityId?: string;
  /** Museum-configured greeting; falls back to the localized default. */
  welcomeMessage?: string;
}

const OPEN_KEY = 'madrona-visitor-chat-open';
const VOICE_KEY = 'madrona-visitor-chat-voice';
const VOICE_TOGGLE_LABEL = 'Spoken responses';
const MIC_LABEL = 'Speak your question';

export function VisitorChatWidget({ orgSlug, contextEntityType, contextEntityId, welcomeMessage }: VisitorChatWidgetProps) {
  const [isOpen, setIsOpen] = useState(() => sessionStorage.getItem(OPEN_KEY) === '1');
  const [input, setInput] = useState('');
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [voiceMode, setVoiceMode] = useState(() => sessionStorage.getItem(VOICE_KEY) === '1');
  const [inputMode, setInputMode] = useState<'voice' | 'text'>('text');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { locale, setLocale, strings } = useLocale();
  const {
    sttSupported,
    ttsSupported,
    listening,
    startListening,
    stopListening,
    speak,
    cancelSpeech,
    primeSpeech,
  } = useSpeech();

  // Keep voiceMode current inside the onAssistantDone closure without
  // re-subscribing the SSE hook.
  const { messages, isStreaming, activeTool, error, sendMessage } = useVisitorChat({
    orgSlug,
    contextEntityType,
    contextEntityId,
    locale,
    inputMode,
    onAssistantDone: (text) => {
      if (voiceMode && ttsSupported) speak(text, locale);
    },
  });

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeTool]);

  // Persist open state + focus input when panel opens
  useEffect(() => {
    sessionStorage.setItem(OPEN_KEY, isOpen ? '1' : '0');
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Stop any speech when the panel is minimized.
  useEffect(() => {
    if (!isOpen) cancelSpeech();
  }, [isOpen, cancelSpeech]);

  const submitText = useCallback((text: string, mode: 'voice' | 'text') => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;
    // A fresh question supersedes anything currently being spoken.
    cancelSpeech();
    setInputMode(mode);
    setInput('');
    sendMessage(trimmed);
  }, [isStreaming, cancelSpeech, sendMessage]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    submitText(input, 'text');
  }, [input, submitText]);

  const handleLocaleChange = useCallback((newLocale: SupportedLocale) => {
    setLocale(newLocale);
    setShowLangMenu(false);
  }, [setLocale]);

  const handleToggleVoice = useCallback(() => {
    setVoiceMode(prev => {
      const next = !prev;
      sessionStorage.setItem(VOICE_KEY, next ? '1' : '0');
      if (next) {
        // Prime synthesis from within this user gesture (iOS requirement).
        primeSpeech();
      } else {
        cancelSpeech();
      }
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

  const handleMinimize = useCallback(() => {
    cancelSpeech();
    stopListening();
    setIsOpen(false);
  }, [cancelSpeech, stopListening]);

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-105"
        style={{ backgroundColor: 'var(--c-primary, #1F3A2E)' }}
        aria-label={strings.openLabel}
      >
        <MessageSquare size={22} className="text-parchment" />
      </button>
    );
  }

  return (
    <div className="fixed inset-x-2 bottom-2 h-[70dvh] sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-[350px] sm:h-[450px] z-40 flex flex-col rounded-lg shadow-xl border border-lichen overflow-hidden bg-parchment">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2.5 shrink-0"
        style={{ backgroundColor: 'var(--c-primary, #1F3A2E)' }}
      >
        <span className="text-sm font-medium text-parchment">{strings.headerTitle}</span>
        <div className="flex items-center gap-1">
          {/* Voice mode toggle */}
          {ttsSupported && (
            <button
              onClick={handleToggleVoice}
              className="p-1 text-parchment/60 hover:text-parchment transition-colors"
              aria-label={VOICE_TOGGLE_LABEL}
              aria-pressed={voiceMode}
              title={VOICE_TOGGLE_LABEL}
            >
              {voiceMode ? <Volume2 size={14} /> : <VolumeX size={14} />}
            </button>
          )}
          {/* Language selector */}
          <div className="relative">
            <button
              onClick={() => setShowLangMenu(!showLangMenu)}
              className="p-1 text-parchment/60 hover:text-parchment transition-colors"
              aria-label={strings.languageLabel}
              title={strings.languageLabel}
            >
              <Globe size={14} />
            </button>
            {showLangMenu && (
              <div className="absolute right-0 top-full mt-1 w-32 rounded border border-lichen bg-parchment shadow-lg z-50">
                {SUPPORTED_LOCALES.map(loc => (
                  <button
                    key={loc}
                    onClick={() => handleLocaleChange(loc)}
                    className={`block w-full text-left px-3 py-1.5 text-xs transition-colors ${
                      loc === locale
                        ? 'bg-bark/10 text-bark font-medium'
                        : 'text-ink hover:bg-stone'
                    }`}
                  >
                    {LOCALE_LABELS[loc]}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={handleMinimize}
            className="p-1 text-parchment/60 hover:text-parchment transition-colors"
            aria-label={strings.minimizeLabel}
          >
            <Minus size={16} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-lg px-4 py-2.5 text-sm leading-relaxed bg-stone text-ink">
              {welcomeMessage || strings.welcome}
            </div>
          </div>
        )}
        {messages.map(msg => (
          <AgentMessage key={msg.id} message={msg} />
        ))}
        {activeTool && <AgentToolIndicator toolName={activeTool.tool} />}
        {error && (
          <div className="px-3 py-2 text-xs text-semantic-error bg-semantic-error/10 rounded">
            {error}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="shrink-0 border-t border-lichen px-3 py-2 flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={strings.placeholder}
          disabled={isStreaming}
          className="flex-1 rounded border border-lichen bg-parchment px-3 py-1.5 text-sm text-ink placeholder:text-archive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-1 disabled:opacity-50"
        />
        {sttSupported && (
          <button
            type="button"
            onClick={handleMic}
            disabled={isStreaming}
            className={`flex h-8 w-8 items-center justify-center rounded border border-lichen transition-colors disabled:opacity-30 ${
              listening ? 'text-bark animate-pulse' : 'text-archive hover:bg-stone'
            }`}
            aria-label={MIC_LABEL}
            aria-pressed={listening}
            title={MIC_LABEL}
          >
            <Mic size={14} />
          </button>
        )}
        <button
          type="submit"
          disabled={isStreaming || !input.trim()}
          className="flex h-8 w-8 items-center justify-center rounded transition-colors disabled:opacity-30"
          style={{ backgroundColor: 'var(--c-primary, #1F3A2E)' }}
          aria-label={strings.sendLabel}
        >
          <Send size={14} className="text-parchment" />
        </button>
      </form>
    </div>
  );
}
