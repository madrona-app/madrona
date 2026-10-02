import { describe, it, expect, vi } from 'vitest';
import { useEffect, useRef } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { AskGuideButton } from '../../components/guide/AskGuideButton';
import { AuthContext } from '../../contexts/AuthContext';
import { AgentChatProvider, useAgentChatContext } from '../../contexts/AgentChatContext';

/**
 * Bubble context state up so tests can assert on isOpen + dispatched messages.
 * Registers a dispatch fn so openChatWithMessage routes synchronously instead
 * of queuing — captured messages are written to data-pending.
 */
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

function renderButton(props: React.ComponentProps<typeof AskGuideButton>) {
  return render(
    <AgentChatProvider>
      <AskGuideButton {...props} />
      <ChatStateProbe />
    </AgentChatProvider>,
  );
}

describe('AskGuideButton', () => {
  it('renders the label and a default aria-label', () => {
    renderButton({ prompt: 'What is a procedure?' });
    expect(screen.getByRole('button', { name: 'Ask Guide' })).toBeInTheDocument();
  });

  it('opens the chat with the prompt queued when clicked', () => {
    renderButton({ prompt: 'Explain condition reports' });
    fireEvent.click(screen.getByRole('button', { name: 'Ask Guide' }));

    const state = screen.getByTestId('chat-state');
    expect(state.getAttribute('data-pending')).toBe('Explain condition reports');
    expect(state.getAttribute('data-open')).toBe('1');
  });

  it('stops event propagation so parent handlers do not also fire', () => {
    const parentClick = vi.fn();
    render(
      <AgentChatProvider>
        <div onClick={parentClick}>
          <AskGuideButton prompt="hi" />
        </div>
        <ChatStateProbe />
      </AgentChatProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ask Guide' }));
    expect(parentClick).not.toHaveBeenCalled();
    expect(screen.getByTestId('chat-state').getAttribute('data-pending')).toBe('hi');
  });

  it('honors a custom label and ariaLabel', () => {
    renderButton({
      prompt: 'why?',
      label: 'Ask Guide why',
      ariaLabel: 'Ask Guide why this requirement is blocking',
    });
    const btn = screen.getByRole('button', { name: 'Ask Guide why this requirement is blocking' });
    expect(btn).toBeInTheDocument();
    // "Guide" renders as its own wordmark span, so the visible label spans
    // multiple nodes — assert the concatenated text.
    expect(btn.textContent).toBe('Ask Guide why');
  });

  it('renders the inline variant without chip padding', () => {
    const { container } = renderButton({ prompt: 'x', variant: 'inline' });
    const btn = container.querySelector('button');
    // Inline variant uses `underline` rather than chip background classes
    expect(btn?.className).toContain('underline');
    expect(btn?.className).not.toContain('border-lichen');
  });
});

/**
 * A deployment with no agent configured serves 503 "Agent is not enabled"
 * from every agent route, so this chip would open the chat panel onto an
 * error. AppShell already withholds the Ask Guide FAB on exactly that
 * signal; the chip is the same affordance docked next to a blocker and had
 * never consulted it, so requirement cards and field tooltips kept offering
 * it. The E2E button sweep caught it as a 5xx on six workspace pages.
 */
describe('AskGuideButton — agent availability', () => {
  const renderWithAuth = (agentEnabled: boolean | undefined) =>
    render(
      <AuthContext.Provider value={{ user: { agent_enabled: agentEnabled } } as never}>
        <AgentChatProvider>
          <AskGuideButton prompt="why is this blocked?" />
        </AgentChatProvider>
      </AuthContext.Provider>,
    );

  it('renders nothing when the deployment has no agent', () => {
    renderWithAuth(false);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders when the agent is available', () => {
    renderWithAuth(true);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('renders when availability is unknown, rather than hiding the affordance', () => {
    // Only an explicit false hides it; an older backend that omits the field
    // should keep working exactly as before.
    renderWithAuth(undefined);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('still renders with no AuthProvider at all', () => {
    // The chip is presentational and appears inside cards and tooltips that
    // are rendered in isolation. Requiring the provider threw and took twelve
    // unrelated tests down with it.
    render(
      <AgentChatProvider>
        <AskGuideButton prompt="why is this blocked?" />
      </AgentChatProvider>,
    );
    expect(screen.getByRole('button')).toBeInTheDocument();
  });
});
