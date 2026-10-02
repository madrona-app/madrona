import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  ProcedureHelpTooltip,
  ProcedureFieldLabel,
} from '../../components/collections/ProcedureHelpTooltip';

const { openChatWithMessageMock } = vi.hoisted(() => ({
  openChatWithMessageMock: vi.fn(),
}));

vi.mock('../../contexts/AgentChatContext', () => ({
  useAgentChatContext: () => ({
    openChatWithMessage: openChatWithMessageMock,
  }),
}));

describe('ProcedureHelpTooltip', () => {
  it('renders the trigger with an aria-label', () => {
    render(
      <ProcedureHelpTooltip
        fieldId="entry_number"
        guidance="A unique identifier for this entry."
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Help for entry_number' }),
    ).toBeInTheDocument();
  });

  it('does not show the tooltip until trigger is clicked or hovered', () => {
    render(
      <ProcedureHelpTooltip
        fieldId="entry_number"
        guidance="A unique identifier for this entry."
      />,
    );
    expect(
      screen.queryByText('A unique identifier for this entry.'),
    ).not.toBeInTheDocument();
  });

  it('opens the tooltip on click and shows guidance and the reference', () => {
    render(
      <ProcedureHelpTooltip
        fieldId="entry_number"
        procedureRef="Object Entry"
        guidance="A unique identifier for this entry."
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Help for entry_number' }));
    expect(screen.getByText('A unique identifier for this entry.')).toBeInTheDocument();
    expect(screen.getByText(/Reference:/)).toBeInTheDocument();
    expect(screen.getByText(/Object Entry/)).toBeInTheDocument();
  });

  it('renders a Learn more link when learnMoreUrl is provided', () => {
    render(
      <ProcedureHelpTooltip
        fieldId="entry_number"
        guidance="Guidance"
        learnMoreUrl="https://example.com/help"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Help for entry_number' }));
    const link = screen.getByText('Learn more →').closest('a');
    expect(link).toHaveAttribute('href', 'https://example.com/help');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('calls openChatWithMessage with a contextual prompt when Ask Guide is clicked', () => {
    openChatWithMessageMock.mockReset();
    render(
      <ProcedureHelpTooltip
        fieldId="entry_number"
        fieldLabel="Entry Number"
        guidance="Some guidance."
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Help for entry_number' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Ask Guide about the Entry Number field' }),
    );
    expect(openChatWithMessageMock).toHaveBeenCalledTimes(1);
    expect(openChatWithMessageMock.mock.calls[0][0]).toContain('Entry Number');
  });

  it('falls back to fieldId (with underscores → spaces) when fieldLabel missing', () => {
    openChatWithMessageMock.mockReset();
    render(
      <ProcedureHelpTooltip fieldId="depositor_name" guidance="g" />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Help for depositor_name' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Ask Guide about the depositor name field' }),
    );
    expect(openChatWithMessageMock.mock.calls[0][0]).toContain('depositor name');
  });

  it('closes the tooltip when Escape is pressed', () => {
    render(
      <ProcedureHelpTooltip
        fieldId="entry_number"
        guidance="Some guidance."
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Help for entry_number' }));
    expect(screen.getByText('Some guidance.')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Some guidance.')).not.toBeInTheDocument();
  });

  it('closes the tooltip when clicking outside', () => {
    render(
      <div>
        <ProcedureHelpTooltip fieldId="entry_number" guidance="Some guidance." />
        <div data-testid="outside">outside</div>
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Help for entry_number' }));
    expect(screen.getByText('Some guidance.')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByText('Some guidance.')).not.toBeInTheDocument();
  });
});

describe('ProcedureFieldLabel', () => {
  it('renders label and required asterisk', () => {
    const { container } = render(
      <ProcedureFieldLabel htmlFor="my_field" label="Entry number" required />,
    );
    expect(screen.getByText('Entry number')).toBeInTheDocument();
    expect(container.querySelector('.text-semantic-error')?.textContent).toBe('*');
  });

  it('uses htmlFor on the underlying label element', () => {
    const { container } = render(
      <ProcedureFieldLabel htmlFor="my_field" label="Entry number" />,
    );
    const label = container.querySelector('label');
    expect(label?.getAttribute('for')).toBe('my_field');
  });

  it('renders the help tooltip trigger when guidance is provided', () => {
    render(
      <ProcedureFieldLabel
        htmlFor="my_field"
        label="Entry number"
        guidance="Some help"
      />,
    );
    expect(screen.getByRole('button', { name: 'Help for my_field' })).toBeInTheDocument();
  });

  it('omits the help tooltip when no guidance is provided', () => {
    render(<ProcedureFieldLabel htmlFor="my_field" label="Entry number" />);
    expect(screen.queryByRole('button', { name: /Help for/ })).not.toBeInTheDocument();
  });
});
