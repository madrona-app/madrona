import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSpeech, stripMarkdownForSpeech } from '../../hooks/useSpeech';

// jsdom provides neither the Web Speech recognition nor synthesis APIs,
// so we install lightweight fakes per-test and delete them afterwards.

interface FakeUtterance {
  text: string;
  lang?: string;
  voice?: unknown;
  volume?: number;
}

function installSynthesis() {
  const spoken: FakeUtterance[] = [];
  const cancel = vi.fn();
  const voices = [
    { lang: 'en-US', name: 'English US' },
    { lang: 'es-ES', name: 'Spanish' },
  ];
  const synthesis = {
    speak: vi.fn((u: FakeUtterance) => spoken.push(u)),
    cancel,
    getVoices: vi.fn(() => voices),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  (window as unknown as { speechSynthesis: unknown }).speechSynthesis = synthesis;
  // SpeechSynthesisUtterance constructor that records its input.
  (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance =
    class {
      text: string;
      lang?: string;
      voice?: unknown;
      volume?: number;
      constructor(text: string) {
        this.text = text;
      }
    };
  (globalThis as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance =
    (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance;
  return { synthesis, spoken, cancel, voices };
}

function uninstallSpeech() {
  delete (window as unknown as { speechSynthesis?: unknown }).speechSynthesis;
  delete (window as unknown as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance;
  delete (globalThis as unknown as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance;
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
}

// A controllable fake recognition instance so tests can drive onresult.
class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  constructor() {
    FakeRecognition.instances.push(this);
  }
}

function installRecognition() {
  FakeRecognition.instances = [];
  (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
  return FakeRecognition;
}

describe('stripMarkdownForSpeech', () => {
  it('speaks the link label, not the URL', () => {
    const out = stripMarkdownForSpeech('See [the vase](https://example.com/vase) upstairs.');
    expect(out).toBe('See the vase upstairs.');
  });

  it('drops emphasis and heading markers', () => {
    expect(stripMarkdownForSpeech('## **Bold** _title_')).toBe('Bold title');
  });
});

describe('useSpeech — unsupported environment', () => {
  beforeEach(() => uninstallSpeech());
  afterEach(() => uninstallSpeech());

  it('reports both capabilities false when the APIs are absent', () => {
    const { result } = renderHook(() => useSpeech());
    expect(result.current.sttSupported).toBe(false);
    expect(result.current.ttsSupported).toBe(false);
  });

  it('does not throw when speak/startListening are called without APIs', () => {
    const { result } = renderHook(() => useSpeech());
    expect(() => {
      act(() => {
        result.current.speak('hello', 'en');
        result.current.startListening({ lang: 'en', onFinal: () => {} });
        result.current.primeSpeech();
        result.current.cancelSpeech();
      });
    }).not.toThrow();
  });
});

describe('useSpeech — synthesis', () => {
  beforeEach(() => uninstallSpeech());
  afterEach(() => uninstallSpeech());

  it('detects TTS support and strips markdown links from spoken text', () => {
    const { spoken } = installSynthesis();
    const { result } = renderHook(() => useSpeech());
    expect(result.current.ttsSupported).toBe(true);

    act(() => {
      result.current.speak('Visit [our shop](https://example.com).', 'en');
    });

    expect(spoken).toHaveLength(1);
    expect(spoken[0].text).toBe('Visit our shop.');
  });

  it('picks a voice matching the requested language prefix', () => {
    const { spoken } = installSynthesis();
    const { result } = renderHook(() => useSpeech());

    act(() => {
      result.current.speak('Hola', 'es');
    });

    expect(spoken[0].voice).toMatchObject({ lang: 'es-ES' });
  });

  it('cancels ongoing synthesis on unmount', () => {
    const { cancel } = installSynthesis();
    const { unmount } = renderHook(() => useSpeech());
    cancel.mockClear();
    unmount();
    expect(cancel).toHaveBeenCalled();
  });

  it('primeSpeech queues a zero-length utterance', () => {
    const { synthesis } = installSynthesis();
    const { result } = renderHook(() => useSpeech());
    act(() => {
      result.current.primeSpeech();
    });
    expect(synthesis.speak).toHaveBeenCalled();
  });
});

describe('useSpeech — recognition', () => {
  beforeEach(() => uninstallSpeech());
  afterEach(() => uninstallSpeech());

  it('detects STT support and drives interim + final callbacks', () => {
    const Rec = installRecognition();
    const { result } = renderHook(() => useSpeech());
    expect(result.current.sttSupported).toBe(true);

    const onInterim = vi.fn();
    const onFinal = vi.fn();
    act(() => {
      result.current.startListening({ lang: 'en-US', onInterim, onFinal });
    });

    const rec = Rec.instances[0];
    expect(rec.start).toHaveBeenCalled();
    expect(rec.lang).toBe('en-US');
    expect(rec.interimResults).toBe(true);
    expect(rec.continuous).toBe(false);
    expect(result.current.listening).toBe(true);

    act(() => {
      rec.onresult?.({
        resultIndex: 0,
        results: { length: 1, 0: { 0: { transcript: 'where is' }, isFinal: false } },
      });
    });
    expect(onInterim).toHaveBeenCalledWith('where is');

    act(() => {
      rec.onresult?.({
        resultIndex: 0,
        results: { length: 1, 0: { 0: { transcript: 'where is the exit' }, isFinal: true } },
      });
    });
    expect(onFinal).toHaveBeenCalledWith('where is the exit');
  });

  it('stopListening stops the active recognition', () => {
    const Rec = installRecognition();
    const { result } = renderHook(() => useSpeech());
    act(() => {
      result.current.startListening({ lang: 'en', onFinal: () => {} });
    });
    act(() => {
      result.current.stopListening();
    });
    expect(Rec.instances[0].stop).toHaveBeenCalled();
    expect(result.current.listening).toBe(false);
  });

  it('aborts recognition on unmount', () => {
    const Rec = installRecognition();
    const { result, unmount } = renderHook(() => useSpeech());
    act(() => {
      result.current.startListening({ lang: 'en', onFinal: () => {} });
    });
    unmount();
    expect(Rec.instances[0].abort).toHaveBeenCalled();
  });
});
