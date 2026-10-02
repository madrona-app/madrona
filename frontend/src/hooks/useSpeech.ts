/**
 * Speech input (STT) + output (TTS) for the visitor chat widget.
 *
 * Wraps the Web Speech API, feature-detecting recognition and synthesis
 * INDEPENDENTLY so a browser with only one capability still gets it.
 * Nothing here throws when the APIs are absent — callers guard on the
 * returned `sttSupported` / `ttsSupported` flags.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// The Web Speech API types aren't in the default TS DOM lib across all
// target versions, so we describe the slice we use.
interface SpeechRecognitionResultLike {
  0: { transcript: string };
  isFinal: boolean;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

function getSynthesis(): SpeechSynthesis | null {
  if (typeof window === 'undefined') return null;
  return window.speechSynthesis || null;
}

/** Strip markdown links `[text](url)` down to their visible text. */
export function stripMarkdownForSpeech(text: string): string {
  return text
    // [label](url) -> label
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    // bare markdown emphasis/heading markers
    .replace(/[*_`#>]/g, '')
    .trim();
}

interface StartListeningOpts {
  lang: string;
  onInterim?: (text: string) => void;
  onFinal: (text: string) => void;
}

interface UseSpeechReturn {
  sttSupported: boolean;
  ttsSupported: boolean;
  listening: boolean;
  startListening: (opts: StartListeningOpts) => void;
  stopListening: () => void;
  speak: (text: string, lang?: string) => void;
  cancelSpeech: () => void;
  /** Prime iOS speech synthesis from within a user-gesture handler. */
  primeSpeech: () => void;
}

export function useSpeech(): UseSpeechReturn {
  const recognitionCtor = getRecognitionCtor();
  const synthesis = getSynthesis();

  const sttSupported = recognitionCtor !== null;
  const ttsSupported = synthesis !== null;

  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);

  // Voices load asynchronously in most browsers — keep a live cache.
  useEffect(() => {
    if (!synthesis) return;
    const loadVoices = () => {
      voicesRef.current = synthesis.getVoices();
    };
    loadVoices();
    synthesis.addEventListener?.('voiceschanged', loadVoices);
    return () => {
      synthesis.removeEventListener?.('voiceschanged', loadVoices);
    };
  }, [synthesis]);

  const stopListening = useCallback(() => {
    const rec = recognitionRef.current;
    if (rec) {
      try {
        rec.stop();
      } catch {
        // already stopped
      }
    }
    setListening(false);
  }, []);

  const startListening = useCallback(
    ({ lang, onInterim, onFinal }: StartListeningOpts) => {
      const Ctor = recognitionCtor;
      if (!Ctor) return;

      // Tear down any in-flight recognition before starting a new one.
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // ignore
        }
      }

      const rec = new Ctor();
      rec.lang = lang;
      rec.continuous = false;
      rec.interimResults = true;

      rec.onresult = (event: SpeechRecognitionEventLike) => {
        let interim = '';
        let final = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const transcript = result[0]?.transcript ?? '';
          if (result.isFinal) {
            final += transcript;
          } else {
            interim += transcript;
          }
        }
        if (interim && onInterim) onInterim(interim);
        if (final) {
          onFinal(final.trim());
        }
      };
      rec.onerror = () => {
        setListening(false);
      };
      rec.onend = () => {
        setListening(false);
      };

      recognitionRef.current = rec;
      try {
        rec.start();
        setListening(true);
      } catch {
        setListening(false);
      }
    },
    [recognitionCtor],
  );

  const cancelSpeech = useCallback(() => {
    synthesis?.cancel();
  }, [synthesis]);

  const speak = useCallback(
    (text: string, lang?: string) => {
      if (!synthesis) return;
      const clean = stripMarkdownForSpeech(text);
      if (!clean) return;

      // Interrupt anything currently being spoken.
      synthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(clean);
      if (lang) utterance.lang = lang;

      // Prefer a voice whose language prefix matches the request.
      if (lang) {
        const prefix = lang.split('-')[0].toLowerCase();
        const voices = voicesRef.current.length ? voicesRef.current : synthesis.getVoices();
        const match = voices.find(v => v.lang?.toLowerCase().startsWith(prefix));
        if (match) utterance.voice = match;
      }

      synthesis.speak(utterance);
    },
    [synthesis],
  );

  const primeSpeech = useCallback(() => {
    if (!synthesis) return;
    try {
      // A zero-length utterance from within a user gesture unlocks
      // synthesis on iOS Safari, which otherwise stays silent.
      const primer = new SpeechSynthesisUtterance('');
      primer.volume = 0;
      synthesis.speak(primer);
    } catch {
      // non-critical
    }
  }, [synthesis]);

  // Cancel any ongoing synthesis + recognition when the hook unmounts.
  useEffect(() => {
    return () => {
      synthesis?.cancel();
      const rec = recognitionRef.current;
      if (rec) {
        try {
          rec.abort();
        } catch {
          // ignore
        }
      }
    };
  }, [synthesis]);

  return {
    sttSupported,
    ttsSupported,
    listening,
    startListening,
    stopListening,
    speak,
    cancelSpeech,
    primeSpeech,
  };
}
