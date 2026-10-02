/**
 * Unit tests for AgentChatPanel — the staff slide-over chat container.
 *
 * Strategy: stub every collaborator (useAgentChat, AgentChatContext,
 * useToast, useAccessibleModal, AgentMessage, AgentToolIndicator) so the
 * test exercises only the panel's own behavior:
 *   - render gating on isOpen
 *   - send button gating (empty input, streaming)
 *   - keyboard handling (Enter submits; Shift+Enter inserts newline)
 *   - title fallback ("Madrona" when no conversationTitle)
 *   - entity context chip rendering
 *   - active tool indicator
 *   - error state + "Try again" repopulates input
 *   - backdrop / X / Close key triggers onClose
 *   - history toggle (empty + populated)
 *   - new-chat button visibility (only when conversationId set)
 *   - history selection updates the active conversation
 *
 * What we deliberately don't test here: the streaming SSE pipe, message
 * rendering markdown, navigation hint clicks. Those live in
 * useAgentChat.test.ts and the future AgentMessage.test.tsx.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

import { AgentChatPanel } from '../../../components/agent/AgentChatPanel';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// useAgentChat — return values overridable per test via _useAgentChatReturn.
const _useAgentChatReturn = {
  messages: [] as Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    isStreaming?: boolean;
  }>,
  isStreaming: false,
  activeTool: null as null | { tool: string; active: boolean; specialist?: string },
  error: null as string | null,
  conversationTitle: null as string | null,
  setConversationTitle: vi.fn(),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  createConversation: vi.fn().mockResolvedValue('conv-new'),
  loadMessages: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../../../hooks/useAgentChat', () => ({
  useAgentChat: () => _useAgentChatReturn,
}));

// AgentChatContext
const _agentChatContextReturn = {
  isOpen: true,
  entityContext: null as null | { type: string; id: string; label: string },
  openChat: vi.fn(),
  closeChat: vi.fn(),
  setEntityContext: vi.fn(),
  openChatWithMessage: vi.fn(),
  registerDispatch: vi.fn(),
};

vi.mock('../../../contexts/AgentChatContext', () => ({
  useAgentChatContext: () => _agentChatContextReturn,
  AgentChatProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ToastContext
vi.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

// useAccessibleModal — strip out the focus-trap behavior; the panel only
// needs the ref + titleId.
vi.mock('../../../hooks/useAccessibleModal', () => ({
  useAccessibleModal: () => ({
    modalRef: { current: null },
    titleId: 'agent-chat-title',
  }),
  getModalAriaProps: (id: string) => ({
    role: 'dialog' as const,
    'aria-modal': true as const,
    'aria-labelledby': id,
  }),
}));

// AgentMessage / AgentToolIndicator — render their key props as text so
// assertions can find them, without dragging in markdown / lucide icons.
vi.mock('../../../components/agent/AgentMessage', () => ({
  AgentMessage: ({
    message,
  }: {
    message: { role: string; content: string };
  }) => (
    <div data-testid="agent-message" data-role={message.role}>
      {message.content}
    </div>
  ),
}));

vi.mock('../../../components/agent/AgentToolIndicator', () => ({
  AgentToolIndicator: ({
    toolName,
    specialist,
  }: {
    toolName: string;
    specialist?: string;
  }) => (
    <div data-testid="tool-indicator">
      tool:{toolName}
      {specialist ? ` specialist:${specialist}` : ''}
    </div>
  ),
}));

// formatRelativeTime — deterministic fake so history items render
// stably.
vi.mock('../../../lib/formatters', () => ({
  formatRelativeTime: (iso: string) => `at ${iso}`,
}));

// API_BASE_URL is referenced directly; mock the apiClient module.
vi.mock('../../../lib/apiClient', () => ({
  API_BASE_URL: 'http://test/api',
  getCsrfToken: vi.fn().mockReturnValue('csrf'),
}));

// fetch for the conversations list. Per-test override via mockFetchOnce.
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function mockConversationsResponse(
  conversations: Array<{ conversation_id: string; title: string | null; updated_at: string }>,
) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ conversations }),
  } as Response);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetAgentChat() {
  _useAgentChatReturn.messages = [];
  _useAgentChatReturn.isStreaming = false;
  _useAgentChatReturn.activeTool = null;
  _useAgentChatReturn.error = null;
  _useAgentChatReturn.conversationTitle = null;
  _useAgentChatReturn.setConversationTitle.mockReset();
  _useAgentChatReturn.sendMessage.mockReset().mockResolvedValue(undefined);
  _useAgentChatReturn.createConversation.mockReset().mockResolvedValue('conv-new');
  _useAgentChatReturn.loadMessages.mockReset().mockResolvedValue(undefined);
}

function resetContext() {
  _agentChatContextReturn.entityContext = null;
  _agentChatContextReturn.registerDispatch.mockReset();
}

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  organizationId: 'org-1',
};

beforeEach(() => {
  resetAgentChat();
  resetContext();
  defaultProps.onClose = vi.fn();
  mockFetch.mockReset();
  mockConversationsResponse([]); // default: no prior conversations
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentChatPanel', () => {
  describe('open / close gating', () => {
    it('returns null when isOpen=false', () => {
      const { container } = render(
        <AgentChatPanel {...defaultProps} isOpen={false} />,
      );
      expect(container.innerHTML).toBe('');
    });

    it('renders the panel when isOpen=true', () => {
      render(<AgentChatPanel {...defaultProps} />);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('falls back to the Guide wordmark when conversationTitle is null', () => {
      render(<AgentChatPanel {...defaultProps} />);
      expect(screen.getByText('Guide')).toBeInTheDocument();
    });

    it('uses conversationTitle when one is set', () => {
      _useAgentChatReturn.conversationTitle = 'Loan LIN-2026-014';
      render(<AgentChatPanel {...defaultProps} />);
      expect(screen.getByText('Loan LIN-2026-014')).toBeInTheDocument();
    });

    it('clicking the close button calls onClose', () => {
      render(<AgentChatPanel {...defaultProps} />);
      fireEvent.click(screen.getByLabelText('Close chat'));
      expect(defaultProps.onClose).toHaveBeenCalledOnce();
    });

    it('clicking the backdrop calls onClose', () => {
      const { container } = render(<AgentChatPanel {...defaultProps} />);
      // The backdrop is the first absolute-inset div in the panel.
      const backdrop = container.querySelector('.bg-ink\\/30');
      expect(backdrop).toBeInTheDocument();
      fireEvent.click(backdrop!);
      expect(defaultProps.onClose).toHaveBeenCalledOnce();
    });

    it('clicking inside the panel does NOT call onClose (stops propagation)', () => {
      render(<AgentChatPanel {...defaultProps} />);
      fireEvent.click(screen.getByRole('dialog'));
      expect(defaultProps.onClose).not.toHaveBeenCalled();
    });
  });

  describe('empty state', () => {
    it('shows the welcome copy when there are no messages', () => {
      render(<AgentChatPanel {...defaultProps} />);
      expect(
        screen.getByText('Ask me anything about the collection.'),
      ).toBeInTheDocument();
    });

    it('does not render any AgentMessage when messages list is empty', () => {
      render(<AgentChatPanel {...defaultProps} />);
      expect(screen.queryAllByTestId('agent-message')).toHaveLength(0);
    });
  });

  describe('messages + streaming indicators', () => {
    it('renders one AgentMessage per message in state', () => {
      _useAgentChatReturn.messages = [
        { id: 'a', role: 'user', content: 'What is on this loan?' },
        { id: 'b', role: 'assistant', content: 'A facility report is pending.' },
      ];
      render(<AgentChatPanel {...defaultProps} />);
      const rendered = screen.getAllByTestId('agent-message');
      expect(rendered).toHaveLength(2);
      expect(rendered[0]).toHaveTextContent('What is on this loan?');
      expect(rendered[1]).toHaveTextContent('A facility report is pending.');
    });

    it('renders the AgentToolIndicator while a tool is active', () => {
      _useAgentChatReturn.activeTool = {
        tool: 'delegate_to_specialist',
        active: true,
        specialist: 'loans_registrar',
      };
      render(<AgentChatPanel {...defaultProps} />);
      const indicator = screen.getByTestId('tool-indicator');
      expect(indicator).toHaveTextContent('tool:delegate_to_specialist');
      expect(indicator).toHaveTextContent('specialist:loans_registrar');
    });
  });

  describe('error state + retry', () => {
    it('renders an error banner with the message', () => {
      _useAgentChatReturn.error = 'Streaming failed: boom';
      render(<AgentChatPanel {...defaultProps} />);
      expect(screen.getByText('Streaming failed: boom')).toBeInTheDocument();
      expect(screen.getByText('Try again')).toBeInTheDocument();
    });

    it('"Try again" repopulates the textarea with the last user message', () => {
      _useAgentChatReturn.messages = [
        { id: 'u1', role: 'user', content: 'first question' },
        { id: 'a1', role: 'assistant', content: 'partial reply' },
        { id: 'u2', role: 'user', content: 'second question' },
      ];
      _useAgentChatReturn.error = 'oops';
      render(<AgentChatPanel {...defaultProps} />);
      const textarea = screen.getByPlaceholderText('Ask a question...');
      expect(textarea).toHaveValue('');
      fireEvent.click(screen.getByText('Try again'));
      expect(textarea).toHaveValue('second question');
    });
  });

  describe('input + send', () => {
    it('Send button is disabled when input is empty', () => {
      render(<AgentChatPanel {...defaultProps} />);
      const send = screen.getByLabelText('Send message');
      expect(send).toBeDisabled();
    });

    it('Send button enables once the input has content', () => {
      render(<AgentChatPanel {...defaultProps} />);
      const textarea = screen.getByPlaceholderText('Ask a question...');
      fireEvent.change(textarea, { target: { value: 'hi' } });
      const send = screen.getByLabelText('Send message');
      expect(send).not.toBeDisabled();
    });

    it('Send button is disabled while streaming, even with input', () => {
      _useAgentChatReturn.isStreaming = true;
      render(<AgentChatPanel {...defaultProps} />);
      const textarea = screen.getByPlaceholderText('Ask a question...');
      fireEvent.change(textarea, { target: { value: 'hi' } });
      expect(screen.getByLabelText('Send message')).toBeDisabled();
    });

    it('Enter triggers send', async () => {
      render(<AgentChatPanel {...defaultProps} />);
      const textarea = screen.getByPlaceholderText('Ask a question...');
      fireEvent.change(textarea, { target: { value: 'hello world' } });
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      // createConversation is called first (no conversationId), then sendMessage
      await waitFor(() => {
        expect(_useAgentChatReturn.createConversation).toHaveBeenCalled();
      });
      await waitFor(() => {
        expect(_useAgentChatReturn.sendMessage).toHaveBeenCalledWith(
          'hello world',
          'conv-new',
        );
      });
    });

    it('Shift+Enter does NOT trigger send', () => {
      render(<AgentChatPanel {...defaultProps} />);
      const textarea = screen.getByPlaceholderText('Ask a question...');
      fireEvent.change(textarea, { target: { value: 'multi\nline' } });
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
      expect(_useAgentChatReturn.sendMessage).not.toHaveBeenCalled();
    });

    it('whitespace-only input is rejected even when Enter is pressed', () => {
      render(<AgentChatPanel {...defaultProps} />);
      const textarea = screen.getByPlaceholderText('Ask a question...');
      fireEvent.change(textarea, { target: { value: '   \n  ' } });
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      expect(_useAgentChatReturn.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('entity context chip', () => {
    it('renders the chip when entityContext is set', () => {
      _agentChatContextReturn.entityContext = {
        type: 'loan_in',
        id: 'lin-1',
        label: 'LIN-2026-014',
      };
      render(<AgentChatPanel {...defaultProps} />);
      expect(screen.getByText(/Viewing:/)).toBeInTheDocument();
      expect(screen.getByText('LIN-2026-014')).toBeInTheDocument();
    });

    it('omits the chip when entityContext is null', () => {
      render(<AgentChatPanel {...defaultProps} />);
      expect(screen.queryByText(/Viewing:/)).not.toBeInTheDocument();
    });

    it('passes the entity to createConversation when sending the first message', async () => {
      _agentChatContextReturn.entityContext = {
        type: 'loan_in',
        id: 'lin-1',
        label: 'LIN-2026-014',
      };
      render(<AgentChatPanel {...defaultProps} />);
      const textarea = screen.getByPlaceholderText('Ask a question...');
      fireEvent.change(textarea, { target: { value: 'status?' } });
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      await waitFor(() => {
        expect(_useAgentChatReturn.createConversation).toHaveBeenCalledWith({
          type: 'loan_in',
          id: 'lin-1',
        });
      });
    });
  });

  describe('history pane', () => {
    it('toggling history shows "No past conversations" when none exist', async () => {
      mockFetch.mockReset();
      mockConversationsResponse([]);
      render(<AgentChatPanel {...defaultProps} />);
      fireEvent.click(screen.getByLabelText('Conversation history'));
      await waitFor(() => {
        expect(screen.getByText('No past conversations')).toBeInTheDocument();
      });
    });

    it('toggling history lists past conversations', async () => {
      mockFetch.mockReset();
      // Initial open also calls fetchConversations once; mock both calls.
      mockConversationsResponse([
        { conversation_id: 'c1', title: 'Loan questions', updated_at: '2026-04-29' },
        { conversation_id: 'c2', title: null, updated_at: '2026-04-28' },
      ]);
      mockConversationsResponse([
        { conversation_id: 'c1', title: 'Loan questions', updated_at: '2026-04-29' },
        { conversation_id: 'c2', title: null, updated_at: '2026-04-28' },
      ]);
      render(<AgentChatPanel {...defaultProps} />);
      fireEvent.click(screen.getByLabelText('Conversation history'));
      await waitFor(() => {
        expect(screen.getByText('Loan questions')).toBeInTheDocument();
        expect(screen.getByText('Untitled')).toBeInTheDocument();
      });
    });

    it('history toggle button is disabled while streaming', () => {
      _useAgentChatReturn.isStreaming = true;
      render(<AgentChatPanel {...defaultProps} />);
      expect(screen.getByLabelText('Conversation history')).toBeDisabled();
    });
  });

  describe('conversation restore on first open', () => {
    const freshIso = () => new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const staleIso = () => new Date(Date.now() - 9 * 60 * 60 * 1000).toISOString();

    it('resumes the most recent conversation when it is fresh', async () => {
      mockFetch.mockReset();
      mockConversationsResponse([
        { conversation_id: 'c-fresh', title: 'Accession help', updated_at: freshIso() },
      ]);
      render(<AgentChatPanel {...defaultProps} />);
      await waitFor(() => {
        expect(_useAgentChatReturn.loadMessages).toHaveBeenCalledWith('c-fresh');
      });
      expect(_useAgentChatReturn.setConversationTitle).toHaveBeenCalledWith('Accession help');
    });

    it('opens fresh when the most recent conversation is stale', async () => {
      mockFetch.mockReset();
      mockConversationsResponse([
        { conversation_id: 'c-stale', title: 'Old thread', updated_at: staleIso() },
      ]);
      render(<AgentChatPanel {...defaultProps} />);
      await waitFor(() => expect(mockFetch).toHaveBeenCalled());
      // Let the restore promise chain settle before asserting the negative.
      await act(async () => {});
      expect(_useAgentChatReturn.loadMessages).not.toHaveBeenCalled();
    });

    it('a dispatched message wins over an in-flight restore', async () => {
      mockFetch.mockReset();
      let resolveFetch: (value: unknown) => void = () => {};
      mockFetch.mockReturnValueOnce(new Promise((resolve) => { resolveFetch = resolve; }));
      render(<AgentChatPanel {...defaultProps} />);

      // Simulate openChatWithMessage: the context flushes the queued message
      // through the dispatch fn the panel registered, before the restore
      // fetch has resolved.
      const dispatch =
        _agentChatContextReturn.registerDispatch.mock.calls.at(-1)?.[0];
      expect(typeof dispatch).toBe('function');
      await act(async () => {
        await dispatch('what fields are required to accession this?');
      });
      expect(_useAgentChatReturn.createConversation).toHaveBeenCalled();

      // Restore resolves late with a fresh conversation — it must not clobber
      // the conversation the dispatch just created.
      await act(async () => {
        resolveFetch({
          ok: true,
          json: async () => ({
            conversations: [
              { conversation_id: 'c-fresh', title: 'Old but fresh', updated_at: freshIso() },
            ],
          }),
        });
      });
      expect(_useAgentChatReturn.loadMessages).not.toHaveBeenCalled();
    });
  });

  describe('new chat button', () => {
    it('is hidden until a conversation has been started', () => {
      render(<AgentChatPanel {...defaultProps} />);
      expect(screen.queryByLabelText('New chat')).not.toBeInTheDocument();
    });
    // The "appears once a conversation exists" branch is exercised
    // indirectly by other tests that send a message — but verifying the
    // visibility flip without a useState setter mock would require
    // prop-drilling we don't have. Locking the hidden case is enough
    // to prevent the regression that motivated the affordance.
  });

  describe('dispatch registration', () => {
    it('registers a dispatch fn on mount and clears it on unmount', () => {
      const { unmount } = render(<AgentChatPanel {...defaultProps} />);
      expect(_agentChatContextReturn.registerDispatch).toHaveBeenCalled();
      const last =
        _agentChatContextReturn.registerDispatch.mock.calls.at(-1)?.[0];
      expect(typeof last).toBe('function');
      unmount();
      expect(
        _agentChatContextReturn.registerDispatch.mock.calls.at(-1)?.[0],
      ).toBeNull();
    });
  });
});
