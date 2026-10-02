import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VisitorChatWidget } from '../../../pages/discover/components/VisitorChatWidget';

// jsdom exposes neither SpeechRecognition nor speechSynthesis, so this file
// verifies the widget degrades gracefully: the voice controls must be absent
// when the browser can't support them.

// This test environment does not provide Web Storage, so back it with an
// in-memory implementation (matches the pre-existing gap in useVisitorChat).
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string) { return this.store.has(key) ? this.store.get(key)! : null; }
  setItem(key: string, value: string) { this.store.set(key, String(value)); }
  removeItem(key: string) { this.store.delete(key); }
  clear() { this.store.clear(); }
  key(i: number) { return Array.from(this.store.keys())[i] ?? null; }
  get length() { return this.store.size; }
}

function installStorage() {
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    Object.defineProperty(window, name, {
      configurable: true,
      writable: true,
      value: new MemoryStorage(),
    });
  }
}

describe('VisitorChatWidget — voice controls gating', () => {
  beforeEach(() => {
    installStorage();
    // Start expanded so the header + input row render.
    window.sessionStorage.setItem('madrona-visitor-chat-open', '1');
  });

  afterEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it('renders the expanded panel with a send button', () => {
    render(<VisitorChatWidget orgSlug="museum-org" />);
    expect(screen.getByLabelText('Send message')).toBeInTheDocument();
  });

  it('hides the voice-mode toggle when speech synthesis is unsupported', () => {
    render(<VisitorChatWidget orgSlug="museum-org" />);
    expect(screen.queryByLabelText('Spoken responses')).not.toBeInTheDocument();
  });

  it('hides the mic button when speech recognition is unsupported', () => {
    render(<VisitorChatWidget orgSlug="museum-org" />);
    expect(screen.queryByLabelText('Speak your question')).not.toBeInTheDocument();
  });
});
