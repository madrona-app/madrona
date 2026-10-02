import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DelegationCard } from '../../../components/agent/DelegationCard';
import type { AgentMessageUI } from '../../../hooks/useAgentChat';

type DelegationHint = AgentMessageUI & { kind: 'delegation' };

function makeHint(overrides: Partial<DelegationHint> = {}): DelegationHint {
  return {
    kind: 'delegation',
    specialist: 'registrar',
    answer: 'Use AAT 300010353 (oil paint).',
    rounds_used: 2,
    tool_calls: [
      { tool: 'lookup_vocabulary_term', succeeded: true, duration_ms: 142 },
    ],
    ...overrides,
  };
}

describe('DelegationCard', () => {
  it('renders the specialist label and answer', () => {
    render(<DelegationCard hint={makeHint()} />);
    expect(screen.getByText('Registrar said')).toBeInTheDocument();
    expect(screen.getByText(/Use AAT 300010353/)).toBeInTheDocument();
  });

  it('humanizes loans_registrar in the headline', () => {
    render(
      <DelegationCard hint={makeHint({ specialist: 'loans_registrar' })} />,
    );
    expect(screen.getByText('Loans Registrar said')).toBeInTheDocument();
  });

  it('falls back to the raw specialist key when unknown', () => {
    render(<DelegationCard hint={makeHint({ specialist: 'wizard' as never })} />);
    expect(screen.getByText('wizard said')).toBeInTheDocument();
  });

  it('shows the tool count chip when the specialist used tools', () => {
    render(<DelegationCard hint={makeHint()} />);
    expect(screen.getByText('1 tool')).toBeInTheDocument();
  });

  it('pluralizes the tool count chip when multiple tools were used', () => {
    render(
      <DelegationCard
        hint={makeHint({
          tool_calls: [
            { tool: 'lookup_vocabulary_term', succeeded: true, duration_ms: 80 },
            { tool: 'get_object_detail', succeeded: true, duration_ms: 50 },
          ],
        })}
      />,
    );
    expect(screen.getByText('2 tools')).toBeInTheDocument();
  });

  it('hides the trace by default and reveals it on click', () => {
    render(<DelegationCard hint={makeHint()} />);
    expect(screen.queryByText('lookup_vocabulary_term')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /registrar said/i }));
    expect(screen.getByText('lookup_vocabulary_term')).toBeInTheDocument();
    expect(screen.getByText('142ms')).toBeInTheDocument();
  });

  it('marks aborted delegations with a warning tint', () => {
    render(
      <DelegationCard
        hint={makeHint({ aborted: true, answer: '(could not finish)' })}
      />,
    );
    const card = screen.getByTestId('delegation-card');
    expect(card.className).toContain('semantic-warning');
  });

  it('falls back to "No answer returned" when no answer text is present', () => {
    render(<DelegationCard hint={makeHint({ answer: '' })} />);
    expect(screen.getByText(/No answer returned/i)).toBeInTheDocument();
  });

  it('surfaces the error message in the body when answer is empty and error is set', () => {
    render(
      <DelegationCard
        hint={makeHint({ answer: '', error: 'llm_error: timeout' })}
      />,
    );
    expect(
      screen.getByText(/Specialist returned an error: llm_error: timeout/i),
    ).toBeInTheDocument();
  });
});
