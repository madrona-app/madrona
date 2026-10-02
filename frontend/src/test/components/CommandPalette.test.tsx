import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useEffect, useRef } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { CommandPalette } from '../../components/palette/CommandPalette';
import { AgentChatProvider, useAgentChatContext } from '../../contexts/AgentChatContext';
import { WorkProvider } from '../../contexts/WorkContext';

// Mock auth + permissions so every catalog entry is reachable.
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ hasAppAccess: () => true }),
}));
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: () => true,
    hasAnyPermission: () => true,
    hasAllPermissions: () => true,
  }),
}));

/** Bubble the current location up to the test via a data attribute. */
function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}</div>;
}

/**
 * Capture dispatched messages by registering a mock dispatch fn — context now
 * uses a dispatchRef pattern instead of pendingMessage state.
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

function renderPalette(initialRoute = '/organizations/test-org/collections/objects') {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <WorkProvider>
        <AgentChatProvider>
          <Routes>
            <Route
              path="/organizations/:orgId/*"
              element={
                <>
                  <CommandPalette isOpen={true} onClose={vi.fn()} />
                  <ChatStateProbe />
                  <LocationProbe />
                </>
              }
            />
          </Routes>
        </AgentChatProvider>
      </WorkProvider>
    </MemoryRouter>,
  );
}

describe('CommandPalette', () => {
  beforeEach(() => {
    // Clean recent items so empty-state tests don't accidentally see leftovers
    localStorage.clear();
  });

  it('renders the search input and Ask Guide fallback on open', () => {
    renderPalette();
    expect(screen.getByPlaceholderText(/Jump to a page/i)).toBeInTheDocument();
    // Empty query shows the generic prompt
    expect(screen.getByText('Ask Guide anything…')).toBeInTheDocument();
  });

  it('surfaces a matching nav row as the user types', () => {
    renderPalette();
    const input = screen.getByPlaceholderText(/Jump to a page/i);
    fireEvent.change(input, { target: { value: 'conservation' } });
    // "Conservation" label appears as a jump-to result
    const labels = screen.getAllByText('Conservation');
    expect(labels.length).toBeGreaterThanOrEqual(1);
    // Ask Guide row rewrites to include the query
    expect(screen.getByText(/Ask Guide: "conservation"/)).toBeInTheDocument();
  });

  it('navigates on Enter when a nav row is selected', () => {
    renderPalette();
    const input = screen.getByPlaceholderText(/Jump to a page/i);
    fireEvent.change(input, { target: { value: 'conservation' } });
    // First row is selected by default — press Enter
    fireEvent.keyDown(input.closest('div')!, { key: 'Enter' });
    // LocationProbe reflects the new path with :orgId substituted
    expect(screen.getByTestId('location').textContent).toBe(
      '/organizations/test-org/collections/conservation',
    );
  });

  it('hands off to the Guide chat when Ask Guide is activated', () => {
    renderPalette();
    const input = screen.getByPlaceholderText(/Jump to a page/i);
    fireEvent.change(input, { target: { value: 'what is procedure 5.1' } });
    // Nonsense for nav matching — Ask Guide row should be the only non-header row
    // Navigate to the last row (Ask Guide) via ArrowDown once (matching nav rows
    // may be zero, so first ArrowDown lands on Ask Guide either way).
    const container = input.closest('div')!;
    fireEvent.keyDown(container, { key: 'ArrowDown' });
    fireEvent.keyDown(container, { key: 'ArrowDown' });
    fireEvent.keyDown(container, { key: 'ArrowDown' });
    fireEvent.keyDown(container, { key: 'ArrowDown' });
    fireEvent.keyDown(container, { key: 'ArrowDown' });
    // Click directly on the Ask Guide row — more deterministic than arrow-key
    // counting across potential nav matches.
    const askGuide = screen.getByText(/Ask Guide: "what is procedure 5\.1"/);
    fireEvent.click(askGuide);

    const chatState = screen.getByTestId('chat-state');
    expect(chatState.getAttribute('data-pending')).toBe('what is procedure 5.1');
    expect(chatState.getAttribute('data-open')).toBe('1');
  });

  it('arrow keys wrap selection around the list', () => {
    renderPalette();
    const input = screen.getByPlaceholderText(/Jump to a page/i);
    fireEvent.change(input, { target: { value: 'conservation' } });
    const container = input.closest('div')!;
    // Going up from index 0 wraps to the last row (Ask Guide)
    fireEvent.keyDown(container, { key: 'ArrowUp' });
    // Pressing Enter should fire Ask Guide, not a navigation
    fireEvent.keyDown(container, { key: 'Enter' });
    const chatState = screen.getByTestId('chat-state');
    expect(chatState.getAttribute('data-pending')).toBe('conservation');
  });
});
