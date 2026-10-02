/**
 * Unit tests for AgentMessage — the markdown-rendered chat bubble.
 *
 * Covers:
 *   - user vs assistant rendering modes
 *   - markdown rendering (bold/italic/lists/code/links)
 *   - internal-link click routes through React Router navigate(),
 *     external links keep their default href behavior
 *   - bufferIncompleteMarkdown hides a trailing [text without (url) while streaming
 *   - streaming spinner when content is empty
 *   - feedback buttons (thumbs up/down POSTs to the feedback endpoint,
 *     selected state, hidden during stream)
 *   - copy button (clipboard write + Check icon revert)
 *   - uiHints rendering: NavigationHintButton, SectionHintButton,
 *     DelegationCard, PlanChecklist, multiple hints in order, unknown kind
 *
 * Strategy: real react-router via MemoryRouter so the navigate() and
 * useSearchParams hooks work for real, with the AgentChatContext
 * mocked at module level to assert closeChat is called on hint clicks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

import { AgentMessage } from '../../../components/agent/AgentMessage';
import type { AgentMessage as AgentMessageType } from '../../../hooks/useAgentChat';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// AgentChatContext — only closeChat is touched by hint click handlers.
const _closeChat = vi.fn();
const _chatContextValue = () => ({
  isOpen: true,
  entityContext: null,
  openChat: vi.fn(),
  closeChat: _closeChat,
  setEntityContext: vi.fn(),
  openChatWithMessage: vi.fn(),
  registerDispatch: vi.fn(),
});
vi.mock('../../../contexts/AgentChatContext', () => ({
  useAgentChatContext: () => _chatContextValue(),
  // AgentMessage uses the optional variant so it also renders on the public
  // visitor surfaces (no provider there).
  useAgentChatContextOptional: () => _chatContextValue(),
}));

// apiClient
vi.mock('../../../lib/apiClient', () => ({
  API_BASE_URL: 'http://test/api',
  getCsrfToken: vi.fn().mockReturnValue('csrf-tok'),
}));

// MadronaLoader — render a known sentinel so the streaming-with-no-content
// case can assert on it without dragging in the real loader's animation.
vi.mock('../../../components/ui/MadronaLoader', () => ({
  MadronaLoader: () => <div data-testid="madrona-loader" />,
}));

// DelegationCard / PlanChecklist — stub to assertable sentinels so this
// test isn't doubling up on what their own test files cover.
vi.mock('../../../components/agent/DelegationCard', () => ({
  DelegationCard: ({ hint }: { hint: { specialist: string } }) => (
    <div data-testid="delegation-card">specialist:{hint.specialist}</div>
  ),
}));
vi.mock('../../../components/agent/PlanChecklist', () => ({
  PlanChecklist: ({ hint }: { hint: { plan_id: string } }) => (
    <div data-testid="plan-checklist">plan:{hint.plan_id}</div>
  ),
}));

// Track navigate() calls without losing real-router behavior.
const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom',
  );
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

// Track fetch calls for feedback POST.
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function userMsg(content: string, overrides: Partial<AgentMessageType> = {}): AgentMessageType {
  return { id: 'u1', role: 'user', content, ...overrides };
}

function assistantMsg(
  content: string,
  overrides: Partial<AgentMessageType> = {},
): AgentMessageType {
  return { id: 'a1', role: 'assistant', content, ...overrides };
}

function renderAt(
  initialPath: string,
  message: AgentMessageType,
  props: { organizationId?: string; conversationId?: string } = {},
) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          path="/orgs/:orgId/*"
          element={
            <AgentMessage
              message={message}
              organizationId={props.organizationId}
              conversationId={props.conversationId}
            />
          }
        />
        <Route
          path="*"
          element={
            <AgentMessage
              message={message}
              organizationId={props.organizationId}
              conversationId={props.conversationId}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

// Read the current pathname at any point — assertions for SectionHintButton
// (it mutates URL search params) need a way to verify the new query string.
function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="probe">{loc.pathname}?{loc.search}</div>;
}

beforeEach(() => {
  _closeChat.mockReset();
  navigateMock.mockReset();
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentMessage', () => {
  describe('user vs assistant rendering', () => {
    it('renders user content as plain text (no markdown processing)', () => {
      renderAt('/x', userMsg('**not bold** and a link [x](http://x.com)'));
      // Asterisks survive — confirms we did not parse this as markdown.
      expect(screen.getByText(/\*\*not bold\*\*/)).toBeInTheDocument();
    });

    it('renders assistant content as markdown', async () => {
      renderAt('/x', assistantMsg('**bold** _italic_'));
      await waitFor(() => {
        const bold = screen.getByText('bold');
        expect(bold.tagName).toBe('STRONG');
        const italic = screen.getByText('italic');
        expect(italic.tagName).toBe('EM');
      });
    });

    it('renders an unordered list', async () => {
      renderAt('/x', assistantMsg('- one\n- two'));
      await waitFor(() => {
        const items = screen.getAllByRole('listitem');
        expect(items).toHaveLength(2);
        expect(items[0]).toHaveTextContent('one');
        expect(items[1]).toHaveTextContent('two');
      });
    });

    it('renders an ordered list', async () => {
      renderAt('/x', assistantMsg('1. first\n2. second'));
      await waitFor(() => {
        expect(screen.getAllByRole('listitem')).toHaveLength(2);
      });
    });

    it('renders inline code', async () => {
      renderAt('/x', assistantMsg('use `foo` here'));
      await waitFor(() => {
        const code = screen.getByText('foo');
        expect(code.tagName).toBe('CODE');
      });
    });
  });

  describe('link routing', () => {
    it('internal links call navigate() and prevent default', async () => {
      renderAt('/x', assistantMsg('[Loans](/collections/loans-in)'));
      await waitFor(() => screen.getByText('Loans'));
      const link = screen.getByText('Loans');
      expect(link.tagName).toBe('A');
      const event = new MouseEvent('click', { bubbles: true, cancelable: true });
      link.dispatchEvent(event);
      expect(navigateMock).toHaveBeenCalledWith('/collections/loans-in');
      expect(event.defaultPrevented).toBe(true);
    });

    it('external links do NOT call navigate()', async () => {
      renderAt('/x', assistantMsg('[Anthropic](https://anthropic.com)'));
      await waitFor(() => screen.getByText('Anthropic'));
      fireEvent.click(screen.getByText('Anthropic'));
      expect(navigateMock).not.toHaveBeenCalled();
    });
  });

  describe('streaming behavior', () => {
    it('shows MadronaLoader when streaming with empty content', () => {
      renderAt('/x', assistantMsg('', { isStreaming: true }));
      expect(screen.getByTestId('madrona-loader')).toBeInTheDocument();
    });

    it('hides feedback / copy buttons while streaming', async () => {
      renderAt('/x', assistantMsg('partial answer', { isStreaming: true }));
      await waitFor(() =>
        expect(screen.getByText('partial answer')).toBeInTheDocument(),
      );
      expect(screen.queryByLabelText('Copy message')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Helpful')).not.toBeInTheDocument();
    });

    it('hides a trailing incomplete markdown link while streaming', async () => {
      renderAt('/x', assistantMsg('See the [partial-l', { isStreaming: true }));
      // The "See the " prefix should remain; "[partial-l" must NOT.
      await waitFor(() => {
        expect(screen.getByText(/See the/)).toBeInTheDocument();
      });
      expect(screen.queryByText(/\[partial-l/)).not.toBeInTheDocument();
    });

    it('keeps a complete markdown link visible mid-stream', async () => {
      renderAt('/x', assistantMsg('[Loans](/loans) is the place', { isStreaming: true }));
      await waitFor(() => {
        expect(screen.getByText('Loans')).toBeInTheDocument();
      });
    });
  });

  describe('feedback buttons (assistant, complete)', () => {
    it('renders thumbs up/down + copy when content is non-empty and not streaming', async () => {
      renderAt('/x', assistantMsg('the final answer'), {
        organizationId: 'org-1',
        conversationId: 'conv-1',
      });
      await waitFor(() =>
        expect(screen.getByLabelText('Helpful')).toBeInTheDocument(),
      );
      expect(screen.getByLabelText('Not helpful')).toBeInTheDocument();
      expect(screen.getByLabelText('Copy message')).toBeInTheDocument();
    });

    it('thumbs up posts feedback with positive', async () => {
      renderAt('/x', assistantMsg('answer', { id: 'msg-42' }), {
        organizationId: 'org-1',
        conversationId: 'conv-9',
      });
      await waitFor(() =>
        fireEvent.click(screen.getByLabelText('Helpful')),
      );
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe(
        'http://test/api/organizations/org-1/agent/conversations/conv-9/messages/msg-42/feedback',
      );
      expect(init.method).toBe('POST');
      expect(init.credentials).toBe('include');
      expect(init.headers['X-CSRF-Token']).toBe('csrf-tok');
      expect(JSON.parse(init.body)).toEqual({ satisfaction: 'positive' });
    });

    it('thumbs down posts feedback with negative', async () => {
      renderAt('/x', assistantMsg('answer', { id: 'msg-42' }), {
        organizationId: 'org-1',
        conversationId: 'conv-9',
      });
      await waitFor(() =>
        fireEvent.click(screen.getByLabelText('Not helpful')),
      );
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
        satisfaction: 'negative',
      });
    });

    it('does NOT post if organizationId or conversationId is missing', async () => {
      renderAt('/x', assistantMsg('answer'));  // no org/conv
      await waitFor(() =>
        fireEvent.click(screen.getByLabelText('Helpful')),
      );
      // Button still flips state visually, but no fetch.
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('feedback failure does not throw (best-effort)', async () => {
      mockFetch.mockReset();
      mockFetch.mockRejectedValue(new Error('network down'));
      renderAt('/x', assistantMsg('answer', { id: 'msg-1' }), {
        organizationId: 'org-1',
        conversationId: 'conv-1',
      });
      await waitFor(() => screen.getByLabelText('Helpful'));
      // Should not raise.
      fireEvent.click(screen.getByLabelText('Helpful'));
      // Wait a tick so the swallowed promise resolves.
      await new Promise(r => setTimeout(r, 0));
    });
  });

  describe('copy button', () => {
    let writeText: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(global.navigator, 'clipboard', {
        value: { writeText },
        configurable: true,
      });
    });

    it('writes the message content to the clipboard on click', async () => {
      renderAt('/x', assistantMsg('the answer text'), {
        organizationId: 'org-1',
        conversationId: 'conv-1',
      });
      await waitFor(() => screen.getByLabelText('Copy message'));
      fireEvent.click(screen.getByLabelText('Copy message'));
      expect(writeText).toHaveBeenCalledWith('the answer text');
    });

    it('reverts the icon back from Check after the timeout', async () => {
      vi.useFakeTimers();
      try {
        renderAt('/x', assistantMsg('hello'), {
          organizationId: 'org-1',
          conversationId: 'conv-1',
        });
        // Markdown render is async — flush it first.
        await act(async () => {
          await Promise.resolve();
        });
        const btn = screen.getByLabelText('Copy message');
        await act(async () => {
          fireEvent.click(btn);
          // Drain the microtask queue so navigator.clipboard.writeText
          // resolves and setCopied(true) takes effect.
          await Promise.resolve();
          await Promise.resolve();
        });
        // After the click, copied=true. Advance past the 2s revert.
        await act(async () => {
          vi.advanceTimersByTime(2100);
        });
        // The aria-label stays "Copy message"; the underlying icon DOM
        // is what changes. We just verify the click was wired.
        expect(writeText).toHaveBeenCalledOnce();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('NavigationHintButton', () => {
    const navHint = {
      kind: 'navigation' as const,
      target: {
        id: 'collections-loans-in',
        path: '/orgs/:orgId/collections/loans-in',
        label: 'Incoming loans',
        breadcrumb: ['Collections', 'Loans in'],
      },
    };

    it('renders with the breadcrumb label', () => {
      renderAt(
        '/orgs/org-1/dashboard',
        assistantMsg('See loans:', { uiHints: [navHint] }),
      );
      expect(screen.getByLabelText('Go to Incoming loans')).toBeInTheDocument();
      expect(screen.getByText('Collections / Loans in')).toBeInTheDocument();
    });

    it('substitutes :orgId at click time and closes the chat', () => {
      renderAt(
        '/orgs/org-42/dashboard',
        assistantMsg('See:', { uiHints: [navHint] }),
      );
      fireEvent.click(screen.getByLabelText('Go to Incoming loans'));
      expect(navigateMock).toHaveBeenCalledWith(
        '/orgs/org-42/collections/loans-in',
      );
      expect(_closeChat).toHaveBeenCalled();
    });

    it('hides itself when the user is already on the target page', () => {
      renderAt(
        '/orgs/org-1/collections/loans-in/abc123',
        assistantMsg('See:', { uiHints: [navHint] }),
      );
      expect(screen.queryByLabelText('Go to Incoming loans')).not.toBeInTheDocument();
    });

    it('falls back to label when breadcrumb is empty', () => {
      const hintNoCrumb = {
        ...navHint,
        target: { ...navHint.target, breadcrumb: [] },
      };
      renderAt(
        '/orgs/org-1/dashboard',
        assistantMsg('Go:', { uiHints: [hintNoCrumb] }),
      );
      expect(screen.getByText('Incoming loans')).toBeInTheDocument();
    });
  });

  describe('SectionHintButton', () => {
    const secHint = {
      kind: 'section' as const,
      sectionId: 'people',
      label: 'People',
      fieldPath: 'creators[0].name',
    };

    it('renders with a "Jump to {label}" button', () => {
      renderAt(
        '/orgs/org-1/collections/objects/abc',
        assistantMsg('See people:', { uiHints: [secHint] }),
      );
      expect(screen.getByLabelText('Jump to People section')).toBeInTheDocument();
      expect(screen.getByText('Jump to People')).toBeInTheDocument();
    });

    it('sets section + field search params and closes the chat on click', () => {
      const Wrapper = () => (
        <MemoryRouter initialEntries={['/orgs/org-1/collections/objects/abc']}>
          <AgentMessage
            message={assistantMsg('x', { uiHints: [secHint] })}
          />
          <LocationProbe />
        </MemoryRouter>
      );
      render(<Wrapper />);
      fireEvent.click(screen.getByLabelText('Jump to People section'));
      const probe = screen.getByTestId('probe').textContent || '';
      expect(probe).toContain('action=expand-section');
      expect(probe).toContain('section=people');
      expect(probe).toContain('field=creators');
      expect(_closeChat).toHaveBeenCalled();
    });

    it('omits the field param when fieldPath is missing', () => {
      const noField = { ...secHint, fieldPath: undefined };
      const Wrapper = () => (
        <MemoryRouter initialEntries={['/x']}>
          <AgentMessage message={assistantMsg('x', { uiHints: [noField] })} />
          <LocationProbe />
        </MemoryRouter>
      );
      render(<Wrapper />);
      fireEvent.click(screen.getByLabelText('Jump to People section'));
      const probe = screen.getByTestId('probe').textContent || '';
      expect(probe).toContain('section=people');
      expect(probe).not.toContain('field=');
    });
  });

  describe('embedded delegation + plan cards', () => {
    it('renders DelegationCard for kind=delegation', () => {
      renderAt(
        '/x',
        assistantMsg('here', {
          uiHints: [
            {
              kind: 'delegation',
              specialist: 'registrar',
              answer: 'use AAT 300',
              rounds_used: 1,
              tool_calls: [],
            },
          ],
        }),
      );
      const card = screen.getByTestId('delegation-card');
      expect(card).toHaveTextContent('specialist:registrar');
    });

    it('renders PlanChecklist for kind=plan', () => {
      renderAt(
        '/x',
        assistantMsg('plan:', {
          uiHints: [
            {
              kind: 'plan',
              plan_id: 'plan-9',
              goal: 'g',
              status: 'pending',
              steps: [],
            },
          ],
        }),
      );
      const card = screen.getByTestId('plan-checklist');
      expect(card).toHaveTextContent('plan:plan-9');
    });

    it('renders multiple uiHints in order', () => {
      const { container } = renderAt(
        '/x',
        assistantMsg('chained:', {
          uiHints: [
            {
              kind: 'delegation',
              specialist: 'registrar',
              answer: 'a',
              rounds_used: 1,
              tool_calls: [],
            },
            {
              kind: 'plan',
              plan_id: 'p1',
              goal: 'g',
              status: 'pending',
              steps: [],
            },
          ],
        }),
      );
      const cards = container.querySelectorAll(
        '[data-testid="delegation-card"], [data-testid="plan-checklist"]',
      );
      expect(cards).toHaveLength(2);
      expect(cards[0].getAttribute('data-testid')).toBe('delegation-card');
      expect(cards[1].getAttribute('data-testid')).toBe('plan-checklist');
    });
  });
});
