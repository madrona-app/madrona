import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useEffect, useRef } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { GuideOnboardingWelcome } from '../../components/onboarding/GuideOnboardingWelcome';
import {
  AgentChatProvider,
  useAgentChatContext,
} from '../../contexts/AgentChatContext';
import { GUIDE_ONBOARDING_SHORTCUTS } from '../../components/onboarding/guideOnboardingShortcuts';

function ChatStateProbe() {
  const { isOpen, registerDispatch } = useAgentChatContext();
  const lastRef = useRef<string>('');
  useEffect(() => {
    registerDispatch((msg) => {
      lastRef.current = msg;
    });
    return () => registerDispatch(null);
  }, [registerDispatch]);
  return (
    <div
      data-testid="chat-state"
      data-pending={lastRef.current}
      data-open={isOpen ? '1' : '0'}
    />
  );
}

function renderWelcome(onDismiss: () => void = vi.fn()) {
  return render(
    <AgentChatProvider>
      <GuideOnboardingWelcome isOpen onDismiss={onDismiss} />
      <ChatStateProbe />
    </AgentChatProvider>,
  );
}

describe('GuideOnboardingWelcome', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders the welcome title and all shortcuts', () => {
    renderWelcome();
    expect(
      screen.getByText(/Welcome — what would you like help with/),
    ).toBeInTheDocument();
    for (const shortcut of GUIDE_ONBOARDING_SHORTCUTS) {
      expect(screen.getByText(shortcut.label)).toBeInTheDocument();
    }
  });

  it('hands the shortcut prompt to the Guide chat and dismisses', () => {
    const onDismiss = vi.fn();
    renderWelcome(onDismiss);
    const shortcut = GUIDE_ONBOARDING_SHORTCUTS[0];

    fireEvent.click(screen.getByText(shortcut.label));

    const state = screen.getByTestId('chat-state');
    expect(state.getAttribute('data-pending')).toBe(shortcut.prompt);
    expect(state.getAttribute('data-open')).toBe('1');
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismiss button closes without opening chat', () => {
    const onDismiss = vi.fn();
    renderWelcome(onDismiss);
    fireEvent.click(screen.getByRole('button', { name: /Dismiss welcome/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('chat-state').getAttribute('data-pending')).toBe('');
    expect(screen.getByTestId('chat-state').getAttribute('data-open')).toBe('0');
  });

  it('"Explore on my own" dismisses without opening chat', () => {
    const onDismiss = vi.fn();
    renderWelcome(onDismiss);
    fireEvent.click(screen.getByText('Explore on my own'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('chat-state').getAttribute('data-open')).toBe('0');
  });

  it('backdrop click dismisses without opening chat', () => {
    const onDismiss = vi.fn();
    renderWelcome(onDismiss);
    // The welcome is portaled to document.body — query from there, not
    // the render container.
    const backdrop = document.body.querySelector('.bg-ink\\/20');
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('returns null when isOpen is false', () => {
    const { container } = render(
      <AgentChatProvider>
        <GuideOnboardingWelcome isOpen={false} onDismiss={vi.fn()} />
      </AgentChatProvider>,
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
